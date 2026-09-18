"""
Seed one fake lead + approved maintenance estimate per rep, so each can log
in and test the proposal generator against their own "My Leads" queue.

Creates, for Rodrigo Leon, Michelle Cady, and Caitlyn Farrell:
  - One manual HOA/commercial lead, assigned_to that rep's user id
  - One maintenance estimate (status=approved, lifecycle=bidding) on a real,
    active branch — deliberately spread across three different branches/legal
    entities so this doubles as coverage for the branch-scoped licenses and
    insurance work (Rodrigo -> Orlando/Juniper FL, Caitlyn -> Fort Myers/Juniper
    FL where Kyle Leverette's credentials live, Michelle -> Houston/Shooter &
    Lindsey Inc, a different legal entity entirely with no branch-specific
    credentials yet — exercises the company-wide-fallback path).
  - Two sections + services, same catalog-item-backed shape as
    seed_contract_estimate.py, so the proposal/contract pages have real content.

Run:
    python scripts/seed_rep_test_leads.py
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

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

# Same services shape as seed_contract_estimate.py (Slice 8's Coral Bay seed) —
# proven catalog_item matches so billing_type + scope_text flow through.
MAIN_SERVICES = [
    ("Mowing & Edging",           "Standard Production Mowing", 12, "/yr",  350, 0.0),
    ("Landscape Bed Maintenance", "Bed Area Maintenance",        12, "/yr",  200, 0.0),
    ("Fertilization",             "Turf Area Fertilization",      4, "/yr",  300, 0.0),
    ("Weed Control",              "Weed Eat",                     6, "/yr",  200, 0.0),
]

ENTRANCE_SERVICES = [
    ("Shrub & Hedge Trimming",    "Prune Medium",                 6, "/yr", 1400, 0.0),
    ("Irrigation System Maint.",  "Common Area Zones",           12, "/yr", 1000, 0.0),
    ("Mulch Application",         "Mulch Per Yard",                1, "/yr",    0, 0.0),
]

ONE_TIME_UNIT_PRICES = {
    "Mulch Application": 420_000,  # $4,200 flat
}

# (rep name fragment for lookup, property name, lead_type, city, state,
#  branch_name LIKE pattern, contract_value_cents)
REPS = [
    ("Rodrigo Leon",     "Sunset Palms HOA",        "HOA",        "Orlando",    "FL",
     "%Orlando%Maintenance%", 3_600_000),
    ("Michelle Cady",    "Bayou Oaks Business Park","commercial", "Houston",    "TX",
     "%Houston%Maintenance%", 5_200_000),
    ("Caitlyn Farrell",  "Egret Cove Community",    "HOA",        "Fort Myers", "FL",
     "%Fort Myers%Maintenance%", 2_900_000),
]


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def lookup_catalog_item(cur, description_fragment: str) -> str | None:
    cur.execute(
        """SELECT id FROM catalog_items
           WHERE description LIKE %s AND active = 1
           LIMIT 1""",
        (f"%{description_fragment}%",),
    )
    row = cur.fetchone()
    if row:
        return row["id"]
    print(f"  ⚠  No catalog_items match for {description_fragment!r}")
    return None


def seed_one(cur, rep_name: str, property_name: str, lead_type: str,
             city: str, state: str, branch_like: str, contract_value_cents: int) -> tuple[str, str]:
    cur.execute("SELECT id FROM users WHERE name = %s", (rep_name,))
    user_row = cur.fetchone()
    if not user_row:
        print(f"❌  No user named {rep_name!r} — skipping.")
        return "", ""
    user_id = user_row["id"]

    cur.execute(
        "SELECT aspire_branch_id FROM branches "
        "WHERE active = 1 AND branch_name LIKE %s ORDER BY aspire_branch_id LIMIT 1",
        (branch_like,),
    )
    branch_row = cur.fetchone()
    if not branch_row:
        print(f"❌  No active branch matching {branch_like!r} — skipping {rep_name}.")
        return "", ""
    aspire_branch_id = branch_row["aspire_branch_id"]

    lead_id = new_id("lead")
    cur.execute(
        """INSERT INTO leads
             (id, source, lead_type, property_name, city, state,
              contact_name, contact_email, status, assigned_to)
           VALUES (%s, 'manual', %s, %s, %s, %s, %s, %s, 'qualified', %s)""",
        (lead_id, lead_type, property_name, city, state,
         rep_name, "carlos.hernandez@juniperlandscaping.com", user_id),
    )

    cur.execute("SELECT COALESCE(MAX(estimate_number), 1000) + 1 AS next_num FROM estimates")
    estimate_number = cur.fetchone()["next_num"]
    estimate_id = new_id("est")

    cur.execute(
        """INSERT INTO estimates
             (id, estimate_type, name, estimate_number,
              client_name, aspire_branch_id, customer_type,
              acreage, contract_value_cents, target_margin,
              status, lifecycle, aspire_owner, priority, win_probability,
              due_back_date, service_start_date, lead_id, notify_bm_rd_on_return)
           VALUES
             (%s, 'maintenance', %s, %s,
              %s, %s, 'commercial',
              6.5, %s, 0.22,
              'approved', 'bidding', 'estimating', 'high', 0.85,
              '2026-10-15', '2027-01-15', %s, 0)""",
        (estimate_id, f"{property_name} — Rep Test", estimate_number,
         property_name, aspire_branch_id, contract_value_cents, lead_id),
    )

    sec1_id = new_id("sec")
    cur.execute(
        "INSERT INTO estimate_sections (id, estimate_id, name, square_feet, sort_order) "
        "VALUES (%s, %s, %s, %s, %s)",
        (sec1_id, estimate_id, "Main Property", 180_000, 0),
    )
    for i, (label, frag, qty, uom, rate, complexity) in enumerate(MAIN_SERVICES):
        cat_id = lookup_catalog_item(cur, frag)
        unit_sell = ONE_TIME_UNIT_PRICES.get(label, rate)
        cur.execute(
            """INSERT INTO section_services
                 (id, section_id, catalog_item_id, label, qty, uom,
                  complexity_pct, unit_sell_cents, sort_order)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (new_id("svc"), sec1_id, cat_id, label, qty, uom, complexity, unit_sell, i),
        )

    sec2_id = new_id("sec")
    cur.execute(
        "INSERT INTO estimate_sections (id, estimate_id, name, square_feet, sort_order) "
        "VALUES (%s, %s, %s, %s, %s)",
        (sec2_id, estimate_id, "Entrance & Amenity Areas", 15_000, 1),
    )
    for i, (label, frag, qty, uom, rate, complexity) in enumerate(ENTRANCE_SERVICES):
        cat_id = lookup_catalog_item(cur, frag)
        unit_sell = ONE_TIME_UNIT_PRICES.get(label, rate)
        cur.execute(
            """INSERT INTO section_services
                 (id, section_id, catalog_item_id, label, qty, uom,
                  complexity_pct, unit_sell_cents, sort_order)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (new_id("svc"), sec2_id, cat_id, label, qty, uom, complexity, unit_sell, i),
        )

    return lead_id, estimate_id


def main() -> None:
    try:
        conn = pymysql.connect(**DB_CFG)
    except pymysql.err.OperationalError as e:
        print(f"❌  Cannot connect to DB: {e}")
        sys.exit(1)

    cur = conn.cursor(pymysql.cursors.DictCursor)
    results = []
    try:
        for rep_name, property_name, lead_type, city, state, branch_like, value in REPS:
            lead_id, estimate_id = seed_one(
                cur, rep_name, property_name, lead_type, city, state, branch_like, value
            )
            if lead_id:
                results.append((rep_name, property_name, lead_id, estimate_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    print()
    print("✅  Seeded rep test leads + estimates")
    for rep_name, property_name, lead_id, estimate_id in results:
        print(f"   {rep_name:<18} {property_name:<28} lead={lead_id}  estimate={estimate_id}")
    print()
    print("   Each rep can log in, open 'My Leads', and find their property to")
    print("   generate a proposal against the attached approved estimate.")


if __name__ == "__main__":
    main()
