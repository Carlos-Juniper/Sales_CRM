"""Maintenance service catalog constants (Handoff 54 §1, migration 075).

Shared by scripts/pull_aspire_service_catalog.py (which proposes the seed) and
the maintenance section seeding (Handoff 54 §2). Kept out of api/estimating.py,
which has a size guard (tests/test_maintenance_crew_rate.py).
"""
from __future__ import annotations

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
