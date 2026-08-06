"""
One-off migration: KMS-encrypt any pre-existing plaintext rows in
user_graph_tokens (access_token / refresh_token) so api/graph.py's
_decrypt() stops hitting the "not KMS-encrypted" fallback path.

Idempotent: rows already carrying the "v1:" prefix (api.graph._CIPHERTEXT_PREFIX)
are left untouched, so this is safe to run more than once.

Defaults to a dry run — it reports which rows would be re-encrypted without
writing anything. Pass --commit to actually perform the UPDATEs.

Usage:
  # against whatever MYSQL_HOST/PORT/USER/PASSWORD/DB + KMS_GRAPH_TOKEN_KEY
  # are set in the environment (e.g. a local Cloud SQL Auth Proxy pointed at
  # the target instance):
  python -m scripts.migrate_encrypt_tokens          # dry run
  python -m scripts.migrate_encrypt_tokens --commit # actually re-encrypt
"""
from __future__ import annotations

import argparse
import asyncio
import logging

from api.graph import _CIPHERTEXT_PREFIX, _encrypt
from db import execute, query

logger = logging.getLogger(__name__)


async def _find_unmigrated_rows() -> list[dict]:
    return await query(
        """
        SELECT user_id, access_token, refresh_token
        FROM user_graph_tokens
        WHERE access_token NOT LIKE %s
           OR refresh_token NOT LIKE %s
        """,
        [f"{_CIPHERTEXT_PREFIX}%", f"{_CIPHERTEXT_PREFIX}%"],
    )


async def _migrate_row(row: dict) -> None:
    access_token = row["access_token"]
    refresh_token = row["refresh_token"]
    new_access = access_token if access_token.startswith(_CIPHERTEXT_PREFIX) else _encrypt(access_token)
    new_refresh = refresh_token if refresh_token.startswith(_CIPHERTEXT_PREFIX) else _encrypt(refresh_token)
    await execute(
        "UPDATE user_graph_tokens SET access_token = %s, refresh_token = %s WHERE user_id = %s",
        [new_access, new_refresh, row["user_id"]],
    )


async def run(commit: bool) -> None:
    rows = await _find_unmigrated_rows()
    if not rows:
        print("No unmigrated rows found — nothing to do.")
        return

    print(f"Found {len(rows)} row(s) with a plaintext access_token or refresh_token:")
    for row in rows:
        print(f"  user_id={row['user_id']}")

    if not commit:
        print("\nDry run only — no rows were changed. Re-run with --commit to encrypt these rows.")
        return

    for row in rows:
        await _migrate_row(row)
    print(f"\nRe-encrypted {len(rows)} row(s).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Actually re-encrypt and write rows. Without this flag, only reports what would change.",
    )
    args = parser.parse_args()
    asyncio.run(run(commit=args.commit))


if __name__ == "__main__":
    main()
