"""Maintenance service catalog constants (Handoff 54 §1, migration 075).

Shared by scripts/pull_aspire_service_catalog.py (which proposes the seed) and
the maintenance section seeding (Handoff 54 §2). Kept out of api/estimating.py,
which has a size guard (tests/test_maintenance_crew_rate.py).
"""
from __future__ import annotations

import uuid
from typing import Awaitable, Callable, Optional

from db import query

# The six maintenance service_categories rows migration 075 seeds, in render
# order: code -> (id, name, is_optional). The names are Aspire's
# OpportunityServiceGroups GroupName values (verified on opportunity 655106;
# the pull script re-checks them against live groups).
MAINTENANCE_CATEGORIES: dict[str, tuple[str, str, bool]] = {
    "turf":         ("maint-cat-turf", "Turf", False),
    "bed_maint":    ("maint-cat-bed_maint", "Bed Maint", False),
    "irrigation":   ("maint-cat-irrigation", "Irrigation", False),
    "fertilizer":   ("maint-cat-fertilizer", "Fertilizer", False),
    "pest_control": ("maint-cat-pest_control", "Pest Control", False),
    "optional":     ("maint-cat-optional", "Optional Services", True),
}

STANDARD_CATEGORY_CODES = tuple(c for c, (_i, _n, opt) in MAINTENANCE_CATEGORIES.items() if not opt)
OPTIONAL_CATEGORY_CODE = "optional"

# services.occurrence_source values: the migration-064 yearly counts on
# estimates. A service whose source is set takes its occurrences from that
# count when a maintenance section is seeded (NULL count = unanswered -> 0);
# a service with no source takes services.default_occurrences.
OCCURRENCE_SOURCES = frozenset({
    "mowing_occurrences",
    "pruning_occurrences",
    "turf_fert_occurrences",
    "shrub_fert_occurrences",
    "ipm_occurrences",
    "irrigation_occurrences",
})

# Basis written on service_kit_links rows the Aspire pull proposes: the kit is
# a TakeoffItem the service is priced through (takeoff quantity / rate).
KIT_LINK_BASIS_TAKEOFF = "takeoff"

# ── H59 catalog curation ─────────────────────────────────────────────────────
# Peak + Off-peak stay active in the catalog (Carlos approved). Auto-seed only
# Off-peak by default (H58 §6); Peak is available via add-service / peak toggle.
PEAK_MOWING_SERVICE_ID = "maint-svc-50390"
OFF_PEAK_MOWING_SERVICE_ID = "maint-svc-50391"
MOWING_SERVICE_IDS = frozenset({PEAK_MOWING_SERVICE_ID, OFF_PEAK_MOWING_SERVICE_ID})
DEFAULT_MOWING_SERVICE_ID = OFF_PEAK_MOWING_SERVICE_ID

# Standard services auto-seeded into a new maintenance section (H58 ~1–3 Turf).
MAINTENANCE_STANDARD_SEED_ALLOWLIST: frozenset[str] = frozenset({
    OFF_PEAK_MOWING_SERVICE_ID,  # Turf — Off-peak only at seed time
    "maint-svc-18906",           # Bed Maint — Pruning (Peak)
    "maint-svc-18900",           # Irrigation Wet Checks
    "maint-svc-fert-shrub-q1",
    "maint-svc-fert-shrub-q2",
    "maint-svc-fert-shrub-q3",
    "maint-svc-fert-shrub-q4",
    "maint-svc-fert-turf-q1",
    "maint-svc-fert-turf-q2",
    "maint-svc-fert-turf-q3",
    "maint-svc-fert-turf-q4",
    "maint-svc-18904",           # Pest — Insect and Disease Control
})

