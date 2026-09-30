"""Migration 072: materials.item_status, with active generated from it.

Unit checks lock the file number, detector, and rollback. The DB check
applies 072 over a populated 070 materials table in the
crm_materials_loader_test scratch schema (skips without it): backfill,
generated active, re-run, rollback, re-apply.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pymysql
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.migrate as M  # noqa: E402
from tests.test_load_materials_catalog import (  # noqa: E402
    MIGRATION as MIGRATION_070,
    MIGRATION_072 as MIGRATION,
    PRE_070,
    SCRATCH_DB,
    _RESET,
    _apply_070_072,
    _connect,
)

ROLLBACK = REPO / "sql" / "rollbacks" / "072_materials_item_status_down.sql"


def test_file_is_072_and_registered():
    ids = [mid for mid, _ in M.migration_files()]
    assert "072_materials_item_status" in ids
    assert ids == sorted(ids)
    assert M._DETECT["072_materials_item_status"] is M.detect_072


def test_rollback_restores_plain_active_and_clears_tracking_row():
    text = ROLLBACK.read_text(encoding="utf-8")
    assert "DELETE FROM schema_migrations WHERE id = ''072_materials_item_status''" in text
    assert "DROP COLUMN item_status" in text
    assert "UPPER(EXTRA) LIKE '%GENERATED%'" in text
    ids = [mid for mid, _ in M.migration_files()]
    assert not any("down" in mid for mid in ids)


def test_nothing_needs_super():
    upper = "\n".join(M.split_statements(MIGRATION.read_text(encoding="utf-8"))).upper()
    for kind in ("TRIGGER", "FUNCTION", "PROCEDURE", "EVENT"):
        assert f"CREATE {kind}" not in upper
    assert "DELIMITER" not in upper


def _run(conn, path: Path | str) -> None:
    text = path.read_text(encoding="utf-8") if isinstance(path, Path) else path
    with conn.cursor() as cur:
        for stmt in M.split_statements(text):
            cur.execute(stmt)
    conn.commit()


def _rows(conn) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute("SELECT inventory_id, active FROM materials ORDER BY inventory_id")
        return [(r["inventory_id"], r["active"]) for r in cur.fetchall()]


def test_apply_over_070_rows_then_roll_back():
    try:
        conn = _connect()
    except pymysql.err.OperationalError as exc:
        pytest.skip(f"{SCRATCH_DB} is not reachable: {exc}")
    try:
        _run(conn, _RESET + PRE_070)
        _run(conn, MIGRATION_070)
        _run(conn, "INSERT INTO materials (inventory_id, description, is_stock_item, active) "
                   "VALUES ('1000000001', 'On', 1, 1), ('1000000002', 'Off', 1, 0)")
        assert M.detect_072(conn) is False

        _run(conn, MIGRATION)
        assert M.detect_072(conn) is True
        assert M.column_is_generated(conn, "materials", "active") is True
        with conn.cursor() as cur:
            cur.execute("SELECT inventory_id, item_status FROM materials ORDER BY inventory_id")
            assert [r["item_status"] for r in cur.fetchall()] == ["Active", "Inactive"]
            cur.execute("UPDATE materials SET item_status = 'No Purchases' WHERE inventory_id = '1000000001'")
        conn.commit()
        assert _rows(conn) == [("1000000001", 0), ("1000000002", 0)]
        _run(conn, MIGRATION)  # re-run is a no-op
        assert M.detect_072(conn) is True

        _run(conn, ROLLBACK)
        assert M.detect_072(conn) is False
        assert M.column_is_generated(conn, "materials", "active") is False
        assert M.index_exists(conn, "materials", "idx_materials_bid_active")
        assert _rows(conn) == [("1000000001", 0), ("1000000002", 0)]
        _run(conn, ROLLBACK)  # idempotent

        _run(conn, MIGRATION)
        assert M.detect_072(conn) is True
    finally:
        _apply_070_072(conn)
        conn.close()
