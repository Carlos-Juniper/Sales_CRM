"""
Seed a maintenance estimate ready to test the contract generator.

Creates:
  - One estimate: "Coral Bay HOA" · maintenance · lifecycle=approved
  - Two sections: Main Property (342,000 sqft) + Entrance/Amenity (28,500 sqft)
  - Seven recurring services + two one-time services
  - Each section_service is linked to a real catalog_item (by description match)
    so service_kits.scope_text + billing_type flow through the API

Run AFTER migrations 044+045 are applied and the Cloud SQL proxy is up:

    python scripts/seed_contract_estimate.py

Prints the estimate ID and the direct proposal-preview URL to open in the app.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Load .env — can't use `set -a; source .env` in zsh because secret values
# contain glob chars (#, ?, {) that the shell expands. Parse manually instead.
env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())

import pymysql  # noqa: E402 (after env load)

DB_CFG = dict(
    host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
    port=int(os.environ.get("MYSQL_PORT", 3306)),
    user=os.environ.get("MYSQL_USER", "crmadmin"),
    password=os.environ.get("MYSQL_PASSWORD", ""),
    db=os.environ.get("MYSQL_DB", "crm"),
    charset="utf8mb4",
    autocommit=False,
)

ESTIMATE_ID = f"est-coral-bay-contract-{uuid.uuid4().hex[:8]}"

# ---------------------------------------------------------------------------
# Services to seed — (label, catalog description to look up, qty, uom, rate¢)
# rate_cents is a fallback if no catalog_item is found.
# ---------------------------------------------------------------------------
# The fragment must match an EXISTING service_kits.description — the contract
# page reads billing_type (recurring vs one-time) and scope_text off the linked
# catalog item, so a line that matches nothing renders with a blank "occurs"
# column and drops out of the payment-schedule base.
MAIN_SERVICES = [
    # (label, catalog description fragment, qty, uom, rate_cents/1000sqft, complexity)
    ("Mowing & Edging",          "Standard Production Mowing", 12, "/yr",  350, 0.0),
    ("Landscape Bed Maintenance","Bed Area Maintenance",        12, "/yr",  200, 0.0),
    ("Fertilization",            "Turf Area Fertilization",      4, "/yr",  300, 0.0),
    ("Weed Control",             "Weed Eat",                     6, "/yr",  200, 0.0),
    ("Tree Canopy Trimming",     "Tree Canopy Trimming",         4, "/yr",  250, 0.0),
]

ENTRANCE_SERVICES = [
    ("Shrub & Hedge Trimming",   "Prune Medium",                 6, "/yr", 1400, 0.0),
    ("Irrigation System Maint.", "Common Area Zones",            12, "/yr", 1000, 0.0),
    ("Mulch Application",        "Mulch Per Yard",                1, "/yr",    0, 0.0),
    ("Annual Flower Installation","Number of Flowers per Change Out", 1, "/yr", 0, 0.0),
]


# Flat-priced services need a manual unit price (not sqft-based). This is a
# PRICING shape, not a billing classification — all maintenance work bundles
# into the 12-month contract regardless.
ONE_TIME_UNIT_PRICES = {
    "Mulch Application":           420_000,  # $4,200 flat
    "Annual Flower Installation":  860_000,  # $8,600 flat
}


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def lookup_catalog_item(cur, description_fragment: str) -> tuple[str | None, str | None]:
    """Return (id, billing_type) for the first matching active maintenance catalog item."""
    # No service_type filter: that column holds the service CATEGORY
    # ('Turf Area', 'Irrigation', 'Palm Pruning'), never the literal
    # 'maintenance', so filtering on it matched nothing and left every seeded
    # line with service_kit_id = NULL.
    cur.execute(
        """SELECT id, billing_type FROM service_kits
           WHERE description LIKE %s AND active = 1
           LIMIT 1""",
        (f"%{description_fragment}%",),
    )
    row = cur.fetchone()
    if row:
        return row["id"], row["billing_type"]
    print(f"⚠  No service_kits match for {description_fragment!r} — "
          f"this line will render without billing type or scope text.")
    return None, None


def check_migrations(cur) -> None:
    """Warn if migrations 044/045 haven't been applied yet."""
    try:
        cur.execute("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits' "
                    "AND COLUMN_NAME = 'scope_text'")
        if not cur.fetchone():
            print("⚠  Migration 044 not applied — scope_text column missing.")
            print("   Run: python scripts/migrate.py")
            print("   Contract page will render without scope narratives.\n")
    except Exception:
        pass