# Active catalog ids after migration 082 (standard + optional takeoffs).
# Used by the Aspire pull so a re-pull does not re-propose deactivated rows.
# Explicit deactivate list (migration 082 + Aspire pull filter). Anything
# else from a sample pull may still be proposed; curated active documents
# the intended post-curation catalog and is what migration 082 re-activates.
MAINTENANCE_DEACTIVATED_IDS: frozenset[str] = frozenset({
    # Turf Base + Jan–Dec months (no kits)
    "maint-svc-50111",
    "maint-svc-50150", "maint-svc-50151", "maint-svc-50152", "maint-svc-50153",
    "maint-svc-50154", "maint-svc-50155", "maint-svc-50156", "maint-svc-50157",
    "maint-svc-50158", "maint-svc-50159", "maint-svc-50160", "maint-svc-50161",
    # Turf bid / add'l / summer
    "maint-svc-46821", "maint-svc-46814", "maint-svc-46817", "maint-svc-46837",
    "maint-svc-50241",
    # Bed Maint no-kit add'l
    "maint-svc-23819",
    # Fertilizer non-quarter Aspire samples
    "maint-svc-23814", "maint-svc-18893", "maint-svc-30964", "maint-svc-23807",
    "maint-svc-50243",
    # Pest no-kit extras
    "maint-svc-50213", "maint-svc-50148", "maint-svc-50199", "maint-svc-50137",
    # Optional junk / no-kit schedule
    "maint-svc-23823", "maint-svc-50168", "maint-svc-50167", "maint-svc-18892",
    "maint-svc-18907", "maint-svc-50270", "maint-svc-50269", "maint-svc-50200",
    "maint-svc-50273", "maint-svc-50400",
})

MAINTENANCE_CURATED_ACTIVE_IDS: frozenset[str] = frozenset({
    # Turf
    PEAK_MOWING_SERVICE_ID,
    OFF_PEAK_MOWING_SERVICE_ID,
    # Bed Maint
    "maint-svc-18906",
    "maint-svc-50392",  # Pruning OFF Peak — catalog only
    # Irrigation
    "maint-svc-18900",
    # Fertilizer quarters
    "maint-svc-fert-shrub-q1",
    "maint-svc-fert-shrub-q2",
    "maint-svc-fert-shrub-q3",
    "maint-svc-fert-shrub-q4",
    "maint-svc-fert-turf-q1",
    "maint-svc-fert-turf-q2",
    "maint-svc-fert-turf-q3",
    "maint-svc-fert-turf-q4",
    # Pest
    "maint-svc-18904",
    # Optional (kit-backed takeoffs)
    "maint-svc-18902",  # Mulch
    "maint-svc-19486",  # Annual Flower Installation
    "maint-svc-46819",  # Additional Irrigation Wet Check #1
    "maint-svc-21186",  # Additional Pruning #5
    "maint-svc-50244",  # Fertilize Shrubs Raleigh
    "maint-svc-50393",  # Palm Pruning
    "maint-svc-50242",  # Winter Maintenance
})


def select_mowing_service(services: list[dict]) -> list[dict]:
    """Keep exactly one Turf mowing service for auto-seed (default OFF-PEAK).

    Peak and Off-peak both remain active in the catalog; never seed both.
    TODO(carlos): real peak/off-peak selection criteria.
    """
    mowing = [s for s in services if s.get("id") in MOWING_SERVICE_IDS]
    others = [s for s in services if s.get("id") not in MOWING_SERVICE_IDS]
    if not mowing:
        return services
    preferred = next(
        (s for s in mowing if s.get("id") == DEFAULT_MOWING_SERVICE_ID),
        mowing[0],
    )
    return others + [preferred]



def service_id_for_aspire(aspire_service_id: int) -> str:
    """Deterministic services.id for an Aspire Service (maint-svc-<ServiceID>)."""
    return f"maint-svc-{int(aspire_service_id)}"


def kit_id_for_takeoff_item(takeoff_item_id: int) -> str:
    """Our service_kits id for an Aspire TakeoffItemID (1:1, kit-maint-<id>)."""
    return f"kit-maint-{int(takeoff_item_id)}"


