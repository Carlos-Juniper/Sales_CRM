"""Aspire sync — the anti-corruption PORT between the estimating domain and Aspire.

This is the ONLY module the domain (api/estimating.py, property/mgmt-co endpoints)
is allowed to call for Aspire work, and — with api/aspire_client.py — the only
place Aspire field names (``OpportunityStatusID``, ``DivisionID``, …) appear.

Contract:
  * Inputs are neutral, OUR-vocabulary dataclasses (OpportunityInput, PropertyInput).
    The domain builds them from its own tables; the port never reads the DB.
  * Outputs are neutral *SyncResult objects carrying our columns
    (aspire_*_id, aspire_number, status, error).
  * Every entry point short-circuits when ASPIRE_SYNC_ENABLED is false, returning
    status="disabled" so the app runs fully standalone (the litmus test).
  * Push is single-attempt and best-effort: transient failures return
    status="failed"; durability/retry is the caller's background sweep re-pushing
    pending/failed rows (so no tenacity dependency is needed here).

status values: "synced" | "failed" | "pending" | "disabled".
  - pending = a prerequisite isn't ready yet (property not synced / opportunity
    not synced); nothing was attempted, the sweep will resolve the chain.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from api import aspire_config as cfg
from api.aspire_client import AspireClient, AspireError


# ── Neutral inputs (OUR vocabulary) ──────────────────────────────────────────

@dataclass
class OpportunityInput:
    name: str
    service_line: str            # key into ASPIRE_DIVISION_MAP (e.g. "Install: Landscape")
    branch_city: str             # key into ASPIRE_BRANCH_MAP  (e.g. "Orlando, FL")
    is_install: bool
    aspire_property_id: Optional[int]        # None ⇒ property not synced yet
    aspire_rep_contact_id: Optional[int] = None   # Aspire ContactID → SalesRepID
    sales_type: Optional[str] = None         # "HOA" | "commercial"
    lead_source: Optional[str] = None


@dataclass
class PropertyInput:
    name: str
    address1: str
    city: str                    # address city (e.g. "Orlando")
    state: str
    zip: str
    branch_city: str             # key into ASPIRE_BRANCH_MAP (e.g. "Orlando, FL")
    is_install: bool = False
    address2: Optional[str] = None
    industry_id: Optional[int] = None


# ── Neutral results ──────────────────────────────────────────────────────────

@dataclass
class SyncResult:
    status: str
    aspire_opportunity_id: Optional[int] = None
    aspire_number: Optional[str] = None
    error: Optional[str] = None


@dataclass
class PropertySyncResult:
    status: str
    aspire_property_id: Optional[int] = None
    error: Optional[str] = None


# ── Takeoff qty push ──────────────────────────────────────────────────────────

@dataclass
class TakeoffQtyLine:
    """One takeoff line's locally-owned opportunity qty, keyed by catalog item.

    catalog_item_id is OUR takeoff_lines.catalog_item_id value; it is compared
    (string-tolerant) against Aspire's OpportunityServiceItem.CatalogItemID —
    the kit-migration workstream keeps the two aligned.
    """
    catalog_item_id: str
    qty: float
    uom: Optional[str] = None


@dataclass
class QtyPushResult:
    status: str
    pushed: int = 0
    skipped: int = 0            # unmatched CatalogItemID or UOM disagreement
    error: Optional[str] = None


# ── Gate ─────────────────────────────────────────────────────────────────────

def sync_enabled() -> bool:
    return os.environ.get("ASPIRE_SYNC_ENABLED", "false").strip().lower() in ("1", "true", "yes")


def _resolve_client(client: Optional[AspireClient]) -> tuple[bool, AspireClient]:
    """Return (owns, client). We only close clients we created ourselves — an
    injected client (tests, or a caller batching calls) stays the caller's to close.
    """
    if client is not None:
        return False, client
    return True, AspireClient()


# ── Pure mapping helpers (Aspire vocabulary lives here) ──────────────────────

def division_id(service_line: str) -> Optional[int]:
    return cfg.ASPIRE_DIVISION_MAP.get(service_line)


def branch_id(branch_city: str, is_install: bool) -> Optional[int]:
    # The vendored map already encodes the install→maintenance fallback in its
    # (city, True) values, so a direct lookup is correct.
    return cfg.ASPIRE_BRANCH_MAP.get((branch_city, is_install))


def extract_aspire_number(record: dict) -> Optional[str]:
    """Canonical user-facing number: COALESCE(MasterOpportunityNumber, OpportunityNumber).

    Never RealOpportunityNumber — it changes per internal revision row.
    """
    number = record.get("MasterOpportunityNumber")
    if number is None:
        number = record.get("OpportunityNumber")
    return None if number is None else str(number)


# ── Payload builders (Aspire vocabulary) ─────────────────────────────────────

def build_opportunity_payload(inp: OpportunityInput) -> dict:
    payload: dict = {
        "OpportunityName": inp.name,
        "PropertyID": inp.aspire_property_id,
        "DivisionID": division_id(inp.service_line),
        "BranchID": branch_id(inp.branch_city, inp.is_install),
        "OpportunityStatusID": cfg.ASPIRE_OPPORTUNITY_STATUS_NEW,
        "OpportunityType": cfg.ASPIRE_OPPORTUNITY_TYPE_DEFAULT,
    }
    if inp.aspire_rep_contact_id is not None:
        payload["SalesRepID"] = inp.aspire_rep_contact_id
    if inp.sales_type is not None and inp.sales_type in cfg.ASPIRE_SALES_TYPE_MAP:
        payload["SalesTypeID"] = cfg.ASPIRE_SALES_TYPE_MAP[inp.sales_type]
    if inp.lead_source is not None and inp.lead_source in cfg.ASPIRE_LEAD_SOURCE_MAP:
        payload["LeadSourceID"] = cfg.ASPIRE_LEAD_SOURCE_MAP[inp.lead_source]
    return payload


def build_property_payload(inp: PropertyInput) -> dict:
    # Minimal proven field set + defaults (plan decision #4); the ~35-field
    # schema is otherwise defaulted/omitted by Aspire.
    payload: dict = {
        "PropertyName": inp.name,
        "AddressLine1": inp.address1,
        "City": inp.city,
        "StateProvinceCode": inp.state,
        "ZipCode": inp.zip,
        "BranchID": branch_id(inp.branch_city, inp.is_install),
        "Active": True,
    }
    if inp.address2:
        payload["AddressLine2"] = inp.address2
    if inp.industry_id is not None:
        payload["IndustryID"] = inp.industry_id
    return payload


# ── Entry points ─────────────────────────────────────────────────────────────

async def _fetch_opportunity_number(client: AspireClient, opp_id: int) -> Optional[str]:
    """Best-effort follow-up read of the canonical number via the collection endpoint.

    Uses the verified `GET /Opportunities?$filter=OpportunityID eq {id}` shape (the
    same one list_opportunities_for_property relies on) rather than a guessed
    `/Opportunities/{id}` path. Isolated so a read failure does NOT discard the
    successfully-created opportunity's id — losing the id would make the sweep
    re-POST and create a duplicate.

    Confirmed 2026-08-24 (sandbox smoke test + prod Aspire API swagger v1):
    POST /Opportunities returns only a bare integer OpportunityID — no
    MasterOpportunityNumber or OpportunityNumber in the POST response body —
    so this follow-up GET is always necessary.
    """
    try:
        data = await client.get("/Opportunities", params={"$filter": f"OpportunityID eq {opp_id}"})
    except AspireError:
        return None
    records = data if isinstance(data, list) else (data.get("value", []) if isinstance(data, dict) else [])
    return extract_aspire_number(records[0]) if records else None


async def push_new_opportunity(
    inp: OpportunityInput, client: Optional[AspireClient] = None
) -> SyncResult:
    if not sync_enabled():
        return SyncResult(status="disabled")
    if inp.aspire_property_id is None:
        # Ordering: the opportunity needs a real PropertyID. Leave it pending;
        # the sweep re-pushes once the property syncs.
        return SyncResult(status="pending", error="property not yet synced")

    owns, client = _resolve_client(client)
    try:
        # POST /Opportunities returns a bare integer OpportunityID (confirmed 2026-08-24).
        created = await client.post("/Opportunities", build_opportunity_payload(inp))
        opp_id = created if isinstance(created, int) else (
            created.get("OpportunityID") if isinstance(created, dict) else None
        )
        number = await _fetch_opportunity_number(client, opp_id) if opp_id is not None else None
        return SyncResult(status="synced", aspire_opportunity_id=opp_id, aspire_number=number)
    except AspireError as exc:
        return SyncResult(status="failed", error=str(exc))
    finally:
        if owns:
            await client.close()


async def push_status(
    aspire_opportunity_id: Optional[int],
    new_status: str,
    lost_reason_id: Optional[int] = None,
    client: Optional[AspireClient] = None,
) -> SyncResult:
    """Write a terminal status (won/lost) back to Aspire. Terminal-only by design.

    NOT IMPLEMENTED (2026-08-24, confirmed via swagger v1 + sandbox smoke test):
    Aspire API v1 has no PUT or PATCH endpoint for individual opportunities.
    POST /Opportunities/QuickTickets creates work tickets, not a status update.
    This function validates inputs and returns status="failed" until a working
    update mechanism is identified (contact Aspire support or check API v2+).
    """
    if not sync_enabled():
        return SyncResult(status="disabled")
    if aspire_opportunity_id is None:
        return SyncResult(status="pending", error="opportunity not yet synced")

    # Validate before failing so data errors are surfaced eagerly.
    if new_status == "won":
        pass
    elif new_status == "lost":
        if lost_reason_id is not None and lost_reason_id not in cfg.ASPIRE_LOST_REASONS:
            return SyncResult(
                status="failed",
                error=f"lost reason {lost_reason_id} is not an active Aspire reason",
            )
    else:
        return SyncResult(status="failed", error=f"non-terminal status {new_status!r} not written")

    # Confirmed 2026-08-24 (swagger v1): no endpoint exists to update opportunity
    # status. LostReason write field is `LostReason` (string), not `OpportunityLostReasonID`.
    # Use cfg.ASPIRE_LOST_REASONS[lost_reason_id] if a working endpoint is found.
    return SyncResult(
        status="failed",
        aspire_opportunity_id=aspire_opportunity_id,
        error=(
            "Aspire API v1 has no endpoint to update opportunity status "
            "(confirmed 2026-08-24 via swagger v1); "
            "contact Aspire support or check API v2+ for the correct mechanism"
        ),
    )


def _records(data) -> list[dict]:
    """Normalize an Aspire collection response (list or OData {value: [...]})."""
    if isinstance(data, list):
        return data
    return data.get("value", []) if isinstance(data, dict) else []


async def push_opportunity_service_item_qty(
    aspire_opportunity_id: Optional[int],
    lines: list[TakeoffQtyLine],
    client: Optional[AspireClient] = None,
) -> QtyPushResult:
    """One-way, best-effort push of takeoff qtys.

    NOT IMPLEMENTED (2026-08-24, confirmed via swagger v1 + sandbox smoke test):
    Aspire API v1 has no PUT or PATCH endpoint for OpportunityServiceItems.
    This function validates inputs and returns status="failed" until a working
    update mechanism is identified (contact Aspire support or check API v2+).
    """
    if not sync_enabled():
        return QtyPushResult(status="disabled")
    if aspire_opportunity_id is None:
        return QtyPushResult(status="pending", error="opportunity not yet synced")
    if not lines:
        return QtyPushResult(status="synced")

    # Confirmed 2026-08-24 (swagger v1): no endpoint exists to update
    # OpportunityServiceItem quantity.
    return QtyPushResult(
        status="failed",
        error=(
            "Aspire API v1 has no endpoint to update OpportunityServiceItem quantity "
            "(confirmed 2026-08-24 via swagger v1); "
            "contact Aspire support or check API v2+ for the correct mechanism"
        ),
    )


async def list_opportunities_for_property(
    aspire_property_id: Optional[int], client: Optional[AspireClient] = None
) -> list[dict]:
    """Best-effort read of a property's existing Aspire opportunities (dedup panel).

    Returns [] when sync is disabled, the property isn't synced, or Aspire errors —
    the intake UI degrades gracefully rather than blocking on this.
    """
    if not sync_enabled() or aspire_property_id is None:
        return []
    owns, client = _resolve_client(client)
    try:
        data = await client.get(
            "/Opportunities", params={"$filter": f"PropertyID eq {aspire_property_id}"}
        )
    except AspireError:
        return []
    finally:
        if owns:
            await client.close()
    if isinstance(data, list):
        return data
    return data.get("value", []) if isinstance(data, dict) else []


async def push_property(
    inp: PropertyInput, client: Optional[AspireClient] = None
) -> PropertySyncResult:
    if not sync_enabled():
        return PropertySyncResult(status="disabled")

    owns, client = _resolve_client(client)
    try:
        # POST /Properties returns a bare integer PropertyID (confirmed 2026-08-24).
        created = await client.post("/Properties", build_property_payload(inp))
        prop_id = created if isinstance(created, int) else (
            created.get("PropertyID") if isinstance(created, dict) else None
        )
        if prop_id is None:
            # Without an id we cannot link — leave failed for the sweep to retry.
            return PropertySyncResult(status="failed", error="no PropertyID returned")
        return PropertySyncResult(status="synced", aspire_property_id=prop_id)
    except AspireError as exc:
        return PropertySyncResult(status="failed", error=str(exc))
    finally:
        if owns:
            await client.close()
