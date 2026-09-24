"""Estimating API — /api/estimating/* routes.

Backs the Estimating tab's single-source estimate model. Mirrors the MSW mock
contract in studio/src/mocks/handlers.ts exactly:

  * JSON is camelCase (matches studio/src/types/estimating.ts); the DB is
    snake_case. Conversion happens in the row<->dict mappers below.
  * Money is integer cents (BIGINT); percentages are decimals (0.22 = 22%).
  * estimate_type is IMMUTABLE after creation (mirrors the DB trigger).
  * Status changes go through the transition machine (ported from
    studio/src/lib/estimating/transitions.ts) — the ONE place lifecycle rules
    live — and every edge is persisted to estimate_status_transitions.

An Estimate is returned as a nested tree: estimate → sections → services →
components.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel

import api.attachments as _att_mod
from db import execute, query
from api import aspire_sync
from api import authz
from api import properties as _props_mod
from api.aspire_sync import OpportunityInput
from api.aspire_config import ASPIRE_BRANCH_MAP, ASPIRE_BRANCH_INSTALL_FALLBACKS

logger = logging.getLogger(__name__)


# ── Status transition machine (port of transitions.ts) ───────────────────────

STATUS_TRANSITIONS: dict[str, list[str]] = {
    "new_from_sales": ["queued", "in_progress"],
    "queued": ["in_progress"],
    "in_progress": ["review", "pending_approval", "approved"],
    "review": ["in_progress", "pending_approval", "approved"],
    "pending_approval": ["in_progress", "approved"],
    "approved": ["handed_back"],
    "handed_back": ["won", "lost"],
    "won": [],
    "lost": [],
}


# ── Lead → Pipeline-kanban write-back (Pipeline kanban redesign) ─────────────
#
# The Pipeline kanban's Estimating/OP Review/Approved columns are auto-driven
# by this estimate's own status — never manually settable on the kanban.
# Qualifying→Estimating fires on create (see create_estimate); the rest fires
# whenever an estimate's status lands on one of these keys, mapped to the
# lead's new LeadStatus.
ESTIMATE_TO_LEAD_STATUS: dict[str, str] = {
    "review": "op_review",
    "pending_approval": "op_review",
    "approved": "approved",
}


async def _write_back_lead_status(lead_id: Optional[str], status: str) -> None:
    """Best-effort UPDATE leads.status — no-op when lead_id is absent."""
    if not lead_id:
        return
    await execute("UPDATE leads SET status = %s WHERE id = %s", [status, lead_id])


async def _create_commission_on_won(estimate_id: str) -> None:
    """Insert a commission record when an estimate transitions to 'won'.

    No-ops silently when: the estimate has no lead, the lead has no crm_rep,
    or the rep has no active commission rate. Idempotent — the UNIQUE KEY on
    estimate_id means a duplicate won transition is a no-op at the DB layer.
    """
    rows = await query(
        """
        SELECT e.contract_value_cents, e.lead_id,
               l.crm_rep AS crm_rep_id
        FROM estimates e
        JOIN leads l ON l.id = e.lead_id
        WHERE e.id = %s
        """,
        [estimate_id],
    )
    if not rows:
        return
    row = rows[0]
    crm_rep_id = row.get("crm_rep_id")
    lead_id = row.get("lead_id")
    contract_value_cents = row.get("contract_value_cents") or 0
    if not crm_rep_id:
        return

    rate_rows = await query(
        """
        SELECT commission_rate
        FROM commission_rates
        WHERE user_id = %s
          AND effective_date <= CURDATE()
          AND (expires_date IS NULL OR expires_date > CURDATE())
        ORDER BY effective_date DESC
        LIMIT 1
        """,
        [crm_rep_id],
    )
    if not rate_rows:
        return
    commission_rate = float(rate_rows[0]["commission_rate"])
    commission_amount_cents = round(contract_value_cents * commission_rate)

    await execute(
        """
        INSERT IGNORE INTO commissions
            (estimate_id, lead_id, user_id, contract_value_cents,
             commission_rate, commission_amount_cents, status, approved_at)
        VALUES (%s, %s, %s, %s, %s, %s, 'approved', NOW())
        """,
        [estimate_id, lead_id, crm_rep_id, contract_value_cents,
         commission_rate, commission_amount_cents],
    )


# ── Crew-rate snapshot on transitions (Handoff 38 §2.6 — LOCKED) ─────────────
#
# estimates.crew_rate_cents_per_hour is the branch crew rate *frozen* at the
# moment an estimate enters review/approval, so the displayed margin stops
# moving once it is under review. It is:
#   FREEZE    on entry to review / pending_approval / approved
#   CLEAR     on entry to in_progress (the hand-back to the estimating queue)
#   PRESERVE  everywhere else (approved → handed_back → won | lost keep it)
#
# All three freeze targets are handled because in_progress→pending_approval and
# review→approved are both legal edges that skip the middle state. Freeze is
# expressed as "snapshot only if not already frozen": that snapshots the live
# rate once, on the FIRST entry to a frozen state, and preserves it across the
# later frozen edges — so a mid-review branch-rate change never restates the
# margin (§2.6). A branch with no branch_settings row is left NULL, never
# invented (the §2.3 loud-failure path); it must not raise.
_FREEZE_STATES = frozenset({"review", "pending_approval", "approved"})


async def _snapshot_crew_rate_on_transition(
    estimate_id: str, target_status: str, current: dict
) -> None:
    """Manage estimates.crew_rate_cents_per_hour across a status transition.

    Freezes (snapshots) the branch rate on first entry to a frozen state, clears
    it on the hand-back to in_progress, and does nothing otherwise. No-op when the
    status is not actually changing.

    CLEAR path (§2.6): when entering in_progress, the frozen snapshot is
    preserved into prior_crew_rate_cents_per_hour in ONE atomic UPDATE so the
    estimator's notice ("Crew rate changed $X → $Y since this was submitted")
    can compare the submitted-at rate against the current live branch rate.
    """
    if target_status == current.get("status"):
        return  # same-status PATCH — not a transition

    if target_status == "in_progress":
        # Hand-back to the estimating queue: copy the frozen snapshot into
        # prior_crew_rate_cents_per_hour BEFORE nulling it — single atomic write
        # so the submitted-at rate is never lost. prior=NULL when the estimate
        # had no snapshot (e.g. handed back before any freeze occurred).
        await execute(
            "UPDATE estimates "
            "SET prior_crew_rate_cents_per_hour = crew_rate_cents_per_hour, "
            "    crew_rate_cents_per_hour = NULL "
            "WHERE id = %s",
            [estimate_id],
        )
        return

    if target_status not in _FREEZE_STATES:
        return  # PRESERVE — handed_back / won / lost never touch the column

    # FREEZE. Snapshot once: if it is already frozen (a later review→approved
    # style edge), keep the existing value rather than re-reading a rate that may
    # have changed mid-review.
    if current.get("crew_rate_cents_per_hour") is not None:
        return

    branch_id = current.get("aspire_branch_id")
    if branch_id is None:
        return  # no branch ⇒ no rate to snapshot; leave NULL (loud-failure path)
    rate_rows = await query(
        "SELECT crew_rate_cents_per_hour FROM branch_settings WHERE aspire_branch_id = %s",
        [branch_id],
    )
    if not rate_rows or rate_rows[0].get("crew_rate_cents_per_hour") is None:
        return  # branch has no configured crew rate — do NOT invent one
    await execute(
        "UPDATE estimates SET crew_rate_cents_per_hour = %s WHERE id = %s",
        [int(rate_rows[0]["crew_rate_cents_per_hour"]), estimate_id],
    )


class IllegalTransitionError(Exception):
    def __init__(self, frm: str, to: str) -> None:
        super().__init__(f"Illegal estimate status transition: {frm} → {to}")


def _can_transition(frm: str, to: str) -> bool:
    return to in STATUS_TRANSITIONS.get(frm, [])


def _side_effects(to: str) -> dict:
    # WON is the Aspire milestone where ownership transfers to the CRM.
    if to == "won":
        return {"lifecycle": "won", "aspire_owner": "crm"}
    return {}


def _can_approve_and_hand_back(status: str) -> bool:
    return status == "approved" or _can_transition(status, "approved")


def _approve_and_hand_back(estimate_id: str, status: str, actor: str, at: str):
    """Chain approved → handed_back. Returns (patch, records)."""
    if not _can_approve_and_hand_back(status):
        raise IllegalTransitionError(status, "handed_back")
    steps = ["handed_back"] if status == "approved" else ["approved", "handed_back"]
    patch: dict = {"status": status}
    records: list[dict] = []
    current = status
    for to in steps:
        if not _can_transition(current, to):
            raise IllegalTransitionError(current, to)
        patch = {**patch, "status": to, **_side_effects(to)}
        records.append(
            {"estimateId": estimate_id, "from": current, "to": to, "actor": actor, "at": at}
        )
        current = to
    return patch, records


# ── Row <-> JSON mapping (snake_case DB <-> camelCase API) ────────────────────

def _now_utc() -> datetime:
    # Naive UTC to match the DB's DATETIME columns (no tz), but sourced from a
    # tz-aware clock so we don't depend on the deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _num(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    return v


# Contract-structure budgets on a maintenance estimate (split: homes vs common
# area). Dollars, not cents — the intake form collects them as dollar amounts.
# NULL is unknown. A known zero stays zero. Do not coerce NULL to 0.
_CONTRACT_BUDGET_FIELDS: tuple[tuple[str, str], ...] = (
    ("homesBudget", "homes_budget"),
    ("commonAreaBudget", "common_area_budget"),
)
_BUDGET_QUANT = Decimal("0.01")
_BUDGET_MAX = Decimal("9999999999999.99")


def parse_optional_budget(value: Any, field: str) -> Optional[Decimal]:
    """Parse one contract-structure budget.

    Omitted, null, and blank (including whitespace) are unknown → None.
    0 / "0" / 0.0 stay zero. Non-numeric values and negatives are rejected.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        raise HTTPException(status_code=400, detail=f"{field} must be a number, blank, or null")
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            return None
        try:
            amount = Decimal(text)
        except InvalidOperation:
            raise HTTPException(
                status_code=400, detail=f"{field} must be a number, blank, or null"
            )
    elif isinstance(value, (int, float, Decimal)):
        if isinstance(value, float) and not math.isfinite(value):
            raise HTTPException(
                status_code=400, detail=f"{field} must be a number, blank, or null"
            )
        try:
            amount = value if isinstance(value, Decimal) else Decimal(str(value))
        except InvalidOperation:
            raise HTTPException(
                status_code=400, detail=f"{field} must be a number, blank, or null"
            )
    else:
        raise HTTPException(status_code=400, detail=f"{field} must be a number, blank, or null")
    if not amount.is_finite():
        raise HTTPException(status_code=400, detail=f"{field} must be a number, blank, or null")
    amount = amount.quantize(_BUDGET_QUANT, rounding=ROUND_HALF_UP)
    if amount < 0:
        raise HTTPException(status_code=400, detail=f"{field} cannot be negative")
    if amount > _BUDGET_MAX:
        raise HTTPException(status_code=400, detail=f"{field} is too large")
    return amount


def _budget_json_number(amount: Decimal) -> int | float:
    """Whole dollar amounts stay ints so 0 is 0, not 0.0."""
    integral = amount.to_integral_value()
    if amount == integral:
        return int(integral)
    return float(amount)


def _budget_db_value(amount: Optional[Decimal]) -> Optional[int | float]:
    if amount is None:
        return None
    return _budget_json_number(amount)


