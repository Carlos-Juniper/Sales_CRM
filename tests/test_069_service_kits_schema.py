"""Migration 069: rename the kit catalog to service_kits.

Unit checks do not need a database. They lock the file number, the detector,
and the kit rename. Applying the SQL against MariaDB is covered outside CI.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.migrate as M  # noqa: E402

MIGRATION = REPO / "sql" / "migrations" / "069_service_kits.sql"
ROLLBACK = REPO / "sql" / "rollbacks" / "069_service_kits_down.sql"


def _executable() -> str:
    return "\n".join(M.split_statements(MIGRATION.read_text(encoding="utf-8")))


class TestMigration069File:
    def test_file_is_069_and_registered(self):
        assert MIGRATION.exists()
        ids = [mid for mid, _ in M.migration_files()]
        assert "069_service_kits" in ids
        assert ids == sorted(ids)
        assert "069_service_kits" in M._DETECT
        assert M._DETECT["069_service_kits"] is M.detect_069

    def test_rollback_deletes_its_tracking_row(self):
        assert ROLLBACK.exists()
        assert ROLLBACK.parent.name == "rollbacks"
        ids = [mid for mid, _ in M.migration_files()]
        assert not any("down" in mid for mid in ids)
        text = ROLLBACK.read_text(encoding="utf-8")
        assert "DELETE FROM schema_migrations WHERE id = ''069_service_kits''" in text
        assert "RENAME TABLE service_kits TO catalog_items" in text
        assert "DROP TABLE" not in text

    def test_renames_kit_table_and_child_columns(self):
        sql = _executable()
        assert "RENAME TABLE catalog_items TO service_kits" in sql
        assert "RENAME COLUMN catalog_item_id TO service_kit_id" in sql
        assert "fk_services_service_kit" in sql
        assert "fk_takeoff_service_kit" in sql
        assert "idx_service_kits_kit_type" in sql
        assert "idx_service_kits_active" in sql
        assert "idx_service_kits_aspire_branch" in sql
        assert "CREATE TABLE" not in sql.upper()

    def test_statements_are_guarded_and_runnable(self):
        stmts = M.split_statements(MIGRATION.read_text(encoding="utf-8"))
        assert stmts, "069 produced no executable statements"
        prepared = [s for s in stmts if s.upper().startswith("PREPARE")]
        executed = [s for s in stmts if s.upper().startswith("EXECUTE")]
        assert prepared and len(prepared) == len(executed)


def _flags(**on: bool):
    def table_exists(_conn, name: str) -> bool:
        return bool(on.get(f"table:{name}"))

    def column_exists(_conn, table: str, column: str) -> bool:
        return bool(on.get(f"column:{table}.{column}"))

    def foreign_key_exists(_conn, table: str, constraint: str) -> bool:
        return bool(on.get(f"fk:{table}.{constraint}"))

    return table_exists, column_exists, foreign_key_exists


def _install_detect(monkeypatch, flags):
    table_exists, column_exists, foreign_key_exists = _flags(**flags)
    monkeypatch.setattr(M, "table_exists", table_exists)
    monkeypatch.setattr(M, "column_exists", column_exists)
    monkeypatch.setattr(M, "foreign_key_exists", foreign_key_exists)


def _applied_flags() -> dict:
    return {
        "table:service_kits": True,
        "column:service_kits.kit_type": True,
        "column:section_services.service_kit_id": True,
        "column:takeoff_lines.service_kit_id": True,
        "fk:section_services.fk_services_service_kit": True,
        "fk:takeoff_lines.fk_takeoff_service_kit": True,
    }


class TestDetect069:
    def test_false_on_the_pre_migration_kit_table(self, monkeypatch):
        _install_detect(monkeypatch, {
            "table:catalog_items": True,
            "column:catalog_items.kit_type": True,
            "column:section_services.catalog_item_id": True,
            "column:takeoff_lines.catalog_item_id": True,
        })
        assert M.detect_069(None) is False

    def test_true_only_when_every_effect_landed(self, monkeypatch):
        _install_detect(monkeypatch, _applied_flags())
        assert M.detect_069(None) is True

    @pytest.mark.parametrize(
        "missing",
        [
            "fk:takeoff_lines.fk_takeoff_service_kit",
            "fk:section_services.fk_services_service_kit",
            "column:section_services.service_kit_id",
            "column:takeoff_lines.service_kit_id",
        ],
    )
    def test_partial_apply_is_not_detected(self, monkeypatch, missing):
        flags = _applied_flags()
        flags.pop(missing)
        _install_detect(monkeypatch, flags)
        assert M.detect_069(None) is False

    def test_false_when_old_column_remains(self, monkeypatch):
        flags = _applied_flags()
        flags["column:section_services.catalog_item_id"] = True
        _install_detect(monkeypatch, flags)
        assert M.detect_069(None) is False
