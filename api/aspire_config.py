"""Vendored Aspire lookup constants — pure data, no logic.

All ids were captured live from the Aspire tenant on 2026-07-27 (see the plan's
"Aspire values verified live" section). Field-mapping logic that consumes these
maps lives in api/aspire_sync.py — this module is intentionally import-free of
anything Aspire-transport related so it can be asserted in isolation.

Branch / division / sales-type / lead-source maps are vendored verbatim from the
sibling deployable juniper-crm-shared/config.py (the nightly-batch push source);
keep them in sync there if Aspire re-numbers a branch.
"""
from __future__ import annotations

# ── Opportunity status ids ───────────────────────────────────────────────────
# get_opportunity_statuses (live): single id each, no variants.
ASPIRE_OPPORTUNITY_STATUS_NEW = 1652   # "New" / Pre Bid — set on create
ASPIRE_OPPORTUNITY_STATUS_WON = 1658
ASPIRE_OPPORTUNITY_STATUS_LOST = 1659

# ── Lost reasons (id → label) ────────────────────────────────────────────────
# Only the active set. Ids 2,4,6,8,10,12 were deactivated 2025-02-13 and must
# never be written; ids 13–15 are the 2026-03-24 replacement set.
ASPIRE_LOST_REASONS: dict[int, str] = {
    13: "Price",
    14: "Quality / Reputation",
    15: "Relationship",
}

# ── Division map (service-line label → DivisionID) ───────────────────────────
# Keys are the service-line dropdown values used by both the intake UI and the
# port. NB: "Install:  Hardscape" carries the DOUBLE space of Aspire's real
# DivisionName — do not "tidy" it, the frontend sends the same string.
ASPIRE_DIVISION_MAP: dict[str, int] = {
    "Maintenance: Contract":           1574,
    "Maintenance: Enhancements":       1570,
    "Maintenance: Irrigation Service": 1588,
    "Install: Landscape":              1569,
    "Install: Enhancements":           1576,   # INACTIVE in Aspire — confirm before targeting
    "Install:  Hardscape":             2594,   # DOUBLE space, matches Aspire DivisionName
    "Install: Irrigation":             1577,
    "Install: Sod":                    1578,
}

ASPIRE_INSTALL_DIVISION_IDS: frozenset[int] = frozenset({1569, 1576, 2594, 1577, 1578})

# ── Branch map ((city, is_install) → BranchID) ───────────────────────────────
ASPIRE_BRANCH_MAP: dict[tuple[str, bool], int] = {
    ("Bonita Springs, FL",     False): 1412,
    ("Bonita Springs, FL",     True):  1412,
    ("Bradenton, FL",          False): 3684,
    ("Bradenton, FL",          True):  1374,
    ("Fort Lauderdale, FL",    False): 3636,
    ("Fort Lauderdale, FL",    True):  3636,
    ("Fort Myers, FL",         False): 3696,
    ("Fort Myers, FL",         True):  1403,
    ("Melbourne, FL",          False): 3676,
    ("Melbourne, FL",          True):  3676,
    ("Naples, FL",             False): 3697,
    ("Naples, FL",             True):  3697,
    ("Ocala, FL",              False): 3694,
    ("Ocala, FL",              True):  3674,
    ("Orlando, FL",            False): 3668,
    ("Orlando, FL",            True):  3579,
    ("Palm Beach Gardens, FL", False): 3683,
    ("Palm Beach Gardens, FL", True):  3683,
    ("Panama City Beach, FL",  False): 3682,
    ("Panama City Beach, FL",  True):  3681,
    ("Riviera Beach, FL",      False): 3672,
    ("Riviera Beach, FL",      True):  3672,
    ("Sarasota, FL",           False): 3684,
    ("Sarasota, FL",           True):  1374,
    ("Tampa East, FL",         False): 3691,
    ("Tampa East, FL",         True):  3677,
    ("Tampa North, FL",        False): 3695,
    ("Tampa North, FL",        True):  3677,
    ("Tampa South, FL",        False): 3663,
    ("Tampa South, FL",        True):  3663,
    ("Venice, FL",             False): 3698,
    ("Venice, FL",             True):  1402,
    ("Vero Beach, FL",         False): 3577,
    ("Vero Beach, FL",         True):  3577,
    ("Daytona, FL",            False): 3705,
    ("Daytona, FL",            True):  3705,
    ("Estero, FL",             False): 3671,
    ("Estero, FL",             True):  3671,
    ("South Orlando, FL",      False): 3666,
    ("South Orlando, FL",      True):  3666,
    ("West Orlando, FL",       False): 3699,
    ("West Orlando, FL",       True):  3579,
    ("Tyndall, FL",            False): 3685,
    ("Tyndall, FL",            True):  3681,
    ("Houston, TX",            False): 3679,
    ("Houston, TX",            True):  3680,
    ("Hilton Head, SC",        False): 3706,
    ("Hilton Head, SC",        True):  3707,
    ("Lancaster, PA",          False): 3686,
    ("Lancaster, PA",          True):  3686,
    ("Carlisle, PA",           False): 3687,
    ("Carlisle, PA",           True):  3687,
    ("Raleigh, NC",            False): 3688,
    ("Raleigh, NC",            True):  3689,
    ("Wilmington, NC",         False): 3688,
    ("Wilmington, NC",         True):  3689,
}

# Cities with no dedicated install branch — install BranchID falls back to the
# maintenance branch (informational; the fallback itself is applied in the port).
ASPIRE_BRANCH_INSTALL_FALLBACKS: frozenset[str] = frozenset({
    "Bonita Springs, FL",
    "Fort Lauderdale, FL",
    "Melbourne, FL",
    "Naples, FL",
    "Palm Beach Gardens, FL",
    "Riviera Beach, FL",
    "Sarasota, FL",
    "Tampa South, FL",
    "Vero Beach, FL",
    "Lancaster, PA",
    "Carlisle, PA",
    "Wilmington, NC",
    "Daytona, FL",
    "Estero, FL",
    "South Orlando, FL",
})

# ── Sales type / lead source ─────────────────────────────────────────────────
ASPIRE_SALES_TYPE_MAP: dict[str, int] = {
    "HOA":        1684,
    "commercial": 1680,
}

ASPIRE_LEAD_SOURCE_MAP: dict[str, int] = {
    "sam_gov":     2176,  # Bid Request
    "higher_gov":  2176,  # Bid Request
    "arcgis":      2117,  # Cold Call
    "hoa_usa":     2117,  # Cold Call
    "google_maps": 2117,  # Cold Call
    "manual":      2117,  # Cold Call
}

# ── Write-path behaviour ──────────────────────────────────────────────────────
# CONFIRMED MOOT (2026-08-24, swagger v1): Aspire API v1 has no PATCH or PUT
# endpoint for individual opportunities — only PATCH /WorkTickets/PartialOccurrences
# exists in the entire API. ASPIRE_STATUS_WRITE_VERB is unused until a working
# opportunity-update endpoint is found (see push_status docstring).
ASPIRE_STATUS_WRITE_VERB = "PATCH"

# Confirmed 2026-08-24 (swagger v1): OpportunityType is required, minLength: 1.
# Empty string fails validation. "Work Order" observed on existing sandbox opportunities.
# Confirm the correct label for Juniper's maintenance/install opportunities before enabling sync.
ASPIRE_OPPORTUNITY_TYPE_DEFAULT = "Work Order"
