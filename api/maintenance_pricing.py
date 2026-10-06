"""Maintenance sell prices that come from the branch crew rate.

The $/1,000 SF formula lives here for every server write and for the draft
reprice that follows a Settings crew-rate change:

    round((1000 / production_rate) × crew_rate_cents / (1 − target_gm))

target_gm outside [0, 1) is treated as 0. Rounding matches the editor
(half up). There is no default rate.

A catalog kit derives its sell from the crew rate when it has a production
rate and no explicit unit sell (unit_sell_cents is null or 0). A line on
that kit is crew-rate-derived when its unitSellCents is null, 0, or equal
to the formula. A positive unit sell that matches neither the formula nor
a positive catalog unit sell is hand-entered and is stored as sent. A kit
with unit_sell_cents > 0 is catalog-priced; those lines never need a rate
and are never rewritten.

Open drafts are new_from_sales, queued, and in_progress. Later statuses
keep the price they already have.

H59 — component+markup model
=============================
The new pricing engine replaces the single-formula approach with separate
labor and material cost components, each carrying its own markup:

    sell = labor_cost × (1 + labor_markup_pct) + material_cost × (1 + material_markup_pct)

Where:
    labor_cost  = (area_sf / production_rate) × labor_rate_cents
    material_cost = material_qty_per_unit × material_unit_cost_cents × area_sf

When target_gm is non-NULL on a kit or line the formula is overridden:
    sell = (labor_cost + material_cost) / (1 − target_gm)

Labor baseline (branch_settings.crew_rate_cents_per_hour default): 2319 ¢/hr.
"""
from __future__ import annotations

import math
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

# Stable code. The editor owns the sentence the user reads.
CREW_RATE_REQUIRED = "crew_rate_required"

OPEN_DRAFT_STATUSES = frozenset({"new_from_sales", "queued", "in_progress"})

# H59: default labor rate baseline in cents per hour (≈ $23.19/hr).
# Reseed branch_settings.crew_rate_cents_per_hour to this value.
LABOR_BASELINE_CENTS: int = 2319


def sell_rate_cents_per_1000_sf(
    production_rate: float, target_gm: float, crew_rate_cents: int
) -> int:
    """Integer cents per 1,000 SF. Same math as sellRateCentsPer1000Sf."""
    cost_per_1000 = (1000 / production_rate) * crew_rate_cents
    gm = 0.0 if target_gm >= 1 or target_gm < 0 else target_gm
    return _round_half_up(cost_per_1000 / (1 - gm))


def _round_half_up(value: float) -> int:
    """Positive-money rounding that matches JavaScript Math.round."""
    return int(math.floor(value + 0.5)) if value >= 0 else int(math.ceil(value - 0.5))


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    return None


async def _db_query(sql: str, params: list | None = None) -> list[dict]:
    # Late import so tests that patch api.estimating.query cover this module.
    from api import estimating

    return await estimating.query(sql, params)


async def _db_execute(sql: str, params: list | None = None) -> int:
    from api import estimating

    return await estimating.execute(sql, params)


async def _live_branch_crew_rate(aspire_branch_id: int | None) -> int | None:
    """Live branch_settings.crew_rate_cents_per_hour. Never a snapshot or a default."""
    if aspire_branch_id is None or isinstance(aspire_branch_id, bool):
        return None
    rows = await _db_query(
        "SELECT crew_rate_cents_per_hour FROM branch_settings WHERE aspire_branch_id = %s",
        [aspire_branch_id],
    )
    if not rows:
        return None
    rate = _number(rows[0].get("crew_rate_cents_per_hour"))
    if rate is None:
        return None
    return int(rate)


def annotate_maintenance_sections(sections: list[dict] | None) -> list[dict]:
    """Flatten nested sections. Handlers stamp ids for the 422."""
    return [
        svc
        for section in (sections or [])
        for svc in (section.get("services") or [])
    ]


