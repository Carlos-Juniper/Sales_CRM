"""Materials catalog loader (scripts/load_materials_catalog.py).

The fixture workbook is synthetic. The Aspire export is not in the repo.
Database checks use a local scratch schema with migration 065 applied and
skip when that database is not reachable.
"""
from __future__ import annotations

import sys
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from xml.sax.saxutils import escape

import pymysql
import pymysql.cursors
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.load_materials_catalog as loader  # noqa: E402
import scripts.migrate as migrate  # noqa: E402

MIGRATION = REPO / "sql" / "migrations" / "065_service_kits_and_materials_catalog.sql"
SCRATCH_DB = "crm_materials_loader_test"
TODAY = date(2026, 9, 28)

HEADERS = [
    "Inventory ID",
    "Description",
    "Item Class",
    "Item Class",
    "Aspire Catalog Category",
    "Posting Class",
    "Manufacturer",
    "Base UOM",
    "Sales UOM",
    "Purchase UOM",
    "Unit Conversion Factor",
    "UOM Conversion",
    "Preferred Vendor - Only for purchase items",
    "Preferred Vendor - Only for purchase items",
    "Item Cross Reference (Vendor SKU)",
    "Aspire Item Alternate Name",
    "Available to Bid",
    "Item Status",
    "Last Cost",
    "Aspire Item Cost",
]


