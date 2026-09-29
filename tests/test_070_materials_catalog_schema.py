"""Migration 070: materials item master and cost history.

Unit checks do not need a database. They lock the file number, the detector,
the table names, and the no-trigger shape (Cloud SQL rejects CREATE TRIGGER
without SUPER when binary logging is on: ERROR 1419). Applying the SQL to a
MySQL database, from scratch and over the half-applied first version, is
covered by the materials loader test.
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
        for trigger in ("trg_material_price_load_bi", "trg_material_prices_bi", "trg_material_prices_bu"):
            assert f"DROP TRIGGER IF EXISTS {trigger}" in text
        executable = "\n".join(M.split_statements(text))
        assert "service_kits" not in executable
        assert "catalog_items" not in executable

    def test_creates_materials_and_price_history(self):
        sql = _executable()
        assert "CREATE TABLE IF NOT EXISTS materials" in sql
        assert "CREATE TABLE IF NOT EXISTS material_prices" in sql
        assert "CREATE TABLE IF NOT EXISTS material_price_loads" not in sql
        assert "DROP TABLE IF EXISTS material_price_loads" in sql
        assert "uq_materials_aspire_id" in sql
        assert "chk_materials_inventory_id" in sql
        assert "uq_material_prices_one_current" in sql
        assert "fk_material_prices_item" in sql
        assert "fk_material_prices_estimate" in sql
        assert "catalog_items" not in sql
        assert "catalog_prices" not in sql
        assert "unit_cost_cents" not in sql.split("CREATE TABLE IF NOT EXISTS material_prices")[0]
        assert "VARCHAR(10)" not in sql
        assert "MODIFY COLUMN" not in sql.upper()

    def test_nothing_needs_super(self):
        """No trigger, function, procedure, or event is created (ERROR 1419)."""
        upper = _executable().upper()
        for kind in ("TRIGGER", "FUNCTION", "PROCEDURE", "EVENT"):
            assert f"CREATE {kind}" not in upper
            assert f"CREATE DEFINER" not in upper
        assert "DELIMITER" not in upper
        assert "BEGIN" not in upper.replace("BEGINS", "")
        for trigger in ("trg_material_price_load_bi", "trg_material_prices_bi", "trg_material_prices_bu"):
            assert f"DROP TRIGGER IF EXISTS {trigger}" in _executable()

    def test_current_marker_is_a_stored_generated_column(self):
        sql = _executable()
        table = sql.split("CREATE TABLE IF NOT EXISTS material_prices", 1)[1].split(") ENGINE", 1)[0]
        assert (
            "GENERATED ALWAYS AS (CASE WHEN is_current = 1 THEN inventory_id END) STORED" in table
        )
        assert "UNIQUE KEY uq_material_prices_one_current (current_inventory_id)" in table
        assert "chk_material_prices_current_marker" not in table
        item_fk = table.split("CONSTRAINT fk_material_prices_item", 1)[1].split("CONSTRAINT", 1)[0]
        assert "ON DELETE RESTRICT ON UPDATE RESTRICT" in item_fk
        assert "CASCADE" not in item_fk

    def test_upgrades_the_half_applied_first_version(self):
        """Guarded ALTERs rebuild a plain current_inventory_id and the CASCADE FK."""
        sql = _executable()
        for fragment in (
            "ALTER TABLE material_prices DROP FOREIGN KEY fk_material_prices_item",
            "UPDATE_RULE <> 'RESTRICT'",
            "ALTER TABLE material_prices DROP CHECK chk_material_prices_current_marker",
            "UPPER(EXTRA) NOT LIKE '%GENERATED%'",
            "ALTER TABLE material_prices DROP INDEX uq_material_prices_one_current",
            "ALTER TABLE material_prices DROP COLUMN current_inventory_id",
            "ALTER TABLE material_prices ADD COLUMN current_inventory_id VARCHAR(64) GENERATED ALWAYS AS",
            "ALTER TABLE material_prices ADD UNIQUE KEY uq_material_prices_one_current",
            "ALTER TABLE material_prices ADD CONSTRAINT fk_material_prices_item",
        ):
            assert fragment in sql, fragment
        # Every ALTER is behind a PREPARE so a re-run is a no-op.
        stmts = M.split_statements(MIGRATION.read_text(encoding="utf-8"))
        assert not [s for s in stmts if s.upper().startswith("ALTER")]
        prepares = [s for s in stmts if s.upper().startswith("PREPARE")]
        executes = [s for s in stmts if s.upper().startswith("EXECUTE")]
        assert len(prepares) == len(executes) == 7
        # migrate.py strips "--" everywhere; the guarded SQL must not contain it.
        assert "--" not in "\n".join(s for s in stmts if s.upper().startswith("SET @"))


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

    def column_is_generated(_conn, table: str, column: str) -> bool:
        return bool(on.get(f"generated:{table}.{column}"))

    return (
        table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists,
        column_is_generated,
    )


def _install_detect(monkeypatch, flags):
    (
        table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists,
        column_is_generated,
    ) = _flags(**flags)
    monkeypatch.setattr(M, "table_exists", table_exists)
    monkeypatch.setattr(M, "column_exists", column_exists)
    monkeypatch.setattr(M, "index_exists", index_exists)
    monkeypatch.setattr(M, "foreign_key_exists", foreign_key_exists)
    monkeypatch.setattr(M, "trigger_exists", trigger_exists)
    monkeypatch.setattr(M, "column_is_generated", column_is_generated)


def _applied_flags() -> dict:
    return {
        "table:materials": True,
        "column:materials.inventory_id": True,
        "table:material_prices": True,
        "column:material_prices.current_inventory_id": True,
        "generated:material_prices.current_inventory_id": True,
        "index:material_prices.uq_material_prices_one_current": True,
        "fk:material_prices.fk_material_prices_item": True,
    }


def _half_applied_flags() -> dict:
    """juniper-dev after the first 070 failed at CREATE TRIGGER."""
    flags = _applied_flags()
    flags.pop("generated:material_prices.current_inventory_id")
    return flags


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

    def test_triggers_are_not_required(self, monkeypatch):
        flags = _applied_flags()
        assert not any(key.startswith("trigger:") for key in flags)
        assert not any("material_price_loads" in key for key in flags)
        _install_detect(monkeypatch, flags)
        assert M.detect_070(None) is True

    def test_half_applied_first_version_is_not_detected(self, monkeypatch):
        """materials + old-shape material_prices (plain marker, all keys) stays False."""
        _install_detect(monkeypatch, _half_applied_flags())
        assert M.detect_070(None) is False

    def test_only_materials_is_not_detected(self, monkeypatch):
        _install_detect(monkeypatch, {
            "table:materials": True,
            "column:materials.inventory_id": True,
        })
        assert M.detect_070(None) is False

    def test_only_material_prices_is_not_detected(self, monkeypatch):
        flags = _applied_flags()
        flags.pop("table:materials")
        flags.pop("column:materials.inventory_id")
        _install_detect(monkeypatch, flags)
        assert M.detect_070(None) is False

    @pytest.mark.parametrize(
        "missing",
        [
            "table:materials",
            "table:material_prices",
            "generated:material_prices.current_inventory_id",
            "index:material_prices.uq_material_prices_one_current",
            "fk:material_prices.fk_material_prices_item",
        ],
    )
    def test_partial_apply_is_not_detected(self, monkeypatch, missing):
        flags = _applied_flags()
        flags.pop(missing)
        _install_detect(monkeypatch, flags)
        assert M.detect_070(None) is False


class TestColumnIsGenerated:
    class _Conn:
        def __init__(self, row):
            self.row = row

    @pytest.mark.parametrize(
        "row, expected",
        [
            (None, False),
            ({"extra": ""}, False),
            ({"extra": None}, False),
            ({"extra": "STORED GENERATED"}, True),
            ({"extra": "VIRTUAL GENERATED"}, True),
        ],
    )
    def test_reads_information_schema_extra(self, monkeypatch, row, expected):
        seen = {}

        def fake_fetch_one(_conn, sql, params=()):
            seen["sql"], seen["params"] = sql, params
            return row

        monkeypatch.setattr(M, "_fetch_one", fake_fetch_one)
        assert M.column_is_generated(None, "material_prices", "current_inventory_id") is expected
        assert "INFORMATION_SCHEMA.COLUMNS" in seen["sql"]
        assert seen["params"] == ("material_prices", "current_inventory_id")
