#!/usr/bin/env python3
"""Populate crm.properties from Aspire, collapsing Aspire's own duplicates.

Aspire holds the authoritative property list but contains rampant duplicate
rows per real property (same name/address filed under multiple IDs). This
script fetches all Aspire property records, deduplicates them by a normalized
natural key (name + address + city), keeps the most-recently-modified winner,
and upserts one canonical row per real property into crm.properties.

The stable source_id (sha256 of the natural key) means re-runs are fully
idempotent: same key → same source_id → ON DUPLICATE KEY UPDATE touches the
existing row rather than inserting a new one.

Usage (from repo root):
    venv/bin/python scripts/populate_aspire_properties.py            # dry-run
    venv/bin/python scripts/populate_aspire_properties.py --commit   # write

Env vars (same as db.py / scripts/migrate.py):
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
    MYSQL_SOCKET_PATH   — Cloud SQL Auth Proxy socket; overrides host/port
    ASPIRE_ENV          — 'sandbox' (default) or 'prod'
    ASPIRE_CLIENT_ID / ASPIRE_SECRET          (prod)
    ASPIRE_SANDBOX_CLIENT_ID / ASPIRE_SANDBOX_SECRET  (sandbox)
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

# ── repo path so `api.*` is importable when run as a script ───────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import pymysql
import pymysql.cursors

from api.aspire_client import AspireClient


# ── DB connection (mirrors scripts/migrate.py connect()) ─────────────────────

def get_db_conn() -> pymysql.Connection:
    kwargs: dict = dict(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        db=os.environ.get("MYSQL_DB", "crm"),
        autocommit=False,           # we manage our own transaction
        connect_timeout=10,
        cursorclass=pymysql.cursors.DictCursor,
    )
    socket_path = os.environ.get("MYSQL_SOCKET_PATH", "")
    if socket_path:
        kwargs["unix_socket"] = socket_path
        del kwargs["host"]
        del kwargs["port"]
    return pymysql.connect(**kwargs)


# ── Aspire fetch ──────────────────────────────────────────────────────────────

async def fetch_aspire_properties(client: AspireClient) -> list[dict[str, Any]]:
    """Fetch all property records from the Aspire Properties endpoint.

    Field names below are based on Aspire REST API conventions — verify each
    one against a live response before the first --commit run.

    TODO: verify field names against a real Aspire /Properties response.
    """
    # TODO: verify the correct path for the Properties collection.
    # Aspire v2 typically uses /Properties; adjust if the env uses /api/Properties.
    response = await client.get("/Properties")  # VERIFY: correct path

    # Aspire typically wraps list responses in a 'value' or 'Data' key.
    # Fall back to treating the response itself as a list if neither key exists.
    # TODO: verify the response envelope key ('value', 'Data', or bare list).
    if isinstance(response, list):
        records = response
    else:
        records = response.get("value") or response.get("Data") or []  # VERIFY: envelope key

    return records  # type: ignore[return-value]


def _extract_fields(record: dict[str, Any]) -> dict[str, Any]:
    """Pull the fields we care about from one Aspire property record.

    Every field access is annotated with VERIFY — confirm the exact key name
    against a live response before the first --commit run.
    """
    return {
        "property_id":   record.get("PropertyID"),          # VERIFY: Aspire integer PK
        "name":          record.get("PropertyName", ""),    # VERIFY: property display name
        "address":       record.get("Address", ""),         # VERIFY: street address
        "city":          record.get("City", ""),            # VERIFY: city
        "state":         record.get("State", ""),           # VERIFY: 2-char state abbreviation
        "zip":           record.get("Zip", ""),             # VERIFY: zip / postal code
        "branch_name":   record.get("BranchName", ""),      # VERIFY: branch name used as branch_city
        "modified_on":   record.get("ModifiedOn", ""),      # VERIFY: ISO-8601 datetime string
    }


# ── Deduplication ─────────────────────────────────────────────────────────────

def _natural_key(fields: dict[str, Any]) -> str:
    """Normalized composite key: name + address + city (lowercased, stripped)."""
    name    = str(fields["name"]).lower().strip()
    address = str(fields["address"]).lower().strip()
    city    = str(fields["city"]).lower().strip()
    return f"{name}|{address}|{city}"


def _parse_modified_on(raw: str) -> datetime | None:
    """Parse ModifiedOn to a datetime for recency comparison; None on failure."""
    if not raw:
        return None
    # Aspire typically returns ISO-8601; strip trailing Z or offset naively.
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(raw[:19], fmt)
        except ValueError:
            continue
    return None


def _sort_key(fields: dict[str, Any]) -> tuple:
    """Sort key for selecting the winner within a duplicate group.

    Primary: most recent ModifiedOn (descending → negate).
    Fallback: largest PropertyID (descending).
    """
    ts = _parse_modified_on(str(fields.get("modified_on", "")))
    pid = fields.get("property_id") or 0
    # We want the "best" record first after sort(); negate ts by using a
    # comparable that sorts larger values first.
    ts_sort = ts if ts is not None else datetime.min
    return (ts_sort, int(pid) if pid else 0)


def dedup_properties(
    records: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Group records by natural key, keep the most-recent winner per group.

    Returns a mapping  natural_key → winner_fields_dict.
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    for raw in records:
        fields = _extract_fields(raw)
        # Skip completely empty / unnamed records
        if not str(fields["name"]).strip():
            continue
        key = _natural_key(fields)
        groups.setdefault(key, []).append(fields)

    winners: dict[str, dict[str, Any]] = {}
    for key, group in groups.items():
        # Sort descending by (modified_on, property_id); first element wins.
        group.sort(key=_sort_key, reverse=True)
        winner = group[0]
        winner["_natural_key"] = key
        winner["_duplicate_count"] = len(group) - 1   # extras collapsed
        winners[key] = winner
    return winners


def _stable_source_id(natural_key: str) -> str:
    """SHA-256 of the natural key, truncated to 36 chars (fits VARCHAR(36))."""
    return hashlib.sha256(natural_key.encode()).hexdigest()[:36]


# ── Upsert ────────────────────────────────────────────────────────────────────

_UPSERT_SQL = """
INSERT INTO properties
    (id, property_type, source_type, source_id, name, address1,
     city, state, zip, branch_city,
     aspire_property_id, aspire_sync_status, aspire_synced_at)
