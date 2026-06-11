"""
Provision a password for a CRM user.

Usage:
    python -m api.seed_auth --email carlos.hernandez@juniperlandscaping.com --password <secret>

The script inserts or replaces the crm_logins row for the given user.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from datetime import datetime, timezone

import bcrypt
import aiomysql

from db import get_pool

BCRYPT_ROUNDS = 12


async def provision(email: str, password: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id FROM crm_users WHERE email = %s",
                (email,),
            )
            row = await cur.fetchone()
            if not row:
                print(f"ERROR: No user found with email {email!r}", file=sys.stderr)
                sys.exit(1)

            user_id: str = row["id"]
            password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()
            # Scrub from local scope immediately after hashing
            password = ""  # noqa: F841 — intentional zero-out

            now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
            await cur.execute(
                """
                INSERT INTO crm_logins (user_id, password_hash, failed_attempts, locked_until, last_login, updated_at)
                VALUES (%s, %s, 0, NULL, NULL, %s) AS new_vals
                ON DUPLICATE KEY UPDATE
                    password_hash   = new_vals.password_hash,
                    failed_attempts = 0,
                    locked_until    = NULL,
                    updated_at      = new_vals.updated_at
                """,
                (user_id, password_hash, now_utc),
            )

    print(f"Password set for {email} (user_id={user_id})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision a CRM user password")
    parser.add_argument("--email", required=True, help="User email address")
    parser.add_argument("--password", default=None, help="Password (omit to prompt securely)")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Password: ")
    if not password:
        print("ERROR: Password cannot be empty", file=sys.stderr)
        sys.exit(1)

    asyncio.run(provision(args.email, password))


if __name__ == "__main__":
    main()