def _blocked_line(svc: dict) -> dict | None:
    """Match crewRateError.ts. None when the line has no section_services id yet."""
    service_id = svc.get("_serviceId")
    if not isinstance(service_id, str) or service_id == "":
        return None
    line = {"serviceId": service_id}
    section_id = svc.get("_sectionId")
    if isinstance(section_id, str) and section_id != "":
        line["sectionId"] = section_id
    return line


async def _kits_by_id(services: list[dict]) -> dict[str, dict]:
    kit_ids = [svc.get("serviceKitId") for svc in services if isinstance(svc.get("serviceKitId"), str)]
    if not kit_ids:
        return {}
    unique = list(dict.fromkeys(kit_ids))
    placeholders = ", ".join(["%s"] * len(unique))
    rows = await _db_query(
        f"SELECT id, production_rate, unit_sell_cents, target_gm FROM service_kits WHERE id IN ({placeholders})",
        unique,
    )
    return {r["id"]: r for r in rows}


def _kit_derives_sell(kit: dict | None) -> bool:
    if not kit:
        return False
    production = _number(kit.get("production_rate"))
    if production is None or production <= 0:
        return False
    catalog_sell = _number(kit.get("unit_sell_cents"))
    return catalog_sell is None or catalog_sell == 0


async def apply_maintenance_crew_prices(
    services: list[dict], crew_rate_cents: int | None
) -> None:
    """Write the computed sell onto crew-rate-derived lines.

    Raises 422 crew_rate_required. blockedLines names only derived lines
    that already have a section_services id. A create has no such id yet:
    the save is still rejected and blockedLines is empty for those lines.
    Catalog prices and hand-entered prices are left unchanged. Nothing is
    written to the database here — callers persist only if this returns.
    """
    kits = await _kits_by_id(services)
    derived: list[tuple[dict, int]] = []
    blocked: list[dict] = []
    unnamed = False
    for svc in services:
        kit = kits.get(svc.get("serviceKitId"))
        if not _kit_derives_sell(kit):
            continue
        production = _number(kit.get("production_rate"))
        target_gm = _number(kit.get("target_gm")) or 0.0
        submitted = _number(svc.get("unitSellCents"))
        computed = (
            None
            if crew_rate_cents is None
            else sell_rate_cents_per_1000_sf(production, target_gm, crew_rate_cents)
        )
        explicit = submitted is not None and submitted != 0
        if computed is not None and (not explicit or int(submitted) == computed):
            derived.append((svc, computed))
            continue
        if explicit:
            continue  # hand-entered; a missing rate does not block it
        ref = _blocked_line(svc)
        if ref is None:
            unnamed = True
        else:
            blocked.append(ref)
    if blocked or unnamed:
        raise HTTPException(
            status_code=422,
            detail={"code": CREW_RATE_REQUIRED, "blockedLines": blocked},
        )
    for svc, computed in derived:
        svc["unitSellCents"] = computed
        svc["_crewRateDerived"] = True


async def reprice_open_drafts(
    aspire_branch_id: int, previous_rate: int | None, new_rate: int
) -> int:
    """Recompute crew-rate-derived sells on this branch's open maintenance drafts.

    A stored line is derived when its kit has no catalog price and its
    unit_sell_cents still equals the formula at previous_rate. Approved,
    finished, and in-review estimates are skipped. Catalog-priced lines,
    hand-entered lines, and other branches are skipped. Returns the number
    of lines updated.
    """
    if previous_rate is None or previous_rate == new_rate:
        return 0
    estimates = await _db_query(
        "SELECT id, status, estimate_type FROM estimates WHERE aspire_branch_id = %s",
        [aspire_branch_id],
    )
    updated = 0
    for estimate in estimates:
        if estimate.get("estimate_type") != "maintenance":
            continue
        if estimate.get("status") not in OPEN_DRAFT_STATUSES:
            continue
        sections = await _db_query(
            "SELECT id FROM estimate_sections WHERE estimate_id = %s",
            [estimate["id"]],
        )
        for section in sections:
            services = await _db_query(
                "SELECT id, service_kit_id, unit_sell_cents FROM section_services WHERE section_id = %s",
                [section["id"]],
            )
            if not services:
                continue
            kits = await _kits_for_rows(services)
            for svc in services:
                kit = kits.get(svc.get("service_kit_id"))
                if not _kit_derives_sell(kit):
                    continue
                stored = _number(svc.get("unit_sell_cents"))
                if stored is None:
                    continue
                production = _number(kit.get("production_rate"))
                target_gm = _number(kit.get("target_gm")) or 0.0
                previous = sell_rate_cents_per_1000_sf(production, target_gm, previous_rate)
                if int(stored) != previous:
                    continue
                nxt = sell_rate_cents_per_1000_sf(production, target_gm, new_rate)
                await _db_execute(
                    "UPDATE section_services SET unit_sell_cents = %s WHERE id = %s",
                    [nxt, svc["id"]],
                )
                updated += 1
    return updated


