"""Assign the standard commission plan to sales users.

One-off admin action. Migration 065 seeds the standard plan. This script
writes user_commission_plans rows. It does not match people by name and it
does not record a migration marker.

Michelle Cady and Rodrigo Leon have their own commission structures and stay
off the standard plan. Look up their users.id values and pass them with
--exclude-user-ids. The flag is repeatable and also accepts a comma-separated
list. Excluded ids are never inserted, in a dry run or with --apply. The
output lists them (id, name, role) separately from the users who would be
assigned. Do not identify them by name in SQL.

    python scripts/assign_standard_commission_plan.py --dry-run \\
        --exclude-user-ids <michelle-user-id>,<rodrigo-user-id>
    python scripts/assign_standard_commission_plan.py --apply \\
        --exclude-user-ids <michelle-user-id> \\
        --exclude-user-ids <rodrigo-user-id>

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
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

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


def parse_exclude_user_ids(values: Sequence[str] | str | None) -> list[str]:
    """User ids from repeatable flags and comma-separated lists.

    A single string is one comma-separated list. Blank pieces are dropped.
    The first occurrence of an id wins.
    """
    if values is None:
        items: Sequence[str] = ()
    elif isinstance(values, str):
        items = (values,)
    else:
        items = values
    seen: set[str] = set()
    ids: list[str] = []
    for raw in items:
        for part in str(raw).split(","):
            user_id = part.strip()
            if not user_id or user_id in seen:
                continue
            seen.add(user_id)
            ids.append(user_id)
    return ids


@dataclass(frozen=True)
class AssignmentResult:
    """Users who receive the standard plan, and users held off it by id."""

    assigned: list[dict]
    excluded: list[dict]


def assign(
    conn,
    *,
    dry_run: bool,
    effective_date: str = EFFECTIVE_DATE,
    exclude_user_ids: Sequence[str] = (),
) -> AssignmentResult:
    """Users who would receive the standard plan. Writes only when dry_run is false.

    A user who already has a plan row on effective_date is skipped. The unique
    key on (user_id, effective_date) makes a repeat insert a no-op.

    exclude_user_ids are matched as users.id values, never as names. Those
    users are omitted from the insert in both dry-run and apply mode. They
    are returned on AssignmentResult.excluded with id, name, and role.
    """
    excluded_ids = parse_exclude_user_ids(exclude_user_ids)
    excluded_set = set(excluded_ids)
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
        candidates = list(cur.fetchall())
        pending = [user for user in candidates if user["id"] not in excluded_set]
        excluded = _excluded_users(cur, excluded_ids)
        if not dry_run:
            for user in pending:
                cur.execute(
                    """
                    INSERT IGNORE INTO user_commission_plans
                        (id, user_id, plan_key, effective_date)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (str(uuid.uuid4()), user["id"], PLAN_KEY, effective_date),
                )
    if not dry_run and not conn.get_autocommit():
        conn.commit()
    return AssignmentResult(assigned=pending, excluded=excluded)


def _excluded_users(cur, excluded_ids: list[str]) -> list[dict]:
    """Look up excluded ids. Missing ids stay in the list with a null name and role."""
    if not excluded_ids:
        return []
    placeholders = ", ".join(["%s"] * len(excluded_ids))
    cur.execute(
        f"""
        SELECT u.id, u.name, u.role
        FROM users u
        WHERE u.id IN ({placeholders})
        """,
        tuple(excluded_ids),
    )
    by_id = {row["id"]: row for row in cur.fetchall()}
    listed = []
    for user_id in excluded_ids:
        row = by_id.get(user_id)
        if row is None:
            listed.append({"id": user_id, "name": None, "role": None})
        else:
            listed.append({"id": row["id"], "name": row["name"], "role": row["role"]})
    return listed


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
    parser.add_argument(
        "--exclude-user-ids",
        action="append",
        default=[],
        metavar="USER_ID",
        help=(
            "users.id values to leave off the standard plan. Repeat the flag "
            "or pass a comma-separated list. Michelle Cady and Rodrigo Leon "
            "have their own commission structures; pass their user ids."
        ),
    )
    args = parser.parse_args(argv)
    if args.apply and args.dry_run:
        parser.error("pass only one of --apply and --dry-run")
    dry_run = not args.apply
    exclude_user_ids = parse_exclude_user_ids(args.exclude_user_ids)
    conn = _connect()
    try:
        result = assign(
            conn,
            dry_run=dry_run,
            effective_date=args.effective_date,
            exclude_user_ids=exclude_user_ids,
        )
    finally:
        conn.close()
    _print_result(result, dry_run=dry_run, effective_date=args.effective_date)
    return 0


def _print_result(result: AssignmentResult, *, dry_run: bool, effective_date: str) -> None:
    label = "would assign" if dry_run else "assigned"
    print(f"{label} {len(result.assigned)} user(s) to plan {PLAN_KEY} effective {effective_date}")
    for user in result.assigned:
        print(f"  {user['id']} {user['name']} ({user['role']})")
    print(f"excluded {len(result.excluded)} user(s)")
    for user in result.excluded:
        print(f"  {user['id']} {user['name']} ({user['role']})")


if __name__ == "__main__":
    raise SystemExit(main())