async def seed_standard_maintenance_services(
    estimate_id: str,
    estimate_type: str,
    section_id: str,
    query_fn: Callable[..., Awaitable[list]],
    execute_fn: Callable[..., Awaitable[None]],
) -> None:
    """Insert one section_services row per linked kit method for each standard
    maintenance service — mirroring Aspire's behaviour where adding a service
    copies its entire kit (every production method as its own row).

    Called from _insert_section in api/estimating.py whenever a section is
    created for a maintenance estimate.  Receives query/execute as callables so
    callers pass the already-imported (and test-patched) db functions, avoiding
    a circular import.

    Business rules (Handoff 59 Track B + catalog curation):
    - Only runs for estimate_type = 'maintenance'.
    - Skip if section already has services (guard against re-saves / duplication).
    - Seed only allowlisted standard services (MAINTENANCE_STANDARD_SEED_ALLOWLIST);
      Turf seeds Off-peak mowing only via select_mowing_service (Peak stays catalog-only).
    - Skip services with no kit links (no empty schedule-style rows).
    - qty = estimate's occurrence column named by occurrence_source, or
      default_occurrences when occurrence_source is NULL. NULL count → 0.
    - label = kit name (method-level label, not service-level display_name).
    - For each linked kit, insert one section_services row:
        * square_feet = NULL if service is in the 'turf' category AND is_primary=1
          (mowing primary inherits the section's square footage).
        * square_feet = 0 for all other method rows (non-primary mowing, and all
          rows for pruning / fertilizer / pest control / irrigation).
    - After each section_services row, insert section_service_components:
        * Always one kind='labor' row.
        * One kind='material' row only if the kit's material_unit_cost_cents is non-null.
    - After inserts, reprice seeded rows (unit_sell_cents + hours) from the live
      branch crew rate and kit production_rate so sells/hours are not left NULL.
    - discipline = NULL (maintenance lines carry no discipline).
    """
    if estimate_type != "maintenance":
        return

    # Guard: skip if section already has services (prevents double-seeding).
    count_rows = await query_fn(
        "SELECT COUNT(*) AS c FROM section_services WHERE section_id = %s",
        [section_id],
    )
    if count_rows and count_rows[0].get("c", 0) > 0:
        return

    # Step 1: get standard (non-optional, active) maintenance category IDs + codes.
    cat_rows = await query_fn(
        "SELECT id, code FROM service_categories WHERE estimate_type = %s AND is_optional = %s AND active = %s",
        ["maintenance", 0, 1],
    )
    if not cat_rows:
        return
    cat_ids = [r["id"] for r in cat_rows]
    # Map category_id -> code so we can identify 'turf' services below.
    cat_code_by_id: dict[str, str] = {r["id"]: r.get("code", "") for r in cat_rows}

    # Step 2: get all active services in those categories (include service_category_id).
    placeholders = ", ".join(["%s"] * len(cat_ids))
    svc_rows = await query_fn(
        f"SELECT id, name, display_name, occurrence_source, default_occurrences, service_category_id"
        f" FROM services WHERE service_category_id IN ({placeholders}) AND active = %s"
        f" ORDER BY sort_order",
        [*cat_ids, 1],
    )
    if not svc_rows:
        return

    # H59 curation: only auto-seed the allowlisted standard set, then pick one
    # mowing service (Off-peak default) so Peak/Off-peak both stay catalog-active
    # without double-seeding Turf.
    svc_rows = [s for s in svc_rows if s.get("id") in MAINTENANCE_STANDARD_SEED_ALLOWLIST]
    svc_rows = select_mowing_service(svc_rows)
    if not svc_rows:
        return

    # Step 3: read occurrence counts + branch from the estimate.
    occ_rows = await query_fn(
        "SELECT mowing_occurrences, pruning_occurrences, turf_fert_occurrences,"
        " shrub_fert_occurrences, ipm_occurrences, irrigation_occurrences,"
        " aspire_branch_id"
        " FROM estimates WHERE id = %s",
        [estimate_id],
    )
    occ = occ_rows[0] if occ_rows else {}
    aspire_branch_id = occ.get("aspire_branch_id")

    # Section square footage — used when a mowing primary inherits (sqft NULL).
    section_rows = await query_fn(
        "SELECT square_feet FROM estimate_sections WHERE id = %s",
        [section_id],
    )
    section_sqft = None
    if section_rows:
        raw_sqft = section_rows[0].get("square_feet")
        try:
            section_sqft = float(raw_sqft) if raw_sqft is not None else None
        except (TypeError, ValueError):
            section_sqft = None

    # Step 4: for each service, insert one section_services row per linked kit method.
    seeded_ids: list[str] = []
    row_sort_idx = 0
    for svc in svc_rows:
        # Determine if this service is in the turf (mowing) category.
        svc_cat_code = cat_code_by_id.get(svc.get("service_category_id", ""), "")
        is_turf_service = svc_cat_code == "turf"

        # Resolve qty from occurrence_source → estimate column, or default.
        src = svc.get("occurrence_source")
        if src and src in OCCURRENCE_SOURCES:
            qty = occ.get(src) or 0
        else:
            qty = svc.get("default_occurrences") or 0

        # Fetch all linked kits for this service, ordered primary-first then by sort_order.
        link_rows = await query_fn(
            "SELECT service_kit_id, is_primary, sort_order"
            " FROM service_kit_links"
            " WHERE service_id = %s"
            " ORDER BY is_primary DESC, sort_order",
            [svc["id"]],
        )

        if not link_rows:
            # No kits — skip. Schedule-style / month rows must not seed empty lines.
            continue

        for link in link_rows:
            kit_id = link["service_kit_id"]
            is_primary = bool(link.get("is_primary"))

            # Fetch kit details for label, uom, material fields, and pricing.
            kit_detail_rows = await query_fn(
                "SELECT id, description, uom, material_unit_cost_cents,"
                " production_rate, unit_sell_cents, target_gm"
                " FROM service_kits WHERE id = %s",
                [kit_id],
            )
            kit_detail = kit_detail_rows[0] if kit_detail_rows else {}

            # Label at method level: kit description.
            label = kit_detail.get("description") or svc.get("display_name") or svc.get("name", "")
            kit_uom = kit_detail.get("uom") or "/yr"

            # square_feet rule:
            #   NULL  — turf (mowing) primary kit only; inherits section.square_feet.
            #   0     — all other method rows (non-primary mowing + all non-turf services).
            if is_turf_service and is_primary:
                sqft: Optional[float] = None
            else:
                sqft = 0

            svc_id = str(uuid.uuid4())
            await execute_fn(
                """INSERT INTO section_services
                     (id, section_id, service_kit_id, service_id, discipline, billing_type, label, qty, uom,
                      complexity_pct, unit_sell_cents, embedded_cost_cents, target_gm, hours, square_feet, sort_order)
                   VALUES (%s, %s, %s, %s, NULL, NULL, %s, %s, %s, 0, NULL, NULL, NULL, NULL, %s, %s)""",
                [svc_id, section_id, kit_id, svc["id"], label, qty, kit_uom, sqft, row_sort_idx],
            )

            # Components: always labor; material only when kit has a material cost.
            await _seed_labor_component(svc_id, execute_fn)
            material_cost = kit_detail.get("material_unit_cost_cents")
            if material_cost is not None:
                await _seed_material_component(svc_id, execute_fn)

            seeded_ids.append(svc_id)
            row_sort_idx += 1

    if seeded_ids:
        await _reprice_seeded_rows(
            seeded_ids=seeded_ids,
            aspire_branch_id=aspire_branch_id,
            section_sqft=section_sqft,
            query_fn=query_fn,
            execute_fn=execute_fn,
        )