def _budget_out(value: Any) -> Optional[int | float]:
    """Serialize a stored budget. None stays None — never an invented zero."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return _budget_json_number(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return _budget_json_number(Decimal(str(value)))
    return None


def combine_contract_budgets(homes: Any, common_area: Any) -> Optional[Decimal]:
    """Sum the two contract-structure budgets.

    A null budget is unknown, not zero, so the total is unknown unless both
    amounts are known: None + 0 is None, and 0 + 0 is 0. Priced totals
    (contract_value_cents, the ITB LS/IR split, commissions, sales performance)
    must not substitute this figure, and Aspire's opportunity payload does not
    carry it — sending 0 for an unknown budget would understate the deal.
    """
    if homes is None or common_area is None:
        return None
    return Decimal(str(homes)) + Decimal(str(common_area))


def _intake_payload_dict(body: dict) -> Optional[dict]:
    """The dict create_estimate will persist as the intake payload, if any."""
    intake = body.get("intake")
    if not isinstance(intake, dict):
        return None
    nested = intake.get("payload")
    if isinstance(nested, dict):
        return nested
    if "payload" not in intake:
        return intake
    return None


def _normalize_present_budgets(payload: dict) -> None:
    """Rewrite budget keys already on a payload: blank → null, numeric string → number."""
    for camel, _col in _CONTRACT_BUDGET_FIELDS:
        if camel in payload:
            payload[camel] = _budget_db_value(parse_optional_budget(payload[camel], camel))


def _resolve_contract_budgets(body: dict) -> tuple[Optional[int | float], Optional[int | float]]:
    """Column values for homes_budget and common_area_budget.

    Top-level body keys win over the same names inside intake.payload (the
    maintenance form posts them there). Omitted from both → None. When a value
    is resolved from either place, the payload copy is rewritten so the stored
    intake JSON matches the columns (blank strings do not survive).
    """
    payload = _intake_payload_dict(body)
    if payload is not None:
        _normalize_present_budgets(payload)
    resolved: list[Optional[int | float]] = []
    for camel, _col in _CONTRACT_BUDGET_FIELDS:
        if camel in body:
            number = _budget_db_value(parse_optional_budget(body[camel], camel))
            if payload is not None:
                payload[camel] = number
        elif payload is not None and camel in payload:
            number = payload[camel]
        else:
            number = None
        resolved.append(number)
    return resolved[0], resolved[1]


def _coerce_budget_patch(body: dict) -> None:
    """Normalize budget keys on a PATCH body in place. Absent keys are left absent."""
    for camel, _col in _CONTRACT_BUDGET_FIELDS:
        if camel in body:
            body[camel] = _budget_db_value(parse_optional_budget(body[camel], camel))


def _iso(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _component_out(r: dict) -> dict:
    return {
        "id": r["id"],
        "sectionServiceId": r["section_service_id"],
        "kind": r["kind"],
        "label": r["label"],
        "qty": _num(r["qty"]),
        "unitCostCents": int(r["unit_cost_cents"]),
        "hours": _num(r["hours"]),
        "sortOrder": r["sort_order"],
    }


def _service_out(
    r: dict, components: list[dict], catalog_data: Optional[dict] = None
) -> dict:
    """Serialize one section_service row.

    `catalog_data` is the joined catalog_items row (service_type, scope_text,
    billing_type) that the contract generator reads to split recurring from
    one-time services and print each service's scope paragraph. Only
    _load_estimate has it in hand; the single-row routes below pass nothing and
    the derived fields serialize as None, matching the optional fields on the
    SectionService TS interface.

    billingType resolves the per-line override first (migration 046), falling
    back to the catalog item. A hand-entered line has no catalog item, so
    without the override it would resolve to None and drop out of the
    contract's payment-schedule base. Mirrors the `discipline` override.
    """
    return {
        "id": r["id"],
        "sectionId": r["section_id"],
        "catalogItemId": r["catalog_item_id"],
        "discipline": r.get("discipline"),
        "label": r["label"],
        "qty": _num(r["qty"]),
        "uom": r["uom"],
        "complexityPct": _num(r["complexity_pct"]),
        "unitSellCents": None if r["unit_sell_cents"] is None else int(r["unit_sell_cents"]),
        "embeddedCostCents": None if r["embedded_cost_cents"] is None else int(r["embedded_cost_cents"]),
        "targetGm": _num(r["target_gm"]),
        "hours": _num(r["hours"]),
        "sortOrder": r["sort_order"],
        # Contract generator fields, sourced from the line's catalog item.
        "serviceType": (catalog_data or {}).get("service_type"),
        "scopeText": (catalog_data or {}).get("scope_text"),
        "billingType": r.get("billing_type") or (catalog_data or {}).get("billing_type"),
        "components": components,
    }


def _section_out(r: dict, services: list[dict]) -> dict:
    return {
        "id": r["id"],
        "estimateId": r["estimate_id"],
        "name": r["name"],
        "squareFeet": _num(r["square_feet"]),
        "sortOrder": r["sort_order"],
        "services": services,
    }


def _estimate_out(r: dict, sections: list[dict]) -> dict:
    return {
        "id": r["id"],
        "estimateType": r["estimate_type"],
        "name": r["name"],
        "aspireNumber": r["aspire_number"],
        "estimateNumber": r.get("estimate_number"),
        "clientName": r["client_name"],
        # Branch identity rides on the Aspire BranchID (int).
        # Slice 14: branchCity now comes from the LEFT JOIN to branches on
        # aspire_branch_id (aliased as branch_city in _load_estimate's SELECT).
        # NULL when aspire_branch_id is not set or matches no branches row.
        "aspireBranchId": r.get("aspire_branch_id"),
        "branchCity": r.get("branch_city"),
        # Frozen crew-rate snapshot (cents/hr) captured at submission (Slice 7);
        # NULL for in_progress / pre-migration rows. Slice 11b: the Margin
        # Analysis panel prices maintenance margin off THIS when present, so a
        # later branch-rate change never moves a frozen estimate's margin. Never
        # substitutes an invented number — null flows straight through (§2.3).
        "crewRateCentsPerHour": r.get("crew_rate_cents_per_hour"),
        # Submitted-at crew rate preserved when clearing on hand-back (§2.6).
        # Non-null when an estimate was handed back after a freeze; null for fresh
        # in_progress estimates and pre-migration rows. The frontend uses this to
        # show "Crew rate changed $X → $Y since this was submitted".
        "priorCrewRateCentsPerHour": r.get("prior_crew_rate_cents_per_hour"),
        "customerType": r["customer_type"],
        # Split-contract budgets in dollars. Null is unknown (the rep did not
        # have the number), distinct from a known zero. Single-structure
        # contracts and pre-migration rows come back null.
        "homesBudget": _budget_out(r.get("homes_budget")),
        "commonAreaBudget": _budget_out(r.get("common_area_budget")),
        "acreage": _num(r["acreage"]),
        "contractValueCents": int(r["contract_value_cents"]),
        "targetMargin": _num(r["target_margin"]),
        "status": r["status"],
        "lifecycle": r["lifecycle"],
        "aspireOwner": r["aspire_owner"],
        "priority": r["priority"],
        "winProbability": _num(r["win_probability"]),
        "siteWalkDate": _iso(r["site_walk_date"]),
        "dueBackDate": _iso(r["due_back_date"]),
        "anticipatedCloseDate": _iso(r["anticipated_close_date"]),
        "serviceStartDate": _iso(r["service_start_date"]),
        "assignedLsEstimator": r["assigned_ls_estimator"],
        "assignedIrrEstimator": r["assigned_irr_estimator"],
        "crmRep": r["crm_rep"],
        "approvalSettings": {"notifyBmRdOnReturn": bool(r["notify_bm_rd_on_return"])}
        if r.get("notify_bm_rd_on_return") is not None
        else None,
        "notes": r.get("notes"),
        # Aspire integration fields (.get keeps pre-migration rows working).
        "propertyId": r.get("property_id"),
        # Pipeline kanban redesign — logical ref to the originating lead; drives
        # the lead→estimate status write-back. (.get keeps pre-migration rows working.)
        "leadId": r.get("lead_id"),
        "aspireOpportunityId": r.get("aspire_opportunity_id"),
        "aspireSyncStatus": r.get("aspire_sync_status"),
        # Install RFI status, tracked first-class. Capture and
        # display only: nothing gates approval on it. (.get keeps pre-migration
        # rows working.)
        "rfiStatus": r.get("rfi_status"),
        # Takeoff metadata (turf/curb). Estimator-entered, and also written by
        # Beam ingest after unit conversion — Beam returns sq ft and ft, these
        # columns are acres and miles. (.get keeps pre-migration rows working.)
        "turfAreaAcres": _num(r.get("turf_area_acres")),
        "curbMiles": _num(r.get("curb_miles")),
        # Set when Attentive redelivered measurements after this estimate was
        # priced. Non-null means the price on screen may be stale.
        "takeoffChangedAt": _iso(r["takeoff_changed_at"]) if r.get("takeoff_changed_at") else None,
        "sections": sections,
        "createdAt": _iso(r["created_at"]),
        "updatedAt": _iso(r["updated_at"]),
    }


async def _load_estimate(estimate_id: str) -> Optional[dict]:
    """Assemble the full estimate → sections → services → components tree.

    Slice 14: LEFT JOIN to branches on aspire_branch_id so that branchCity is
    sourced from the canonical branches table rather than the legacy estimates.branch
    city string. The alias `branch_city` is consumed by _estimate_out. NULL when
    aspire_branch_id is unset or no matching branches row exists (§2.3 no-fallback).
    """
    rows = await query(
        "SELECT e.*, b.city AS branch_city "
        "FROM estimates e "
        "LEFT JOIN branches b ON b.aspire_branch_id = e.aspire_branch_id "
        "WHERE e.id = %s",
        [estimate_id],
    )
    if not rows:
        return None
    est = rows[0]

    section_rows = await query(
        "SELECT * FROM estimate_sections WHERE estimate_id = %s ORDER BY sort_order",
        [estimate_id],
    )
    section_ids = [s["id"] for s in section_rows]

    service_rows = []
    if section_ids:
        placeholders = ", ".join(["%s"] * len(section_ids))
        service_rows = await query(
            f"SELECT * FROM section_services WHERE section_id IN ({placeholders}) ORDER BY sort_order",
            section_ids,
        )
    service_ids = [sv["id"] for sv in service_rows]

    component_rows = []
    if service_ids:
        placeholders = ", ".join(["%s"] * len(service_ids))
        component_rows = await query(
            f"SELECT * FROM section_service_components WHERE section_service_id IN ({placeholders}) ORDER BY sort_order",
            service_ids,
        )

    comps_by_service: dict[str, list[dict]] = {}
    for c in component_rows:
        comps_by_service.setdefault(c["section_service_id"], []).append(_component_out(c))

    # Fetch catalog_items data for contract generator fields (scope_text, billing_type, service_type)
    catalog_data_by_id: dict[str, dict] = {}
    catalog_item_ids = {sv["catalog_item_id"] for sv in service_rows if sv.get("catalog_item_id")}
    if catalog_item_ids:
        placeholders = ", ".join(["%s"] * len(catalog_item_ids))
        catalog_rows = await query(
            f"SELECT id, service_type, scope_text, billing_type FROM catalog_items WHERE id IN ({placeholders})",
            list(catalog_item_ids),
        )
        catalog_data_by_id = {r["id"]: r for r in catalog_rows}

    services_by_section: dict[str, list[dict]] = {}
    for sv in service_rows:
        catalog_data = catalog_data_by_id.get(sv.get("catalog_item_id"))
        services_by_section.setdefault(sv["section_id"], []).append(
            _service_out(sv, comps_by_service.get(sv["id"], []), catalog_data)
        )

    sections = [_section_out(s, services_by_section.get(s["id"], [])) for s in section_rows]
    return _estimate_out(est, sections)


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# ── Aspire sync (best-effort, via the aspire_sync port only) ─────────────────
#
# The domain speaks ZERO Aspire vocabulary: it builds a neutral OpportunityInput
# and hands it to the port. Create/patch always succeed locally; the push is a
# background task whose SyncResult is persisted to the estimate's own
# aspire_sync_status/error columns. A lifespan sweep re-pushes pending/failed
# rows, so a single failed attempt is self-healing (no per-call retry needed).

# Service line defaults per estimate type (decision #8); the Phase 2 dropdown may
# override via the `serviceLine` create field.
DEFAULT_SERVICE_LINE = {
    "maintenance": "Maintenance: Contract",
    "install": "Install: Landscape",
}
# Maps our customer_type onto Aspire's sales-type vocabulary (port ignores misses).
SALES_TYPE_BY_CUSTOMER = {"hoa": "HOA", "commercial": "commercial"}

_SWEEP_INTERVAL_SECONDS = int(os.environ.get("ASPIRE_SWEEP_INTERVAL", "300"))


def _territory_city_for_branch(aspire_branch_id: Any) -> str:
    """City key in ASPIRE_BRANCH_MAP for an Aspire BranchID, or '' if unknown."""
    if aspire_branch_id is None:
        return ""
    for (city, _is_install), bid in ASPIRE_BRANCH_MAP.items():
        if bid == aspire_branch_id:
            return city
    return ""


async def _build_opportunity_input(est_row: dict, service_line: Optional[str] = None) -> OpportunityInput:
    """Assemble a neutral OpportunityInput from the estimate + its property/rep rows.

    All DB reads for the mapping live here (never in the port). The linked
    property supplies the Aspire PropertyID and the city-level branch key; the
    crm_rep supplies the Aspire ContactID for SalesRepContactID.
    """
    aspire_property_id: Optional[int] = None
    branch_city: Optional[str] = None
    property_type: Optional[str] = None
    if est_row.get("property_id"):
        prows = await query(
            "SELECT aspire_property_id, branch_city, property_type FROM properties WHERE id = %s",
            [est_row["property_id"]],
        )
        if prows:
            aspire_property_id = prows[0].get("aspire_property_id")
            branch_city = prows[0].get("branch_city")
            property_type = prows[0].get("property_type")

    rep_contact_id: Optional[int] = None
    if est_row.get("crm_rep"):
        urows = await query(
            "SELECT aspire_rep_id FROM users WHERE id = %s", [est_row["crm_rep"]]
        )
        if urows:
            rep_contact_id = urows[0].get("aspire_rep_id")

    est_type = est_row.get("estimate_type")
    return OpportunityInput(
        name=est_row.get("name", ""),
        service_line=service_line or DEFAULT_SERVICE_LINE.get(est_type, "Maintenance: Contract"),
        # estimates.branch was dropped by migration 022. The replacement identity
        # is aspire_branch_id; reverse it through the vendored city map when the
        # property has no branch_city of its own.
        branch_city=branch_city or _territory_city_for_branch(est_row.get("aspire_branch_id")),
        is_install=(est_type == "install"),
        aspire_property_id=aspire_property_id,
        aspire_rep_contact_id=rep_contact_id,
        # customer_type wins; the canonical property's property_type is the
        # fallback so lead-origin estimates still map a sales type.
        sales_type=SALES_TYPE_BY_CUSTOMER.get(
            est_row.get("customer_type") or property_type
        ),
        lead_source="manual",
    )


def _sync_status_col(status: str) -> str:
    """Map a port status onto the aspire_sync_status enum (disabled ⇒ pending)."""
    return {"synced": "synced", "failed": "failed"}.get(status, "pending")


async def _persist_sync_result(estimate_id: str, res, *, set_ids: bool = True) -> None:
    """Write a SyncResult back onto the estimate's sync columns."""
    status_col = _sync_status_col(res.status)
    synced_at = _now_utc() if res.status == "synced" else None
    if set_ids:
        await execute(
            """UPDATE estimates
                 SET aspire_opportunity_id = COALESCE(%s, aspire_opportunity_id),
                     aspire_number = COALESCE(%s, aspire_number),
                     aspire_sync_status = %s,
                     aspire_sync_error = %s,
                     aspire_synced_at = %s,
                     updated_at = CURRENT_TIMESTAMP
               WHERE id = %s""",
            [res.aspire_opportunity_id, res.aspire_number, status_col, res.error, synced_at, estimate_id],
        )
    else:
        await execute(
            """UPDATE estimates
                 SET aspire_sync_status = %s,
                     aspire_sync_error = %s,
                     aspire_synced_at = %s,
                     updated_at = CURRENT_TIMESTAMP
               WHERE id = %s""",
            [status_col, res.error, synced_at, estimate_id],
        )


async def _sync_new_opportunity_bg(estimate_id: str, service_line: Optional[str] = None) -> None:
    rows = await query("SELECT * FROM estimates WHERE id = %s", [estimate_id])
    if not rows:
        return
    inp = await _build_opportunity_input(rows[0], service_line)
    res = await aspire_sync.push_new_opportunity(inp)
    await _persist_sync_result(estimate_id, res, set_ids=True)


async def _sync_status_bg(estimate_id: str, new_status: str, lost_reason_id: Optional[int] = None) -> None:
    rows = await query(
        "SELECT aspire_opportunity_id, aspire_lost_reason_id FROM estimates WHERE id = %s",
        [estimate_id],
    )
    if not rows:
        return
    # Sweep re-pushes call this without a reason; fall back to the persisted one.
    reason = lost_reason_id if lost_reason_id is not None else rows[0].get("aspire_lost_reason_id")
    res = await aspire_sync.push_status(rows[0].get("aspire_opportunity_id"), new_status, reason)
    await _persist_sync_result(estimate_id, res, set_ids=False)


async def sweep_once(limit: int = 50) -> None:
    """Re-push a bounded batch of estimates whose Aspire sync is pending/failed."""
    rows = await query(
        """SELECT id, status, aspire_opportunity_id FROM estimates
             WHERE aspire_sync_status IN ('pending','failed')
             ORDER BY updated_at LIMIT %s""",
        [limit],
    )
    for r in rows:
        if r.get("aspire_opportunity_id") is None:
            await _sync_new_opportunity_bg(r["id"])
        elif r.get("status") in ("won", "lost"):
            await _sync_status_bg(r["id"], r["status"])


async def sweep_loop() -> None:
    """Periodic durability sweep — started from the app lifespan when sync is on."""
    while True:
        await asyncio.sleep(_SWEEP_INTERVAL_SECONDS)
        try:
            await sweep_once()
        except Exception:  # never let the sweep loop die
            logger.exception("aspire sync sweep failed")


# ── Takeoff lines ──────────────────────────────────────────────────────────
#
# Derived fields (bid_qty / flagged / delta_vs_opp) are RECOMPUTED here —
# never stored, never trusted from the client. The flag
# threshold is config (default 10%, range 1–25%; mirrors DISCREPANCY_THRESHOLD
# in studio/src/lib/estimating/config.ts) and is deliberately not a row column.
# opportunity_qty is a LOCALLY-set, manually-editable value — it is never read
# from Aspire (locked decision).

# §5.4 — this constant was "defined twice" (here AND studio/.../config.ts). The
# backend source of truth is now company_settings.discrepancy_threshold_pct
# (read via _discrepancy_threshold); this value survives ONLY as the last-resort
# fallback for when that singleton row is somehow missing. The seed equals this
# value, so moving the source changes no behaviour.
DISCREPANCY_DEFAULT_THRESHOLD = 0.10


async def _discrepancy_threshold() -> float:
    """Read the discrepancy flag threshold from company_settings (§5.4).

    Falls back to DISCREPANCY_DEFAULT_THRESHOLD only when the singleton row is
    absent — never invents a different number.
    """
    rows = await query(
        "SELECT discrepancy_threshold_pct FROM company_settings WHERE id = %s", [1]
    )
    if not rows or rows[0].get("discrepancy_threshold_pct") is None:
        return DISCREPANCY_DEFAULT_THRESHOLD
    return float(rows[0]["discrepancy_threshold_pct"])