VALUES
    (%s, %s, 'aspire', %s, %s, %s, %s, %s, %s, %s, %s, 'synced', NOW())
ON DUPLICATE KEY UPDATE
    name                = VALUES(name),
    address1            = VALUES(address1),
    city                = VALUES(city),
    state               = VALUES(state),
    zip                 = VALUES(zip),
    branch_city         = VALUES(branch_city),
    aspire_property_id  = VALUES(aspire_property_id),
    aspire_sync_status  = 'synced',
    aspire_synced_at    = NOW()
""".strip()

_CHECK_EXISTS_SQL = """
SELECT id FROM properties
WHERE source_type = 'aspire' AND source_id = %s
""".strip()


def upsert_properties(
    conn: pymysql.Connection,
    winners: dict[str, dict[str, Any]],
) -> tuple[int, int]:
    """Execute upserts inside the caller's transaction.

    Returns (inserted_count, updated_count).
    """
    inserted = 0
    updated = 0

    with conn.cursor() as cur:
        for natural_key, fields in winners.items():
            source_id = _stable_source_id(natural_key)

            # Check whether the row already exists (to differentiate INSERT vs UPDATE).
            cur.execute(_CHECK_EXISTS_SQL, [source_id])
            existing = cur.fetchone()

            row_id = str(uuid.uuid4())
            cur.execute(
                _UPSERT_SQL,
                [
                    row_id,                                     # id (INSERT only)
                    "hoa",                                      # property_type (default)
                    source_id,                                  # source_id
                    str(fields["name"]).strip()[:255],          # name
                    str(fields["address"]).strip()[:255],       # address1
                    str(fields["city"]).strip()[:100],          # city
                    str(fields["state"]).strip()[:2],           # state
                    str(fields["zip"]).strip()[:20],            # zip
                    str(fields["branch_name"]).strip()[:100] or None,  # branch_city
                    fields["property_id"],                      # aspire_property_id (INT)
                ],
            )
            if existing:
                updated += 1
            else:
                inserted += 1

    return inserted, updated


# ── Reporting ─────────────────────────────────────────────────────────────────

def _print_report(
    *,
    fetched: int,
    unique: int,
    inserted: int,
    updated: int,
    collapsed: int,
    dry_run: bool,
) -> None:
    print(f"Aspire records fetched:  {fetched:>6}")
    print(f"Unique after dedup:      {unique:>6}")
    print(f"Inserted (new):          {inserted:>6}")
    print(f"Updated (existing):      {updated:>6}")
    print(f"Duplicates collapsed:    {collapsed:>6}")
    if dry_run:
        print("Dry-run: no changes written (use --commit to apply)")
    else:
        print("Committed: changes written to crm.properties")


# ── Main ──────────────────────────────────────────────────────────────────────

async def _run(commit: bool) -> None:
    async with AspireClient() as client:
        print("Fetching properties from Aspire...")
        raw_records = await fetch_aspire_properties(client)

    fetched = len(raw_records)
    print(f"Fetched {fetched} records. Deduplicating...")

    winners = dedup_properties(raw_records)
    unique = len(winners)
    collapsed = fetched - unique

    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("BEGIN")

        inserted, updated = upsert_properties(conn, winners)

        if commit:
            conn.commit()
        else:
            conn.rollback()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    _print_report(
        fetched=fetched,
        unique=unique,
        inserted=inserted,
        updated=updated,
        collapsed=collapsed,
        dry_run=not commit,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Populate crm.properties from Aspire, collapsing duplicates. "
            "Dry-run by default — pass --commit to write changes."
        )
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Write changes to the database (default: dry-run with ROLLBACK)",
    )
    args = parser.parse_args()

    asyncio.run(_run(commit=args.commit))


if __name__ == "__main__":
    main()
