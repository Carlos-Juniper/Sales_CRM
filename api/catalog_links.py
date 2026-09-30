"""Estimate-tree links to the catalog (Handoff 55 §4/§5, migrations 073/074).

api/estimating.py calls these before it writes:

- prepare_component: validates a component's kind (074's five cost buckets)
  and inventoryId, and snapshots the material's current price onto
  unitCostCents when the caller sent none. The snapshot is the only price
  read: a saved component is never re-priced (§4 acceptance).
- validate_service_ref: section_services.service_id must name a services row.

They live outside api/estimating.py (size guard in
tests/test_maintenance_crew_rate.py) and take the caller's query function so
the FakeDb patch on api.estimating.query covers them.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException

QueryFn = Callable[..., Awaitable[list]]

# section_service_components.kind after 074; same set as
# service_default_items.kind (073).
COMPONENT_KINDS = ("labor", "material", "equipment", "subcontractor", "other")


async def current_unit_cost_cents(query_fn: QueryFn, inventory_id: str) -> Optional[int]:
    """The material's current material_prices cost, or None without one."""
    rows = await query_fn(
        "SELECT unit_cost_cents FROM material_prices WHERE inventory_id = %s AND is_current = %s",
        [inventory_id, 1],
    )
    return None if not rows or rows[0].get("unit_cost_cents") is None else int(rows[0]["unit_cost_cents"])


async def prepare_component(
    body: dict, query_fn: QueryFn, current: Optional[dict] = None
) -> dict:
    """Validate and complete a component body before INSERT (current=None)
    or PATCH (current = the stored row). Returns a new dict.

    - kind is required on insert and must be one of COMPONENT_KINDS (400).
    - inventoryId, when non-null, must name a materials row (422). Any status:
      a component saved against an item that later went inactive still saves.
      New picks come from GET /api/estimating/materials, which offers only
      active, bid-able items.
    - When inventoryId is set (insert) or changed (patch) and the body carries
      no unitCostCents, the current price is snapshotted onto it (0 when the
      item has no price row; the column is NOT NULL). An explicit
      unitCostCents always wins.
    - On insert without a label, the material's description is used.
    Setting inventoryId to null unlinks the row and leaves its cost alone.
    """
    out = dict(body)
    if current is None or "kind" in out:
        if out.get("kind") not in COMPONENT_KINDS:
            raise HTTPException(
                status_code=400, detail=f"kind must be one of {', '.join(COMPONENT_KINDS)}"
            )
    if "inventoryId" not in out or out["inventoryId"] is None:
        return out
    inventory_id = out["inventoryId"]
    if not isinstance(inventory_id, str) or not inventory_id:
        raise HTTPException(status_code=422, detail="inventoryId must be a string or null")
    unchanged = current is not None and current.get("inventory_id") == inventory_id
    rows = await query_fn(
        "SELECT inventory_id, description FROM materials WHERE inventory_id = %s", [inventory_id]
    )
    if not rows:
        raise HTTPException(status_code=422, detail=f"Unknown inventoryId: {inventory_id}")
    if not unchanged and out.get("unitCostCents") is None:
        cost = await current_unit_cost_cents(query_fn, inventory_id)
        out["unitCostCents"] = 0 if cost is None else cost
    if current is None and not out.get("label"):
        out["label"] = rows[0]["description"]
    return out


async def validate_service_ref(body: Any, query_fn: QueryFn) -> None:
    """422 unless body.serviceId, when present and non-null, names a services
    row (073). Checked before the write so a bad id is not an FK error."""
    if not isinstance(body, dict) or body.get("serviceId") is None:
        return
    service_id = body["serviceId"]
    if not isinstance(service_id, str) or not service_id:
        raise HTTPException(status_code=422, detail="serviceId must be a string id or null")
    if not await query_fn("SELECT id FROM services WHERE id = %s", [service_id]):
        raise HTTPException(status_code=422, detail=f"Unknown serviceId: {service_id}")


async def validate_estimate_tree(
    sections: Any, estimate_type: Optional[str], query_fn: QueryFn
) -> None:
    """Up-front check of a nested create-estimate body, so a bad category,
    service or component id is a 4xx before the first INSERT."""
    from api.service_catalog import validate_service_category

    for section in sections or []:
        if not isinstance(section, dict):
            continue
        await validate_service_category(section, estimate_type, query_fn)
        for svc in section.get("services") or []:
            if not isinstance(svc, dict):
                continue
            await validate_service_ref(svc, query_fn)
            for comp in svc.get("components") or []:
                if isinstance(comp, dict):
                    await prepare_component(comp, query_fn)
