"""Estimate-tree links to the catalog (Handoff 55 §4/§5, migrations 073/074).

api/estimating.py calls these before it writes:

- prepare_component: validates a component's kind (074's five cost buckets),
  uom and inventoryId, and snapshots the material's current price onto
  unitCostCents when the caller sent none, converted to the component's uom. The snapshot is the only price
  read: a saved component is never re-priced (§4 acceptance).
- validate_service_ref: section_services.service_id must name a services row,
  and that service must belong to the section's service category.
- validate_section_category: a section PATCH may not move the section to a
  category its existing service lines do not belong to.

Category match (Handoff 55 D9): a section_services row with a non-null
service_id whose section has a non-null service_category_id must use a
service of that category (services.service_category_id). Enforced here, not by
a trigger (Cloud SQL runs with binlog on and no SUPER). A section with a NULL
category (pre-073 legacy, or built without the catalog) accepts any service:
there is nothing to match against. Moving a section to NULL is always allowed.

They live outside api/estimating.py (size guard in
tests/test_maintenance_crew_rate.py) and take the caller's query function so
the FakeDb patch on api.estimating.query covers them.
"""

from __future__ import annotations

from contextvars import ContextVar
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException

QueryFn = Callable[..., Awaitable[list]]

# section_service_components.kind after 074; same set as
# service_default_items.kind (073).
COMPONENT_KINDS = ("labor", "material", "equipment", "subcontractor", "other")


UOM_MAX_LEN = 20  # section_service_components.uom VARCHAR(20) (074)

_MATERIAL_COLS = "inventory_id, description, base_uom, sales_uom, purchase_uom, purchase_to_base_factor"

# Rows validate_estimate_tree loaded set-based (one query per table for the
# whole body), consulted by prepare_component / validate_service_ref for the
# rest of the same request (the nested INSERTs re-run prepare_component). A
# positive cache: an id it does not hold, exactly as sent, is looked up on
# its own. Each request runs in its own task, so nothing crosses requests.
_TREE_ROWS: ContextVar[Optional[dict]] = ContextVar("catalog_links_tree_rows", default=None)


def _marks(values: list) -> str:
    return ", ".join(["%s"] * len(values))


async def preload_tree_rows(query_fn: QueryFn, inventory_ids: list, service_ids: list) -> dict:
    """materials, current material_prices and services rows for every id in
    a nested body: at most three queries, whatever the body's size."""
    inv = sorted({i for i in inventory_ids if isinstance(i, str) and i})
    svc = sorted({i for i in service_ids if isinstance(i, str) and i})
    rows: dict = {"materials": {}, "prices": {}, "services": {}}
    if inv:
        for r in await query_fn(f"SELECT {_MATERIAL_COLS} FROM materials WHERE inventory_id IN ({_marks(inv)})", inv):
            rows["materials"][r["inventory_id"]] = r
        for r in await query_fn(
            f"SELECT inventory_id, unit_cost_cents, uom FROM material_prices "
            f"WHERE inventory_id IN ({_marks(inv)}) AND is_current = %s",
            [*inv, 1],
        ):
            if r.get("unit_cost_cents") is not None:
                rows["prices"][r["inventory_id"]] = r
    if svc:
        for r in await query_fn(f"SELECT id, service_category_id FROM services WHERE id IN ({_marks(svc)})", svc):
            rows["services"][r["id"]] = r
    return rows


async def _material_row(query_fn: QueryFn, inventory_id: str) -> Optional[dict]:
    cached = (_TREE_ROWS.get() or {}).get("materials", {}).get(inventory_id)
    if cached is not None:
        return cached
    rows = await query_fn(f"SELECT {_MATERIAL_COLS} FROM materials WHERE inventory_id = %s", [inventory_id])
    return rows[0] if rows else None


async def _service_row(query_fn: QueryFn, service_id: str) -> Optional[dict]:
    cached = (_TREE_ROWS.get() or {}).get("services", {}).get(service_id)
    if cached is not None:
        return cached
    rows = await query_fn("SELECT id, service_category_id FROM services WHERE id = %s", [service_id])
    return rows[0] if rows else None
