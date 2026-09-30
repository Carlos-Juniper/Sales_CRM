"""Service catalog (Handoff 55 §1, migration 073).

GET /api/estimating/service-catalog?estimateType= returns the level-1
service_categories, their level-2 services, and each service's
service_default_items template. Lives outside api/estimating.py, which has a
size guard (tests/test_maintenance_crew_rate.py).

validate_service_category is the estimate-section check api/estimating.py runs
before it writes estimate_sections.service_category_id. It takes the caller's
query function so the FakeDb patch on api.estimating.query covers it.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, Awaitable, Callable, Optional

from fastapi import Depends, HTTPException, Query

from api import authz
from db import query

ESTIMATE_TYPES = ("maintenance", "install")


def _num(v: Any) -> Any:
    return float(v) if isinstance(v, Decimal) else v


def _int_or_none(v: Any) -> Optional[int]:
    return None if v is None else int(v)


def _json_list(value: Any) -> Optional[list]:
    """A MySQL JSON column as a Python list (drivers return str or list)."""
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        value = json.loads(value)
    return list(value)


def _service_category_out(r: dict, services: list[dict]) -> dict:
    """One service_categories row (migration 073) with its services nested."""
    return {
        "id": r["id"],
        "code": r["code"],
        "name": r["name"],
        "estimateType": r["estimate_type"],
        "sortOrder": r["sort_order"],
        "isOptional": bool(r["is_optional"]),
        "aspireServiceGroupName": r.get("aspire_service_group_name"),
        # item_classes.code values for the materials-search soft prefilter;
        # null = unfiltered.
        "itemClassCodes": _json_list(r.get("item_class_codes")),
        "active": bool(r["active"]),
        "services": services,
    }


def _catalog_service_out(r: dict, default_items: list[dict]) -> dict:
    """One services row (migration 073) with its default items nested."""
    return {
        "id": r["id"],
        "serviceCategoryId": r["service_category_id"],
        "name": r["name"],
        "displayName": r["display_name"],
        "sortOrder": r["sort_order"],
        "defaultOccurrences": _int_or_none(r.get("default_occurrences")),
        "aspireServiceId": _int_or_none(r.get("aspire_service_id")),
        "active": bool(r["active"]),
        "defaultItems": default_items,
    }


def _default_item_out(r: dict) -> dict:
    """One service_default_items row (the D2 template).

    unitCostCents is the template value; null means "resolve from the current
    material_prices row". resolvedUnitCostCents is that resolution, done now:
    the template value when set, else the item's current price, else null (no
    price row, or no material). The caller snapshots resolvedUnitCostCents onto
    the component it creates, so a later price change never reprices a saved
    estimate (Handoff 55 §4).
    """
    template = _int_or_none(r.get("unit_cost_cents"))
    current = _int_or_none(r.get("current_unit_cost_cents"))
    return {
        "id": r["id"],
        "serviceId": r["service_id"],
        "kind": r["kind"],
        "label": r["label"],
        "inventoryId": r.get("inventory_id"),
        "serviceKitId": r.get("service_kit_id"),
        "qty": _num(r["qty"]),
        "unitCostCents": template,
        "resolvedUnitCostCents": template if template is not None else current,
        "hours": _num(r.get("hours")),
        "sortOrder": r["sort_order"],
    }


async def validate_service_category(
    body: Any,
    estimate_type: Optional[str],
    query_fn: Callable[..., Awaitable[list]] = query,
) -> None:
    """422 unless body.serviceCategoryId, when present and non-null, names an
    existing service_categories row of the estimate's type.

    Runs before the write, so a bad id is a 422 rather than an FK error halfway
    through a save. An absent key or null is allowed (sections need not come
    from the catalog, and pre-073 sections have none).
    """
    if not isinstance(body, dict) or body.get("serviceCategoryId") is None:
        return
    category_id = body["serviceCategoryId"]
    if not isinstance(category_id, str) or not category_id:
        raise HTTPException(status_code=422, detail="serviceCategoryId must be a string id or null")
    rows = await query_fn(
        "SELECT id, estimate_type FROM service_categories WHERE id = %s", [category_id]
    )
    if not rows:
        raise HTTPException(status_code=422, detail=f"Unknown serviceCategoryId: {category_id}")
    if estimate_type is not None and rows[0].get("estimate_type") != estimate_type:
        raise HTTPException(
            status_code=422,
            detail=(
                f"serviceCategoryId {category_id} is a {rows[0].get('estimate_type')} "
                f"category; this is a {estimate_type} estimate"
            ),
        )


def register(app, require_auth) -> None:
    @app.get("/api/estimating/service-catalog")
    async def get_service_catalog(
        estimate_type: str = Query(..., alias="estimateType"),
        _user: dict = Depends(require_auth),
    ) -> list:
        """Active service categories -> services -> default items (Handoff 55 §1).

        Three queries, no N+1: categories, their active services, and those
        services' default items with the current material price joined for
        cost resolution. Inactive categories and services are omitted.
        """
        authz.require_estimator(_user)
        if estimate_type not in ESTIMATE_TYPES:
            raise HTTPException(
                status_code=400, detail="estimateType must be maintenance or install"
            )
        cat_rows = await query(
            """SELECT * FROM service_categories
                WHERE estimate_type = %s AND active = 1
                ORDER BY sort_order, name""",
            [estimate_type],
        )
        if not cat_rows:
            return []
        cat_ids = [c["id"] for c in cat_rows]
        svc_rows = await query(
            f"""SELECT * FROM services
                 WHERE service_category_id IN ({', '.join(['%s'] * len(cat_ids))})
                   AND active = 1
                 ORDER BY sort_order, display_name""",
            cat_ids,
        )
        item_rows: list[dict] = []
        if svc_rows:
            svc_ids = [s["id"] for s in svc_rows]
            item_rows = await query(
                f"""SELECT d.*, mp.unit_cost_cents AS current_unit_cost_cents
                      FROM service_default_items d
                      LEFT JOIN material_prices mp
                        ON mp.inventory_id = d.inventory_id AND mp.is_current = 1
                     WHERE d.service_id IN ({', '.join(['%s'] * len(svc_ids))})
                     ORDER BY d.sort_order, d.id""",
                svc_ids,
            )
        items_by_service: dict[str, list[dict]] = {}
        for it in item_rows:
            items_by_service.setdefault(it["service_id"], []).append(_default_item_out(it))
        services_by_cat: dict[str, list[dict]] = {}
        for sv in svc_rows:
            services_by_cat.setdefault(sv["service_category_id"], []).append(
                _catalog_service_out(sv, items_by_service.get(sv["id"], []))
            )
        return [_service_category_out(c, services_by_cat.get(c["id"], [])) for c in cat_rows]
