"""Maintenance service catalog constants (Handoff 54 §1, migration 075).

Shared by scripts/pull_aspire_service_catalog.py (which proposes the seed) and
the maintenance section seeding (Handoff 54 §2). Kept out of api/estimating.py,
which has a size guard (tests/test_maintenance_crew_rate.py).
"""
from __future__ import annotations

import uuid
from typing import Awaitable, Callable

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
    """Insert one section_services row per standard maintenance service.

    Called from _insert_section in api/estimating.py whenever a section is
    created for a maintenance estimate.  Receives query/execute as callables so
    callers pass the already-imported (and test-patched) db functions, avoiding
    a circular import.

    Business rules (Handoff 54 §2):
    - Only runs for estimate_type = 'maintenance'.
    - Skip if section already has services (guard against re-saves / duplication).
    - Seed only services in non-optional maintenance categories (is_optional = 0).
    - qty = estimate's occurrence column named by occurrence_source, or
      default_occurrences when occurrence_source is NULL. NULL count → 0.
    - label = display_name if set, else name.
    - service_kit_id = primary kit (is_primary=1, lowest sort_order), or NULL.
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

    # Step 1: get standard (non-optional, active) maintenance category IDs.
    cat_rows = await query_fn(
        "SELECT id FROM service_categories WHERE estimate_type = %s AND is_optional = %s AND active = %s",
        ["maintenance", 0, 1],
    )
    if not cat_rows:
        return
    cat_ids = [r["id"] for r in cat_rows]

    # Step 2: get all active services in those categories.
    placeholders = ", ".join(["%s"] * len(cat_ids))
    svc_rows = await query_fn(
        f"SELECT id, name, display_name, occurrence_source, default_occurrences"
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

    # Step 4: insert one section_services row per service.
    for sort_idx, svc in enumerate(svc_rows):
        svc_id = str(uuid.uuid4())

        # Resolve label.
        label = svc.get("display_name") or svc.get("name", "")

        # Resolve qty from occurrence_source → estimate column, or default.
        src = svc.get("occurrence_source")
        if src and src in OCCURRENCE_SOURCES:
            qty = occ.get(src) or 0
        else:
            qty = svc.get("default_occurrences") or 0

        # Resolve primary kit (is_primary=1, lowest sort_order).
        kit_rows = await query_fn(
            "SELECT service_kit_id FROM service_kit_links"
            " WHERE service_id = %s AND is_primary = %s ORDER BY sort_order LIMIT %s",
            [svc["id"], 1, 1],
        )
        kit_id = kit_rows[0]["service_kit_id"] if kit_rows else None

        await execute_fn(
            """INSERT INTO section_services
                 (id, section_id, service_kit_id, service_id, discipline, billing_type, label, qty, uom,
                  complexity_pct, unit_sell_cents, embedded_cost_cents, target_gm, hours, sort_order)
               VALUES (%s, %s, %s, %s, NULL, NULL, %s, %s, NULL, NULL, NULL, NULL, NULL, NULL, %s)""",
            [svc_id, section_id, kit_id, svc["id"], label, qty, sort_idx],
        )
