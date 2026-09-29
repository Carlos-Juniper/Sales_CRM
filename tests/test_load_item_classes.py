"""Item class loader (scripts/load_item_classes.py) and migration 071.

Parsing runs against the real class list committed at
scripts/data/acumatica_item_classes.xlsx. Database checks apply 070 and 071
to the local MySQL 8.4 scratch schema used by the materials loader test and
skip when it is not reachable.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pymysql
import pymysql.cursors
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.load_item_classes as loader  # noqa: E402
import scripts.migrate as migrate  # noqa: E402

MIGRATION_070 = REPO / "sql" / "migrations" / "070_materials_catalog.sql"
MIGRATION_071 = REPO / "sql" / "migrations" / "071_item_classes.sql"
ROLLBACK_071 = REPO / "sql" / "rollbacks" / "071_item_classes_down.sql"
SCRATCH_DB = "crm_materials_loader_test"

HEADER = {"B": "Final List for Upload to Acumatica", "C": "Acumatica Item Class ID",
          "D": "Acumatica Item Class ID with underscores", "E": "Posting Class",
          "J": "Description"}


@pytest.fixture(scope="module")
def parsed() -> loader.ClassList:
    return loader.read_workbook()


def _by_code(parsed: loader.ClassList) -> dict[int, loader.ItemClass]:
    return {c.code: c for c in parsed.classes}


class TestRealWorkbook:
    def test_counts(self, parsed):
        assert len(parsed.groups) == 10
        # 60 NNN- labels on the sheet; 903 and 904 have no underscore class id.
        assert len(parsed.classes) == 58
        assert [(s.row_number, s.label) for s in parsed.skipped] == [
            (67, "903-IND-Breakroom Supplies"),
            (68, "904-IND-Indirect Supplies"),
        ]

    def test_groups(self, parsed):
        assert [(g.code, g.name) for g in parsed.groups] == [
            (100, "Agronomy-Aquatics (Chem/Fert)"),
            (200, "Facilities"),
            (300, "Fleet & Equipment"),
            (400, "Freight/Transportation"),
            (500, "Information Technology"),
            (600, "Irrigation/Drainage"),
            (700, "Landscapes"),
            (800, "Live Goods"),
            (900, "Indirect Materials"),
            (999, "Capital Expenditure"),
        ]

    def test_class_fields(self, parsed):
        by_code = _by_code(parsed)
        parts = by_code[601]
        assert parts.item_class_id == "IRRIGATION-PARTS_____"
        assert parts.name == "IRR-Irrigation Parts"
        assert parts.group_code == 600
        assert parts.posting_class is None
        herb = by_code[101]
        assert herb.item_class_id == "AGRONOMY__-HERBISIDE_"
        assert herb.posting_class == "DIRMATL"
        assert by_code[603].posting_class == "SUBCONTR"
        assert by_code[310].name == "FLT-Vehicle Operation Rental"  # trailing space trimmed
        assert by_code[908].group_code == 900
        assert by_code[999].group_code == 999
        assert by_code[999].item_class_id == "CAPEX_____-__________"

    def test_posting_notes_are_not_stored(self, parsed):
        assert [code for code, _text in parsed.posting_notes] == [201, 202, 301, 302, 906, 907]
        by_code = _by_code(parsed)
        assert all(by_code[code].posting_class is None for code, _ in parsed.posting_notes)

    def test_ids_match_materials_item_class_form(self, parsed):
        # materials.item_class carries the underscore form, e.g. IRRIGATION-PARTS_____.
        ids = [c.item_class_id for c in parsed.classes]
        assert len(ids) == len(set(ids))
        assert all(len(i) == 21 and " " not in i and i[10] == "-" for i in ids)

    def test_dry_run_summary(self, capsys):
        assert loader.main(["--dry-run"]) == 0
        lines = capsys.readouterr().out.splitlines()
        assert "  groups: 10" in lines
        assert "  classes: 58" in lines
        assert "  skipped rows: 2" in lines


class TestParseRows:
    def _rows(self, *body: dict[str, str]) -> loader.Rows:
        return [(1, HEADER), *((n, row) for n, row in enumerate(body, start=2))]

    def test_missing_header(self):
        with pytest.raises(ValueError, match="no 'final list"):
            loader.parse_rows([(1, {"A": "Inventory ID"})])

    def test_missing_column(self):
        header = {k: v for k, v in HEADER.items() if k != "D"}
        with pytest.raises(ValueError, match="underscores"):
            loader.parse_rows([(1, header)])

    def test_duplicate_class_code(self):
        rows = self._rows(
            {"B": "601-IRR-Parts", "D": "IRRIGATION-PARTS_____", "J": "600 Irrigation"},
            {"B": "601-IRR-Other", "D": "IRRIGATION-OTHER_____"},
        )
        with pytest.raises(ValueError, match="duplicate class code: 601"):
            loader.parse_rows(rows)

    def test_class_without_group(self):
        rows = self._rows({"B": "101-AG-Herb", "D": "AGRONOMY__-HERBISIDE_", "J": "600 Irrigation"})
        with pytest.raises(ValueError, match="101 has no group"):
            loader.parse_rows(rows)


class TestMigration071File:
    def test_registered_with_detector(self):
        ids = [mid for mid, _ in migrate.migration_files()]
        assert "071_item_classes" in ids
        assert ids == sorted(ids)
        assert migrate._DETECT["071_item_classes"] is migrate.detect_071

    def test_additive_only(self):
        sql = "\n".join(migrate.split_statements(MIGRATION_071.read_text(encoding="utf-8")))
        assert "CREATE TABLE IF NOT EXISTS item_class_groups" in sql
        assert "CREATE TABLE IF NOT EXISTS item_classes" in sql
        for word in ("DROP", "ALTER", "TRIGGER", "materials"):
            assert word not in sql

    def test_rollback(self):
        text = ROLLBACK_071.read_text(encoding="utf-8")
        assert "DROP TABLE IF EXISTS item_classes;" in text
        assert "DROP TABLE IF EXISTS item_class_groups;" in text
        assert "DELETE FROM schema_migrations WHERE id = ''071_item_classes''" in text


# ── database ──────────────────────────────────────────────────────────────────

def _exec_file(conn, path: Path) -> None:
    with conn.cursor() as cur:
        for stmt in migrate.split_statements(path.read_text(encoding="utf-8")):
            cur.execute(stmt)


@pytest.fixture(scope="module")
def class_db():
    try:
        conn = pymysql.connect(
            host="127.0.0.1", port=3306, user="crmadmin", password="crmpassword",
            database=SCRATCH_DB, autocommit=False, connect_timeout=5,
            cursorclass=pymysql.cursors.DictCursor,
        )
    except pymysql.err.OperationalError as exc:
        pytest.skip(f"{SCRATCH_DB} is not reachable: {exc}")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS item_classes")
        cur.execute("DROP TABLE IF EXISTS item_class_groups")
        cur.execute(
            "CREATE TABLE IF NOT EXISTS estimates (id VARCHAR(36) NOT NULL, PRIMARY KEY (id)) "
            "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        )
    _exec_file(conn, MIGRATION_070)
    assert not migrate.detect_071(conn)
    _exec_file(conn, MIGRATION_071)
    _exec_file(conn, MIGRATION_071)  # re-runnable
    conn.commit()
    assert migrate.detect_071(conn)
    yield conn
    conn.close()


def _count(conn, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM {table}")
        return int(cur.fetchone()["c"])


class TestApply:
    def test_load_matches_sheet_and_is_idempotent(self, class_db, parsed):
        first = loader.apply_list(class_db, parsed)
        class_db.commit()
        assert (first.classes_deleted, first.groups_deleted) == (0, 0)
        assert _count(class_db, "item_class_groups") == 10
        assert _count(class_db, "item_classes") == 58

        second = loader.apply_list(class_db, parsed)
        class_db.commit()
        assert (second.classes_deleted, second.groups_deleted) == (0, 0)
        assert _count(class_db, "item_classes") == 58
        with class_db.cursor() as cur:
            cur.execute("SELECT code, name, group_code, posting_class FROM item_classes "
                        "WHERE item_class_id = 'AGRONOMY__-HERBISIDE_'")
            assert cur.fetchone() == {"code": 101, "name": "AG-Herbiside",
                                      "group_code": 100, "posting_class": "DIRMATL"}

    def test_changed_class_id_replaces_the_old_row(self, class_db, parsed):
        loader.apply_list(class_db, parsed)
        class_db.commit()
        from dataclasses import replace
        renamed = loader.ClassList(
            groups=parsed.groups,
            classes=[replace(c, item_class_id="IRRIGATION-PARTS_NEW_") if c.code == 601 else c
                     for c in parsed.classes],
        )
        result = loader.apply_list(class_db, renamed)
        class_db.commit()
        assert result.classes_deleted == 1
        with class_db.cursor() as cur:
            cur.execute("SELECT item_class_id FROM item_classes WHERE code = 601")
            assert cur.fetchall() == [{"item_class_id": "IRRIGATION-PARTS_NEW_"}]
        loader.apply_list(class_db, parsed)
        class_db.commit()

    def test_empty_list_is_refused(self, class_db):
        with pytest.raises(ValueError, match="empty"):
            loader.apply_list(class_db, loader.ClassList())

    def test_unknown_material_classes(self, class_db, parsed):
        loader.apply_list(class_db, parsed)
        with class_db.cursor() as cur:
            cur.execute("DELETE FROM material_prices")
            cur.execute("DELETE FROM materials")
            cur.executemany(
                "INSERT INTO materials (inventory_id, description, item_class, is_stock_item) "
                "VALUES (%s, %s, %s, 1)",
                [("6010000001", "Rotor", "IRRIGATION-PARTS_____"),
                 ("3060000001", "Shop rag", "FLEET     -SHOP CONSU"),
                 ("3060000002", "Shop towel", "FLEET     -SHOP CONSU"),
                 ("7000000001", "No class", None)],
            )
        assert loader.unknown_material_classes(class_db) == [("FLEET     -SHOP CONSU", 2)]
        class_db.rollback()