async def _reprice_seeded_rows(
    *,
    seeded_ids: list[str],
    aspire_branch_id: Optional[int],
    section_sqft: Optional[float],
    query_fn: Callable[..., Awaitable[list]],
    execute_fn: Callable[..., Awaitable[None]],
) -> None:
    """Fill unit_sell_cents + hours on freshly seeded method rows.

    Empty create payloads are priced before seed (no lines), then seed inserts
    with NULL sell/hours. This pass stamps crew-rate-derived sells and
    occurrence hours so the editor is not left blank.
    """
    from api.maintenance_pricing import (
        _kit_derives_sell,
        _number,
        sell_rate_cents_per_1000_sf,
    )

    crew_rate: Optional[int] = None
    if aspire_branch_id is not None and not isinstance(aspire_branch_id, bool):
        rate_rows = await query_fn(
            "SELECT crew_rate_cents_per_hour FROM branch_settings WHERE aspire_branch_id = %s",
            [aspire_branch_id],
        )
        if rate_rows:
            raw = _number(rate_rows[0].get("crew_rate_cents_per_hour"))
            crew_rate = int(raw) if raw is not None else None

    for sid in seeded_ids:
        rows = await query_fn(
            "SELECT id, service_kit_id, square_feet FROM section_services WHERE id = %s",
            [sid],
        )
        if not rows:
            continue
        row = rows[0]
        kit_id = row.get("service_kit_id")
        if not kit_id:
            continue
        kit_rows = await query_fn(
            "SELECT id, production_rate, unit_sell_cents, target_gm FROM service_kits WHERE id = %s",
            [kit_id],
        )
        if not kit_rows:
            continue
        kit = kit_rows[0]
        production = _number(kit.get("production_rate"))

        # Hours: line area (override or section inherit) ÷ production rate.
        line_sqft = row.get("square_feet")
        if line_sqft is None:
            area = section_sqft
        else:
            try:
                area = float(line_sqft)
            except (TypeError, ValueError):
                area = None
        hours: Optional[float] = None
        if production is not None and production > 0:
            if area is None:
                hours = None
            else:
                hours = float(area) / production

        unit_sell: Optional[int] = None
        if _kit_derives_sell(kit) and crew_rate is not None and production is not None and production > 0:
            target_gm = _number(kit.get("target_gm")) or 0.0
            unit_sell = sell_rate_cents_per_1000_sf(production, target_gm, crew_rate)
        else:
            catalog_sell = _number(kit.get("unit_sell_cents"))
            if catalog_sell is not None and catalog_sell > 0:
                unit_sell = int(catalog_sell)

        if unit_sell is None and hours is None:
            continue
        await execute_fn(
            "UPDATE section_services SET unit_sell_cents = %s, hours = %s WHERE id = %s",
            [unit_sell, hours, sid],
        )


