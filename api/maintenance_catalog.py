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

    Business rules (Handoff 59 Track B):
    - Only runs for estimate_type = 'maintenance'.
    - Skip if section already has services (guard against re-saves / duplication).
    - Seed only services in non-optional maintenance categories (is_optional = 0).
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

    # Step 3: read occurrence counts from the estimate (all 6 columns at once).
    occ_rows = await query_fn(
        "SELECT mowing_occurrences, pruning_occurrences, turf_fert_occurrences,"
        " shrub_fert_occurrences, ipm_occurrences, irrigation_occurrences"
        " FROM estimates WHERE id = %s",
        [estimate_id],
    )
    occ = occ_rows[0] if occ_rows else {}

    # Step 4: for each service, insert one section_services row per linked kit method.
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
            # Service has no linked kits — insert a single row with no kit.
            svc_id = str(uuid.uuid4())
            label = svc.get("display_name") or svc.get("name", "")
            await execute_fn(
                """INSERT INTO section_services
                     (id, section_id, service_kit_id, service_id, discipline, billing_type, label, qty, uom,
                      complexity_pct, unit_sell_cents, embedded_cost_cents, target_gm, hours, square_feet, sort_order)
                   VALUES (%s, %s, %s, %s, NULL, NULL, %s, %s, NULL, NULL, NULL, NULL, NULL, NULL, %s, %s)""",
                [svc_id, section_id, None, svc["id"], label, qty, 0, row_sort_idx],
            )
            await _seed_labor_component(svc_id, execute_fn)
            row_sort_idx += 1
            continue

        for link in link_rows:
            kit_id = link["service_kit_id"]
            is_primary = bool(link.get("is_primary"))

            # Fetch kit details for label and material fields.
            kit_detail_rows = await query_fn(
                "SELECT id, name, material_unit_cost_cents"
                " FROM service_kits WHERE id = %s",
                [kit_id],
            )
            kit_detail = kit_detail_rows[0] if kit_detail_rows else {}

            # Label at method level: kit name.
            label = kit_detail.get("name") or svc.get("display_name") or svc.get("name", "")

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
                   VALUES (%s, %s, %s, %s, NULL, NULL, %s, %s, NULL, NULL, NULL, NULL, NULL, NULL, %s, %s)""",
                [svc_id, section_id, kit_id, svc["id"], label, qty, sqft, row_sort_idx],
            )

            # Components: always labor; material only when kit has a material cost.
            await _seed_labor_component(svc_id, execute_fn)
            material_cost = kit_detail.get("material_unit_cost_cents")
            if material_cost is not None:
                await _seed_material_component(svc_id, execute_fn)

            row_sort_idx += 1


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