_CONVERSION_TOLERANCE = Decimal("0.01")  # max relative error of a cents-rounded converted cost


async def current_price(query_fn: QueryFn, inventory_id: str) -> Optional[dict]:
    """The material's current material_prices row (unit_cost_cents, uom), or
    None without one."""
    cache = _TREE_ROWS.get()
    if cache is not None and inventory_id in cache["materials"]:
        return cache["prices"].get(inventory_id)  # loaded with its material: absent = no price
    rows = await query_fn(
        "SELECT unit_cost_cents, uom FROM material_prices WHERE inventory_id = %s AND is_current = %s",
        [inventory_id, 1],
    )
    if not rows or rows[0].get("unit_cost_cents") is None:
        return None
    return rows[0]


def _same_unit(a: Any, b: Any) -> bool:
    return str(a or "").strip().upper() == str(b or "").strip().upper()


def material_unit(material: dict) -> Optional[str]:
    """The unit an estimator counts a material in: sales unit, else base unit
    (the same `uom` GET /api/estimating/materials returns)."""
    unit = material.get("sales_uom") or material.get("base_uom")
    return unit.strip() if isinstance(unit, str) and unit.strip() else None


def convert_unit_cost(material: dict, cost_cents: int, cost_uom: Any, target_uom: Any) -> Optional[int]:
    """cost_cents per cost_uom, re-expressed per target_uom, or None when it
    cannot be done reliably.

    material_prices.uom is the purchase unit (loader: purchase, else base,
    else sales) and materials.purchase_to_base_factor is base units per
    purchase unit (Garlon 4 Ultra 2.5G: 1 EA = 320 OZ). So:
      same unit (case-insensitive), or either side unknown -> unchanged
      purchase -> base   -> cost / factor
      base -> purchase   -> cost * factor
    Anything else (e.g. a sales unit that is neither base nor purchase) has no
    factor in the item master -> None. A per-base-unit cost that rounds to
    whole cents with more than 1% error (e.g. $1.00 per 320 OZ) -> None too:
    cents cannot carry it.
    """
    if not target_uom or not cost_uom or _same_unit(cost_uom, target_uom):
        return int(cost_cents)
    try:
        factor = Decimal(str(material.get("purchase_to_base_factor")))
    except (InvalidOperation, ValueError):
        return None
    if not factor.is_finite() or factor <= 0:
        return None
    base, purchase = material.get("base_uom"), material.get("purchase_uom")
    exact: Optional[Decimal] = None
    if _same_unit(cost_uom, purchase) and _same_unit(target_uom, base):
        exact = Decimal(int(cost_cents)) / factor
    elif _same_unit(cost_uom, base) and _same_unit(target_uom, purchase):
        exact = Decimal(int(cost_cents)) * factor
    if exact is None:
        return None
    rounded = int(exact.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if exact and abs(Decimal(rounded) - exact) / exact > _CONVERSION_TOLERANCE:
        return None
    return rounded


async def snapshot_cost(query_fn: QueryFn, material: dict, uom: Optional[str]) -> tuple[int, Optional[str]]:
    """(unit_cost_cents, uom) for a component picked from `material`.

    uom None = the caller sent none: price it per material_unit(), falling
    back to the price row's own unit when that conversion is not reliable, so
    the stored uom and cost always agree. A caller-sent uom the cost cannot be
    converted to is a 422 (send unitCostCents with it instead). No current
    price row is a 422, never a $0 snapshot: unit_cost_cents is NOT NULL, so
    "unknown" cannot be stored, and $0 would silently under-price the bid.
    """
    inventory_id = material["inventory_id"]
    price = await current_price(query_fn, inventory_id)
    if price is None:
        raise HTTPException(
            status_code=422,
            detail=(f"inventoryId {inventory_id} has no current price (material_prices); "
                    "send unitCostCents explicitly"),
        )
    cost, cost_uom = int(price["unit_cost_cents"]), price.get("uom")
    target = uom if uom is not None else material_unit(material)
    converted = convert_unit_cost(material, cost, cost_uom, target)
    if converted is not None:
        return converted, (target if target is not None else cost_uom)
    if uom is not None:
        raise HTTPException(
            status_code=422,
            detail=(f"Cannot convert inventoryId {inventory_id}'s cost from {cost_uom} to {uom}; "
                    "send unitCostCents with uom, or omit uom"),
        )
    return cost, cost_uom


def _check_uom(out: dict) -> None:
    uom = out.get("uom")
    if uom is None:
        return
    if not isinstance(uom, str) or not uom.strip() or len(uom.strip()) > UOM_MAX_LEN:
        raise HTTPException(
            status_code=422, detail=f"uom must be a non-empty string of at most {UOM_MAX_LEN} characters, or null"
        )
    out["uom"] = uom.strip()


async def prepare_component(
    body: dict, query_fn: QueryFn, current: Optional[dict] = None
) -> dict:
    """Validate and complete a component body before INSERT (current=None)
    or PATCH (current = the stored row). Returns a new dict.

    - kind is required on insert and must be one of COMPONENT_KINDS (400).
    - uom, when present, is a string of at most 20 characters or null (422).
    - inventoryId, when non-null, must name a materials row (422). Any status:
      a component saved against an item that later went inactive still saves.
      New picks come from GET /api/estimating/materials, which offers only
      active, bid-able items.
    - When inventoryId is set (insert) or changed (patch) and the body carries
      no unitCostCents, the current price is snapshotted onto it, per the
      body's uom or, without one, per the material's unit (snapshot_cost:
      unit conversion, 422 when the item has no price row). With an explicit
      unitCostCents and no uom, uom is filled from the material's unit. An
      explicit unitCostCents always wins.
    - On insert without a label, the material's description is used.
    Setting inventoryId to null unlinks the row and leaves its cost and uom
    alone.
    """
    out = dict(body)
    if current is None or "kind" in out:
        if out.get("kind") not in COMPONENT_KINDS:
            raise HTTPException(
                status_code=400, detail=f"kind must be one of {', '.join(COMPONENT_KINDS)}"
            )
    _check_uom(out)
    if "inventoryId" not in out or out["inventoryId"] is None:
        return out
    inventory_id = out["inventoryId"]
    if not isinstance(inventory_id, str) or not inventory_id:
        raise HTTPException(status_code=422, detail="inventoryId must be a string or null")
    unchanged = current is not None and current.get("inventory_id") == inventory_id
    material = await _material_row(query_fn, inventory_id)
    if material is None:
        raise HTTPException(status_code=422, detail=f"Unknown inventoryId: {inventory_id}")
    if not unchanged:
        if out.get("unitCostCents") is None:
            out["unitCostCents"], out["uom"] = await snapshot_cost(query_fn, material, out.get("uom"))
        elif out.get("uom") is None:
            out["uom"] = material_unit(material)
    if current is None and not out.get("label"):
        out["label"] = material["description"]
    return out


async def stored_section_category(query_fn: QueryFn, section_id: str) -> Optional[str]:
    """estimate_sections.service_category_id as stored (None when unset)."""
    rows = await query_fn(
        "SELECT service_category_id FROM estimate_sections WHERE id = %s", [section_id]
    )
    return rows[0].get("service_category_id") if rows else None


def category_mismatch_detail(service_id: str, service_category: Any, section_category: str) -> str:
    return (
        f"serviceId {service_id} is in serviceCategoryId {service_category}; "
        f"this section is serviceCategoryId {section_category}"
    )


async def validate_service_ref(
    body: Any,
    query_fn: QueryFn,
    section_category_id: Optional[str] = None,
    *,
    section_id: Optional[str] = None,
) -> None:
    """422 unless body.serviceId, when present and non-null, names a services
    row (073) in the section's category. Checked before the write so a bad id
    is not an FK error.

    The section's category is section_category_id when the caller has it (a
    nested create), else read from section_id (a line added to or edited on a
    stored section). No category = legacy section = no match check.
    """
    if not isinstance(body, dict) or body.get("serviceId") is None:
        return
    service_id = body["serviceId"]
    if not isinstance(service_id, str) or not service_id:
        raise HTTPException(status_code=422, detail="serviceId must be a string id or null")
    row = await _service_row(query_fn, service_id)
    if row is None:
        raise HTTPException(status_code=422, detail=f"Unknown serviceId: {service_id}")
    if section_category_id is None and section_id is not None:
        section_category_id = await stored_section_category(query_fn, section_id)
    service_category = row.get("service_category_id")
    if section_category_id is not None and service_category != section_category_id:
        raise HTTPException(
            status_code=422,
            detail=category_mismatch_detail(service_id, service_category, section_category_id),
        )


async def validate_section_category(
    body: Any, estimate_type: Optional[str], section_id: str, query_fn: QueryFn
) -> None:
    """Section PATCH check, before the write: the category must exist and fit
    the estimate type (validate_service_category), and every service line
    already on the section with a service_id must be in that category.
    Setting the category to null is always allowed."""
    from api.service_catalog import validate_service_category

    await validate_service_category(body, estimate_type, query_fn)
    if not isinstance(body, dict) or body.get("serviceCategoryId") is None:
        return
    category_id = body["serviceCategoryId"]
    lines = await query_fn(
        "SELECT service_id FROM section_services WHERE section_id = %s AND service_id IS NOT NULL",
        [section_id],
    )
    ids = sorted({r["service_id"] for r in lines})
    if not ids:
        return
    services = await query_fn(
        f"SELECT id, service_category_id FROM services WHERE id IN ({', '.join(['%s'] * len(ids))})",
        ids,
    )
    conflicts = sorted(
        (r["id"], r.get("service_category_id"))
        for r in services
        if r.get("service_category_id") != category_id
    )
    if conflicts:
        listed = "; ".join(f"serviceId {sid} is in serviceCategoryId {cat}" for sid, cat in conflicts)
        raise HTTPException(
            status_code=422,
            detail=f"serviceCategoryId {category_id} conflicts with this section's service lines: {listed}",
        )


async def validate_estimate_tree(
    sections: Any,
    estimate_type: Optional[str],
    query_fn: QueryFn,
    *,
    section_id: Optional[str] = None,
) -> None:
    """Up-front check of a nested create body (estimate, section, or service
    line), so a bad category, service or component id, or a service outside
    its section's category, is a 4xx before the first INSERT.

    Set-based: every serviceId and inventoryId in the body is loaded in one
    query per table (preload_tree_rows), not one per line or component, and
    the rows stay available to the INSERTs that follow in this request.

    section_id: the body's services go onto that stored section (POST
    .../services), so its stored category is the one to match (read once).
    """
    from api.service_catalog import validate_service_category

    sections = [s for s in sections or [] if isinstance(s, dict)]
    lines = [(sec, svc) for sec in sections for svc in sec.get("services") or [] if isinstance(svc, dict)]
    comps = [c for _, svc in lines for c in svc.get("components") or [] if isinstance(c, dict)]
    _TREE_ROWS.set(await preload_tree_rows(
        query_fn, [c.get("inventoryId") for c in comps], [svc.get("serviceId") for _, svc in lines]
    ))
    stored_category: Optional[str] = None
    if section_id is not None and any(svc.get("serviceId") is not None for _, svc in lines):
        stored_category = await stored_section_category(query_fn, section_id)
    for section in sections:
        await validate_service_category(section, estimate_type, query_fn)
    for section, svc in lines:
        category = section.get("serviceCategoryId")
        await validate_service_ref(svc, query_fn, category if category is not None else stored_category)
    for comp in comps:
        await prepare_component(comp, query_fn)