_TAKEOFF_COLS = {
    "description": "description",
    "uom": "uom",
    "planQty": "plan_qty",
    "addPct": "add_pct",
    "measuredQty": "measured_qty",
    "opportunityQty": "opportunity_qty",
    "catalogItemId": "catalog_item_id",
}


def _bid_qty(plan_qty: float, add_pct: float) -> int:
    """round(plan × (1 + add%)) — half-up, mirroring JS Math.round in
    studio/src/lib/estimating/calc.ts (locked: round, not ceil)."""
    return int(math.floor(plan_qty * (1 + add_pct) + 0.5))


def _takeoff_flagged(
    measured_qty: float, plan_qty: float, threshold: float = DISCREPANCY_DEFAULT_THRESHOLD
) -> bool:
    if plan_qty == 0:
        return False
    return abs(measured_qty - plan_qty) / plan_qty > threshold


def _takeoff_line_out(r: dict, threshold: float = DISCREPANCY_DEFAULT_THRESHOLD) -> dict:
    plan = float(_num(r["plan_qty"]) or 0)
    add = float(_num(r["add_pct"]) or 0)
    measured = float(_num(r["measured_qty"]) or 0)
    opp = float(_num(r["opportunity_qty"]) or 0)
    return {
        "id": r["id"],
        "estimateId": r["estimate_id"],
        "description": r["description"],
        "uom": r["uom"],
        "planQty": plan,
        "addPct": add,
        "measuredQty": measured,
        "opportunityQty": opp,
        "catalogItemId": r.get("catalog_item_id"),
        # Derived server-side at the config threshold (company_settings, §5.4) —
        # the UI's live slider re-derives client-side; these are never stored.
        "bidQty": _bid_qty(plan, add),
        "flagged": _takeoff_flagged(measured, plan, threshold),
        "deltaVsOpp": measured - opp,
    }


async def _push_takeoff_qtys_bg(estimate_id: str) -> None:
    """ONE batched, best-effort qty push on estimate Save.

    Pushes every takeoff line that carries a catalog_item_id (a single pass,
    not a call per edit) to OpportunityServiceItem.ItemQuantity via the
    aspire_sync port. Strictly non-blocking: any failure is logged, never
    raised — an Aspire outage must not fail the Save. (Separate from the
    property→Aspire sync, which fires on estimate submit.)
    """
    try:
        if not aspire_sync.sync_enabled():
            return
        rows = await query(
            "SELECT aspire_opportunity_id FROM estimates WHERE id = %s", [estimate_id]
        )
        if not rows:
            return
        line_rows = await query(
            """SELECT catalog_item_id, opportunity_qty, uom FROM takeoff_lines
                 WHERE estimate_id = %s AND catalog_item_id IS NOT NULL""",
            [estimate_id],
        )
        lines = [
            aspire_sync.TakeoffQtyLine(
                catalog_item_id=r["catalog_item_id"],
                qty=float(_num(r["opportunity_qty"]) or 0),
                uom=r.get("uom"),
            )
            for r in line_rows
        ]
        if not lines:
            return
        res = await aspire_sync.push_opportunity_service_item_qty(
            rows[0].get("aspire_opportunity_id"), lines
        )
        if res.status not in ("synced", "disabled"):
            logger.warning(
                "takeoff qty push %s for estimate %s: %s", res.status, estimate_id, res.error
            )
    except Exception:  # best-effort by contract — never propagate
        logger.exception("takeoff qty push failed for estimate %s", estimate_id)


# ── Update helpers (one place for the camel→snake PATCH pattern) ─────────────

async def _apply_updates(
    table: str, colmap: dict[str, str], body: dict, pk_value: str, *, touch_updated_at: bool = False
) -> None:
    """Persist the subset of `body`'s camelCase keys present in `colmap`.

    Builds a single UPDATE against `table` keyed by its `id` column. With
    `touch_updated_at`, also bumps `updated_at` in the same statement (and runs
    even when no mapped fields are present). Otherwise a body with none of the
    mapped keys is a no-op.
    """
    set_parts: list[str] = []
    params: list[Any] = []
    for camel, col in colmap.items():
        if camel in body:
            set_parts.append(f"{col} = %s")
            params.append(body[camel])
    if touch_updated_at:
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
    elif not set_parts:
        return
    params.append(pk_value)
    await execute(
        f"UPDATE {table} SET {', '.join(set_parts)} WHERE id = %s", params
    )


async def _next_sort_order(table: str, fk_col: str, fk_value: str, body: dict) -> int:
    """Explicit sortOrder from the body, else append after the current max index."""
    if "sortOrder" in body:
        return body["sortOrder"]
    rows = await query(
        f"SELECT COUNT(*) AS c FROM {table} WHERE {fk_col} = %s", [fk_value]
    )
    return rows[0]["c"]


# ── Write helpers (persist nested tree) ──────────────────────────────────────

async def _insert_intake_submission(
    estimate_id: str, estimate_type: str, intake: dict, submitted_by: str
) -> str:
    """Persist a raw intake payload (+ any attachment metadata) verbatim.

    The structured intake form lives in intake_submissions/intake_attachments —
    NEVER in estimate.notes (that column is a short human queue note). Attachment
    file bytes are future scope; only names surface here (inside the payload) until
    real uploads land.
    """
    submission_id = _new_id("ins")
    payload = intake.get("payload", intake)
    await execute(
        """INSERT INTO intake_submissions
             (id, estimate_id, estimate_type, payload, submitted_by)
           VALUES (%s, %s, %s, %s, %s)""",
        [submission_id, estimate_id, estimate_type, json.dumps(payload), submitted_by],
    )
    for att in intake.get("attachments") or []:
        await execute(
            """INSERT INTO intake_attachments
                 (id, intake_submission_id, file_name, content_type, size_bytes, url)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            [
                _new_id("att"),
                submission_id,
                att.get("fileName", ""),
                att.get("contentType", ""),
                att.get("sizeBytes", 0),
                att.get("url", ""),
            ],
        )
    return submission_id


def _intake_out(r: dict) -> dict:
    payload = r["payload"]
    if isinstance(payload, (str, bytes, bytearray)):
        payload = json.loads(payload)
    return {
        "id": r["id"],
        "estimateId": r["estimate_id"],
        "estimateType": r["estimate_type"],
        "payload": payload,
        "submittedBy": r["submitted_by"],
        "createdAt": _iso(r["created_at"]),
    }


def _draft_out(r: dict) -> dict:
    """Serialize an intake_submissions DRAFT row.

    Drafts are partial intakes saved before submission: estimate_id is NULL
    (a draft never creates an estimate) and is_draft=1. They are per-user and
    device-independent — the modal resumes them from any browser.
    """
    payload = r["payload"]
    if isinstance(payload, (str, bytes, bytearray)):
        payload = json.loads(payload)
    return {
        "id": r["id"],
        "estimateType": r["estimate_type"],
        "payload": payload,
        "submittedBy": r["submitted_by"],
        "isDraft": True,
        "createdAt": _iso(r["created_at"]),
    }


# The Takeoff Insert scan is a scanned map image (or PDF); the
# intake kinds stay PDF-only at the endpoint layer.
_SCAN_CONTENT_TYPES = frozenset(
    {"application/pdf", "image/png", "image/jpeg", "image/webp"}
)

# Kinds that hang directly off intake_attachments.estimate_id with a NULL
# intake_submission_id — no intake submission required (Handoff 27 for
# takeoff_scan, Handoff 47 for the three proposal kinds). Everything NOT in this
# set is intake-submission-scoped and 404s without a submission. A membership
# test, not a growing `!= takeoff_scan` chain.
_ESTIMATE_SCOPED_KINDS = frozenset(
    {"takeoff_scan", "proposal_contract", "proposal_measurements", "proposal_other"}
)

# All valid attachment kinds. Unknown kinds coerce to 'other' (legacy behaviour);
# the three proposal kinds must NOT coerce, or a proposal document uploads as an
# intake 'other' row and the render silently finds nothing to append (§3.2).
_VALID_ATTACHMENT_KINDS = frozenset(
    {"property_map", "rfp", "other", "takeoff_scan",
     "proposal_contract", "proposal_measurements", "proposal_other"}
)

# The three proposal-document kinds (validated at confirm; appended at render).
_PROPOSAL_DOC_KINDS = frozenset(
    {"proposal_contract", "proposal_measurements", "proposal_other"}
)

# Proposal-document kinds accept images as well as PDF, EXCEPT the contract,
# which stays PDF-only (an Aspire printout; an image there is a screenshotted
# contract). measurements/other accept scans via _SCAN_CONTENT_TYPES (§3.2).
_IMAGE_OR_PDF_KINDS = frozenset(
    {"takeoff_scan", "proposal_measurements", "proposal_other"}
)

# Attachment-by-id lookup, authorized against the estimate. Rows are linked
# either directly (ia.estimate_id — takeoff scans) or through
# their intake submission (legacy intake docs), hence the LEFT JOIN + OR.
_ATTACHMENT_BY_ID_SQL = """SELECT ia.* FROM intake_attachments ia
   LEFT JOIN intake_submissions ins ON ins.id = ia.intake_submission_id
   WHERE ia.id = %s AND (ia.estimate_id = %s OR ins.estimate_id = %s)"""


def _attachment_out(r: dict) -> dict:
    """Serialize an intake_attachments row to the API shape.

    downloadable = True only when the object actually landed in GCS (status='stored'
    AND object_key is set). Legacy rows inserted before this feature (object_key=NULL)
    surface as downloadable=False so estimators see them but cannot click Download.
    """
    downloadable = r.get("status") == "stored" and bool(r.get("object_key"))
    return {
        "id": r["id"],
        "intakeSubmissionId": r["intake_submission_id"],
        # Direct estimate link (takeoff scans); NULL for legacy
        # submission-scoped rows (.get keeps pre-migration rows working).
        "estimateId": r.get("estimate_id"),
        "fileName": r["file_name"],
        "contentType": r.get("content_type", ""),
        "sizeBytes": r.get("size_bytes", 0),
        "kind": r.get("kind", "other"),
        "uploadedBy": r.get("uploaded_by"),
        "status": r.get("status", "pending"),
        "objectKey": r.get("object_key"),
        "downloadable": downloadable,
        # Stable ordering for "other" proposal attachments (§3.1); 0 for every
        # kind that does not use it. .get keeps pre-032 rows working.
        "sortOrder": r.get("sort_order", 0),
        # Server-side page count recorded at confirm for proposal documents
        # (§6/§7); None for images before confirm and for pre-032 rows.
        "pageCount": r.get("page_count"),
        "createdAt": _iso(r["created_at"]),
    }


# ── Config-table row mappers (read-only GET endpoints) ───────────────────────
#
# Shapes match the TS types in studio/src/types/estimating.ts exactly so the
# frontend swap from config.ts literals is a drop-in. These tables are DATA:
# changing a ladder/band/scope/formula is a row edit, never a code deploy.

def _approval_tier_out(r: dict) -> dict:
    return {
        "id": r["id"],
        "roleKey": r["role_key"],
        "label": r["label"],
        "minValueCents": int(r["min_value_cents"]),
        "maxValueCents": None if r["max_value_cents"] is None else int(r["max_value_cents"]),
        "order": r["tier_order"],
        "estimateType": r["estimate_type"],
    }


def _margin_band_out(r: dict) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "goodMin": _num(r["good_min"]),
        "okMin": _num(r["ok_min"]),
    }


def _material_calc_out(r: dict) -> dict:
    # factors is JSON in MySQL; drivers may hand back a str or a parsed object.
    factors = r["factors"]
    if isinstance(factors, (str, bytes, bytearray)):
        factors = json.loads(factors)
    return {
        "id": r["id"],
        "materialKey": r["material_key"],
        "label": r["label"],
        "computeType": r["compute_type"],
        "factors": factors,
        "unitSellCents": int(r["unit_sell_cents"]),
        "unitCostCents": int(r["unit_cost_cents"]),
        "uom": r["uom"],
        "volumeQuoteThresholdSf": r["volume_quote_threshold_sf"],
    }


def _itb_scope_out(r: dict) -> dict:
    return {
        "id": r["id"],
        "key": r["scope_key"],
        "label": r["label"],
        "group": r["scope_group"],
        "order": r["sort_order"],
    }


# ── ITB tracker ───────────────────────────────────────────────────────────────
#
# Status legend codes: P Pending · C Created Request · S Sent · R Received ·
# U Updated · X 100% Complete · '-' Non-Applicable.
ITB_STATUS_CODES = frozenset({"P", "C", "S", "R", "U", "X", "-"})

# Default initial scope status for a freshly auto-generated ITB project:
# 'P' Pending
DEFAULT_ITB_STATUS = "P"

# EST LS $ / EST IR $ auto-split. A line's catalog_items.service_type
# in this set is classified as Irrigation; everything else is Landscape. A named
# config set (not a hardcoded branch) so adding a service type is a data change.
IRRIGATION_SERVICE_TYPES = frozenset({"Irrigation"})


def _line_discipline(discipline_override: Optional[str], service_type: Optional[str]) -> str:
    """'irrigation' or 'landscape' for one section_services line.

    A per-line `discipline` override always wins; otherwise derive from the
    line's catalog item `service_type`. Manual lines (no catalog item, no
    override) default to landscape.
    """
    if discipline_override in ("landscape", "irrigation"):
        return discipline_override
    return "irrigation" if service_type in IRRIGATION_SERVICE_TYPES else "landscape"


async def _compute_ls_ir_split(estimate_id: str, est_type: str, total_cents: int) -> tuple[int, int]:
    """Derive (est_ls_cents, est_ir_cents) from an estimate's PERSISTED line
    items. Each is summed directly from its classified lines
    (not `total_cents - ir_cents`) so a split can never go negative even when
    lines are added/edited after creation and no longer match the create-time
    `total_cents` snapshot — that snapshot is only used as a fallback when the
    estimate has no lines yet.

    Reads section_services fresh from the DB rather than trusting the create
    body — both intake forms POST sections: [] and add lines afterward via the
    section/service endpoints, so this must reflect current persisted state to
    mean anything (see _recompute_itb_split, called from those endpoints).

    Line sell math mirrors studio/src/lib/estimating/calc.ts exactly (the one
    other place this formula lives) — install: qty * unitSellCents; maintenance:
    (squareFeet / 1000) * unitSellCents * qty * (1 + complexityPct).
    """
    sections = await query(
        "SELECT id, square_feet FROM estimate_sections WHERE estimate_id = %s", [estimate_id]
    )
    if not sections:
        return total_cents, 0
    section_ids = [s["id"] for s in sections]
    sqft_by_section = {s["id"]: s.get("square_feet") or 0 for s in sections}
    placeholders = ", ".join(["%s"] * len(section_ids))
    svc_rows = await query(
        f"SELECT section_id, catalog_item_id, discipline, qty, unit_sell_cents, complexity_pct"
        f" FROM section_services WHERE section_id IN ({placeholders})",
        section_ids,
    )
    lines: list[dict] = []
    catalog_item_ids: set[str] = set()
    for sv in svc_rows:
        lines.append({**sv, "square_feet": sqft_by_section.get(sv["section_id"], 0)})
        if sv.get("discipline") not in ("landscape", "irrigation"):
            cid = sv.get("catalog_item_id")
            if cid:
                catalog_item_ids.add(cid)
    if not lines:
        return total_cents, 0
    service_types: dict[str, str] = {}
    if catalog_item_ids:
        ids = list(catalog_item_ids)
        placeholders = ", ".join(["%s"] * len(ids))
        rows = await query(
            f"SELECT id, service_type FROM catalog_items WHERE id IN ({placeholders})", ids
        )
        service_types = {r["id"]: r["service_type"] for r in rows}
    # Sum LS and IR independently from the lines themselves (rather than
    # `total_cents - ir_cents`) so the split can never go negative: total_cents
    # is a snapshot from estimate creation and can drift stale as lines are
    # added/edited afterward, whereas LS + IR here is always exactly the sum
    # of every persisted line's sell.
    ls_cents = 0
    ir_cents = 0
    for sv in lines:
        qty = float(sv.get("qty") or 0)
        unit_sell = float(sv.get("unit_sell_cents") or 0)
        if est_type == "maintenance":
            square_feet = float(sv.get("square_feet") or 0)
            complexity = float(sv.get("complexity_pct") or 0)
            sell = round((square_feet / 1000) * unit_sell * qty * (1 + complexity))
        else:
            sell = round(qty * unit_sell)
        discipline = _line_discipline(sv.get("discipline"), service_types.get(sv.get("catalog_item_id")))
        if discipline == "irrigation":
            ir_cents += sell
        else:
            ls_cents += sell
    return ls_cents, ir_cents


async def _recompute_itb_split(estimate_id: str) -> None:
    """Re-derive EST LS $ / EST IR $ on the linked itb_projects row whenever an
    estimate's line items change post-creation (LOCKED
    default: recompute, not a create-time snapshot). No-op if the estimate has
    no linked ITB project (shouldn't happen given the 1:1 guarantee, but
    defensive since this runs from several independent CRUD endpoints) — a
    single self-contained call so every call site looks the same.
    """
    itb_rows = await query(
        "SELECT est_total_cents FROM itb_projects WHERE estimate_id = %s", [estimate_id]
    )
    if not itb_rows:
        return
    est_rows = await query("SELECT estimate_type FROM estimates WHERE id = %s", [estimate_id])
    if not est_rows:
        return
    total = int(itb_rows[0]["est_total_cents"])
    est_ls, est_ir = await _compute_ls_ir_split(estimate_id, est_rows[0]["estimate_type"], total)
    # Once real lines exist, LS + IR is the sum of their sells, which becomes
    # the new source of truth for the total too (the create-time total was
    # only ever a placeholder for the "no lines yet" case).
    await execute(
        "UPDATE itb_projects SET est_total_cents = %s, est_ls_cents = %s, est_ir_cents = %s "
        "WHERE estimate_id = %s",
        [est_ls + est_ir, est_ls, est_ir, estimate_id],
    )


def _quarter_for(d: Any) -> str:
    """Calendar quarter ('Q1'..'Q4') for an ISO date string or date object."""
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return f"Q{(d.month - 1) // 3 + 1}"


def _itb_project_out(r: dict, statuses: list[dict]) -> dict:
    return {
        "id": r["id"],
        "estimateId": r.get("estimate_id"),
        "name": r["name"],
        "aspireNumber": r["aspire_number"],
        "branch": r["branch"],
        "salesRep": r["sales_rep"],
        "lsEstimator": r["ls_estimator"],
        "irrEstimator": r["irr_estimator"],
        "irrDesigner": r["irr_designer"],
        "bidNumber": r["bid_number"],
        "itbDate": _iso(r["itb_date"]),
        "dueDate": _iso(r["due_date"]),
        "rebid": bool(r["rebid"]),
        "estTotalCents": int(r["est_total_cents"]),
        "estLsCents": int(r["est_ls_cents"]),
        "estIrCents": int(r["est_ir_cents"]),
        "client": r["client"],
        "quarter": r["quarter"],
        "notes": r["notes"],
        "statuses": statuses,
    }


def _itb_status_out(r: dict) -> dict:
    return {
        "projectId": r["project_id"],
        "scopeId": r["scope_id"],
        "statusCode": r["status_code"],
    }


async def _create_itb_project(estimate_id: str, body: dict, est_type: str) -> str:
    """Auto-generate the 1:1 itb_projects row for a new estimate.

    LOCKED decision: every estimate created from either intake form gets exactly
    one linked ITB project, plus one itb_scope_status row per itb_scopes row
    (config-driven — a scope added in the DB gets a column with no code change),
    each initialized to DEFAULT_ITB_STATUS. Local-only: no Aspire push here.

    EST LS $ / EST IR $ split: derived automatically from the
    estimate's own line items (see _compute_ls_ir_split), unless the caller
    provides estLsCents / estIrCents explicitly — those always win.
    """
    project_id = _new_id("itb")
    today = date.today()
    due = body.get("dueBackDate") or today.isoformat()
    total = int(body.get("contractValueCents") or 0)
    est_ls = body.get("estLsCents")
    est_ir = body.get("estIrCents")
    if est_ls is None or est_ir is None:
        # Compute both if either is missing — a partial body (only one provided)
        # is not a valid split, so always derive together or use both from body.
        est_ls, est_ir = await _compute_ls_ir_split(estimate_id, est_type, total)
    est_ls = int(est_ls)
    est_ir = int(est_ir)
    await execute(
        """INSERT INTO itb_projects
             (id, estimate_id, name, aspire_number, branch, sales_rep,
              ls_estimator, irr_estimator, irr_designer, bid_number, itb_date,
              due_date, rebid, est_total_cents, est_ls_cents, est_ir_cents,
              client, quarter, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [
            project_id,
            estimate_id,
            body.get("name", ""),
            body.get("aspireNumber"),
            # itb_projects.branch is a different column from estimates.branch.
            # Migration 022 drops only estimates.branch and catalog_items.branch;
            # itb_projects.branch is still VARCHAR NOT NULL, so this write stays.
            body.get("branchCity") or body.get("branch", ""),
            body.get("crmRep"),
            body.get("assignedLsEstimator"),
            body.get("assignedIrrEstimator"),
            body.get("irrDesigner"),
            body.get("bidNumber"),
            today.isoformat(),
            due,
            1 if body.get("rebid") else 0,
            est_ls + est_ir,
            est_ls,
            est_ir,
            body.get("clientName", ""),
            _quarter_for(due),
            None,
        ],
    )
    scopes = await query("SELECT id FROM itb_scopes", [])
    for scope in scopes:
        await execute(
            """INSERT INTO itb_scope_status (project_id, scope_id, status_code)
               VALUES (%s, %s, %s)""",
            [project_id, scope["id"], DEFAULT_ITB_STATUS],
        )
    return project_id


