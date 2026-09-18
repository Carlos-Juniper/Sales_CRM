"""
Seed branch managers into `users` (role='manager'), from a Word-doc roster of
full name / email / branch city supplied by Carlos.

Follows the same shape as api/settings.py's authorize_user endpoint:
  INSERT INTO users (id, email, name, role, active, aspire_rep_id)
  VALUES (uuid, lower(email), name, 'manager', 1, NULL)
then a user_branches row per (user_id, aspire_branch_id) — NOT users.branch_id,
which the authorize flow no longer writes (branch scoping is user_branches-only,
see api/authz.py).

Several roster cities (Fort Myers, Bradenton, Venice, Tampa North) have both
an Install and a Maintenance Aspire branch. Per Carlos (2026-09-18): don't
split "Associate Branch Manager" vs "Branch Manager" into different roles —
everyone in the roster is role='manager' — and every manager is scoped to
BOTH the Install and Maintenance branch at their city, not just one.

Usage:
    python scripts/seed_branch_managers.py            # dry run (default, no writes)
    python scripts/seed_branch_managers.py --apply     # actually insert
"""
from __future__ import annotations

import argparse
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
    connect_timeout=10,
)

# (full name, email, branch city label as it appears in the roster doc)
# Garth Rinard's email was cut off in the source doc; Carlos confirmed
# (2026-09-18) it follows the same firstname.lastname pattern as everyone else.
ROSTER = [
    ("Matt Hammond",       "matt.hammond@juniperlandscaping.com",     "Bonita Springs"),
    ("Brennen Garrett",    "brennen.garrett@juniperlandscaping.com",  "Fort Myers"),
    ("Alberto Toucet",     "alberto.toucet@juniperlandscaping.com",   "Fort Myers"),
    ("Catarino Martinez",  "catarino.martinez@juniperlandscaping.com","Naples"),
    ("Eddie Tanguay",      "edward.tanguay@juniperlandscaping.com",   "Venice"),
    ("Roger Kelley",       "Roger@JuniperLandscaping.com",            "Estero"),
    ("Diego Cantu",        "Diego.Cantu@juniperlandscaping.com",      "Bradenton"),
    ("Todd Ruggles",       "Todd.Ruggles@juniperlandscaping.com",     "Bradenton"),
    ("Matthew Gerich",     "matt.gerich@juniperlandscaping.com",      "Tampa North"),
    ("Juan Nova",          "juan.nova@juniperlandscaping.com",        "Tampa South"),
    ("Garth Rinard",       "garth.rinard@juniperlandscaping.com",     "Tampa East"),
]

ROLE = "manager"


def avatar_initials(name: str) -> str:
    parts = name.split()
    return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else parts[0][:2].upper()


def find_branch_candidates(cur, city_label: str) -> list[dict]:
    """Active, operating Aspire branches whose name matches this roster label.

    Matches on branch_name only, NOT the city column: several branches' address
    city differs from the branch's own name (e.g. Estero Maintenance's address
    city is "Fort Myers"), which produced false-positive matches when city was
    included.
    """
    cur.execute(
        """SELECT aspire_branch_id, branch_name, city, state, manager_name
             FROM branches
            WHERE active = 1 AND is_operating_branch = 1
              AND branch_name LIKE %s
            ORDER BY aspire_branch_id""",
        (f"%{city_label}%",),
    )
    return cur.fetchall()


def existing_user(cur, email: str) -> dict | None:
    if not email:
        return None
    cur.execute("SELECT id, name, email, role, active FROM users WHERE LOWER(email) = %s",
                (email.lower(),))
    return cur.fetchone()


def plan(cur) -> list[dict]:
    rows = []
    for name, email, city_label in ROSTER:
        row = {"name": name, "email": email, "city": city_label}

        if not email:
            row["action"] = "NEEDS INPUT"
            row["reason"] = "missing email in source doc"
            rows.append(row)
            continue

        dupe = existing_user(cur, email)
        if dupe:
            row["action"] = "SKIP"
            row["reason"] = f"user already exists (id={dupe['id']}, role={dupe['role']}, active={dupe['active']})"
            rows.append(row)
            continue

        candidates = find_branch_candidates(cur, city_label)
        if not candidates:
            row["action"] = "NEEDS INPUT"
            row["reason"] = f"no active operating branch found matching {city_label!r}"
            rows.append(row)
            continue

        # Per Carlos (2026-09-18): scope every manager to ALL branches at their
        # city (Install + Maintenance where both exist) — no per-branch split.
        row["action"] = "CREATE"
        row["reason"] = "ok"
        row["branches"] = candidates
        rows.append(row)
    return rows


def print_plan(rows: list[dict]) -> None:
    print(f"{'ACTION':<12} {'NAME':<20} {'EMAIL':<38} {'CITY':<15} DETAIL")
    print("-" * 120)
    for r in rows:
        detail = r["reason"]
        if r["action"] == "CREATE":
            branch_desc = ", ".join(f"{b['aspire_branch_id']} {b['branch_name']!r}" for b in r["branches"])
            detail = f"-> user_branches: {branch_desc}, role={ROLE!r}"
        print(f"{r['action']:<12} {r['name']:<20} {r['email'] or '(missing)':<38} {r['city']:<15} {detail}")
    print("-" * 120)
    n_create = sum(1 for r in rows if r["action"] == "CREATE")
    n_skip = sum(1 for r in rows if r["action"] == "SKIP")
    n_needs = sum(1 for r in rows if r["action"] == "NEEDS INPUT")
    print(f"{n_create} to create, {n_skip} to skip (already exist), {n_needs} need input before they can run.")


def apply_plan(conn, cur, rows: list[dict]) -> None:
    created = []
    for r in rows:
        if r["action"] != "CREATE":
            continue
        user_id = str(uuid.uuid4())
        email = r["email"].strip().lower()
        cur.execute(
            """INSERT INTO users (id, email, name, role, active, aspire_rep_id, avatar_initials)
                 VALUES (%s, %s, %s, %s, 1, NULL, %s)""",
            (user_id, email, r["name"], ROLE, avatar_initials(r["name"])),
        )
        branch_ids = [b["aspire_branch_id"] for b in r["branches"]]
        for branch_id in branch_ids:
            cur.execute(
                "INSERT INTO user_branches (user_id, aspire_branch_id) VALUES (%s, %s)",
                (user_id, branch_id),
            )
        created.append((r["name"], email, user_id, branch_ids))
    conn.commit()
    for name, email, user_id, branch_ids in created:
        print(f"  created {name} <{email}> id={user_id} branches={branch_ids}")
    print(f"Committed {len(created)} new users.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually write; default is dry-run")
    args = ap.parse_args()

    print(f"Target DB: {DB_CFG['host']}:{DB_CFG['port']}/{DB_CFG['db']} as {DB_CFG['user']}")
    conn = pymysql.connect(cursorclass=pymysql.cursors.DictCursor, **DB_CFG)
    try:
        cur = conn.cursor()
        rows = plan(cur)
        print_plan(rows)

        if not args.apply:
            print("\nDry run only — no writes made. Re-run with --apply once NEEDS INPUT rows are resolved.")
            return

        blocking = [r for r in rows if r["action"] == "NEEDS INPUT"]
        if blocking:
            print(f"\n{len(blocking)} row(s) still need input — refusing to apply until resolved.")
            sys.exit(1)

        apply_plan(conn, cur, rows)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
