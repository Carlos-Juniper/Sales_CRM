"""
Onboard or update a CRM user (no password — auth is Microsoft Entra SSO only).

Identity is proven by Entra SSO at login, but there is NO auto-provisioning:
``entra_callback`` returns 403 "User not provisioned" when no ``users`` row
matches the token's email. Every user must be onboarded with this script first.
Re-running it also changes an existing user's role or branch_id (e.g., promote
to manager, add branch scoping).

This writes to the SAME store the SSO callback reads from — the GCP Cloud SQL
MySQL ``users`` table, via the shared ``query``/``execute`` helpers. That is
deliberate: ``entra_callback`` authorizes users by reading ``users`` from MySQL,
so updates must write there too.
(The BigQuery users table is no longer in use.)

Usage:
    # Promote a user to manager with a branch:
    python -m api.seed_auth --email jane.doe@juniperlandscaping.com \
        --name "Jane Doe" --role manager --branch-id b1

    # Onboard an inside sales rep without a branch (branch_id is nullable):
    python -m api.seed_auth --email pat.lee@juniperlandscaping.com \
        --name "Pat Lee" --role inside_sales

Running this script again for the same email updates that user's name/role/branch
(upsert keyed on the normalized email), so it's an "edit role or branch" tool
that avoids duplicates.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from typing import Optional

from db import execute, query
from api.authz import CANONICAL_ROLES, normalize_role

# The ten canonical business roles (single role vocabulary).
# The legacy input `outside_sales` is accepted and stored as `sales`.
VALID_ROLES = CANONICAL_ROLES

# Roles that require a branch_id. Managers are scoped to a branch; other roles
# may be provisioned without one (branch_id is nullable in crm_users).
BRANCH_REQUIRED_ROLES = {"manager"}


def _avatar_initials(name: str) -> str:
    """First letter of the first two words, uppercased (crm_users caps at 5)."""
    parts = [p for p in name.split() if p]
    initials = "".join(p[0] for p in parts[:2]).upper()
    return initials[:5]


async def provision(
    email: str,
    name: str,
    role: str,
    branch_id: Optional[str] = None,
    avatar_initials: Optional[str] = None,
) -> None:
    role = normalize_role(role)  # legacy inside_sales/outside_sales → sales
    if role not in VALID_ROLES:
        raise ValueError(
            f"Unknown role {role!r}. Valid roles: {', '.join(sorted(VALID_ROLES))}."
        )
    if role in BRANCH_REQUIRED_ROLES and not branch_id:
        raise ValueError(f"role {role!r} requires a branch_id.")

    # Emails are the join key between Entra claims and crm_users. Entra token
    # casing is not something we control, so normalize to lowercase on write to
    # match the lowercased lookup in entra_callback — otherwise a casing
    # mismatch 403s a user who was in fact onboarded.
    email = email.strip().lower()
    name = name.strip()
    if not name:
        raise ValueError("name cannot be empty.")

    if not avatar_initials:
        avatar_initials = _avatar_initials(name) or name[:1].upper()

    # SELECT-then-INSERT/UPDATE mirrors the upsert helpers in db.py (upsert_lead,
    # upsert_hoa_property). Keyed on the normalized email so a re-run updates the
    # existing row (keeping its original id) instead of inserting a duplicate.
    existing = await query(
        "SELECT id FROM users WHERE LOWER(email) = %s LIMIT 1",
        [email],
    )

    if existing:
        affected = await execute(
            "UPDATE users SET name = %s, role = %s, branch_id = %s, avatar_initials = %s WHERE id = %s",
            [name, role, branch_id, avatar_initials, existing[0]["id"]],
        )
        action = "Updated"
    else:
        affected = await execute(
            "INSERT INTO users (id, name, email, role, branch_id, avatar_initials, created_at) VALUES (%s, %s, %s, %s, %s, %s, NOW())",
            [str(uuid.uuid4()), name, email, role, branch_id, avatar_initials],
        )
        action = "Created"

    if not affected:
        raise RuntimeError(
            f"Onboarding {email} affected 0 rows — the crm_users write did not land."
        )

    print(f"{action} {email} (name={name!r}, role={role}, branch_id={branch_id})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Onboard a CRM user (role + branch)")
    parser.add_argument("--email", required=True, help="User email (must match their Microsoft account)")
    parser.add_argument("--name", required=True, help='Display name, e.g. "Jane Doe"')
    parser.add_argument("--role", required=True, help=f"One of: {', '.join(sorted(VALID_ROLES))}")
    parser.add_argument("--branch-id", default=None, help="Branch id (required for managers)")
    parser.add_argument("--avatar-initials", default=None, help="Override avatar initials (max 5 chars); auto-derived from name if omitted")
    args = parser.parse_args()

    try:
        asyncio.run(provision(args.email, args.name, args.role, args.branch_id, args.avatar_initials))
    except (ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