def _catalog_item_out(r: dict) -> dict:
    # Slice 14: `branch` city string removed; identity carried by aspire_branch_id
    # (NULL = company-wide per §2.3 convention). The legacy `branch` key is NOT
    # passed through — once 022 is applied the column will not exist in the row.
    return {
        "id": r["id"],
        "description": r["description"],
        "uom": r["uom"],
        "unitCostCents": int(r["unit_cost_cents"]),
        "unitSellCents": int(r["unit_sell_cents"]),
        "targetGm": _num(r["target_gm"]),
        "kitType": r["kit_type"],
        "productionRate": _num(r["production_rate"]),
        "aspireBranchId": r.get("aspire_branch_id"),
        "active": bool(r["active"]),
        "serviceType": r["service_type"],
    }


async def _insert_component(service_id: str, comp: dict, idx: int) -> str:
    component_id = _new_id("cmp")
    await execute(
        """INSERT INTO section_service_components
             (id, section_service_id, kind, label, qty, unit_cost_cents, hours, sort_order)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        [
            component_id,
            service_id,
            comp["kind"],
            comp["label"],
            comp.get("qty", 0),
            comp.get("unitCostCents", 0),
            comp.get("hours"),
            comp.get("sortOrder", idx),
        ],
    )
    return component_id


async def _insert_service(section_id: str, svc: dict, idx: int) -> str:
    service_id = _new_id("svc")
    await execute(
        """INSERT INTO section_services
             (id, section_id, catalog_item_id, discipline, billing_type, label, qty, uom,
              complexity_pct, unit_sell_cents, embedded_cost_cents, target_gm, hours, sort_order)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [
            service_id,
            section_id,
            svc.get("catalogItemId"),
            svc.get("discipline"),
            svc.get("billingType"),
            svc["label"],
            svc.get("qty", 0),
            svc.get("uom", ""),
            svc.get("complexityPct", 0),
            svc.get("unitSellCents"),
            svc.get("embeddedCostCents"),
            svc.get("targetGm"),
            svc.get("hours"),
            svc.get("sortOrder", idx),
        ],
    )
    for ci, comp in enumerate(svc.get("components") or []):
        await _insert_component(service_id, comp, ci)
    return service_id


async def _insert_section(estimate_id: str, section: dict, idx: int) -> str:
    section_id = _new_id("sec")
    await execute(
        """INSERT INTO estimate_sections (id, estimate_id, name, square_feet, sort_order)
           VALUES (%s, %s, %s, %s, %s)""",
        [
            section_id,
            estimate_id,
            section.get("name", ""),
            section.get("squareFeet", 0),
            section.get("sortOrder", idx),
        ],
    )
    for vi, svc in enumerate(section.get("services") or []):
        await _insert_service(section_id, svc, vi)
    return section_id


# ── Production-rate save guard (LOCKED decision) ─────────────────────────────
#
# Production rates are REQUIRED: a maintenance service line cannot be saved
# unless its hours are computable. A line resolves when it carries non-null
# hours itself, OR its catalog_item has a non-null production_rate. Otherwise
# the write is rejected 422 BEFORE anything persists (the frontend shows its
# own guard, but the server never trusts the client). Install estimates are
# untouched — install kits are quantity-driven and carry no production rate.

async def _require_resolvable_maintenance_lines(services: list[dict]) -> None:
    """Reject (422) any maintenance line whose hours cannot be resolved.

    `services` are camelCase line dicts carrying label / hours / catalogItemId.
    Kits are fetched in one batched query; a missing kit id counts as
    unresolvable (a dangling catalog_item_id can never produce hours).
    """
    pending = [svc for svc in services if svc.get("hours") is None]
    if not pending:
        return
    kit_ids = {svc.get("catalogItemId") for svc in pending if svc.get("catalogItemId")}
    rates: dict[str, Any] = {}
    if kit_ids:
        placeholders = ", ".join(["%s"] * len(kit_ids))
        rows = await query(
            f"SELECT id, production_rate FROM catalog_items WHERE id IN ({placeholders})",
            list(kit_ids),
        )
        rates = {r["id"]: r.get("production_rate") for r in rows}
    for svc in pending:
        kit_id = svc.get("catalogItemId")
        if kit_id is None or rates.get(kit_id) is None:
            label = svc.get("label") or "(unnamed line)"
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Maintenance line \"{label}\" cannot be saved: no production rate "
                    "resolves for it. Enter hours or pick a kit that has a production rate."
                ),
            )


# ── rou ────────────────────────────────────────────────────────────

# Payloads accept arbitrary camelCase keys (validated against the DB columns in
# the handlers); modeled loosely to mirror the flexible mock contract.

# Scalar estimate columns updatable via PATCH (estimate_type intentionally absent).
_UPDATABLE = {
    "name": "name",
    "aspireNumber": "aspire_number",
    "clientName": "client_name",
    # Slice 14: "branch" (legacy city string) removed from PATCH surface.
    # No caller should send it; if they do it is silently ignored (the key
    # simply won't appear in _UPDATABLE so no SET clause is generated for it).
    "customerType": "customer_type",
    # Dollars. Null clears the value back to unknown; omitting the key leaves it.
    "homesBudget": "homes_budget",
    "commonAreaBudget": "common_area_budget",
    "acreage": "acreage",
    "contractValueCents": "contract_value_cents",
    "targetMargin": "target_margin",
    "status": "status",
    "lifecycle": "lifecycle",
    "aspireOwner": "aspire_owner",
    "priority": "priority",
    "winProbability": "win_probability",
    "siteWalkDate": "site_walk_date",
    "dueBackDate": "due_back_date",
    "anticipatedCloseDate": "anticipated_close_date",
    "serviceStartDate": "service_start_date",
    "assignedLsEstimator": "assigned_ls_estimator",
    "assignedIrrEstimator": "assigned_irr_estimator",
    "crmRep": "crm_rep",
    "notes": "notes",
    # Tracked RFI status (capture/display only; no gating).
    "rfiStatus": "rfi_status",
    # Manual takeoff metadata (Takeoff Insert). Estimator-entered
    # today; Beam AI automated takeoff is the eventual source (paused — when it
    # lands it writes these same fields). Acreage/sqft stay derived, never stored.
    "turfAreaAcres": "turf_area_acres",
    "curbMiles": "curb_miles",
    "notifyBmRdOnReturn": "notify_bm_rd_on_return",
    # Captured at the lost transition so the durability sweep can re-send the same
    # reason on a retry (otherwise a re-push would drop it).
    "lostReasonId": "aspire_lost_reason_id",
}

# Refined estimate-header PATCH ownership:
#   * targetMargin — approver-only: it's the approver lever.
#   * contractValueCents — estimator OR approver: the value is derived from
#     line items the estimator legitimately edits (there's no server-side
#     contract-value rollup), and approver value-adjustments stay audited via
#     the adjustments POST.
#   * status — any authenticated role: the transition machine (the
#     409 guard below) is the enforcement, and privileged transitions have
#     their own guarded endpoint (approve-handback with tier checks). The
#     won/lost/send-back edges are legitimately driven by sales and approvers.
#   * everything else — estimator-owned (same convention as
#     section/service/component mutations).
_APPROVER_ONLY_FIELDS = frozenset({"targetMargin"})
_ESTIMATOR_OR_APPROVER_FIELDS = frozenset({"contractValueCents"})
_ANY_ROLE_FIELDS = frozenset({"status"})


async def _require_estimate_patch_ownership(body: dict, user: dict) -> None:
    """Classify the PATCH body's fields and apply the strictest required check
    per ownership group. A body mixing groups requires every group's check
    (e.g. targetMargin + name → approver AND estimator, effectively admin),
    which matches field ownership.

    Async because require_approver now re-reads the live users row (B.2)."""
    keys = set(body)
    if keys & _APPROVER_ONLY_FIELDS:
        await authz.require_approver(user)
    if keys & _ESTIMATOR_OR_APPROVER_FIELDS:
        role = user.get("role")
        if not (authz.is_estimator(role) or authz.is_approver(role)):
            raise HTTPException(
                status_code=403,
                detail="Estimator or approver role required: contract value is "
                "derived from estimator-owned line items or adjusted by approvers.",
            )
    if keys - _APPROVER_ONLY_FIELDS - _ESTIMATOR_OR_APPROVER_FIELDS - _ANY_ROLE_FIELDS:
        authz.require_estimator(user)


class ApproveHandBackBody(BaseModel):
    # Actor identity comes from the JWT — the field is accepted
    # for wire compatibility but IGNORED server-side.
    actor: Optional[str] = None
    notifyBmRdOnReturn: Optional[bool] = None


class AdjustmentBody(BaseModel):
    """One audited approver lever change (complexity|margin).

    Values are decimals (0.22 = 22%). The actor is derived from the JWT —
    an `actor` field in the body is accepted for wire compatibility but
    IGNORED server-side, mirroring ApproveHandBackBody.
    """
    field: str
    fromValue: float
    toValue: float
    actor: Optional[str] = None


def _adjustment_out(r: dict) -> dict:
    return {
        "id": r["id"],
        "estimateId": r["estimate_id"],
        "actor": r["actor"],
        "field": r["field"],
        "fromValue": _num(r["from_value"]),
        "toValue": _num(r["to_value"]),
        "createdAt": _iso(r["created_at"]),
    }


