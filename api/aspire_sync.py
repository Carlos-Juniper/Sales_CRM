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
    aspire_rep_contact_id: Optional[int] = None   # Aspire ContactID → SalesRepContactID
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


# ── Takeoff qty push (Handoff 20 §4.2) ───────────────────────────────────────

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
        payload["SalesRepContactID"] = inp.aspire_rep_contact_id
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
    return payload


# ── Entry points ─────────────────────────────────────────────────────────────

async def _fetch_opportunity_number(client: AspireClient, opp_id: int) -> Optional[str]:
    """Best-effort follow-up read of the canonical number via the collection endpoint.

    Uses the verified `GET /Opportunities?$filter=OpportunityID eq {id}` shape (the
    same one list_opportunities_for_property relies on) rather than a guessed
    `/Opportunities/{id}` path. Isolated so a read failure does NOT discard the
    successfully-created opportunity's id — losing the id would make the sweep
    re-POST and create a duplicate.
    TODO(aspire-live): drop this follow-up entirely if POST proves to return the number.
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
        created = await client.post("/Opportunity", build_opportunity_payload(inp))
        opp_id = created.get("OpportunityID")
        number = extract_aspire_number(created)
        if number is None and opp_id is not None:
            number = await _fetch_opportunity_number(client, opp_id)
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
    """Write a terminal status (won/lost) back to Aspire. Terminal-only by design."""
    if not sync_enabled():
        return SyncResult(status="disabled")
    if aspire_opportunity_id is None:
        return SyncResult(status="pending", error="opportunity not yet synced")

    body: dict = {}
    if new_status == "won":
        body["OpportunityStatusID"] = cfg.ASPIRE_OPPORTUNITY_STATUS_WON
    elif new_status == "lost":
        body["OpportunityStatusID"] = cfg.ASPIRE_OPPORTUNITY_STATUS_LOST
        if lost_reason_id is not None:
            if lost_reason_id not in cfg.ASPIRE_LOST_REASONS:
                return SyncResult(
                    status="failed",
                    error=f"lost reason {lost_reason_id} is not an active Aspire reason",
                )
            # TODO(aspire-live): confirm field name for lost reason on write.
            body["OpportunityLostReasonID"] = lost_reason_id
    else:
        return SyncResult(status="failed", error=f"non-terminal status {new_status!r} not written")

    owns, client = _resolve_client(client)
    path = f"/Opportunity/{aspire_opportunity_id}"
    try:
        if cfg.ASPIRE_STATUS_WRITE_VERB == "PUT":
            await client.put(path, body)
        else:
            await client.patch(path, body)
        return SyncResult(status="synced", aspire_opportunity_id=aspire_opportunity_id)
    except AspireError as exc:
        return SyncResult(status="failed", error=str(exc))
    finally:
        if owns:
            await client.close()


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
    """One-way, batched, best-effort push of takeoff qtys (Handoff 20 §4.2).

    Writes each line's locally-owned opportunity qty to
    OpportunityServiceItem.ItemQuantity via the §2 join
    (OpportunityServiceID → OpportunityService.OpportunityID), matched by
    CatalogItemID with the UOM sanity-checked against AllocationUnitTypeName.

    Same shape as push_status: never raises — transient failures return
    status="failed" and are logged by the caller; unmatched/UOM-mismatched
    lines are counted in `skipped`, never treated as an error. This module
    never READS a quantity back — opportunity_qty stays locally owned.
    """
    if not sync_enabled():
        return QtyPushResult(status="disabled")
    if aspire_opportunity_id is None:
        return QtyPushResult(status="pending", error="opportunity not yet synced")
    if not lines:
        return QtyPushResult(status="synced")

    owns, client = _resolve_client(client)
    try:
        services = _records(await client.get(
            "/OpportunityServices",
            params={"$filter": f"OpportunityID eq {aspire_opportunity_id}"},
        ))
        items_by_catalog: dict[str, dict] = {}
        for svc in services:
            svc_id = svc.get("OpportunityServiceID")
            if svc_id is None:
                continue
            items = _records(await client.get(
                "/OpportunityServiceItems",
                params={"$filter": f"OpportunityServiceID eq {svc_id}"},
            ))
            for item in items:
                cat = item.get("CatalogItemID")
                if cat is not None:
                    items_by_catalog.setdefault(str(cat), item)

        pushed = skipped = 0
        for line in lines:
            item = items_by_catalog.get(str(line.catalog_item_id))
            item_id = None if item is None else item.get("OpportunityServiceItemID")
            aspire_uom = None if item is None else item.get("AllocationUnitTypeName")
            if item is None or item_id is None:
                skipped += 1
                continue
            if line.uom and aspire_uom and line.uom != aspire_uom:
                skipped += 1  # UOM disagreement — never write a mismatched qty
                continue
            path = f"/OpportunityServiceItem/{item_id}"
            body = {"ItemQuantity": line.qty}
            if cfg.ASPIRE_STATUS_WRITE_VERB == "PUT":
                await client.put(path, body)
            else:
                await client.patch(path, body)
            pushed += 1
        return QtyPushResult(status="synced", pushed=pushed, skipped=skipped)
    except AspireError as exc:
        return QtyPushResult(status="failed", error=str(exc))
    finally:
        if owns:
            await client.close()


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
        created = await client.post("/Property", build_property_payload(inp))
        prop_id = created.get("PropertyID")
        if prop_id is None:
            # Without an id we cannot link — leave failed for the sweep to retry.
            return PropertySyncResult(status="failed", error="no PropertyID returned")
        return PropertySyncResult(status="synced", aspire_property_id=prop_id)
    except AspireError as exc:
        return PropertySyncResult(status="failed", error=str(exc))
    finally:
        if owns:
            await client.close()
