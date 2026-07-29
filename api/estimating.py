"""Estimating API — /api/estimating/* routes (Handoff 00 + 08).

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
import os
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel

import api.attachments as _att_mod
from db import execute, query
from api import aspire_sync
from api.aspire_sync import OpportunityInput

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


def _service_out(r: dict, components: list[dict]) -> dict:
    return {
        "id": r["id"],
        "sectionId": r["section_id"],
        "catalogItemId": r["catalog_item_id"],
        "label": r["label"],
        "qty": _num(r["qty"]),
        "uom": r["uom"],
        "complexityPct": _num(r["complexity_pct"]),
        "unitSellCents": None if r["unit_sell_cents"] is None else int(r["unit_sell_cents"]),
        "embeddedCostCents": None if r["embedded_cost_cents"] is None else int(r["embedded_cost_cents"]),
        "targetGm": _num(r["target_gm"]),
        "hours": _num(r["hours"]),
        "sortOrder": r["sort_order"],
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
        "clientName": r["client_name"],
        "branch": r["branch"],
        "customerType": r["customer_type"],
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
        "aspireOpportunityId": r.get("aspire_opportunity_id"),
        "aspireSyncStatus": r.get("aspire_sync_status"),
        "sections": sections,
        "createdAt": _iso(r["created_at"]),
        "updatedAt": _iso(r["updated_at"]),
    }


async def _load_estimate(estimate_id: str) -> Optional[dict]:
    """Assemble the full estimate → sections → services → components tree."""
    rows = await query("SELECT * FROM estimates WHERE id = %s", [estimate_id])
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

    services_by_section: dict[str, list[dict]] = {}
    for sv in service_rows:
        services_by_section.setdefault(sv["section_id"], []).append(
            _service_out(sv, comps_by_service.get(sv["id"], []))
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


async def _build_opportunity_input(est_row: dict, service_line: Optional[str] = None) -> OpportunityInput:
    """Assemble a neutral OpportunityInput from the estimate + its property/rep rows.

    All DB reads for the mapping live here (never in the port). The linked
    property supplies the Aspire PropertyID and the city-level branch key; the
    crm_rep supplies the Aspire ContactID for SalesRepContactID.
    """
    aspire_property_id: Optional[int] = None
    branch_city: Optional[str] = None
    if est_row.get("property_id"):
        prows = await query(
            "SELECT aspire_property_id, branch_city FROM properties WHERE id = %s",
            [est_row["property_id"]],
        )
        if prows:
            aspire_property_id = prows[0].get("aspire_property_id")
            branch_city = prows[0].get("branch_city")

    rep_contact_id: Optional[int] = None
    if est_row.get("crm_rep"):
        urows = await query(
            "SELECT aspire_rep_id FROM crm_users WHERE id = %s", [est_row["crm_rep"]]
        )
        if urows:
            rep_contact_id = urows[0].get("aspire_rep_id")

    est_type = est_row.get("estimate_type")
    return OpportunityInput(
        name=est_row.get("name", ""),
        service_line=service_line or DEFAULT_SERVICE_LINE.get(est_type, "Maintenance: Contract"),
        branch_city=branch_city or est_row.get("branch") or "",
        is_install=(est_type == "install"),
        aspire_property_id=aspire_property_id,
        aspire_rep_contact_id=rep_contact_id,
        sales_type=SALES_TYPE_BY_CUSTOMER.get(est_row.get("customer_type")),
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
        "fileName": r["file_name"],
        "contentType": r.get("content_type", ""),
        "sizeBytes": r.get("size_bytes", 0),
        "kind": r.get("kind", "other"),
        "uploadedBy": r.get("uploaded_by"),
        "status": r.get("status", "pending"),
        "objectKey": r.get("object_key"),
        "downloadable": downloadable,
        "createdAt": _iso(r["created_at"]),
    }


async def _insert_component(service_id: str, comp: dict, idx: int) -> None:
    await execute(
        """INSERT INTO section_service_components
             (id, section_service_id, kind, label, qty, unit_cost_cents, hours, sort_order)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        [
            _new_id("cmp"),
            service_id,
            comp["kind"],
            comp["label"],
            comp.get("qty", 0),
            comp.get("unitCostCents", 0),
            comp.get("hours"),
            comp.get("sortOrder", idx),
        ],
    )