def seed(conn) -> str:
    cur = conn.cursor(pymysql.cursors.DictCursor)

    check_migrations(cur)

    # Look up a real aspire_branch_id to avoid FK issues. An unfiltered
    # "LIMIT 1" here previously landed on an inactive "DO NOT USE" branch
    # (whichever row MySQL happened to return first) — filter to an active,
    # maintenance-type Orlando branch, or override with SEED_ASPIRE_BRANCH_ID.
    aspire_branch_id_override = os.environ.get("SEED_ASPIRE_BRANCH_ID")
    if aspire_branch_id_override:
        aspire_branch_id = int(aspire_branch_id_override)
    else:
        cur.execute(
            "SELECT aspire_branch_id FROM branches "
            "WHERE active = 1 AND branch_name LIKE %s "
            "ORDER BY aspire_branch_id LIMIT 1",
            ("%Orlando%Maintenance%",),
        )
        branch_row = cur.fetchone()
        aspire_branch_id = branch_row["aspire_branch_id"] if branch_row else 1919

    # Lead the estimate hangs off. The proposal builder finds this estimate via
    # GET /estimating/estimates?leadId=...&status=approved, so seeding it onto
    # an arbitrary "first" lead meant the lead under test never saw it.
    # Override with SEED_LEAD_ID=<uuid>.
    lead_id = os.environ.get("SEED_LEAD_ID") or None
    if lead_id:
        cur.execute("SELECT id FROM leads WHERE id = %s", (lead_id,))
        if not cur.fetchone():
            print(f"❌  SEED_LEAD_ID {lead_id} is not a real lead.")
            sys.exit(1)
    else:
        cur.execute("SELECT id FROM leads LIMIT 1")
        lead_row = cur.fetchone()
        lead_id = lead_row["id"] if lead_row else None
        print(f"ℹ  No SEED_LEAD_ID set — attaching to first lead: {lead_id}")

    # Get next estimate_number
    cur.execute("SELECT COALESCE(MAX(estimate_number), 1000) + 1 AS next_num FROM estimates")
    estimate_number = cur.fetchone()["next_num"]

    # ── 1. Estimate ──────────────────────────────────────────────────────────
    cur.execute(
        """INSERT INTO estimates
             (id, estimate_type, name, aspire_number, estimate_number,
              client_name, aspire_branch_id, customer_type,
              acreage, contract_value_cents, target_margin,
              status, lifecycle, aspire_owner, priority, win_probability,
              due_back_date, service_start_date, lead_id,
              notify_bm_rd_on_return, rfi_status)
           VALUES
             (%s, 'maintenance', 'Coral Bay HOA — Contract Test',
              'CB-2026-SEED', %s,
              'Coral Bay HOA', %s, 'commercial',
              8.2, 4800000, 0.22,
              'approved', 'bidding', 'estimating', 'high', 0.90,
              '2026-10-01', '2027-01-01', %s,
              0, NULL)""",
        (ESTIMATE_ID, estimate_number, aspire_branch_id, lead_id),
    )

    # ── 2. Section 1 — Main Property (342,000 sqft) ──────────────────────────
    sec1_id = new_id("sec")
    cur.execute(
        "INSERT INTO estimate_sections (id, estimate_id, name, square_feet, sort_order) "
        "VALUES (%s, %s, %s, %s, %s)",
        (sec1_id, ESTIMATE_ID, "Main Property", 342_000, 0),
    )

    for i, (label, frag, qty, uom, rate, complexity) in enumerate(MAIN_SERVICES):
        svc_id = new_id("svc")
        cat_id, billing_type = lookup_catalog_item(cur, frag)
        unit_sell = ONE_TIME_UNIT_PRICES.get(label, rate)
        cur.execute(
            """INSERT INTO section_services
                 (id, section_id, service_kit_id, label, qty, uom,
                  complexity_pct, unit_sell_cents, sort_order)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (svc_id, sec1_id, cat_id, label, qty, uom, complexity, unit_sell, i),
        )

    # ── 3. Section 2 — Entrance & Amenity (28,500 sqft) ─────────────────────
    sec2_id = new_id("sec")
    cur.execute(
        "INSERT INTO estimate_sections (id, estimate_id, name, square_feet, sort_order) "
        "VALUES (%s, %s, %s, %s, %s)",
        (sec2_id, ESTIMATE_ID, "Entrance & Amenity Areas", 28_500, 1),
    )

    for i, (label, frag, qty, uom, rate, complexity) in enumerate(ENTRANCE_SERVICES):
        svc_id = new_id("svc")
        cat_id, billing_type = lookup_catalog_item(cur, frag)
        unit_sell = ONE_TIME_UNIT_PRICES.get(label, rate)
        cur.execute(
            """INSERT INTO section_services
                 (id, section_id, service_kit_id, label, qty, uom,
                  complexity_pct, unit_sell_cents, sort_order)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (svc_id, sec2_id, cat_id, label, qty, uom, complexity, unit_sell, i),
        )

    conn.commit()
    cur.close()
    return ESTIMATE_ID


def main() -> None:
    try:
        conn = pymysql.connect(**DB_CFG)
    except pymysql.err.OperationalError as e:
        print(f"❌  Cannot connect to DB: {e}")
        print("   Is the Cloud SQL proxy running? (python run_dev.py)")
        sys.exit(1)

    try:
        estimate_id = seed(conn)
    finally:
        conn.close()

    print()
    print("✅  Seeded estimate for contract generator test")
    print(f"   Estimate ID : {estimate_id}")
    print()
    print("   Open in the app:")
    print(f"   http://localhost:5174  → Inside Sales → Estimating → find 'Coral Bay HOA — Contract Test'")
    print()
    print("   Or open the proposal preview directly via the estimate detail page.")
    print("   The 'Landscape Maintenance Agreement' chapter appears when lifecycle=approved|won.")
    print()


if __name__ == "__main__":
    main()
