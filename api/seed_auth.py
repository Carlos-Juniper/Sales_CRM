"""
Onboard a CRM user (no password — auth is Microsoft Entra SSO only).

Identity is proven by Entra SSO at login; this script provisions the
*authorization* half: the crm_users row that grants a Microsoft-authenticated
user their `role` (which parts of the app they see) and `branch_id` (data
scoping). A Microsoft account with no crm_users row cannot sign in (403), so
this is the one manual onboarding step per user.

This writes to the SAME store the SSO callback reads from — the BigQuery
`users` table (referenced as ``T('users')``), via the shared ``query``/
``execute`` helpers. That is deliberate: ``entra_callback`` authorizes users by
reading ``T('users')`` from BigQuery, so onboarding must write there too.
(The MySQL password/credential store is gone with manual login.)

Usage:
    python -m api.seed_auth --email jane.doe@juniperlandscaping.com \
        --name "Jane Doe" --role inside_sales --branch-id b1

    # non-manager without a branch (branch_id is nullable for these roles):
    python -m api.seed_auth --email pat.lee@juniperlandscaping.com \
        --name "Pat Lee" --role outside_sales

Re-running for the same email updates that user's name/role/branch (upsert
keyed on the normalized email), so it doubles as a "fix a role or branch" tool
without creating duplicates.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from typing import Optional

from db import P, T, execute, query

# Roles the frontend routes on (studio LoginPage / AuthCallbackPage).
# Keep in sync with roleDefaultRoute().
VALID_ROLES = {"inside_sales", "outside_sales", "manager"}

# Roles that require a branch_id. Managers are scoped to a branch; other roles
# may be provisioned without one (branch_id is nullable in crm_users).
BRANCH_REQUIRED_ROLES = {"manager"}


def _avatar_initials(name: str) -> str:
    """First letter of the first two words, uppercased (crm_users caps at 5)."""
    parts = [p for p in name.split() if p]
    initials = "".join(p[0] for p in parts[:2]).upper()
    return initials[:5]


async def provision(email: str, name: str, role: str, branch_id: Optional[str] = None) -> None:
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

    avatar_initials = _avatar_initials(name) or name[:1].upper()

    # SELECT-then-INSERT/UPDATE mirrors the upsert helpers in db.py (upsert_lead,
    # upsert_hoa_property). Keyed on the normalized email so a re-run updates the
    # existing row (keeping its original id) instead of inserting a duplicate.
    existing = await query(
        f"SELECT id FROM {T('users')} WHERE LOWER(email) = @email LIMIT 1",
        [P("email", "STRING", email)],
    )

    if existing:
        affected = await execute(
            f"""
            UPDATE {T('users')} SET
                name            = @name,
                role            = @role,
                branch_id       = @branch_id,
                avatar_initials = @avatar_initials
            WHERE id = @id
            """,
            [
                P("name", "STRING", name),
                P("role", "STRING", role),
                P("branch_id", "STRING", branch_id),
                P("avatar_initials", "STRING", avatar_initials),
                P("id", "STRING", existing[0]["id"]),
            ],
        )
        action = "Updated"
    else:
        affected = await execute(
            f"""
            INSERT INTO {T('users')}
                (id, name, email, role, branch_id, avatar_initials, created_at)
            VALUES
                (@id, @name, @email, @role, @branch_id, @avatar_initials, CURRENT_TIMESTAMP())
            """,
            [
                P("id", "STRING", str(uuid.uuid4())),
                P("name", "STRING", name),
                P("email", "STRING", email),
                P("role", "STRING", role),
                P("branch_id", "STRING", branch_id),
                P("avatar_initials", "STRING", avatar_initials),
            ],
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
    args = parser.parse_args()

    try:
        asyncio.run(provision(args.email, args.name, args.role, args.branch_id))
    except (ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
