"""Migration 070: materials item master and cost history.

Unit checks do not need a database. They lock the file number, the detector,
the table names, and the price-history trigger. Applying the SQL against
MariaDB is covered by the materials loader test.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.migrate as M  # noqa: E402

MIGRATION = REPO / "sql" / "migrations" / "070_materials_catalog.sql"
ROLLBACK = REPO / "sql" / "rollbacks" / "070_materials_catalog_down.sql"


def _executable() -> str:
    return "\n".join(M.split_statements(MIGRATION.read_text(encoding="utf-8")))


class TestMigration070File:
    def test_file_is_070_and_registered(self):
        assert MIGRATION.exists()
        ids = [mid for mid, _ in M.migration_files()]
        assert "070_materials_catalog" in ids
        assert ids == sorted(ids)
        assert "070_materials_catalog" in M._DETECT
        assert M._DETECT["070_materials_catalog"] is M.detect_070

    def test_rollback_drops_its_tables_and_tracking_row(self):
        assert ROLLBACK.exists()
        assert ROLLBACK.parent.name == "rollbacks"
        ids = [mid for mid, _ in M.migration_files()]
        assert not any("down" in mid for mid in ids)
        text = ROLLBACK.read_text(encoding="utf-8")
        assert "DELETE FROM schema_migrations WHERE id = ''070_materials_catalog''" in text
        assert "DROP TABLE IF EXISTS material_price_loads" in text
        assert "DROP TABLE IF EXISTS material_prices" in text
        assert "DROP TABLE IF EXISTS materials" in text
        assert "DROP TRIGGER IF EXISTS trg_material_price_load_bi" in text
        executable = "\n".join(M.split_statements(text))
        assert "service_kits" not in executable
        assert "catalog_items" not in executable

    def test_creates_materials_and_price_history(self):
        sql = _executable()
        assert "CREATE TABLE IF NOT EXISTS materials" in sql
        assert "CREATE TABLE IF NOT EXISTS material_prices" in sql
        assert "CREATE TABLE IF NOT EXISTS material_price_loads" in sql
        assert "uq_materials_aspire_id" in sql
        assert "chk_materials_inventory_id" in sql
        assert "uq_material_prices_one_current" in sql
        assert "fk_material_prices_item" in sql
        assert "fk_material_prices_estimate" in sql
        assert "trg_material_prices_bi" in sql
        assert "trg_material_prices_bu" in sql
        assert "trg_material_price_load_bi" in sql
        assert "catalog_items" not in sql
        assert "catalog_prices" not in sql
        assert "unit_cost_cents" not in sql.split("CREATE TABLE IF NOT EXISTS material_prices")[0]
        assert "VARCHAR(10)" not in sql
        assert "MODIFY COLUMN" not in sql.upper()

    def test_price_history_trigger_is_one_statement(self):
        stmts = M.split_statements(MIGRATION.read_text(encoding="utf-8"))
        triggers = [s for s in stmts if s.upper().startswith("CREATE TRIGGER")]
        assert len(triggers) == 3
        history = next(s for s in triggers if "trg_material_price_load_bi" in s)
        assert "BEGIN" in history
        assert history.rstrip().endswith("END")
        assert "UPDATE material_prices" in history
        assert "INSERT INTO material_prices" in history
        assert "UUID()" in history


def _flags(**on: bool):
    def table_exists(_conn, name: str) -> bool:
        return bool(on.get(f"table:{name}"))

    def column_exists(_conn, table: str, column: str) -> bool:
        return bool(on.get(f"column:{table}.{column}"))

    def index_exists(_conn, table: str, index_name: str) -> bool:
        return bool(on.get(f"index:{table}.{index_name}"))

    def foreign_key_exists(_conn, table: str, constraint: str) -> bool:
        return bool(on.get(f"fk:{table}.{constraint}"))

    def trigger_exists(_conn, name: str) -> bool:
        return bool(on.get(f"trigger:{name}"))

    return table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists


def _install_detect(monkeypatch, flags):
    table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists = _flags(**flags)
    monkeypatch.setattr(M, "table_exists", table_exists)
    monkeypatch.setattr(M, "column_exists", column_exists)
    monkeypatch.setattr(M, "index_exists", index_exists)
    monkeypatch.setattr(M, "foreign_key_exists", foreign_key_exists)
    monkeypatch.setattr(M, "trigger_exists", trigger_exists)


def _applied_flags() -> dict:
    return {
        "table:materials": True,
        "column:materials.inventory_id": True,
        "table:material_prices": True,
        "index:material_prices.uq_material_prices_one_current": True,
        "fk:material_prices.fk_material_prices_item": True,
        "trigger:trg_material_prices_bi": True,
        "trigger:trg_material_prices_bu": True,
        "table:material_price_loads": True,
        "trigger:trg_material_price_load_bi": True,
    }


class TestDetect070:
    def test_false_before_the_tables_exist(self, monkeypatch):
        _install_detect(monkeypatch, {})
        assert M.detect_070(None) is False

    def test_false_when_materials_is_still_the_kit_table(self, monkeypatch):
        flags = _applied_flags()
        flags["column:materials.kit_type"] = True
        _install_detect(monkeypatch, flags)
        assert M.detect_070(None) is False

    def test_true_only_when_every_effect_landed(self, monkeypatch):
        _install_detect(monkeypatch, _applied_flags())
        assert M.detect_070(None) is True

    @pytest.mark.parametrize(
        "missing",
        [
            "table:materials",
            "index:material_prices.uq_material_prices_one_current",
            "fk:material_prices.fk_material_prices_item",
            "trigger:trg_material_prices_bi",
            "trigger:trg_material_price_load_bi",
            "table:material_price_loads",
        ],
    )
    def test_partial_apply_is_not_detected(self, monkeypatch, missing):
        flags = _applied_flags()
        flags.pop(missing)
        _install_detect(monkeypatch, flags)
        assert M.detect_070(None) is False
