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
"""
from __future__ import annotations

import math
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

# Stable code. The editor owns the sentence the user reads.
CREW_RATE_REQUIRED = "crew_rate_required"

OPEN_DRAFT_STATUSES = frozenset({"new_from_sales", "queued", "in_progress"})


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
    kit_ids = [svc.get("catalogItemId") for svc in services if isinstance(svc.get("catalogItemId"), str)]
    if not kit_ids:
        return {}
    unique = list(dict.fromkeys(kit_ids))
    placeholders = ", ".join(["%s"] * len(unique))
    rows = await _db_query(
        f"SELECT id, production_rate, unit_sell_cents, target_gm FROM catalog_items WHERE id IN ({placeholders})",
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
        kit = kits.get(svc.get("catalogItemId"))
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
                "SELECT id, catalog_item_id, unit_sell_cents FROM section_services WHERE section_id = %s",
                [section["id"]],
            )
            if not services:
                continue
            kits = await _kits_for_rows(services)
            for svc in services:
                kit = kits.get(svc.get("catalog_item_id"))
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
        {"catalogItemId": svc.get("catalog_item_id")}
        for svc in services
        if isinstance(svc.get("catalog_item_id"), str)
    ]
    return await _kits_by_id(adapted)