# ── Routes ──────────────────────────────────────────────────────────────────

def register(app, require_auth) -> None:
    """Attach all estimating routes to the FastAPI app with the shared auth dep."""

    @app.get("/api/estimating/estimates")
    async def list_estimates(
        estimate_type: Optional[str] = Query(default=None),
        status: Optional[str] = Query(default=None),
        # Slice 14: the `branch` city-string convenience filter is removed.
        # Cross-branch roles should pass aspireBranchId for narrower views once
        # that query param is added (pending follow-up). Branch-scoped users are
        # already filtered via aspire_branch_id from their user_branches rows.
        # Slice 4 (Handoff 37): filter by the lead that originated the estimate.
        # Uses estimates.lead_id (added in migration 010). Allows BidTab to fetch
        # only the approved estimate for this lead without client-side filtering.
        lead_id: Optional[str] = Query(default=None, alias="leadId"),
        _user: dict = Depends(require_auth),
    ) -> list:
        # Branch scope is derived from the AUTHENTICATED user (BRD I-9.5).
        scope = await authz.resolve_branch_scope(_user)
        if scope.kind == "none":
            return []
        conditions: list[str] = []
        params: list[Any] = []
        if estimate_type:
            conditions.append("estimate_type = %s")
            params.append(estimate_type)
        if status:
            conditions.append("status = %s")
            params.append(status)
        if scope.kind == "branch":
            # Scope to the user's aspire_branch_id list (Amendment B.1). One
            # parameterized placeholder per id — the ids are NEVER interpolated.
            placeholders = ", ".join(["%s"] * len(scope.ids))
            conditions.append(f"aspire_branch_id IN ({placeholders})")
            params.extend(scope.ids)
        if lead_id:
            # Filter to estimates linked to the given lead (migration 010 column).
            conditions.append("lead_id = %s")
            params.append(lead_id)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = await query(
            f"SELECT id FROM estimates {where} ORDER BY created_at DESC", params
        )
        return [await _load_estimate(r["id"]) for r in rows]

    @app.post("/api/estimating/estimates", status_code=201)
    async def create_estimate(
        body: dict, background: BackgroundTasks, user: dict = Depends(require_auth)
    ) -> dict:
        est_type = body.get("estimateType")
        if est_type not in ("maintenance", "install"):
            raise HTTPException(status_code=400, detail="estimateType must be maintenance or install")
        # Branch identity rides on the Aspire BranchID (int), captured at intake.
        # Migration 022 dropped estimates.branch; do not write that column.
        aspire_branch_id = body.get("aspireBranchId")
        if not isinstance(aspire_branch_id, int) or isinstance(aspire_branch_id, bool):
            raise HTTPException(
                status_code=400,
                detail="aspireBranchId is required — select a branch from the intake form",
            )
        # Guard runs BEFORE any INSERT so a reject persists nothing.
        if est_type == "maintenance":
            await _require_resolvable_maintenance_lines([
                svc
                for section in (body.get("sections") or [])
                for svc in (section.get("services") or [])
            ])
        # Budgets are optional. Resolve before the INSERT so a 400 persists
        # nothing, and so a blank string is NULL rather than 0. These dollars
        # are not the priced contract value — contract_value_cents, the ITB
        # split, commissions, and Aspire stay on their own numbers.
        homes_budget, common_area_budget = _resolve_contract_budgets(body)
        estimate_id = _new_id("est")
        # Auto-assign the next sequential estimate number (contract generator).
        next_num_row = await query("SELECT COALESCE(MAX(estimate_number), 0) + 1 AS next_num FROM estimates")
        estimate_number = int(next_num_row[0]["next_num"]) if next_num_row else 1
        await execute(
            """INSERT INTO estimates
                 (id, estimate_type, name, aspire_number, estimate_number, client_name, aspire_branch_id,
                  customer_type,
                  acreage, contract_value_cents, target_margin, status, lifecycle, aspire_owner,
                  priority, win_probability, site_walk_date, due_back_date, anticipated_close_date,
                  service_start_date, assigned_ls_estimator, assigned_irr_estimator, crm_rep,
                  notify_bm_rd_on_return, notes, property_id, lead_id, rfi_status,
                  homes_budget, common_area_budget)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                estimate_id,
                est_type,
                body.get("name", ""),
                body.get("aspireNumber"),
                estimate_number,
                body.get("clientName", ""),
                aspire_branch_id,
                body.get("customerType", ""),
                body.get("acreage"),
                body.get("contractValueCents", 0),
                body.get("targetMargin", 0.22),
                body.get("status", "new_from_sales"),
                body.get("lifecycle", "bidding"),
                body.get("aspireOwner", "estimating"),
                body.get("priority", "medium"),
                body.get("winProbability", 0.20),
                body.get("siteWalkDate"),
                body.get("dueBackDate") or date.today().isoformat(),
                body.get("anticipatedCloseDate"),
                body.get("serviceStartDate"),
                body.get("assignedLsEstimator"),
                body.get("assignedIrrEstimator"),
                body.get("crmRep"),
                (body.get("approvalSettings") or {}).get("notifyBmRdOnReturn", True),
                body.get("notes"),
                body.get("propertyId"),
                body.get("leadId"),
                # RFI status tracked first-class (install).
                body.get("rfiStatus"),
                # NULL when the rep left the budget blank. 0 only when they sent 0.
                homes_budget,
                common_area_budget,
            ],
        )
        for si, section in enumerate(body.get("sections") or []):
            await _insert_section(estimate_id, section, si)
        # Structured intake payload lands in its own table (never estimate.notes).
        intake = body.get("intake")
        if isinstance(intake, dict) and intake.get("payload") is not None:
            await _insert_intake_submission(
                estimate_id, est_type, intake, user.get("id") or "unknown"
            )
        # Auto-generate the 1:1 ITB project (+ its scope-status
        # rows, one per itb_scopes row) for EITHER intake type. Local-only.
        await _create_itb_project(estimate_id, body, est_type)
        # Estimate submission is THE (only) trigger for the
        # property's Aspire push: promotion/backfill/create leave properties
        # 'unsynced'; submitting an estimate for one pushes it (pending →
        # synced/failed). The guard skips already-synced/in-flight rows.
        if body.get("propertyId"):
            background.add_task(_props_mod.sync_property_if_needed, body["propertyId"])
        # Create never blocks on Aspire: push the opportunity in the background,
        # leaving aspire_sync_status='pending' (its column default) until it lands.
        background.add_task(_sync_new_opportunity_bg, estimate_id, body.get("serviceLine"))
        # Pipeline kanban redesign — a lead sits in Qualifying until an estimate
        # is actually created against it; this is the one and only Qualifying→
        # Estimating trigger (never a manual kanban drag).
        if body.get("leadId"):
            await _write_back_lead_status(body["leadId"], "estimating")
        created = await _load_estimate(estimate_id)
        assert created is not None
        return created

    @app.get("/api/estimating/estimates/{estimate_id}")
    async def get_estimate(estimate_id: str, _user: dict = Depends(require_auth)) -> dict:
        # Handoff 50 §2: the estimate-detail surface is estimator/approver-owned.
        # A sales user reaches an estimate only via the queue; opening one
        # directly (by URL) is refused, so hiding the tab is backed by a real
        # server-side 403 — not cosmetic. Fires BEFORE the DB load.
        authz.require_estimate_viewer(_user)
        est = await _load_estimate(estimate_id)
        if est is None:
            raise HTTPException(status_code=404, detail="Not found")
        return est

    @app.get("/api/estimating/estimates/{estimate_id}/intake")
    async def list_intake_submissions(
        estimate_id: str, _user: dict = Depends(require_auth)
    ) -> list:
        if not await query("SELECT id FROM estimates WHERE id = %s", [estimate_id]):
            raise HTTPException(status_code=404, detail="Not found")
        rows = await query(
            "SELECT * FROM intake_submissions WHERE estimate_id = %s ORDER BY created_at",
            [estimate_id],
        )
        return [_intake_out(r) for r in rows]

    # ── Intake drafts ─────────────────────────────────────────────────────────
    #
    # "Save draft" persists a PARTIAL intake to intake_submissions with
    # is_draft=1 and estimate_id NULL. A draft never creates an estimate and
    # never triggers any Aspire push (property sync is estimate-submit only).
    # Drafts are per-user: every route scopes by the JWT
    # identity, so a rep can resume from any device but never sees another
    # rep's drafts.

    @app.post("/api/estimating/intake/drafts")
    async def save_intake_draft(body: dict, response: Response, user: dict = Depends(require_auth)) -> dict:
        est_type = body.get("estimateType")
        if est_type not in ("maintenance", "install"):
            raise HTTPException(status_code=400, detail="estimateType must be maintenance or install")
        payload = body.get("payload")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="payload must be an object")
        # Same blank-vs-zero rule as create: a draft that leaves the budget
        # empty stores null, not 0 and not "".
        _normalize_present_budgets(payload)
        user_id = user.get("id") or "unknown"

        draft_id = body.get("draftId")
        if draft_id:
            rows = await query(
                "SELECT * FROM intake_submissions WHERE id = %s AND submitted_by = %s AND is_draft = 1",
                [draft_id, user_id],
            )
            if not rows:
                raise HTTPException(status_code=404, detail="Draft not found")
            await execute(
                "UPDATE intake_submissions SET payload = %s WHERE id = %s",
                [json.dumps(payload), draft_id],
            )
            return _draft_out({**rows[0], "payload": payload})

        new_draft_id = _new_id("ins")
        await execute(
            """INSERT INTO intake_submissions
                 (id, estimate_id, estimate_type, payload, submitted_by, is_draft)
               VALUES (%s, NULL, %s, %s, %s, 1)""",
            [new_draft_id, est_type, json.dumps(payload), user_id],
        )
        response.status_code = 201
        return _draft_out({
            "id": new_draft_id,
            "estimate_type": est_type,
            "payload": payload,
            "submitted_by": user_id,
            "created_at": _now_utc(),
        })

    @app.get("/api/estimating/intake/drafts")
    async def list_intake_drafts(
        estimate_type: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> list:
        conditions = ["submitted_by = %s", "is_draft = 1"]
        params: list[Any] = [user.get("id") or "unknown"]
        if estimate_type:
            if estimate_type not in ("maintenance", "install"):
                raise HTTPException(
                    status_code=400, detail="estimate_type must be maintenance or install"
                )
            conditions.append("estimate_type = %s")
            params.append(estimate_type)
        rows = await query(
            f"""SELECT * FROM intake_submissions
                 WHERE {' AND '.join(conditions)}
                 ORDER BY created_at DESC""",
            params,
        )
        return [_draft_out(r) for r in rows]

    @app.delete("/api/estimating/intake/drafts/{draft_id}", status_code=204)
    async def delete_intake_draft(draft_id: str, user: dict = Depends(require_auth)):
        rows = await query(
            "SELECT id FROM intake_submissions WHERE id = %s AND submitted_by = %s AND is_draft = 1",
            [draft_id, user.get("id") or "unknown"],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Draft not found")
        await execute("DELETE FROM intake_submissions WHERE id = %s", [draft_id])

    @app.patch("/api/estimating/estimates/{estimate_id}")
    async def update_estimate(
        estimate_id: str, body: dict, background: BackgroundTasks, _user: dict = Depends(require_auth)
    ) -> dict:
        # C1 — refined ownership split, enforced server-side (not
        # just in the UI): targetMargin is approver-only; contractValueCents
        # is estimator-or-approver (derived from estimator-owned line items);
        # status is any-authenticated (the transition machine below
        # is the enforcement); every other header field — name, dates, notes,
        # assignments, takeoff metadata — is estimator-owned, mirroring the
        # section/service guards. See _require_estimate_patch_ownership.
        # TODO(open item): couple approver targetMargin PATCHes
        # to a persisted estimate_adjustments row so a lever change can never
        # land without its audit row — not built yet, pending that open item.
        # (contractValueCents is now estimator-or-approver since it mirrors
        # the line-item rollup; approver value-adjustments remain audited via
        # the adjustments POST.)
        await _require_estimate_patch_ownership(body, _user)
        rows = await query(
            "SELECT estimate_type, status, aspire_opportunity_id, lead_id, "
            "aspire_branch_id, crew_rate_cents_per_hour FROM estimates WHERE id = %s",
            [estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        # Blank budget strings become NULL before the UPDATE so MySQL cannot
        # coerce "" to 0 on the DECIMAL columns.
        _coerce_budget_patch(body)
        current = rows[0]
        if "estimateType" in body and body["estimateType"] != current["estimate_type"]:
            raise HTTPException(
                status_code=400,
                detail="estimate_type is immutable and cannot be changed after creation",
            )
        # approvalSettings arrives as a nested object; flatten to the column.
        if isinstance(body.get("approvalSettings"), dict):
            body["notifyBmRdOnReturn"] = body["approvalSettings"].get("notifyBmRdOnReturn")

        # Every status write goes through the transition machine.
        # The generic PATCH used to accept any DB-enum-valid status, bypassing
        # STATUS_TRANSITIONS (only approve-handback enforced it). Reject illegal
        # edges with the same 409 shape as approve-handback. A same-status PATCH
        # (e.g. a full-form Save re-sending the current value) stays a no-op.
        target_status = body.get("status")
        if (
            target_status is not None
            and target_status != current.get("status")
            and not _can_transition(current.get("status"), target_status)
        ):
            raise HTTPException(
                status_code=409,
                detail=str(IllegalTransitionError(current.get("status"), target_status)),
            )

        # Terminal WON folds in the same side effects as the approve/handback path
        # (lifecycle→won, ownership→crm); see _side_effects, the single source.
        if target_status == "won":
            for camel, val in {"lifecycle": "won", "aspireOwner": "crm"}.items():
                body.setdefault(camel, val)

        await _apply_updates("estimates", _UPDATABLE, body, estimate_id, touch_updated_at=True)

        # Crew-rate snapshot (§2.6): freeze on entry to review/pending_approval/
        # approved, clear on the hand-back to in_progress, preserve otherwise.
        # Runs only when status is actually moving (the helper no-ops on a
        # same-status PATCH). target_status is None when the body omits status.
        if target_status is not None:
            await _snapshot_crew_rate_on_transition(estimate_id, target_status, current)

        # Terminal-only Aspire write-back (won/lost), best-effort in the background.
        # Guarded by the transition machine so an illegal PATCH jump (e.g.
        # in_progress → won) never fires a bogus write-back to Aspire.
        if (
            target_status in ("won", "lost")
            and current.get("status") != target_status
            and _can_transition(current.get("status"), target_status)
        ):
            background.add_task(
                _sync_status_bg, estimate_id, target_status, body.get("lostReasonId")
            )

        # Commission creation — fires only on the actual won transition.
        if target_status == "won" and current.get("status") != "won":
            background.add_task(_create_commission_on_won, estimate_id)

        # Estimate Save triggers ONE batched, best-effort
        # push of the takeoff quantities that carry a catalog_item_id. Never
        # blocks the Save; failures are logged inside the task.
        background.add_task(_push_takeoff_qtys_bg, estimate_id)

        # Pipeline kanban redesign — Estimating→OP Review write-back. Approved
        # is handled separately by approve_handback (the only path that today
        # actually lands status='approved'); this covers review/pending_approval.
        if (
            target_status in ESTIMATE_TO_LEAD_STATUS
            and target_status != current.get("status")
            and current.get("lead_id")
        ):
            await _write_back_lead_status(current["lead_id"], ESTIMATE_TO_LEAD_STATUS[target_status])

        est = await _load_estimate(estimate_id)
        assert est is not None
        return est

    @app.post("/api/estimating/estimates/{estimate_id}/retry-aspire-sync", status_code=202)
    async def retry_aspire_sync(
        estimate_id: str,
        background: BackgroundTasks,
        response: Response,
        _user: dict = Depends(require_auth),
    ) -> dict:
        rows = await query(
            "SELECT id, status, aspire_opportunity_id FROM estimates WHERE id = %s",
            [estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        r = rows[0]
        if r.get("aspire_opportunity_id") is None:
            background.add_task(_sync_new_opportunity_bg, estimate_id)
        elif r.get("status") in ("won", "lost"):
            background.add_task(_sync_status_bg, estimate_id, r["status"])
        else:
            # §5.3: already synced and not terminal ⇒ nothing to push. Don't lie
            # with 202 "queued"; override the route default to 200 not_needed.
            response.status_code = 200
            return {"status": "not_needed"}
        return {"status": "queued"}

    @app.post("/api/estimating/estimates/{estimate_id}/approve-handback")
    async def approve_handback(
        estimate_id: str, body: ApproveHandBackBody, _user: dict = Depends(require_auth)
    ) -> dict:
        # Approve is approver-owned, and only within the caller's tier — a
        # manager cannot approve a >$100k estimate. Identity
        # comes from the JWT, never from the client body.
        # require_approver gates approver+active BEFORE the 404 lookup and
        # returns the live role so the authority check reuses that users re-read.
        live_role = await authz.require_approver(_user)
        rows = await query(
            "SELECT id, status, contract_value_cents, lead_id FROM estimates WHERE id = %s",
            [estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        await authz.require_approval_authority(
            _user, int(rows[0].get("contract_value_cents") or 0), live_role=live_role
        )
        actor = _user.get("name") or _user.get("email") or _user.get("id") or "unknown"
        at = _now_utc().isoformat()
        try:
            patch, records = _approve_and_hand_back(estimate_id, rows[0]["status"], actor, at)
        except IllegalTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc))

        set_parts = ["status = %s"]
        params: list[Any] = [patch["status"]]
        if "lifecycle" in patch:
            set_parts.append("lifecycle = %s")
            params.append(patch["lifecycle"])
        if "aspire_owner" in patch:
            set_parts.append("aspire_owner = %s")
            params.append(patch["aspire_owner"])
        if body.notifyBmRdOnReturn is not None:
            set_parts.append("notify_bm_rd_on_return = %s")
            params.append(body.notifyBmRdOnReturn)
        params.append(estimate_id)
        await execute(
            f"UPDATE estimates SET {', '.join(set_parts)}, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            params,
        )
        for rec in records:
            await execute(
                """INSERT INTO estimate_status_transitions
                     (id, estimate_id, from_status, to_status, actor, at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                [_new_id("trn"), estimate_id, rec["from"], rec["to"], rec["actor"], rec["at"]],
            )
        # Pipeline kanban redesign — Approved is the same real-world event on
        # both sides: an estimate's status landing on 'approved' write-backs
        # the linked lead's Pipeline stage to Approved (never independently
        # settable on the kanban).
        if rows[0].get("lead_id") and any(rec["to"] == "approved" for rec in records):
            await _write_back_lead_status(rows[0]["lead_id"], "approved")
        est = await _load_estimate(estimate_id)
        return {"estimate": est, "transitions": records}

    @app.get("/api/estimating/estimates/{estimate_id}/status-transitions")
    async def list_status_transitions(estimate_id: str, _user: dict = Depends(require_auth)) -> list:
        if not await query("SELECT id FROM estimates WHERE id = %s", [estimate_id]):
            raise HTTPException(status_code=404, detail="Not found")
        rows = await query(
            "SELECT * FROM estimate_status_transitions WHERE estimate_id = %s ORDER BY at",
            [estimate_id],
        )
        return [
            {
                "estimateId": r["estimate_id"],
                "from": r["from_status"],
                "to": r["to_status"],
                "actor": r["actor"],
                "at": _iso(r["at"]),
            }
            for r in rows
        ]

    # ── estimate_adjustments (approver lever audit, BRD III-1) ───────────────
    #
    # Complexity/margin are the ONLY approver-owned levers; every change (and
    # every revert back to the original) persists a from/to row here. This is
    # the audited companion of the estimate-level PATCH the approver flow uses
    # to move targetMargin/contractValueCents. One approver action may write
    # BOTH an adjustment row and a status transition (via approve-handback) —
    # neither path suppresses the other.

    @app.post("/api/estimating/estimates/{estimate_id}/adjustments", status_code=201)
    async def create_adjustment(
        estimate_id: str, body: AdjustmentBody, _user: dict = Depends(require_auth)
    ) -> dict:
        # Adjustments are approver-owned — estimators 403.
        await authz.require_approver(_user)
        if body.field not in ("complexity", "margin"):
            raise HTTPException(
                status_code=400,
                detail="field must be complexity or margin — approvers may adjust only these levers",
            )
        if not await query("SELECT id FROM estimates WHERE id = %s", [estimate_id]):
            raise HTTPException(status_code=404, detail="Not found")
        actor = _user.get("name") or _user.get("email") or _user.get("id") or "unknown"
        adj_id = _new_id("adj")
        at = _now_utc()
        await execute(
            """INSERT INTO estimate_adjustments
                 (id, estimate_id, actor, field, from_value, to_value, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            [adj_id, estimate_id, actor, body.field, body.fromValue, body.toValue, at],
        )
        return _adjustment_out({
            "id": adj_id,
            "estimate_id": estimate_id,
            "actor": actor,
            "field": body.field,
            "from_value": body.fromValue,
            "to_value": body.toValue,
            "created_at": at,
        })

    @app.get("/api/estimating/estimates/{estimate_id}/adjustments")
    async def list_adjustments(estimate_id: str, _user: dict = Depends(require_auth)) -> list:
        # Audit read — any authenticated role may see why a number moved.
        if not await query("SELECT id FROM estimates WHERE id = %s", [estimate_id]):
            raise HTTPException(status_code=404, detail="Not found")
        rows = await query(
            "SELECT * FROM estimate_adjustments WHERE estimate_id = %s ORDER BY created_at",
            [estimate_id],
        )
        return [_adjustment_out(r) for r in rows]

    @app.post("/api/estimating/estimates/{estimate_id}/sections", status_code=201)
    async def create_section(estimate_id: str, body: dict, _user: dict = Depends(require_auth)) -> dict:
        authz.require_estimator(_user)  # sections are estimator-owned
        est_rows = await query(
            "SELECT id, estimate_type FROM estimates WHERE id = %s", [estimate_id]
        )
        if not est_rows:
            raise HTTPException(status_code=404, detail="Not found")
        # Nested services must resolve a production rate/hours.
        if est_rows[0].get("estimate_type") == "maintenance":
            await _require_resolvable_maintenance_lines(body.get("services") or [])
        idx = await _next_sort_order("estimate_sections", "estimate_id", estimate_id, body)
        section_id = await _insert_section(estimate_id, {**body, "sortOrder": idx}, idx)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        # A newly added section may carry lines, which shift
        # the ITB LS/IR split.
        await _recompute_itb_split(estimate_id)
        rows = await query("SELECT * FROM estimate_sections WHERE id = %s", [section_id])
        svc_rows = await query(
            "SELECT * FROM section_services WHERE section_id = %s ORDER BY sort_order", [section_id]
        )
        services = [_service_out(sv, []) for sv in svc_rows]
        return _section_out(rows[0], services)

    @app.patch("/api/estimating/estimates/{estimate_id}/sections/{section_id}")
    async def update_section(
        estimate_id: str, section_id: str, body: dict, _user: dict = Depends(require_auth)
    ) -> dict:
        authz.require_estimator(_user)
        rows = await query(
            "SELECT * FROM estimate_sections WHERE id = %s AND estimate_id = %s",
            [section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        cols = {"name": "name", "squareFeet": "square_feet", "sortOrder": "sort_order"}
        await _apply_updates("estimate_sections", cols, body, section_id)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        # A squareFeet edit changes every maintenance line's
        # sell in this section, which shifts the ITB LS/IR split (recomputed
        # unconditionally, like every other section/service mutation, so the
        # trigger never has to be kept in sync with the split formula's inputs).
        await _recompute_itb_split(estimate_id)
        rows = await query("SELECT * FROM estimate_sections WHERE id = %s", [section_id])
        svc_rows = await query(
            "SELECT * FROM section_services WHERE section_id = %s ORDER BY sort_order", [section_id]
        )
        return _section_out(rows[0], [_service_out(sv, []) for sv in svc_rows])

    @app.delete("/api/estimating/estimates/{estimate_id}/sections/{section_id}", status_code=204)
    async def delete_section(estimate_id: str, section_id: str, _user: dict = Depends(require_auth)):
        authz.require_estimator(_user)
        rows = await query(
            "SELECT id FROM estimate_sections WHERE id = %s AND estimate_id = %s",
            [section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        await execute("DELETE FROM estimate_sections WHERE id = %s", [section_id])
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        # Deleting a section removes its lines from the split.
        await _recompute_itb_split(estimate_id)

    @app.post(
        "/api/estimating/estimates/{estimate_id}/sections/{section_id}/services",
        status_code=201,
    )
    async def create_service(
        estimate_id: str, section_id: str, body: dict, _user: dict = Depends(require_auth)
    ) -> dict:
        authz.require_estimator(_user)  # services/line items are estimator-owned
        rows = await query(
            "SELECT id FROM estimate_sections WHERE id = %s AND estimate_id = %s",
            [section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        # A maintenance line must resolve a production rate/hours.
        est_rows = await query(
            "SELECT estimate_type FROM estimates WHERE id = %s", [estimate_id]
        )
        if est_rows and est_rows[0].get("estimate_type") == "maintenance":
            await _require_resolvable_maintenance_lines([body])
        idx = await _next_sort_order("section_services", "section_id", section_id, body)
        service_id = await _insert_service(section_id, {**body, "sortOrder": idx}, idx)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        # A new line shifts the ITB LS/IR split.
        await _recompute_itb_split(estimate_id)
        svc = await query("SELECT * FROM section_services WHERE id = %s", [service_id])
        comp = await query(
            "SELECT * FROM section_service_components WHERE section_service_id = %s ORDER BY sort_order",
            [service_id],
        )
        return _service_out(svc[0], [_component_out(c) for c in comp])

    @app.patch(
        "/api/estimating/estimates/{estimate_id}/sections/{section_id}/services/{service_id}"
    )
    async def update_service(
        estimate_id: str,
        section_id: str,
        service_id: str,
        body: dict,
        _user: dict = Depends(require_auth),
    ) -> dict:
        authz.require_estimator(_user)
        rows = await query(
            """SELECT sv.* FROM section_services sv
               JOIN estimate_sections s ON s.id = sv.section_id
               WHERE sv.id = %s AND sv.section_id = %s AND s.estimate_id = %s""",
            [service_id, section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        current = rows[0]
        # Guard the MERGED line (row + patch): an edit may not null-out hours
        # or repoint at an unrated kit and leave the line unresolvable.
        est_rows = await query(
            "SELECT estimate_type FROM estimates WHERE id = %s", [estimate_id]
        )
        if est_rows and est_rows[0].get("estimate_type") == "maintenance":
            merged = {
                "label": body.get("label", current.get("label")),
                "hours": body["hours"] if "hours" in body else current.get("hours"),
                "catalogItemId": body["catalogItemId"]
                if "catalogItemId" in body
                else current.get("catalog_item_id"),
            }
            await _require_resolvable_maintenance_lines([merged])
        cols = {
            "catalogItemId": "catalog_item_id",
            "discipline": "discipline",
            "billingType": "billing_type",
            "label": "label",
            "qty": "qty",
            "uom": "uom",
            "complexityPct": "complexity_pct",
            "unitSellCents": "unit_sell_cents",
            "embeddedCostCents": "embedded_cost_cents",
            "targetGm": "target_gm",
            "hours": "hours",
            "sortOrder": "sort_order",
        }
        await _apply_updates("section_services", cols, body, service_id)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        # An edited line (qty, sell, discipline, …) shifts the ITB LS/IR split.
        await _recompute_itb_split(estimate_id)
        svc = await query("SELECT * FROM section_services WHERE id = %s", [service_id])
        comp = await query(
            "SELECT * FROM section_service_components WHERE section_service_id = %s ORDER BY sort_order",
            [service_id],
        )
        return _service_out(svc[0], [_component_out(c) for c in comp])

    @app.delete(
        "/api/estimating/estimates/{estimate_id}/sections/{section_id}/services/{service_id}",
        status_code=204,
    )
    async def delete_service(
        estimate_id: str, section_id: str, service_id: str, _user: dict = Depends(require_auth)
    ):
        authz.require_estimator(_user)
        rows = await query(
            """SELECT sv.id FROM section_services sv
               JOIN estimate_sections s ON s.id = sv.section_id
               WHERE sv.id = %s AND sv.section_id = %s AND s.estimate_id = %s""",
            [service_id, section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        await execute("DELETE FROM section_services WHERE id = %s", [service_id])
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        # A removed line shifts the ITB LS/IR split.
        await _recompute_itb_split(estimate_id)

    # ── Component CRUD (the level the editors need) ────────────────────────
    #
    # Kit components (labor/material breakdown) are estimator-owned like the
    # rest of the tree. Every route validates the full ownership chain
    # (component → service → section → estimate) so a stray id can never
    # mutate another estimate's row.

    _SERVICE_CHAIN_SQL = """SELECT sv.id FROM section_services sv
               JOIN estimate_sections s ON s.id = sv.section_id
               WHERE sv.id = %s AND sv.section_id = %s AND s.estimate_id = %s"""

    _COMPONENT_CHAIN_SQL = """SELECT c.* FROM section_service_components c
               JOIN section_services sv ON sv.id = c.section_service_id
               JOIN estimate_sections s ON s.id = sv.section_id
               WHERE c.id = %s AND c.section_service_id = %s
                 AND sv.section_id = %s AND s.estimate_id = %s"""

    @app.post(
        "/api/estimating/estimates/{estimate_id}/sections/{section_id}/services/{service_id}/components",
        status_code=201,
    )
    async def create_component(
        estimate_id: str,
        section_id: str,
        service_id: str,
        body: dict,
        _user: dict = Depends(require_auth),
    ) -> dict:
        authz.require_estimator(_user)  # components are estimator-owned
        if body.get("kind") not in ("labor", "material"):
            raise HTTPException(status_code=400, detail="kind must be labor or material")
        rows = await query(_SERVICE_CHAIN_SQL, [service_id, section_id, estimate_id])
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        idx = await _next_sort_order(
            "section_service_components", "section_service_id", service_id, body
        )
        component_id = await _insert_component(service_id, {**body, "sortOrder": idx}, idx)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        comp = await query(
            "SELECT * FROM section_service_components WHERE id = %s", [component_id]
        )
        return _component_out(comp[0])

    @app.patch(
        "/api/estimating/estimates/{estimate_id}/sections/{section_id}/services/{service_id}/components/{component_id}"
    )
    async def update_component(
        estimate_id: str,
        section_id: str,
        service_id: str,
        component_id: str,
        body: dict,
        _user: dict = Depends(require_auth),
    ) -> dict:
        authz.require_estimator(_user)
        rows = await query(
            _COMPONENT_CHAIN_SQL, [component_id, service_id, section_id, estimate_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        cols = {
            "kind": "kind",
            "label": "label",
            "qty": "qty",
            "unitCostCents": "unit_cost_cents",
            "hours": "hours",
            "sortOrder": "sort_order",
        }
        await _apply_updates("section_service_components", cols, body, component_id)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        comp = await query(
            "SELECT * FROM section_service_components WHERE id = %s", [component_id]
        )
        return _component_out(comp[0])

    @app.delete(
        "/api/estimating/estimates/{estimate_id}/sections/{section_id}/services/{service_id}/components/{component_id}",
        status_code=204,
    )
    async def delete_component(
        estimate_id: str,
        section_id: str,
        service_id: str,
        component_id: str,
        _user: dict = Depends(require_auth),
    ):
        authz.require_estimator(_user)
        rows = await query(
            _COMPONENT_CHAIN_SQL, [component_id, service_id, section_id, estimate_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        await execute("DELETE FROM section_service_components WHERE id = %s", [component_id])
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])

    # ── Lifecycle flip (audit rides the status edge) ───────────────────────
    #
    # The Bidding↔Won toggle persists here, NOT in a frontend in-memory log.
    # Ownership always derives from lifecycle (won → crm); the edge is recorded
    # in estimate_status_transitions with a `lifecycle:` prefix so status edges
    # and lifecycle edges stay distinguishable in the one audit trail (per the
    # audit-wiring decision — no separate audit table).

    LIFECYCLE_OWNER = {"won": "crm", "bidding": "estimating"}

    @app.post("/api/estimating/estimates/{estimate_id}/lifecycle")
    async def transition_estimate_lifecycle(
        estimate_id: str, body: dict, _user: dict = Depends(require_auth)
    ) -> dict:
        authz.require_estimator(_user)  # the editor toggle is estimator-owned
        to = body.get("to")
        if to not in LIFECYCLE_OWNER:
            raise HTTPException(status_code=400, detail="to must be bidding or won")
        rows = await query("SELECT lifecycle FROM estimates WHERE id = %s", [estimate_id])
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        frm = rows[0]["lifecycle"]
        if frm == to:  # no-op — never spam the audit trail
            est = await _load_estimate(estimate_id)
            return {"estimate": est, "transition": None}
        await execute(
            "UPDATE estimates SET lifecycle = %s, aspire_owner = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            [to, LIFECYCLE_OWNER[to], estimate_id],
        )
        actor = _user.get("name") or _user.get("email") or _user.get("id") or "unknown"
        record = {
            "estimateId": estimate_id,
            "from": f"lifecycle:{frm}",
            "to": f"lifecycle:{to}",
            "actor": actor,
            "at": _now_utc().isoformat(),
        }
        await execute(
            """INSERT INTO estimate_status_transitions
                 (id, estimate_id, from_status, to_status, actor, at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            [_new_id("trn"), estimate_id, record["from"], record["to"], actor, record["at"]],
        )
        est = await _load_estimate(estimate_id)
        return {"estimate": est, "transition": record}

    # ── Takeoff-line CRUD (Discrepancy Review persistence) ─────────────────
    #
    # Takeoff is estimator-owned. All qty fields — including
    # opportunity_qty — are writable by the estimator; opportunity_qty is a
    # local value with NO Aspire read dependency, ever. Derived fields come
    # back recomputed via _takeoff_line_out; client-sent derived values are
    # ignored by the colmap. The Aspire qty push rides estimate Save
    # (PATCH /estimates/{id}), never these per-line edits.

    async def _get_takeoff_line(estimate_id: str, line_id: str) -> dict:
        rows = await query(
            "SELECT * FROM takeoff_lines WHERE id = %s AND estimate_id = %s",
            [line_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        return rows[0]

    @app.get("/api/estimating/estimates/{estimate_id}/takeoff-lines")
    async def list_takeoff_lines(
        estimate_id: str, _user: dict = Depends(require_auth)
    ) -> list:
        if not await query("SELECT id FROM estimates WHERE id = %s", [estimate_id]):
            raise HTTPException(status_code=404, detail="Not found")
        rows = await query(
            "SELECT * FROM takeoff_lines WHERE estimate_id = %s ORDER BY created_at, id",
            [estimate_id],
        )
        threshold = await _discrepancy_threshold()
        return [_takeoff_line_out(r, threshold) for r in rows]

    @app.post(
        "/api/estimating/estimates/{estimate_id}/takeoff-lines", status_code=201
    )
    async def create_takeoff_line(
        estimate_id: str, body: dict, _user: dict = Depends(require_auth)
    ) -> dict:
        authz.require_estimator(_user)
        if not await query("SELECT id FROM estimates WHERE id = %s", [estimate_id]):
            raise HTTPException(status_code=404, detail="Not found")
        line_id = _new_id("tk")
        await execute(
            """INSERT INTO takeoff_lines
                 (id, estimate_id, description, uom, plan_qty, add_pct,
                  measured_qty, opportunity_qty, catalog_item_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                line_id,
                estimate_id,
                body.get("description", ""),
                body.get("uom", ""),
                body.get("planQty", 0),
                body.get("addPct", 0),
                body.get("measuredQty", 0),
                body.get("opportunityQty", 0),
                body.get("catalogItemId"),
            ],
        )
        await execute(
            "UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id]
        )
        threshold = await _discrepancy_threshold()
        return _takeoff_line_out(await _get_takeoff_line(estimate_id, line_id), threshold)

    @app.patch("/api/estimating/estimates/{estimate_id}/takeoff-lines/{line_id}")
    async def update_takeoff_line(
        estimate_id: str, line_id: str, body: dict, _user: dict = Depends(require_auth)
    ) -> dict:
        authz.require_estimator(_user)
        await _get_takeoff_line(estimate_id, line_id)  # 404 outside the chain
        await _apply_updates("takeoff_lines", _TAKEOFF_COLS, body, line_id)
        await execute(
            "UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id]
        )
        threshold = await _discrepancy_threshold()
        return _takeoff_line_out(await _get_takeoff_line(estimate_id, line_id), threshold)

    @app.delete(
        "/api/estimating/estimates/{estimate_id}/takeoff-lines/{line_id}",
        status_code=204,
    )
    async def delete_takeoff_line(
        estimate_id: str, line_id: str, _user: dict = Depends(require_auth)
    ):
        authz.require_estimator(_user)
        await _get_takeoff_line(estimate_id, line_id)
        await execute("DELETE FROM takeoff_lines WHERE id = %s", [line_id])
        await execute(
            "UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id]
        )

    # ── Attachment routes (GCS upload/download) ─────────────────────────────

    @app.post(
        "/api/estimating/estimates/{estimate_id}/attachments/presign",
        status_code=201,
    )
    async def presign_attachment(
        estimate_id: str,
        body: dict,
        request: Request,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Validate, mint a pending attachment row, and return the GCS resumable session URI."""
        # 1. Estimate must exist.
        est_rows = await query("SELECT id FROM estimates WHERE id = %s", [estimate_id])
        if not est_rows:
            raise HTTPException(status_code=404, detail="Estimate not found")

        # 2. Validate content type per kind. Intake docs and the contract stay
        # PDF-only; the Takeoff Insert scan and the measurements/other proposal
        # kinds are scanned images, so they also accept common image types.
        #
        # Unknown kinds coerce to 'other' (legacy behaviour). The three proposal
        # kinds are in the allowlist, so they never coerce — a proposal document
        # uploading as an intake 'other' row would leave the render nothing to
        # append with no error anywhere (§3.2).
        kind = body.get("kind", "other")
        if kind not in _VALID_ATTACHMENT_KINDS:
            kind = "other"
        content_type = body.get("contentType", "")
        if kind in _IMAGE_OR_PDF_KINDS:
            if content_type not in _SCAN_CONTENT_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail="This attachment must be PNG, JPEG, WebP, or PDF",
                )
        elif content_type != "application/pdf":
            raise HTTPException(status_code=400, detail="Only PDF attachments are supported")

        # 3. Validate size (must be a positive integer ≤ 2 GiB).
        raw_size = body.get("sizeBytes", 0)
        try:
            size_bytes = int(raw_size)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="sizeBytes must be an integer")
        if size_bytes <= 0:
            raise HTTPException(status_code=400, detail="sizeBytes must be positive")
        if size_bytes > _att_mod.GCS_MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="File exceeds the 2 GiB limit")

        # 4. Resolve intake submission for the FK. Estimate-scoped kinds (takeoff
        # scans and the three proposal kinds) hang directly off
        # intake_attachments.estimate_id and need no submission; everything else
        # requires one. Membership test, not a `!= takeoff_scan` chain (§3.2).
        submission_id: Optional[str] = None
        if kind not in _ESTIMATE_SCOPED_KINDS:
            sub_rows = await query(
                "SELECT id FROM intake_submissions WHERE estimate_id = %s ORDER BY created_at DESC LIMIT 1",
                [estimate_id],
            )
            if not sub_rows:
                raise HTTPException(status_code=404, detail="No intake submission found for this estimate")
            submission_id = sub_rows[0]["id"]

        # 5. Mint IDs and persist pending row (always carrying the estimate link).
        attachment_id = _new_id("att")
        object_key = _att_mod.object_key_for(estimate_id, attachment_id, content_type)

        await execute(
            """INSERT INTO intake_attachments
                 (id, intake_submission_id, estimate_id, file_name, content_type,
                  size_bytes, url, kind, uploaded_by, status, object_key)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                attachment_id, submission_id, estimate_id,
                body.get("fileName", ""), content_type, size_bytes, "",
                kind, user.get("id"), "pending", object_key,
            ],
        )

        # 6. Begin resumable upload session — browser writes bytes directly to GCS.
        # Allowlist the origin so we never grant cross-origin CORS for arbitrary domains.
        raw_origin = request.headers.get("origin", "")
        origin = raw_origin if raw_origin in _att_mod.ALLOWED_ORIGINS else ""
        upload_url = _att_mod.begin_resumable_session(object_key, content_type, origin)
        return {"attachmentId": attachment_id, "objectKey": object_key, "uploadUrl": upload_url}

    @app.post(
        "/api/estimating/estimates/{estimate_id}/attachments/{attachment_id}/confirm",
    )
    async def confirm_attachment(
        estimate_id: str,
        attachment_id: str,
        _user: dict = Depends(require_auth),
    ) -> dict:
        """Verify the blob landed in GCS and flip status to 'stored' (or 'failed')."""
        rows = await query(
            _ATTACHMENT_BY_ID_SQL,
            [attachment_id, estimate_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Attachment not found")

        row = rows[0]
        object_key = row.get("object_key")

        # Legacy rows (object_key=NULL) were never uploaded — refuse to corrupt them.
        if not object_key:
            raise HTTPException(status_code=409, detail="No GCS object associated with this attachment")

        try:
            blob = _att_mod.head(object_key)
        except Exception:
            await execute(
                "UPDATE intake_attachments SET status = %s WHERE id = %s",
                ["failed", attachment_id],
            )
            raise HTTPException(status_code=400, detail="Object not found in GCS")

        # Validate the blob matches what presign authorized (per-kind content
        # type — PDF for intake docs, image types for takeoff scans).
        expected_type = row.get("content_type") or "application/pdf"
        if blob.content_type != expected_type or not blob.size:
            await execute(
                "UPDATE intake_attachments SET status = %s WHERE id = %s",
                ["failed", attachment_id],
            )
            raise HTTPException(status_code=400, detail="Upload validation failed")

        # Proposal documents are appended into a client-facing PDF, so their
        # bytes are validated HERE, at confirm — the rep learns a file is
        # unusable while still in the form, not at render (§7). This also records
        # the page count the preview panel and render manifest report (§6). An
        # encrypted/corrupt PDF or an undecodable image → status='failed', 400.
        page_count: Optional[int] = None
        if row.get("kind") in _PROPOSAL_DOC_KINDS:
            import api.proposal_documents as _pdoc
            try:
                data = _pdoc.download_bytes(object_key)
                page_count = _pdoc.validate_document_bytes(blob.content_type, data)
            except _pdoc.DocumentValidationError as exc:
                await execute(
                    "UPDATE intake_attachments SET status = %s WHERE id = %s",
                    ["failed", attachment_id],
                )
                raise HTTPException(status_code=400, detail=str(exc))

        await execute(
            """UPDATE intake_attachments
               SET status = %s, content_type = %s, size_bytes = %s, page_count = %s
               WHERE id = %s""",
            ["stored", blob.content_type, blob.size, page_count, attachment_id],
        )

        updated = dict(row)
        updated["status"] = "stored"
        updated["content_type"] = blob.content_type
        updated["size_bytes"] = blob.size
        updated["page_count"] = page_count
        return _attachment_out(updated)

    @app.get("/api/estimating/estimates/{estimate_id}/attachments")
    async def list_attachments(
        estimate_id: str,
        _user: dict = Depends(require_auth),
    ) -> list:
        """List all attachments for an estimate (stored + pending + legacy)."""
        est_rows = await query("SELECT id FROM estimates WHERE id = %s", [estimate_id])
        if not est_rows:
            raise HTTPException(status_code=404, detail="Estimate not found")

        rows = await query(
            """SELECT ia.* FROM intake_attachments ia
               LEFT JOIN intake_submissions ins ON ins.id = ia.intake_submission_id
               WHERE (ia.estimate_id = %s OR ins.estimate_id = %s)
                 AND ia.status <> 'deleted'
               ORDER BY ia.sort_order ASC, ia.created_at ASC""",
            [estimate_id, estimate_id],
        )
        return [_attachment_out(r) for r in rows]

    @app.get(
        "/api/estimating/estimates/{estimate_id}/attachments/{attachment_id}/download-url",
    )
    async def get_download_url(
        estimate_id: str,
        attachment_id: str,
        _user: dict = Depends(require_auth),
    ) -> dict:
        """Return a short-lived v4 signed GET URL for a stored attachment."""
        rows = await query(
            _ATTACHMENT_BY_ID_SQL,
            [attachment_id, estimate_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Attachment not found")

        row = rows[0]
        if row.get("status") != "stored":
            raise HTTPException(status_code=409, detail="Attachment is not yet stored")

        url = _att_mod.signed_get_url(row["object_key"], row["file_name"])
        return {"url": url, "expiresIn": _att_mod.GCS_SIGNED_URL_TTL_MIN * 60}

    @app.patch(
        "/api/estimating/estimates/{estimate_id}/attachments/{attachment_id}",
    )
    async def patch_attachment(
        estimate_id: str,
        attachment_id: str,
        body: dict,
        _user: dict = Depends(require_auth),
    ) -> dict:
        """Update an attachment's sort_order (reordering 'other' proposal docs, §4).

        Accepts sortOrder only — the render orders 'other' attachments by this
        column, so writing it reorders them in the output PDF.
        """
        raw = body.get("sortOrder")
        if raw is None:
            raise HTTPException(status_code=400, detail="sortOrder is required")
        try:
            sort_order = int(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="sortOrder must be an integer")

        rows = await query(
            _ATTACHMENT_BY_ID_SQL,
            [attachment_id, estimate_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Attachment not found")

        await execute(
            "UPDATE intake_attachments SET sort_order = %s WHERE id = %s",
            [sort_order, attachment_id],
        )
        updated = dict(rows[0])
        updated["sort_order"] = sort_order
        return _attachment_out(updated)

    @app.delete(
        "/api/estimating/estimates/{estimate_id}/attachments/{attachment_id}",
        status_code=204,
    )
    async def delete_attachment(
        estimate_id: str,
        attachment_id: str,
        _user: dict = Depends(require_auth),
    ):
        """Soft-delete an attachment and remove its GCS object (§4).

        Per api/attachments.py::delete's docstring, the row is soft-deleted
        (status='deleted') to preserve the corpus, and the stored object is
        deleted from GCS. A GCS failure (object already gone) does not fail the
        soft-delete — the row must still be retired.
        """
        rows = await query(
            _ATTACHMENT_BY_ID_SQL,
            [attachment_id, estimate_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Attachment not found")

        row = rows[0]
        object_key = row.get("object_key")
        if object_key:
            try:
                _att_mod.delete(object_key)
            except Exception:
                # Best-effort: an already-absent object must not block the
                # soft-delete of the row.
                logger.warning("GCS delete failed for %s; soft-deleting row anyway", object_key)

        await execute(
            "UPDATE intake_attachments SET status = %s WHERE id = %s",
            ["deleted", attachment_id],
        )

    # ── Lead-scoped proposal attachment routes (WS2) ───────────────────────
    #
    # When there is no estimate yet (estimate-optional proposals, Handoff 50
    # WS2), proposal documents (contract / measurements / other) are uploaded
    # against the LEAD instead of the estimate. These three endpoints mirror the
    # estimate-scoped presign / confirm / list routes but write lead_id instead
    # of estimate_id. Only the three proposal kinds are accepted — rejecting
    # intake kinds (takeoff_scan, property_map, rfp, other) keeps them firmly
    # estimate-scoped.
    #
    # When POST /api/proposals later supplies an estimate_id, the handler
    # re-anchors lead-scoped rows to the estimate (two separate statements,
    # not transactional) so the render pipeline finds them via estimate_id as usual.

    # Lead-only attachment presign
    @app.post("/api/leads/{lead_id}/attachments/presign", status_code=201)
    async def presign_lead_attachment(
        lead_id: str,
        body: dict,
        request: Request,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Mint a pending lead-scoped proposal attachment and return the GCS session URI.

        Only the three proposal document kinds are accepted; intake/takeoff kinds
        must be uploaded against an estimate (estimate-scoped presign endpoint).
        """
        # 1. Lead must exist.
        lead_rows = await query("SELECT id FROM leads WHERE id = %s", [lead_id])
        if not lead_rows:
            raise HTTPException(status_code=404, detail="Lead not found")

        # 2. Only proposal kinds are accepted at the lead level.
        kind = body.get("kind", "")
        if kind not in _PROPOSAL_DOC_KINDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"kind '{kind}' is not valid for lead-scoped uploads. "
                    "Accepted: proposal_contract, proposal_measurements, proposal_other"
                ),
            )

        # 3. Validate content type (same rules as estimate presign).
        content_type = body.get("contentType", "")
        if kind in _IMAGE_OR_PDF_KINDS:
            if content_type not in _SCAN_CONTENT_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail="This attachment must be PNG, JPEG, WebP, or PDF",
                )
        elif content_type != "application/pdf":
            raise HTTPException(status_code=400, detail="Only PDF attachments are supported")

        # 4. Validate size.
        raw_size = body.get("sizeBytes", 0)
        try:
            size_bytes = int(raw_size)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="sizeBytes must be an integer")
        if size_bytes <= 0:
            raise HTTPException(status_code=400, detail="sizeBytes must be positive")
        if size_bytes > _att_mod.GCS_MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="File exceeds the 2 GiB limit")

        # 5. Mint IDs and persist a pending row (lead_id set, estimate_id NULL).
        attachment_id = _new_id("att")
        # Use lead_id in the object key path so GCS objects are namespaced per lead.
        object_key = _att_mod.object_key_for(f"lead-{lead_id}", attachment_id, content_type)

        await execute(
            """INSERT INTO intake_attachments
                 (id, intake_submission_id, estimate_id, lead_id, file_name,
                  content_type, size_bytes, url, kind, uploaded_by, status, object_key)
               VALUES (%s, NULL, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                attachment_id, lead_id,
                body.get("fileName", ""), content_type, size_bytes, "",
                kind, user.get("id"), "pending", object_key,
            ],
        )

        # 6. Begin GCS resumable session.
        raw_origin = request.headers.get("origin", "")
        origin = raw_origin if raw_origin in _att_mod.ALLOWED_ORIGINS else ""
        upload_url = _att_mod.begin_resumable_session(object_key, content_type, origin)
        return {"attachmentId": attachment_id, "objectKey": object_key, "uploadUrl": upload_url}

    # Lead-only attachment confirm
    @app.post("/api/leads/{lead_id}/attachments/{attachment_id}/confirm")
    async def confirm_lead_attachment(
        lead_id: str,
        attachment_id: str,
        _user: dict = Depends(require_auth),
    ) -> dict:
        """Verify the blob landed in GCS and flip status to 'stored' (or 'failed').

        Looks up the attachment by both id AND lead_id so a rep cannot confirm
        an attachment belonging to a different lead.
        """
        rows = await query(
            "SELECT ia.* FROM intake_attachments ia WHERE ia.id = %s AND ia.lead_id = %s",
            [attachment_id, lead_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Attachment not found")

        row = rows[0]
        object_key = row.get("object_key")
        if not object_key:
            raise HTTPException(status_code=409, detail="No GCS object associated with this attachment")

        try:
            blob = _att_mod.head(object_key)
        except Exception:
            await execute(
                "UPDATE intake_attachments SET status = %s WHERE id = %s",
                ["failed", attachment_id],
            )
            raise HTTPException(status_code=400, detail="Object not found in GCS")

        expected_type = row.get("content_type") or "application/pdf"
        if blob.content_type != expected_type or not blob.size:
            await execute(
                "UPDATE intake_attachments SET status = %s WHERE id = %s",
                ["failed", attachment_id],
            )
            raise HTTPException(status_code=400, detail="Upload validation failed")

        # Validate proposal document bytes at confirm time (same as estimate confirm).
        page_count: Optional[int] = None
        if row.get("kind") in _PROPOSAL_DOC_KINDS:
            import api.proposal_documents as _pdoc
            try:
                data = _pdoc.download_bytes(object_key)
                page_count = _pdoc.validate_document_bytes(blob.content_type, data)
            except _pdoc.DocumentValidationError as exc:
                await execute(
                    "UPDATE intake_attachments SET status = %s WHERE id = %s",
                    ["failed", attachment_id],
                )
                raise HTTPException(status_code=400, detail=str(exc))

        await execute(
            """UPDATE intake_attachments
               SET status = %s, content_type = %s, size_bytes = %s, page_count = %s
               WHERE id = %s""",
            ["stored", blob.content_type, blob.size, page_count, attachment_id],
        )

        updated = dict(row)
        updated["status"] = "stored"
        updated["content_type"] = blob.content_type
        updated["size_bytes"] = blob.size
        updated["page_count"] = page_count
        return _attachment_out(updated)

    # Lead-only attachment list
    @app.get("/api/leads/{lead_id}/attachments")
    async def list_lead_attachments(
        lead_id: str,
        _user: dict = Depends(require_auth),
    ) -> list:
        """List proposal document attachments anchored to a lead (no estimate yet).

        Returns only the three proposal kinds; intake/takeoff attachments are
        always estimate-scoped and will not appear here.
        """
        lead_rows = await query("SELECT id FROM leads WHERE id = %s", [lead_id])
        if not lead_rows:
            raise HTTPException(status_code=404, detail="Lead not found")

        rows = await query(
            """SELECT ia.* FROM intake_attachments ia
               WHERE ia.lead_id = %s
                 AND ia.kind IN ('proposal_contract', 'proposal_measurements', 'proposal_other')
                 AND ia.status <> 'deleted'
               ORDER BY ia.sort_order ASC, ia.created_at ASC""",
            [lead_id],
        )
        return [_attachment_out(r) for r in rows]

    # Lead-only attachment delete
    @app.delete("/api/leads/{lead_id}/attachments/{attachment_id}", status_code=204)
    async def delete_lead_attachment(
        lead_id: str,
        attachment_id: str,
        _user: dict = Depends(require_auth),
    ):
        """Soft-delete a lead-scoped attachment and remove its GCS object.

        Scopes the lookup to both id AND lead_id so a rep cannot delete an
        attachment belonging to a different lead. GCS delete is best-effort —
        an already-absent object must not block the soft-delete of the row.
        """
        rows = await query(
            "SELECT * FROM intake_attachments WHERE id = %s AND lead_id = %s",
            [attachment_id, lead_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Attachment not found")

        row = rows[0]
        object_key = row.get("object_key")
        if object_key:
            try:
                _att_mod.delete(object_key)
            except Exception:
                logger.warning("GCS delete failed for %s; soft-deleting row anyway", object_key)

        await execute(
            "DELETE FROM intake_attachments WHERE id = %s AND lead_id = %s",
            [attachment_id, lead_id],
        )

    # ── Config-table read APIs (READ-ONLY by locked decision) ──────────────
    #
    # No POST/PATCH/DELETE for these tables here: config is edited via SQL/DB
    # for now; an admin editing surface is a separate future handoff.

    @app.get("/api/estimating/config/approval-tiers")
    async def list_approval_tiers(
        estimate_type: Optional[str] = Query(default=None),
        _user: dict = Depends(require_auth),
    ) -> list:
        if estimate_type is not None and estimate_type not in ("maintenance", "install"):
            raise HTTPException(
                status_code=400, detail="estimate_type must be maintenance or install"
            )
        where = "WHERE estimate_type = %s" if estimate_type else ""
        params: list[Any] = [estimate_type] if estimate_type else []
        rows = await query(
            f"SELECT * FROM approval_tiers {where} ORDER BY tier_order", params
        )
        return [_approval_tier_out(r) for r in rows]

    @app.get("/api/estimating/config/margin-bands")
    async def list_margin_bands(_user: dict = Depends(require_auth)) -> list:
        rows = await query("SELECT * FROM margin_bands ORDER BY name", [])
        return [_margin_band_out(r) for r in rows]

    @app.get("/api/estimating/config/material-calcs")
    async def list_material_calcs(_user: dict = Depends(require_auth)) -> list:
        rows = await query("SELECT * FROM material_calcs ORDER BY material_key", [])
        return [_material_calc_out(r) for r in rows]

    @app.get("/api/estimating/config/branches")
    async def list_branches(
        kind: str = Query(...),
        _user: dict = Depends(require_auth),
    ) -> list:
        """Return Aspire-derived branch options for the intake branch dropdown.

        kind=install:      cities with a dedicated install branch (excludes
                           ASPIRE_BRANCH_INSTALL_FALLBACKS which share the
                           maintenance branch).
        kind=maintenance:  all cities (every city has a maintenance branch).

        Returns [{city, aspire_branch_id}] sorted by city name.  Auth-only;
        no role or branch scoping (this is reference/config data).
        """
        if kind not in ("install", "maintenance"):
            raise HTTPException(
                status_code=400, detail="kind must be 'install' or 'maintenance'"
            )
        is_install = kind == "install"
        cities = {c for (c, _) in ASPIRE_BRANCH_MAP}
        if is_install:
            cities -= ASPIRE_BRANCH_INSTALL_FALLBACKS
        return sorted(
            [{"city": c, "aspire_branch_id": ASPIRE_BRANCH_MAP[(c, is_install)]} for c in cities],
            key=lambda x: x["city"],
        )

    @app.get("/api/estimating/config/itb-scopes")
    async def list_itb_scopes(_user: dict = Depends(require_auth)) -> list:
        # Group order: estimating → outside_dept → vendor_only (enum order),
        # then the admin-set sort_order within each group.
        rows = await query(
            "SELECT * FROM itb_scopes ORDER BY scope_group, sort_order", []
        )
        return [_itb_scope_out(r) for r in rows]

    # ── ITB tracker ──────────────────────────────────────────────────────────

    @app.get("/api/estimating/itb/projects")
    async def list_itb_projects(_user: dict = Depends(require_auth)) -> list:
        """All ACTIVE estimates' ITB projects, branch-scoped.

        "Active" = the linked estimate's status is NOT terminal — NOT IN
        ('won', 'lost'). handed_back/approved estimates stay visible by default
        (LOCKED: confirmed with Carlos). Every estimate appears
        (LOCKED: one estimate → one ITB project). Scope definitions come from
        GET /config/itb-scopes; this returns projects + their scope statuses.
        """
        scope = await authz.resolve_branch_scope(_user)
        if scope.kind == "none":
            return []
        conditions = ["e.status NOT IN ('won', 'lost')"]
        params: list[Any] = []
        if scope.kind == "branch":
            # Filter on the linked estimate's aspire_branch_id (Amendment B.1);
            # the JOIN already brings `estimates e` into scope. Parameterized
            # placeholders only — ids are never string-interpolated.
            placeholders = ", ".join(["%s"] * len(scope.ids))
            conditions.append(f"e.aspire_branch_id IN ({placeholders})")
            params.extend(scope.ids)
        rows = await query(
            f"""SELECT p.* FROM itb_projects p
                 JOIN estimates e ON e.id = p.estimate_id
                 WHERE {' AND '.join(conditions)}
                 ORDER BY p.due_date, p.created_at""",
            params,
        )
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        placeholders = ", ".join(["%s"] * len(ids))
        status_rows = await query(
            f"""SELECT project_id, scope_id, status_code FROM itb_scope_status
                 WHERE project_id IN ({placeholders})""",
            ids,
        )
        by_project: dict[str, list[dict]] = {}
        for sr in status_rows:
            by_project.setdefault(sr["project_id"], []).append(_itb_status_out(sr))
        return [_itb_project_out(r, by_project.get(r["id"], [])) for r in rows]

    @app.patch("/api/estimating/itb/projects/{project_id}/scopes/{scope_id}")
    async def update_itb_scope_status(
        project_id: str, scope_id: str, body: dict, _user: dict = Depends(require_auth)
    ) -> dict:
        """Update one scope's status code for one ITB project.

        Upserts, so scopes added to itb_scopes AFTER a project was auto-created
        still accept a status (the tracker renders missing cells as N/A).
        """
        code = body.get("statusCode")
        if code not in ITB_STATUS_CODES:
            raise HTTPException(
                status_code=400,
                detail=f"statusCode must be one of {sorted(ITB_STATUS_CODES)}",
            )
        if not await query("SELECT id FROM itb_projects WHERE id = %s", [project_id]):
            raise HTTPException(status_code=404, detail="ITB project not found")
        if not await query("SELECT id FROM itb_scopes WHERE id = %s", [scope_id]):
            raise HTTPException(status_code=404, detail="ITB scope not found")
        await execute(
            """INSERT INTO itb_scope_status (project_id, scope_id, status_code)
               VALUES (%s, %s, %s)
               ON DUPLICATE KEY UPDATE status_code = VALUES(status_code)""",
            [project_id, scope_id, code],
        )
        return {"projectId": project_id, "scopeId": scope_id, "statusCode": code}

    @app.get("/api/estimating/catalog-items")
    async def list_catalog_items(
        # Slice 14: the `branch` city-string filter is removed; callers should
        # filter by aspireBranchId (int) once that param is wired (follow-up).
        kit_type: Optional[str] = Query(default=None),
        active: Optional[str] = Query(default=None),
        _user: dict = Depends(require_auth),
    ) -> list:
        if kit_type is not None and kit_type not in ("maintenance_hours", "install_quantity"):
            raise HTTPException(
                status_code=400,
                detail="kit_type must be maintenance_hours or install_quantity",
            )
        conditions: list[str] = []
        params: list[Any] = []
        if kit_type:
            conditions.append("kit_type = %s")
            params.append(kit_type)
        if active is not None:
            flag = {"true": 1, "1": 1, "false": 0, "0": 0}.get(active.lower())
            if flag is None:
                raise HTTPException(status_code=400, detail="active must be true or false")
            conditions.append("active = %s")
            params.append(flag)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = await query(
            f"SELECT * FROM catalog_items {where} ORDER BY description", params
        )
        return [_catalog_item_out(r) for r in rows]