async def _kits_for_rows(services: list[dict]) -> dict[str, dict]:
    adapted = [
        {"serviceKitId": svc.get("service_kit_id")}
        for svc in services
        if isinstance(svc.get("service_kit_id"), str)
    ]
    return await _kits_by_id(adapted)


# ---------------------------------------------------------------------------
# H59 — component+markup pricing (pure functions)
# ---------------------------------------------------------------------------

def component_sell_cents(
    *,
    area_sf: float,
    production_rate: float | None,
    labor_rate_cents: float,
    labor_markup_pct: float,
    material_unit_cost_cents: float | None = None,
    material_qty_per_unit: float | None = None,
    material_markup_pct: float = 1.0,
    target_gm: float | None = None,
    qty: float | None = None,
) -> int:
    """Compute the sell price (integer cents) using the H59 component+markup model.

    Labor cost (sqft-based):
        labor_cost = (area_sf / production_rate) × labor_rate_cents

    Material cost:
        If qty is provided (count/CT/HR kits with no production_rate):
            material_cost = qty × material_unit_cost_cents
        Else (sqft-based):
            material_cost = material_qty_per_unit × material_unit_cost_cents × area_sf

    Sell formula:
        GM override (target_gm is not None):
            sell = (labor_cost + material_cost) / (1 - target_gm)
        Markup formula (target_gm is None):
            sell = labor_cost × (1 + labor_markup_pct) + material_cost × (1 + material_markup_pct)

    Rounding: half-up (matches JavaScript Math.round and the existing editor).
    """
    # Labor component
    if production_rate and production_rate > 0:
        labor_cost: float = (area_sf / production_rate) * labor_rate_cents
    else:
        labor_cost = 0.0

    # Material component
    have_material = (
        material_unit_cost_cents is not None
        and material_unit_cost_cents > 0
    )
    if have_material:
        if qty is not None:
            # Count-based / CT / HR kits: qty × unit_cost
            material_cost: float = qty * material_unit_cost_cents  # type: ignore[operator]
        elif material_qty_per_unit is not None:
            # Coverage-factor kits: bags_per_sqft × unit_cost × area
            material_cost = material_qty_per_unit * material_unit_cost_cents * area_sf  # type: ignore[operator]
        else:
            material_cost = 0.0
    else:
        material_cost = 0.0

    if target_gm is not None:
        gm = max(0.0, min(target_gm, 0.9999))
        sell = (labor_cost + material_cost) / (1.0 - gm)
    else:
        sell = labor_cost * (1.0 + labor_markup_pct) + material_cost * (1.0 + material_markup_pct)

    return _round_half_up(sell)


def derived_gm(
    *,
    labor_cost_cents: float,
    material_cost_cents: float,
    sell_cents: float | None,
) -> float | None:
    """Return the gross margin implied by the given cost/sell pair.

    Returns None when sell_cents is 0 or None (avoids division by zero).
    """
    if not sell_cents:
        return None
    total_cost = labor_cost_cents + material_cost_cents
    return 1.0 - total_cost / sell_cents


