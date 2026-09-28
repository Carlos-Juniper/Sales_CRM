"""Assign the standard commission plan to sales users.

One-off admin action. Migration 065 seeds the standard plan. This script
writes user_commission_plans rows. It does not match people by name and it
does not record a migration marker.

Roles come from authz.SALES_REP_DB_ROLES. vp_sales is included as well.
PR #39 (cursor/add-sales-roles-1503) adds vp_sales to that tuple. Until that
branch merges, this script appends the role so a vp_sales user is assigned
once the role exists, and matches nobody extra before then.

Default is a dry run. Pass --apply to insert.

    python scripts/assign_standard_commission_plan.py
    python scripts/assign_standard_commission_plan.py --dry-run
    python scripts/assign_standard_commission_plan.py --apply
"""
from __future__ import annotations

import argparse
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())

import pymysql  # noqa: E402
import pymysql.cursors  # noqa: E402

from api.authz import SALES_REP_DB_ROLES  # noqa: E402

EFFECTIVE_DATE = "2026-09-25"
PLAN_KEY = "standard"


def assignment_roles() -> tuple[str, ...]:
    """Sales-rep roles, plus vp_sales when that role is not in the tuple yet."""
    roles = list(SALES_REP_DB_ROLES)
    if "vp_sales" not in roles:
        roles.append("vp_sales")
    return tuple(roles)


def assign(conn, *, dry_run: bool, effective_date: str = EFFECTIVE_DATE) -> list[dict]:
    """Users who would receive the standard plan. Writes only when dry_run is false.

    A user who already has a plan row on effective_date is skipped. The unique
    key on (user_id, effective_date) makes a repeat insert a no-op.
    """
    roles = assignment_roles()
    placeholders = ", ".join(["%s"] * len(roles))
    with conn.cursor() as cur:
        cur.execute("SELECT plan_key FROM commission_plans WHERE plan_key = %s", (PLAN_KEY,))
        if cur.fetchone() is None:
            raise RuntimeError("standard plan is missing; apply migration 065 first")
        cur.execute(
            f"""
            SELECT u.id, u.name, u.role
            FROM users u
            WHERE u.role IN ({placeholders})
              AND NOT EXISTS (
                SELECT 1 FROM user_commission_plans existing
                WHERE existing.user_id = u.id
                  AND existing.effective_date = %s
              )
            ORDER BY u.name
            """,
            (*roles, effective_date),
        )
        pending = list(cur.fetchall())
        if dry_run:
            return pending
        for user in pending:
            cur.execute(
                """
                INSERT IGNORE INTO user_commission_plans
                    (id, user_id, plan_key, effective_date)
                VALUES (%s, %s, %s, %s)
                """,
                (str(uuid.uuid4()), user["id"], PLAN_KEY, effective_date),
            )
    if not conn.get_autocommit():
        conn.commit()
    return pending


def _connect():
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        db=os.environ.get("MYSQL_DB", "crm"),
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the users who would be assigned and write nothing",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Insert standard-plan rows for sales users",
    )
    parser.add_argument("--effective-date", default=EFFECTIVE_DATE)
    args = parser.parse_args(argv)
    if args.apply and args.dry_run:
        parser.error("pass only one of --apply and --dry-run")
    dry_run = not args.apply
    conn = _connect()
    try:
        pending = assign(conn, dry_run=dry_run, effective_date=args.effective_date)
    finally:
        conn.close()
    label = "would assign" if dry_run else "assigned"
    print(f"{label} {len(pending)} user(s) to plan {PLAN_KEY} effective {args.effective_date}")
    for user in pending:
        print(f"  {user['name']} ({user['role']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