async def _seed_labor_component(
    section_service_id: str,
    execute_fn: Callable[..., Awaitable[None]],
) -> None:
    """Insert a kind='labor' section_service_components row for a method row."""
    comp_id = str(uuid.uuid4())
    await execute_fn(
        """INSERT INTO section_service_components
             (id, section_service_id, kind, label, inventory_id, qty, uom, unit_cost_cents, hours, sort_order)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [comp_id, section_service_id, "labor", "Labor", None, 0, None, 0, None, 0],
    )


async def _seed_material_component(
    section_service_id: str,
    execute_fn: Callable[..., Awaitable[None]],
) -> None:
    """Insert a kind='material' section_service_components row for a method row."""
    comp_id = str(uuid.uuid4())
    await execute_fn(
        """INSERT INTO section_service_components
             (id, section_service_id, kind, label, inventory_id, qty, uom, unit_cost_cents, hours, sort_order)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [comp_id, section_service_id, "material", "Material", None, 0, None, 0, None, 1],
    )


# (db_column, output_key, coerce_fn) for the three pricing fields on service kits.
_RATE_FIELDS: tuple[tuple[str, str, type], ...] = (
    ("production_rate", "productionRate", float),
    ("unit_cost_cents", "unitCostCents", int),
    ("target_gm", "targetGm", float),
)