async def _kits_for_rows_v2(services: list[dict]) -> dict[str, dict]:
    """Like _kits_for_rows but fetches the H59 markup + material columns too."""
    kit_ids = [
        svc.get("service_kit_id")
        for svc in services
        if isinstance(svc.get("service_kit_id"), str)
    ]
    if not kit_ids:
        return {}
    unique = list(dict.fromkeys(kit_ids))
    placeholders = ", ".join(["%s"] * len(unique))
    rows = await _db_query(
        f"SELECT id, production_rate, unit_sell_cents, target_gm, "
        f"labor_markup_pct, material_markup_pct, "
        f"material_unit_cost_cents, material_qty_per_unit "
        f"FROM service_kits WHERE id IN ({placeholders})",
        unique,
    )
    return {r["id"]: r for r in rows}


async def reprice_open_drafts_v2(
    aspire_branch_id: int, previous_rate: int | None, new_rate: int
) -> int:
    """Recompute component+markup-derived sells on this branch's open maintenance drafts.

    Mirrors reprice_open_drafts but uses the H59 component_sell_cents formula.
    A kit line is repriced when:
      - The estimate is open (OPEN_DRAFT_STATUSES).
      - The kit has no catalog price (unit_sell_cents is NULL or 0).
      - The stored sell equals the formula value at previous_rate.

    When target_gm is non-NULL on the kit the GM-override path is used for
    both the identification check and the new sell computation.

    Returns the number of lines updated.
    """
    if previous_rate is None or previous_rate == new_rate:
        return 0

    estimates = await _db_query(
        "SELECT id, status, estimate_type FROM estimates WHERE aspire_branch_id = %s",
        [aspire_branch_id],
    )
    updated = 0
    for estimate in estimates:
        if estimate.get("estimate_type") != "maintenance":
            continue
        if estimate.get("status") not in OPEN_DRAFT_STATUSES:
            continue
        sections = await _db_query(
            "SELECT id FROM estimate_sections WHERE estimate_id = %s",
            [estimate["id"]],
        )
        for section in sections:
            services = await _db_query(
                "SELECT id, service_kit_id, unit_sell_cents FROM section_services WHERE section_id = %s",
                [section["id"]],
            )
            if not services:
                continue
            kits = await _kits_for_rows_v2(services)
            for svc in services:
                kit = kits.get(svc.get("service_kit_id"))
                if not _kit_derives_sell(kit):
                    continue
                stored = _number(svc.get("unit_sell_cents"))
                if stored is None:
                    continue

                production = _number(kit.get("production_rate"))
                target_gm_val = _number(kit.get("target_gm"))
                labor_markup = _number(kit.get("labor_markup_pct")) or 1.0
                material_markup = _number(kit.get("material_markup_pct")) or 1.0
                mat_unit_cost = _number(kit.get("material_unit_cost_cents"))
                mat_qty = _number(kit.get("material_qty_per_unit"))

                previous_sell = component_sell_cents(
                    area_sf=1000,
                    production_rate=production,
                    labor_rate_cents=previous_rate,
                    labor_markup_pct=labor_markup,
                    material_unit_cost_cents=mat_unit_cost,
                    material_qty_per_unit=mat_qty,
                    material_markup_pct=material_markup,
                    target_gm=target_gm_val,
                )
                if int(stored) != previous_sell:
                    continue

                new_sell = component_sell_cents(
                    area_sf=1000,
                    production_rate=production,
                    labor_rate_cents=new_rate,
                    labor_markup_pct=labor_markup,
                    material_unit_cost_cents=mat_unit_cost,
                    material_qty_per_unit=mat_qty,
                    material_markup_pct=material_markup,
                    target_gm=target_gm_val,
                )
                await _db_execute(
                    "UPDATE section_services SET unit_sell_cents = %s WHERE id = %s",
                    [new_sell, svc["id"]],
                )
                updated += 1
    return updated
