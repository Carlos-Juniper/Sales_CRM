"""Migration 065: kit rename plus the materials catalog and cost history.

Unit checks do not need a database. They lock the file number, the detector,
and the shape of the DDL (no sell price or cost on the item master, no kit
BOM). Applying the SQL against MariaDB/MySQL is covered by the shell
verification in this change, not by Cloud SQL.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.migrate as M  # noqa: E402

MIGRATION = REPO / "sql" / "migrations" / "065_service_kits_and_materials_catalog.sql"
ROLLBACK = REPO / "sql" / "rollbacks" / "065_service_kits_and_materials_catalog_down.sql"


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _executable() -> str:
    return "\n".join(M.split_statements(_sql()))


class TestMigration065File:
    def test_file_is_065_and_registered(self):
        assert MIGRATION.exists()
        ids = [mid for mid, _ in M.migration_files()]
        assert "065_service_kits_and_materials_catalog" in ids
        assert ids == sorted(ids)
        assert "065_service_kits_and_materials_catalog" in M._DETECT

    def test_rollback_is_outside_the_runner(self):
        assert ROLLBACK.exists()
        assert ROLLBACK.parent.name == "rollbacks"
        ids = [mid for mid, _ in M.migration_files()]
        assert not any("down" in mid for mid in ids)
        assert "DROP TABLE catalog_prices" in ROLLBACK.read_text(encoding="utf-8")

    def test_renames_kit_table_and_child_columns(self):
        sql = _executable()
        assert "RENAME TABLE catalog_items TO service_kits" in sql
        assert "RENAME COLUMN catalog_item_id TO service_kit_id" in sql
        assert "fk_services_service_kit" in sql
        assert "fk_takeoff_service_kit" in sql

    def test_materials_table_has_no_price_columns(self):
        sql = _executable()
        # The CREATE for the new catalog_items is the only CREATE of that name.
        create = sql.split("CREATE TABLE IF NOT EXISTS catalog_items", 1)[1]
        create = create.split("CREATE TABLE IF NOT EXISTS catalog_prices", 1)[0]
        for banned in (
            "unit_cost_cents",
            "unit_sell_cents",
            "last_cost",
            "target_gm",
            "kit_type",
            "default_sell",
        ):
            assert banned not in create, banned
        assert "inventory_id" in create
        assert "aspire_catalog_item_id" in create
        assert "purchase_to_base_factor" in create
        assert "available_to_bid" in create
        assert "is_stock_item" in create
        assert "chk_catalog_items_inventory_id" in create

    def test_prices_hold_cost_history_without_sell_price(self):
        sql = _executable()
        prices = sql.split("CREATE TABLE IF NOT EXISTS catalog_prices", 1)[1]
        assert "unit_cost_cents" in prices
        assert "is_current" in prices
        assert "effective_from" in prices
        assert "uq_catalog_prices_one_current" in prices
        assert "chk_catalog_prices_current_marker" in prices
        assert "trg_catalog_prices_bi" in sql
        assert "trg_catalog_prices_bu" in sql
        assert "current_inventory_id = inventory_id" not in prices
        assert "estimate_id" in prices
        assert "entered_by" in prices
        assert "unit_sell" not in prices
        assert "target_gm" not in prices
        assert "fk_catalog_prices_item" in prices
        # Materials are not a kit bill of materials.
        assert "catalog_item_components" not in sql
        assert "material_id" not in sql

    def test_statements_are_guarded_and_runnable(self):
        stmts = M.split_statements(_sql())
        assert stmts, "065 produced no executable statements"
        # SELECT 1 guards are inside prepared strings, not top-level statements
        # the runner would skip. PREPARE/EXECUTE pairs must survive the splitter.
        prepared = [s for s in stmts if s.upper().startswith("PREPARE")]
        executed = [s for s in stmts if s.upper().startswith("EXECUTE")]
        assert prepared and len(prepared) == len(executed)
        assert any(s.upper().startswith("CREATE TABLE") for s in stmts)


def _flags(**on: bool):
    """Schema-lookup stand-ins for detect_065."""

    def table_exists(_conn, name: str) -> bool:
        return bool(on.get(f"table:{name}"))

    def column_exists(_conn, table: str, column: str) -> bool:
        return bool(on.get(f"column:{table}.{column}"))

    def index_exists(_conn, table: str, index: str) -> bool:
        return bool(on.get(f"index:{table}.{index}"))

    def foreign_key_exists(_conn, table: str, constraint: str) -> bool:
        return bool(on.get(f"fk:{table}.{constraint}"))

    def trigger_exists(_conn, name: str) -> bool:
        return bool(on.get(f"trigger:{name}"))

    return table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists


def _applied_flags() -> dict:
    return {
        "table:service_kits": True,
        "column:service_kits.kit_type": True,
        "column:section_services.service_kit_id": True,
        "column:takeoff_lines.service_kit_id": True,
        "table:catalog_items": True,
        "column:catalog_items.inventory_id": True,
        "table:catalog_prices": True,
        "column:catalog_prices.unit_cost_cents": True,
        "column:catalog_prices.is_current": True,
        "index:catalog_prices.uq_catalog_prices_one_current": True,
        "fk:section_services.fk_services_service_kit": True,
        "fk:takeoff_lines.fk_takeoff_service_kit": True,
        "fk:catalog_prices.fk_catalog_prices_item": True,
        "trigger:trg_catalog_prices_bi": True,
        "trigger:trg_catalog_prices_bu": True,
    }


class TestDetect065:
    def test_false_on_the_pre_migration_kit_table(self, monkeypatch):
        table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists = _flags(
            **{
                "table:catalog_items": True,
                "column:catalog_items.kit_type": True,
                "column:catalog_items.unit_cost_cents": True,
                "column:section_services.catalog_item_id": True,
                "column:takeoff_lines.catalog_item_id": True,
            }
        )
        monkeypatch.setattr(M, "table_exists", table_exists)
        monkeypatch.setattr(M, "column_exists", column_exists)
        monkeypatch.setattr(M, "index_exists", index_exists)
        monkeypatch.setattr(M, "foreign_key_exists", foreign_key_exists)
        monkeypatch.setattr(M, "trigger_exists", trigger_exists)
        assert M.detect_065(None) is False

    def test_true_only_when_every_effect_landed(self, monkeypatch):
        table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists = _flags(**_applied_flags())
        monkeypatch.setattr(M, "table_exists", table_exists)
        monkeypatch.setattr(M, "column_exists", column_exists)
        monkeypatch.setattr(M, "index_exists", index_exists)
        monkeypatch.setattr(M, "foreign_key_exists", foreign_key_exists)
        monkeypatch.setattr(M, "trigger_exists", trigger_exists)
        assert M.detect_065(None) is True

    @pytest.mark.parametrize(
        "missing",
        [
            "fk:takeoff_lines.fk_takeoff_service_kit",
            "index:catalog_prices.uq_catalog_prices_one_current",
            "column:section_services.service_kit_id",
            "table:catalog_prices",
            "trigger:trg_catalog_prices_bu",
        ],
    )
    def test_partial_apply_is_not_detected(self, monkeypatch, missing):
        flags = _applied_flags()
        flags.pop(missing)
        table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists = _flags(**flags)
        monkeypatch.setattr(M, "table_exists", table_exists)
        monkeypatch.setattr(M, "column_exists", column_exists)
        monkeypatch.setattr(M, "index_exists", index_exists)
        monkeypatch.setattr(M, "foreign_key_exists", foreign_key_exists)
        monkeypatch.setattr(M, "trigger_exists", trigger_exists)
        assert M.detect_065(None) is False

    def test_false_if_materials_table_still_has_kit_columns(self, monkeypatch):
        flags = _applied_flags()
        flags["column:catalog_items.kit_type"] = True
        table_exists, column_exists, index_exists, foreign_key_exists, trigger_exists = _flags(**flags)
        monkeypatch.setattr(M, "table_exists", table_exists)
        monkeypatch.setattr(M, "column_exists", column_exists)
        monkeypatch.setattr(M, "index_exists", index_exists)
        monkeypatch.setattr(M, "foreign_key_exists", foreign_key_exists)
        monkeypatch.setattr(M, "trigger_exists", trigger_exists)
        assert M.detect_065(None) is False