def _absorb_rate_row(row: dict, result: dict) -> None:
    """Merge non-None pricing fields from a DB row into result, skipping filled keys."""
    for col, key, coerce in _RATE_FIELDS:
        if key not in result and row.get(col) is not None:
            result[key] = coerce(row[col])


def _rate_complete(result: dict) -> bool:
    return all(k in result for k in ("productionRate", "unitCostCents", "targetGm"))


async def resolve_kit_rate(kit_id: str, aspire_branch_id: Optional[int]) -> dict:
    """Return the effective pricing fields for a service kit at a given branch.

    Three-step fallback for rate fields (Handoff 54 §4):
      1. Newest service_kit_rates row WHERE service_kit_id=%s AND aspire_branch_id=%s
      2. Newest service_kit_rates row WHERE service_kit_id=%s AND aspire_branch_id IS NULL
      3. service_kits baseline: production_rate, unit_cost_cents, target_gm

    Fields are merged per-field — a branch row may override some but not all,
    so fallback applies per-field, not per-row.  Steps 1 and 2 are separate
    queries because FakeDb does not support IS NULL alongside other conditions.

    Markup fields (Handoff 59 Track A) are always company-wide — they do NOT
    vary per branch. They are always read from the service_kits baseline:
      labor_markup_pct, material_markup_pct, material_unit_cost_cents,
      material_qty_per_unit, material_uom, is_primary.
    """
    result: dict = {}

    # Step 1: branch-specific rate row.
    if aspire_branch_id is not None:
        rows = await query(
            "SELECT production_rate, unit_cost_cents, target_gm"
            " FROM service_kit_rates"
            " WHERE service_kit_id = %s AND aspire_branch_id = %s"
            " ORDER BY effective_from DESC LIMIT 1",
            [kit_id, aspire_branch_id],
        )
        if rows:
            _absorb_rate_row(rows[0], result)

    # Step 2: company-wide row (aspire_branch_id IS NULL — separate query for FakeDb).
    if not _rate_complete(result):
        rows = await query(
            "SELECT production_rate, unit_cost_cents, target_gm"
            " FROM service_kit_rates"
            " WHERE service_kit_id = %s AND aspire_branch_id IS NULL"
            " ORDER BY effective_from DESC LIMIT 1",
            [kit_id],
        )
        if rows:
            _absorb_rate_row(rows[0], result)

    # Step 3: service_kits baseline — fills any remaining rate fields AND always
    # reads markup/material fields (those are always company-wide from baseline).
    rows = await query(
        "SELECT production_rate, unit_cost_cents, target_gm,"
        " labor_markup_pct, material_markup_pct, material_unit_cost_cents,"
        " material_qty_per_unit, material_uom, is_primary"
        " FROM service_kits WHERE id = %s",
        [kit_id],
    )
    if rows:
        baseline = rows[0]
        # Fill any rate fields not yet resolved by steps 1–2.
        if not _rate_complete(result):
            _absorb_rate_row(baseline, result)
        # Markup/material fields: always from baseline (company-wide, not per-branch).
        lm = baseline.get("labor_markup_pct")
        result["laborMarkupPct"] = float(lm) if lm is not None else None
        mm = baseline.get("material_markup_pct")
        result["materialMarkupPct"] = float(mm) if mm is not None else None
        muc = baseline.get("material_unit_cost_cents")
        result["materialUnitCostCents"] = int(muc) if muc is not None else None
        mqpu = baseline.get("material_qty_per_unit")
        result["materialQtyPerUnit"] = float(mqpu) if mqpu is not None else None
        result["materialUom"] = baseline.get("material_uom") or None
        result["isPrimary"] = bool(baseline.get("is_primary", 0))

    return result
