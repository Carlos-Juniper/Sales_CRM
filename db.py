"""Database access layer — thin aiomysql wrapper used by api/server.py."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any

import aiomysql

_pool: aiomysql.Pool | None = None
# Set for the duration of transaction() so query/execute share that connection.
_conn_ctx: ContextVar[aiomysql.Connection | None] = ContextVar("db_conn", default=None)


def _cfg() -> dict:
    cfg: dict[str, Any] = dict(
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        db=os.environ.get("MYSQL_DB", "crm"),
        autocommit=True,
        cursorclass=aiomysql.DictCursor,
    )
    socket_path = os.environ.get("MYSQL_SOCKET_PATH")
    if socket_path:
        cfg["unix_socket"] = socket_path
    else:
        cfg["host"] = os.environ.get("MYSQL_HOST", "127.0.0.1")
        cfg["port"] = int(os.environ.get("MYSQL_PORT", "3306"))
    return cfg


async def _get_pool() -> aiomysql.Pool:
    global _pool
    if _pool is None:
        _pool = await aiomysql.create_pool(minsize=1, maxsize=10, **_cfg())
    return _pool


async def _run_on(conn: aiomysql.Connection, sql: str, params: list | None, *, fetch: bool):
    async with conn.cursor() as cur:
        # Pass None (not []) when there are no params so aiomysql skips
        # %-substitution — otherwise a literal % in the SQL (LIKE, DATE_FORMAT)
        # raises "not enough arguments for format string".
        await cur.execute(sql, params if params else None)
        if fetch:
            return await cur.fetchall()
        return cur.rowcount


async def query(sql: str, params: list | None = None) -> list[dict]:
    conn = _conn_ctx.get()
    if conn is not None:
        return await _run_on(conn, sql, params, fetch=True)
    pool = await _get_pool()
    async with pool.acquire() as acquired:
        return await _run_on(acquired, sql, params, fetch=True)


async def execute(sql: str, params: list | None = None) -> int:
    conn = _conn_ctx.get()
    if conn is not None:
        return await _run_on(conn, sql, params, fetch=False)
    pool = await _get_pool()
    async with pool.acquire() as acquired:
        return await _run_on(acquired, sql, params, fetch=False)


@asynccontextmanager
async def transaction():
    """Run query and execute on one connection inside an explicit transaction.

    The pool uses autocommit, so a multi-statement write has to begin and
    commit itself. A failure rolls the connection back before the error
    propagates.
    """
    pool = await _get_pool()
    async with pool.acquire() as conn:
        await conn.begin()
        token = _conn_ctx.set(conn)
        try:
            yield conn
            await conn.commit()
        except BaseException:
            await conn.rollback()
            raise
        finally:
            _conn_ctx.reset(token)


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


# run_migrations() removed — schema is now managed by scripts/migrate.py.


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
