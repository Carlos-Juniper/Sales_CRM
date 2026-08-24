"""Database access layer — thin aiomysql wrapper used by api/server.py."""
from __future__ import annotations

import os
from typing import Any

import aiomysql

_pool: aiomysql.Pool | None = None


def _cfg() -> dict:
    return dict(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        db=os.environ.get("MYSQL_DB", "crm"),
        autocommit=True,
        cursorclass=aiomysql.DictCursor,
    )


async def _get_pool() -> aiomysql.Pool:
    global _pool
    if _pool is None:
        _pool = await aiomysql.create_pool(minsize=1, maxsize=10, **_cfg())
    return _pool


async def query(sql: str, params: list | None = None) -> list[dict]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Pass None (not []) when there are no params so aiomysql skips
            # %-substitution — otherwise a literal % in the SQL (LIKE, DATE_FORMAT)
            # raises "not enough arguments for format string".
            await cur.execute(sql, params if params else None)
            return await cur.fetchall()


async def execute(sql: str, params: list | None = None) -> int:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params if params else None)
            return cur.rowcount


def _in_clause(values: list) -> tuple[str, list]:
    placeholders = ", ".join(["%s"] * len(values))
    return placeholders, list(values)


async def set_hoa_property_status(hoa_property_id: str, status: str) -> None:
    await execute(
        "UPDATE hoa_properties SET status = %s, updated_at = CURRENT_TIMESTAMP() WHERE id = %s",
        [status, hoa_property_id],
    )


async def count_active_leads_for_property(property_id: str) -> int:
    """Active (non-won, non-lost) leads for a canonical properties.id."""
    rows = await query(
        "SELECT COUNT(*) AS cnt FROM leads WHERE property_id = %s AND status NOT IN ('won', 'lost') AND deleted_at IS NULL",
        [property_id],
    )
    return rows[0]["cnt"] if rows else 0


async def has_won_lead_for_property(property_id: str) -> bool:
    """Whether a won lead exists for a canonical properties.id."""
    rows = await query(
        "SELECT 1 FROM leads WHERE property_id = %s AND status = 'won' AND deleted_at IS NULL LIMIT 1",
        [property_id],
    )
    return bool(rows)


async def run_migrations() -> None:
    """No-op: schema managed via sql/ files applied manually.

    Migrations are hand-run against the `crm` database — see
    sql/migrations/README.md (numbered .sql files, no `juniper.` prefix).
    """


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