async def _insert_service(section_id: str, svc: dict, idx: int) -> str:
    service_id = _new_id("svc")
    await execute(
        """INSERT INTO section_services
             (id, section_id, catalog_item_id, label, qty, uom, complexity_pct,
              unit_sell_cents, embedded_cost_cents, target_gm, hours, sort_order)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [
            service_id,
            section_id,
            svc.get("catalogItemId"),
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


# ── Request models ────────────────────────────────────────────────────────────

# Payloads accept arbitrary camelCase keys (validated against the DB columns in
# the handlers); modeled loosely to mirror the flexible mock contract.

# Scalar estimate columns updatable via PATCH (estimate_type intentionally absent).
_UPDATABLE = {
    "name": "name",
    "aspireNumber": "aspire_number",
    "clientName": "client_name",
    "branch": "branch",
    "customerType": "customer_type",
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
    "notifyBmRdOnReturn": "notify_bm_rd_on_return",
    # Captured at the lost transition so the durability sweep can re-send the same
    # reason on a retry (otherwise a re-push would drop it).
    "lostReasonId": "aspire_lost_reason_id",
}


class ApproveHandBackBody(BaseModel):
    actor: str
    notifyBmRdOnReturn: Optional[bool] = None


# ── Routes ──────────────────────────────────────────────────────────────────

def register(app, require_auth) -> None:
    """Attach all estimating routes to the FastAPI app with the shared auth dep."""

    @app.get("/api/estimating/estimates")
    async def list_estimates(
        estimate_type: Optional[str] = Query(default=None),
        status: Optional[str] = Query(default=None),
        branch: Optional[str] = Query(default=None),
        _user: dict = Depends(require_auth),
    ) -> list:
        conditions: list[str] = []
        params: list[Any] = []
        if estimate_type:
            conditions.append("estimate_type = %s")
            params.append(estimate_type)
        if status:
            conditions.append("status = %s")
            params.append(status)
        if branch:
            conditions.append("branch = %s")
            params.append(branch)
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
        estimate_id = _new_id("est")
        await execute(
            """INSERT INTO estimates
                 (id, estimate_type, name, aspire_number, client_name, branch, customer_type,
                  acreage, contract_value_cents, target_margin, status, lifecycle, aspire_owner,
                  priority, win_probability, site_walk_date, due_back_date, anticipated_close_date,
                  service_start_date, assigned_ls_estimator, assigned_irr_estimator, crm_rep,
                  notify_bm_rd_on_return, notes, property_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                estimate_id,
                est_type,
                body.get("name", ""),
                body.get("aspireNumber"),
                body.get("clientName", ""),
                body.get("branch", ""),
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
        # Create never blocks on Aspire: push the opportunity in the background,
        # leaving aspire_sync_status='pending' (its column default) until it lands.
        background.add_task(_sync_new_opportunity_bg, estimate_id, body.get("serviceLine"))
        created = await _load_estimate(estimate_id)
        assert created is not None
        return created

    @app.get("/api/estimating/estimates/{estimate_id}")
    async def get_estimate(estimate_id: str, _user: dict = Depends(require_auth)) -> dict:
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

    @app.patch("/api/estimating/estimates/{estimate_id}")
    async def update_estimate(
        estimate_id: str, body: dict, background: BackgroundTasks, _user: dict = Depends(require_auth)
    ) -> dict:
        rows = await query(
            "SELECT estimate_type, status, aspire_opportunity_id FROM estimates WHERE id = %s",
            [estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        current = rows[0]
        if "estimateType" in body and body["estimateType"] != current["estimate_type"]:
            raise HTTPException(
                status_code=400,
                detail="estimate_type is immutable and cannot be changed after creation",
            )
        # approvalSettings arrives as a nested object; flatten to the column.
        if isinstance(body.get("approvalSettings"), dict):
            body["notifyBmRdOnReturn"] = body["approvalSettings"].get("notifyBmRdOnReturn")

        # Terminal WON folds in the same side effects as the approve/handback path
        # (lifecycle→won, ownership→crm); see _side_effects, the single source.
        target_status = body.get("status")
        if target_status == "won":
            for camel, val in {"lifecycle": "won", "aspireOwner": "crm"}.items():
                body.setdefault(camel, val)

        await _apply_updates("estimates", _UPDATABLE, body, estimate_id, touch_updated_at=True)

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

        est = await _load_estimate(estimate_id)
        assert est is not None
        return est

    @app.post("/api/estimating/estimates/{estimate_id}/retry-aspire-sync", status_code=202)
    async def retry_aspire_sync(
        estimate_id: str, background: BackgroundTasks, _user: dict = Depends(require_auth)
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
        return {"status": "queued"}

    @app.post("/api/estimating/estimates/{estimate_id}/approve-handback")
    async def approve_handback(
        estimate_id: str, body: ApproveHandBackBody, _user: dict = Depends(require_auth)
    ) -> dict:
        rows = await query("SELECT id, status FROM estimates WHERE id = %s", [estimate_id])
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        at = _now_utc().isoformat()
        try:
            patch, records = _approve_and_hand_back(estimate_id, rows[0]["status"], body.actor, at)
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

    @app.post("/api/estimating/estimates/{estimate_id}/sections", status_code=201)
    async def create_section(estimate_id: str, body: dict, _user: dict = Depends(require_auth)) -> dict:
        if not await query("SELECT id FROM estimates WHERE id = %s", [estimate_id]):
            raise HTTPException(status_code=404, detail="Not found")
        idx = await _next_sort_order("estimate_sections", "estimate_id", estimate_id, body)
        section_id = await _insert_section(estimate_id, {**body, "sortOrder": idx}, idx)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
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
        rows = await query(
            "SELECT * FROM estimate_sections WHERE id = %s AND estimate_id = %s",
            [section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        cols = {"name": "name", "squareFeet": "square_feet", "sortOrder": "sort_order"}
        await _apply_updates("estimate_sections", cols, body, section_id)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
        rows = await query("SELECT * FROM estimate_sections WHERE id = %s", [section_id])
        svc_rows = await query(
            "SELECT * FROM section_services WHERE section_id = %s ORDER BY sort_order", [section_id]
        )
        return _section_out(rows[0], [_service_out(sv, []) for sv in svc_rows])

    @app.delete("/api/estimating/estimates/{estimate_id}/sections/{section_id}", status_code=204)
    async def delete_section(estimate_id: str, section_id: str, _user: dict = Depends(require_auth)):
        rows = await query(
            "SELECT id FROM estimate_sections WHERE id = %s AND estimate_id = %s",
            [section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        await execute("DELETE FROM estimate_sections WHERE id = %s", [section_id])
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])

    @app.post(
        "/api/estimating/estimates/{estimate_id}/sections/{section_id}/services",
        status_code=201,
    )
    async def create_service(
        estimate_id: str, section_id: str, body: dict, _user: dict = Depends(require_auth)
    ) -> dict:
        rows = await query(
            "SELECT id FROM estimate_sections WHERE id = %s AND estimate_id = %s",
            [section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        idx = await _next_sort_order("section_services", "section_id", section_id, body)
        service_id = await _insert_service(section_id, {**body, "sortOrder": idx}, idx)
        await execute("UPDATE estimates SET updated_at = CURRENT_TIMESTAMP WHERE id = %s", [estimate_id])
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
        rows = await query(
            """SELECT sv.id FROM section_services sv
               JOIN estimate_sections s ON s.id = sv.section_id
               WHERE sv.id = %s AND sv.section_id = %s AND s.estimate_id = %s""",
            [service_id, section_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        cols = {
            "catalogItemId": "catalog_item_id",
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

    # ── Attachment routes (GCS upload/download, Handoff plan §WP-B) ──────────

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

        # 2. Validate content type.
        content_type = body.get("contentType", "")
        if content_type != "application/pdf":
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

        # 4. Resolve intake submission for the FK.
        sub_rows = await query(
            "SELECT id FROM intake_submissions WHERE estimate_id = %s ORDER BY created_at DESC LIMIT 1",
            [estimate_id],
        )
        if not sub_rows:
            raise HTTPException(status_code=404, detail="No intake submission found for this estimate")
        submission_id = sub_rows[0]["id"]

        # 5. Mint IDs and persist pending row.
        attachment_id = _new_id("att")
        object_key = _att_mod.object_key_for(estimate_id, attachment_id)
        kind = body.get("kind", "other")
        if kind not in ("property_map", "rfp", "other"):
            kind = "other"

        await execute(
            """INSERT INTO intake_attachments
                 (id, intake_submission_id, file_name, content_type, size_bytes, url,
                  kind, uploaded_by, status, object_key)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                attachment_id, submission_id,
                body.get("fileName", ""), content_type, size_bytes, "",
                kind, user.get("id"), "pending", object_key,
            ],
        )

        # 6. Begin resumable upload session — browser writes bytes directly to GCS.
        # Allowlist the origin so we never grant cross-origin CORS for arbitrary domains.
        raw_origin = request.headers.get("origin", "")
        origin = raw_origin if raw_origin in _att_mod.ALLOWED_ORIGINS else ""
        upload_url = _att_mod.begin_resumable_session(object_key, "application/pdf", origin)
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
            """SELECT ia.* FROM intake_attachments ia
               JOIN intake_submissions ins ON ins.id = ia.intake_submission_id
               WHERE ia.id = %s AND ins.estimate_id = %s""",
            [attachment_id, estimate_id],
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

        # Validate the blob matches expectations.
        if blob.content_type != "application/pdf" or not blob.size:
            await execute(
                "UPDATE intake_attachments SET status = %s WHERE id = %s",
                ["failed", attachment_id],
            )
            raise HTTPException(status_code=400, detail="Upload validation failed")

        await execute(
            """UPDATE intake_attachments
               SET status = %s, content_type = %s, size_bytes = %s
               WHERE id = %s""",
            ["stored", blob.content_type, blob.size, attachment_id],
        )

        updated = dict(row)
        updated["status"] = "stored"
        updated["content_type"] = blob.content_type
        updated["size_bytes"] = blob.size
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
               JOIN intake_submissions ins ON ins.id = ia.intake_submission_id
               WHERE ins.estimate_id = %s
               ORDER BY ia.created_at ASC""",
            [estimate_id],
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
            """SELECT ia.* FROM intake_attachments ia
               JOIN intake_submissions ins ON ins.id = ia.intake_submission_id
               WHERE ia.id = %s AND ins.estimate_id = %s""",
            [attachment_id, estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Attachment not found")

        row = rows[0]
        if row.get("status") != "stored":
            raise HTTPException(status_code=409, detail="Attachment is not yet stored")

        url = _att_mod.signed_get_url(row["object_key"], row["file_name"])
        return {"url": url, "expiresIn": _att_mod.GCS_SIGNED_URL_TTL_MIN * 60}