def _col_letter(index: int) -> str:
    letters = ""
    n = index + 1
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def write_xlsx(path: Path, sheets: list[tuple[str, list[list]]]) -> None:
    """Minimal xlsx writer. Strings are shared; numbers are numeric cells."""
    strings: list[str] = []
    index: dict[str, int] = {}

    def shared(value: str) -> int:
        if value not in index:
            index[value] = len(strings)
            strings.append(value)
        return index[value]

    sheet_xml: list[str] = []
    for rows in (rows for _name, rows in sheets):
        body = []
        for r_i, row in enumerate(rows, start=1):
            cells = []
            for c_i, value in enumerate(row):
                if value is None or value == "":
                    continue
                ref = f"{_col_letter(c_i)}{r_i}"
                if isinstance(value, bool):
                    value = "1" if value else "0"
                if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
                    number = format(Decimal(str(value)), "f")
                    cells.append(f'<c r="{ref}"><v>{number}</v></c>')
                else:
                    cells.append(f'<c r="{ref}" t="s"><v>{shared(str(value))}</v></c>')
            body.append(f'<row r="{r_i}">{"".join(cells)}</row>')
        sheet_xml.append(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f"<sheetData>{''.join(body)}</sheetData></worksheet>"
        )

    sst_items = "".join(f"<si><t>{escape(text)}</t></si>" for text in strings)
    sst = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(strings)}" uniqueCount="{len(strings)}">{sst_items}</sst>'
    )
    sheet_tags = []
    rels = []
    overrides = []
    for i, (name, _rows) in enumerate(sheets, start=1):
        sheet_tags.append(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>')
        rels.append(
            f'<Relationship Id="rId{i}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{i}.xml"/>'
        )
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    rels.append(
        f'<Relationship Id="rId{len(sheets) + 1}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" '
        'Target="sharedStrings.xml"/>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{''.join(sheet_tags)}</sheets></workbook>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        f"{''.join(overrides)}</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{''.join(rels)}</Relationships>"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        z.writestr("xl/sharedStrings.xml", sst)
        for i, xml in enumerate(sheet_xml, start=1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", xml)


def _row(**values) -> list:
    row = [None] * len(HEADERS)
    for key, value in values.items():
        row[HEADERS.index(key)] = value
    return row


def _workbook(path: Path, stock: list[list], nonstock: list[list], extra: list[tuple[str, list[list]]] | None = None) -> Path:
    sheets = [
        ("Stock Items", [HEADERS, *stock]),
        ("NONStock Items", [HEADERS, *nonstock]),
    ]
    if extra:
        sheets.extend(extra)
    write_xlsx(path, sheets)
    return path


def _by_id(plan):
    return {item.inventory_id: item for item in plan.items}


class TestPlan:
    def test_stock_row_wins_on_overlap(self, tmp_path: Path):
        stock = _row(**{
            "Inventory ID": "1000000001",
            "Description": "Stock Pipe",
            "Aspire Catalog Category": "IRRIGATION-PVC_FITTIN",
            "Posting Class": "DIRMATL",
            "Base UOM": "EA",
            "Sales UOM": "EA",
            "Purchase UOM": "EA",
            "Unit Conversion Factor": Decimal("1"),
            "UOM Conversion": "EA",
            "Item Cross Reference (Vendor SKU)": "SKU-1",
            "Aspire Item Alternate Name": "Pipe Alt",
            "Available to Bid": "1",
            "Item Status": "Active",
            "Last Cost": "18.420000000000002",
            "Aspire Item Cost": "999",
        })
        stock[2] = "605-IRR-PVC Fittings"
        stock[3] = "IRRIGATION-PVC_FITTIN"
        stock[12] = "HERITAGE"
        stock[13] = "HERILAND26"
        path = _workbook(
            tmp_path / "items.xlsx",
            stock=[stock],
            nonstock=[
                _row(**{
                    "Inventory ID": "1000000001",
                    "Description": "Old Pipe Name",
                    "Item Class": "605-IRR-PVC Fittings",
                    "Posting Class": "906-IND-Apparel/Uniforms",
                    "Base UOM": "FT",
                    "Last Cost": "9.99",
                    "Available to Bid": "0",
                    "Item Status": "Inactive",
                }),
                _row(**{
                    "Inventory ID": "1000000002",
                    "Description": "Nonstock Only",
                    "Item Class": "Apparel",
                    "Base UOM": "EA",
                    "Last Cost": "0",
                    "Available to Bid": "0",
                }),
            ],
        )
        plan = loader.build_plan(path)
        stock = _by_id(plan)["1000000001"]
        assert stock.description == "Stock Pipe"
        assert stock.is_stock_item == 1
        assert stock.item_class == "IRRIGATION-PVC_FITTIN"
        assert stock.aspire_category == "IRRIGATION-PVC_FITTIN"
        assert stock.posting_class == "DIRMATL"
        assert stock.base_uom == "EA"
        assert stock.purchase_to_base_factor == Decimal("1.000000")
        assert stock.preferred_vendor_name == "HERITAGE"
        assert stock.preferred_vendor_id == "HERILAND26"
        assert stock.vendor_sku == "SKU-1"
        assert stock.alternate_name == "Pipe Alt"
        assert stock.available_to_bid == 1
        assert stock.active == 1
        assert stock.unit_cost_cents == 1842
        assert stock.cost_uom == "EA"
        only = _by_id(plan)["1000000002"]
        assert only.is_stock_item == 0
        assert only.unit_cost_cents is None
        assert plan.overlap == 1
        assert plan.stock_overrides == 1
        assert plan.rejects == []
        assert plan.zero_costs == 1
        assert plan.with_cost == 1
        assert plan.without_cost == 1
        assert len(plan.items) == 2

    def test_second_item_class_and_vendor_id_columns(self, tmp_path: Path):
        stock = _row(**{
            "Inventory ID": "1000000001",
            "Description": "Coupling",
            "Base UOM": "EA",
            "Last Cost": "3.50",
        })
        # Two Item Class columns and two Preferred Vendor columns, in sheet order.
        stock[2] = "605-IRR-PVC Fittings"
        stock[3] = "IRRIGATION-PVC_FITTIN"
        stock[12] = "HERITAGE"
        stock[13] = "HERILAND26"
        path = _workbook(tmp_path / "cols.xlsx", stock=[stock], nonstock=[])
        item = loader.build_plan(path).items[0]
        assert item.item_class == "IRRIGATION-PVC_FITTIN"
        assert item.preferred_vendor_name == "HERITAGE"
        assert item.preferred_vendor_id == "HERILAND26"
        assert item.unit_cost_cents == 350

    def test_short_id_loads_as_given(self, tmp_path: Path):
        path = _workbook(
            tmp_path / "short.xlsx",
            stock=[
                _row(**{"Inventory ID": "  101  ", "Description": "Single product", "Base UOM": "EA", "Last Cost": "4.00"}),
                _row(**{"Inventory ID": "123456789", "Description": "Nine digits", "Base UOM": "EA"}),
                _row(**{"Inventory ID": "ABC1234567", "Description": "Not numeric", "Base UOM": "EA"}),
                _row(**{"Inventory ID": "2000000001", "Description": "Kept", "Base UOM": "EA", "Last Cost": "1.005"}),
                _row(**{"Inventory ID": "1" * 65, "Description": "Too long", "Base UOM": "EA"}),
            ],
            nonstock=[
                _row(**{"Inventory ID": "", "Description": "No id"}),
                _row(**{"Inventory ID": "101", "Description": "Nonstock name", "Base UOM": "FT", "Last Cost": "9"}),
            ],
        )
        plan = loader.build_plan(path)
        assert _by_id(plan)["101"].description == "Single product"
        assert _by_id(plan)["101"].inventory_id == "101"
        assert _by_id(plan)["101"].is_stock_item == 1
        assert _by_id(plan)["101"].unit_cost_cents == 400
        assert "123456789" in _by_id(plan)
        assert "ABC1234567" in _by_id(plan)
        assert _by_id(plan)["2000000001"].unit_cost_cents == 101  # 1.005 → 101 cents, half up
        assert "0" * 7 + "101" not in _by_id(plan)
        reasons = sorted((rej.inventory_id, rej.reason) for rej in plan.rejects)
        assert ("", "missing_inventory_id") in reasons
        assert ("1" * 65, "inventory_id_too_long") in reasons
        assert not any(reason == "inventory_id_not_10_digits" for _id, reason in reasons)
        assert not any(reason in loader.CONFLICT_REASONS for _id, reason in reasons)
        missing = next(rej for rej in plan.rejects if rej.reason == "missing_inventory_id")
        assert missing.row_number == 2
        assert missing.description == "No id"

    def test_same_short_id_on_two_products_is_rejected(self, tmp_path: Path):
        path = _workbook(
            tmp_path / "dup-101.xlsx",
            stock=[
                _row(**{
                    "Inventory ID": "101",
                    "Description": "Avenue South 2.5 GAL",
                    "Item Class": "Herbicide",
                    "Base UOM": "EA",
                    "Last Cost": "4",
                    "Preferred Vendor - Only for purchase items": "SITEONE",
                }),
                _row(**{
                    "Inventory ID": "101",
                    "Description": "Barricade 50LB",
                    "Item Class": "Herbicide",
                    "Base UOM": "EA",
                    "Last Cost": "5",
                }),
            ],
            nonstock=[],
        )
        plan = loader.build_plan(path)
        assert plan.items == []
        assert [rej.row_number for rej in plan.rejects] == [2, 3]
        assert {rej.reason for rej in plan.rejects} == {"conflicting_duplicate_inventory_id"}
        assert {rej.description for rej in plan.rejects} == {"Avenue South 2.5 GAL", "Barricade 50LB"}
        brief = loader.format_conflict_brief(plan)
        assert "## 101" in brief
        assert "2 rows." in brief
        assert "Avenue South 2.5 GAL" in brief
        assert "Barricade 50LB" in brief

    def test_conflicting_stock_duplicate_blocks_nonstock_fallback(self, tmp_path: Path):
        path = _workbook(
            tmp_path / "dupes.xlsx",
            stock=[
                _row(**{"Inventory ID": "6060000001", "Description": "Repair coupling", "Base UOM": "EA", "Last Cost": "2"}),
                _row(**{"Inventory ID": "6060000001", "Description": "CL 160 PVC BE PIPE", "Base UOM": "FT", "Last Cost": "3"}),
                _row(**{"Inventory ID": "3000000001", "Description": "Same", "Base UOM": "EA", "Last Cost": "4"}),
                _row(**{"Inventory ID": "3000000001", "Description": "Same", "Base UOM": "EA", "Last Cost": "4"}),
            ],
            nonstock=[
                _row(**{"Inventory ID": "6060000001", "Description": "Nonstock fallback", "Base UOM": "EA", "Last Cost": "8"}),
            ],
            extra=[("Template Stock Items STENS", [HEADERS, _row(**{
                "Inventory ID": "4000000001", "Description": "Stens only", "Base UOM": "EA", "Last Cost": "6",
            })])],
        )
        plan = loader.build_plan(path)
        assert "6060000001" not in _by_id(plan)
        assert "4000000001" not in _by_id(plan)
        kept = _by_id(plan)["3000000001"]
        assert kept.description == "Same"
        assert kept.unit_cost_cents == 400
        assert plan.identical_duplicates == 1
        assert plan.overlap == 1
        assert plan.stock_overrides == 0
        reasons = [rej.reason for rej in plan.rejects]
        assert reasons.count("conflicting_duplicate_inventory_id") == 2
        assert reasons.count("stock_sheet_conflict") == 1
        assert plan.ignored_sheets == [("Template Stock Items STENS", 1)]

    def test_dry_run_writes_rejects_and_does_not_connect(self, tmp_path: Path, monkeypatch):
        path = _workbook(
            tmp_path / "dry.xlsx",
            stock=[_row(**{"Inventory ID": "101", "Description": "Short", "Base UOM": "EA"})],
            nonstock=[_row(**{"Inventory ID": "", "Description": "Missing"})],
        )
        monkeypatch.setattr(loader, "connect", lambda: (_ for _ in ()).throw(AssertionError("connect")))
        rejects = tmp_path / "out.csv"
        brief = tmp_path / "conflicts.md"
        assert loader.main([
            str(path), "--dry-run", "--rejects", str(rejects), "--conflicts", str(brief),
        ]) == 0
        text = rejects.read_text(encoding="utf-8")
        assert text.splitlines()[0] == "reason,sheet,row_number,inventory_id,description,item_class,aspire_category,uom,vendor,last_cost"
        assert "missing_inventory_id" in text
        assert "101" not in text
        assert "Inventory IDs used for more than one product" in brief.read_text(encoding="utf-8")


PRE_065 = """
CREATE TABLE IF NOT EXISTS estimates (
    id VARCHAR(36) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_items (
    id VARCHAR(36) NOT NULL,
    description VARCHAR(255) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    kit_type VARCHAR(32) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_catalog_kit_type (kit_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS section_services (
    id VARCHAR(36) NOT NULL,
    catalog_item_id VARCHAR(36) DEFAULT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_services_catalog_item
        FOREIGN KEY (catalog_item_id) REFERENCES catalog_items (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_lines (
    id VARCHAR(36) NOT NULL,
    catalog_item_id VARCHAR(36) DEFAULT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_takeoff_catalog_item
        FOREIGN KEY (catalog_item_id) REFERENCES catalog_items (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""


def _connect():
    return pymysql.connect(
        host="127.0.0.1",
        port=3306,
        user="crmadmin",
        password="crmpassword",
        database=SCRATCH_DB,
        autocommit=False,
        connect_timeout=5,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _apply_065(conn) -> None:
    with conn.cursor() as cur:
        for stmt in migrate.split_statements(PRE_065):
            cur.execute(stmt)
        for stmt in migrate.split_statements(MIGRATION.read_text(encoding="utf-8")):
            cur.execute(stmt)
    conn.commit()


@pytest.fixture(scope="module")
def materials_db():
    try:
        conn = _connect()
    except pymysql.err.OperationalError as exc:
        pytest.skip(f"{SCRATCH_DB} is not reachable: {exc}")
    try:
        _apply_065(conn)
    except Exception:
        conn.rollback()
        conn.close()
        raise
    yield conn
    conn.close()


@pytest.fixture
def db(materials_db):
    with materials_db.cursor() as cur:
        cur.execute("DELETE FROM catalog_prices")
        cur.execute("DELETE FROM catalog_items")
    materials_db.commit()
    return materials_db


def _price_rows(conn, inventory_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT inventory_id, unit_cost_cents, uom, vendor_name, is_current,
                      current_inventory_id, effective_from, effective_to, source, entered_by
                 FROM catalog_prices
                WHERE inventory_id = %s
                ORDER BY is_current, created_at""",
            (inventory_id,),
        )
        return list(cur.fetchall())


class TestApply:
    def test_idempotent_rerun_and_cost_change_history(self, db, tmp_path: Path):
        path = _workbook(
            tmp_path / "prices.xlsx",
            stock=[_row(**{
                "Inventory ID": "1000000009",
                "Description": "Valve",
                "Base UOM": "EA",
                "Purchase UOM": "EA",
                "Preferred Vendor - Only for purchase items": "HERITAGE",
                "Last Cost": "10.00",
            })],
            nonstock=[],
        )
        # Single vendor column is the name. The id column is absent.
        plan = loader.build_plan(path)
        item = plan.items[0]
        assert item.preferred_vendor_name == "HERITAGE"
        assert item.preferred_vendor_id is None

        first = loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        assert first.prices_inserted == 1
        assert first.prices_archived == 0

        from dataclasses import replace
        plan.items = [replace(item, preferred_vendor_name="Other Vendor")]
        second = loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        assert second.prices_inserted == 0
        assert second.prices_unchanged == 1
        assert second.prices_archived == 0
        with db.cursor() as cur:
            cur.execute(
                "SELECT preferred_vendor_name FROM catalog_items WHERE inventory_id = %s",
                (item.inventory_id,),
            )
            assert cur.fetchone()["preferred_vendor_name"] == "Other Vendor"
        unchanged = _price_rows(db, item.inventory_id)
        assert len(unchanged) == 1
        assert unchanged[0]["vendor_name"] == "HERITAGE"
        assert unchanged[0]["is_current"] == 1
        assert unchanged[0]["current_inventory_id"] == item.inventory_id
        assert unchanged[0]["source"] == "aspire_import"
        assert unchanged[0]["entered_by"] == "scripts/load_materials_catalog.py"
        assert int(unchanged[0]["unit_cost_cents"]) == 1000

        plan.items = [replace(item, unit_cost_cents=1250, preferred_vendor_name="HERITAGE")]
        third = loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        assert third.prices_inserted == 1
        assert third.prices_archived == 1
        assert third.prices_unchanged == 0
        rows = _price_rows(db, item.inventory_id)
        assert len(rows) == 2
        history = [row for row in rows if row["is_current"] == 0]
        current = [row for row in rows if row["is_current"] == 1]
        assert len(history) == 1 and len(current) == 1
        assert history[0]["current_inventory_id"] is None
        assert history[0]["effective_to"] == TODAY
        assert int(history[0]["unit_cost_cents"]) == 1000
        assert current[0]["current_inventory_id"] == item.inventory_id
        assert current[0]["effective_to"] is None
        assert int(current[0]["unit_cost_cents"]) == 1250
        assert current[0]["uom"] == "EA"

    def test_short_inventory_id_is_stored_as_given(self, db, tmp_path: Path):
        path = _workbook(
            tmp_path / "id101.xlsx",
            stock=[_row(**{
                "Inventory ID": "101",
                "Description": "Single herbicide",
                "Base UOM": "EA",
                "Last Cost": "4.50",
            })],
            nonstock=[],
        )
        plan = loader.build_plan(path)
        assert plan.items[0].inventory_id == "101"
        result = loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        assert result.prices_inserted == 1
        with db.cursor() as cur:
            cur.execute("SELECT inventory_id, description FROM catalog_items")
            row = cur.fetchone()
        assert row["inventory_id"] == "101"
        assert row["description"] == "Single herbicide"
        prices = _price_rows(db, "101")
        assert len(prices) == 1
        assert prices[0]["current_inventory_id"] == "101"
        assert int(prices[0]["unit_cost_cents"]) == 450

    def test_blank_cost_does_not_clear_an_existing_price(self, db, tmp_path: Path):
        path = _workbook(
            tmp_path / "blank.xlsx",
            stock=[_row(**{
                "Inventory ID": "1000000008",
                "Description": "Cap",
                "Base UOM": "EA",
                "Last Cost": "2.00",
            })],
            nonstock=[],
        )
        plan = loader.build_plan(path)
        loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        plan.items = [replace_costless(plan.items[0])]
        again = loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        assert again.prices_inserted == 0
        assert again.prices_archived == 0
        rows = _price_rows(db, "1000000008")
        assert len(rows) == 1
        assert rows[0]["is_current"] == 1
        assert int(rows[0]["unit_cost_cents"]) == 200


def replace_costless(item):
    from dataclasses import replace
    return replace(item, unit_cost_cents=None, cost_uom=None)
