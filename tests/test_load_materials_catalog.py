"""Materials catalog loader (scripts/load_materials_catalog.py).

The fixture workbook is synthetic. The Aspire export is not in the repo.
TestPlan covers ``--include-nonstock`` (the earlier behavior). TestStockOnly
covers the default mode.
Database checks use a local scratch schema with migration 070 applied and
skip when that database is not reachable. They run on MySQL 8.4 (the Cloud
SQL engine) as a user without SUPER, with binary logging on, so a trigger in
070 fails them with ERROR 1419.
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

MIGRATION = REPO / "sql" / "migrations" / "070_materials_catalog.sql"
MIGRATION_072 = REPO / "sql" / "migrations" / "072_materials_item_status.sql"
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
        plan = loader.build_plan(path, include_nonstock=True)
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
        assert stock.item_status == "Active"
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
        plan = loader.build_plan(path, include_nonstock=True)
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
        plan = loader.build_plan(path, include_nonstock=True)
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
        plan = loader.build_plan(path, include_nonstock=True)
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
        monkeypatch.setattr(migrate, "connect", lambda: (_ for _ in ()).throw(AssertionError("connect")))
        rejects = tmp_path / "out.csv"
        brief = tmp_path / "conflicts.md"
        assert loader.main([
            str(path), "--dry-run", "--include-nonstock", "--rejects", str(rejects), "--conflicts", str(brief),
        ]) == 0
        text = rejects.read_text(encoding="utf-8")
        assert text.splitlines()[0] == "reason,sheet,row_number,inventory_id,description,item_class,aspire_category,uom,vendor,last_cost"
        assert "missing_inventory_id" in text
        assert "101" not in text
        assert "Inventory IDs used for more than one product" in brief.read_text(encoding="utf-8")


def _stock_row(inventory_id: str, description: str, *, classes: tuple[str, str] | None = None, **values) -> list:
    # Keyword names use underscores for spaces: Last_Cost="4" is "Last Cost".
    extra = {key.replace("_", " "): value for key, value in values.items()}
    row = _row(**{"Inventory ID": inventory_id, "Description": description, "Base UOM": "EA", **extra})
    if classes is not None:
        row[2], row[3] = classes
    return row


HERBICIDE = ("101-AG-Herbiside", "AGRONOMY__-HERBISIDE_")
FITTINGS = ("605-IRR-PVC Fittings", "IRRIGATION-PVC_FITTIN")


class TestStockOnly:
    def test_nonstock_sheet_is_not_required(self, tmp_path: Path):
        path = tmp_path / "stock-only.xlsx"
        write_xlsx(path, [("Stock Items", [HEADERS, _stock_row("1000000001", "Coupling")])])
        plan = loader.build_plan(path)
        assert [item.inventory_id for item in plan.items] == ["1000000001"]
        assert plan.nonstock_sheet is None
        assert plan.nonstock_skipped == 0
        with pytest.raises(ValueError, match="NONStock"):
            loader.build_plan(path, include_nonstock=True)

    def test_nonstock_sheet_is_ignored(self, tmp_path: Path):
        path = _workbook(
            tmp_path / "ignored.xlsx",
            # Stock row has no cost and no purchase UOM. Non-stock has both.
            stock=[_stock_row("1000000001", "Stock Pipe", classes=FITTINGS)],
            nonstock=[
                _row(**{
                    "Inventory ID": "1000000001", "Description": "Old Pipe Name", "Base UOM": "FT",
                    "Purchase UOM": "BOX", "Last Cost": "9.99", "Manufacturer": "ACME",
                }),
                _row(**{"Inventory ID": "1000000002", "Description": "Nonstock Only", "Base UOM": "EA", "Last Cost": "2"}),
                _row(**{"Inventory ID": "101", "Description": "Nonstock short id", "Base UOM": "EA"}),
            ],
        )
        plan = loader.build_plan(path)
        assert list(_by_id(plan)) == ["1000000001"]
        item = _by_id(plan)["1000000001"]
        assert item.description == "Stock Pipe"
        assert item.base_uom == "EA"
        assert item.purchase_uom is None
        assert item.manufacturer is None
        assert item.unit_cost_cents is None
        assert plan.rejects == []
        assert plan.nonstock_sheet == "NONStock Items"
        assert plan.nonstock_rows == 3
        assert plan.nonstock_skipped == 3

    def test_agronomy_is_held_by_default(self, tmp_path: Path):
        path = _workbook(
            tmp_path / "ag.xlsx",
            stock=[
                _stock_row("1010000001", "Barricade 50LB", classes=HERBICIDE),
                _stock_row("1020000001", "Insecticide", classes=("102-AG-Insecticide", "AGRONOMY__-INSECTICID")),
                # Loaded class alone marks agronomy.
                _stock_row("1070000001", "Liquid fert", classes=("", "AGRONOMY__-LIQ_FERT__")),
                _stock_row("6050000001", "Coupling", classes=FITTINGS),
                # "AG" inside another word is not agronomy.
                _stock_row("7000000001", "Bag", classes=("700-LS-Bags", "LANDSCAPE_-AGGREGATE_")),
            ],
            nonstock=[],
        )
        plan = loader.build_plan(path)
        assert sorted(_by_id(plan)) == ["6050000001", "7000000001"]
        held = sorted(rej.inventory_id for rej in plan.rejects if rej.reason == "held_agronomy")
        assert held == ["1010000001", "1020000001", "1070000001"]
        assert plan.reject_count("held_agronomy") == 3

        included = loader.build_plan(path, include_agronomy=True)
        assert sorted(_by_id(included)) == ["1010000001", "1020000001", "1070000001", "6050000001", "7000000001"]
        assert _by_id(included)["1010000001"].item_class == "AGRONOMY__-HERBISIDE_"
        assert included.rejects == []

    def test_invalid_id_boundary(self, tmp_path: Path):
        path = _workbook(
            tmp_path / "ids.xlsx",
            stock=[
                _stock_row("1234567890", "Ten digits"),
                _stock_row(" 2000000001 ", "Ten digits, padded"),
                _stock_row("123456789", "Nine digits"),
                _stock_row("12345678901", "Eleven digits"),
                _stock_row("ABC1234567", "Not numeric"),
                _stock_row("1" * 65, "Too long"),
                _row(**{"Inventory ID": "", "Description": "No id"}),
                # The placeholder 101 on several herbicides is invalid, not a conflict.
                *[_stock_row("101", f"Herbicide {n}", classes=HERBICIDE, Last_Cost=str(n)) for n in range(1, 4)],
            ],
            nonstock=[],
        )
        plan = loader.build_plan(path, include_agronomy=True)
        assert sorted(_by_id(plan)) == ["1234567890", "2000000001"]
        invalid = sorted(rej.inventory_id for rej in plan.rejects if rej.reason == "invalid_inventory_id")
        assert invalid == ["101", "101", "101", "123456789", "12345678901", "ABC1234567"]
        assert not any(rej.reason in loader.CONFLICT_REASONS for rej in plan.rejects)
        reasons = {(rej.inventory_id, rej.reason) for rej in plan.rejects}
        assert ("1" * 65, "inventory_id_too_long") in reasons
        assert ("", "missing_inventory_id") in reasons

    def test_conflicting_ids_are_still_rejected(self, tmp_path: Path):
        path = _workbook(
            tmp_path / "conflict.xlsx",
            stock=[
                _stock_row("6060000001", "Repair coupling", Last_Cost="2"),
                _stock_row("6060000001", "CL 160 PVC BE PIPE", Last_Cost="3"),
                _stock_row("3000000001", "Same", Last_Cost="4"),
                _stock_row("3000000001", "Same", Last_Cost="4"),
            ],
            nonstock=[_stock_row("6060000001", "Nonstock fallback", Last_Cost="8")],
        )
        plan = loader.build_plan(path)
        assert list(_by_id(plan)) == ["3000000001"]
        assert plan.identical_duplicates == 1
        assert [(rej.inventory_id, rej.reason) for rej in plan.rejects] == [
            ("6060000001", "conflicting_duplicate_inventory_id"),
            ("6060000001", "conflicting_duplicate_inventory_id"),
        ]
        assert "## 6060000001" in loader.format_conflict_brief(plan)

    def test_include_nonstock_keeps_the_earlier_behavior(self, tmp_path: Path):
        path = _workbook(
            tmp_path / "modes.xlsx",
            stock=[
                _stock_row("1000000001", "Stock Pipe", classes=FITTINGS, Last_Cost="1"),
                _stock_row("1010000001", "Barricade", classes=HERBICIDE, Last_Cost="5"),
                _stock_row("101", "Single herbicide", classes=HERBICIDE, Last_Cost="4"),
            ],
            nonstock=[
                _row(**{"Inventory ID": "1000000001", "Description": "Old Pipe Name", "Base UOM": "FT"}),
                _row(**{"Inventory ID": "1000000002", "Description": "Nonstock Only", "Base UOM": "EA"}),
            ],
        )
        old = loader.build_plan(path, include_nonstock=True)
        assert sorted(_by_id(old)) == ["1000000001", "1000000002", "101", "1010000001"]
        assert _by_id(old)["1000000001"].description == "Stock Pipe"
        assert _by_id(old)["1000000002"].is_stock_item == 0
        assert old.rejects == []
        assert old.stock_overrides == 1
        assert old.nonstock_skipped == 0

        default = loader.build_plan(path)
        assert sorted(_by_id(default)) == ["1000000001"]
        assert sorted((rej.inventory_id, rej.reason) for rej in default.rejects) == [
            ("101", "invalid_inventory_id"),
            ("1010000001", "held_agronomy"),
        ]
        assert default.nonstock_skipped == 2

    def test_dry_run_summary_counts(self, tmp_path: Path, monkeypatch, capsys):
        path = _workbook(
            tmp_path / "summary.xlsx",
            stock=[
                _stock_row("1000000001", "Pipe", classes=FITTINGS),
                _stock_row("1010000001", "Barricade", classes=HERBICIDE),
                _stock_row("101", "Avenue South", classes=HERBICIDE),
                _stock_row("101", "Barricade", classes=HERBICIDE),
                _stock_row("6060000001", "Repair coupling"),
                _stock_row("6060000001", "PVC pipe"),
            ],
            nonstock=[_row(**{"Inventory ID": "1000000002", "Description": "Nonstock Only", "Base UOM": "EA"})],
            extra=[("Template Stock Items STENS", [
                HEADERS,
                _stock_row("4000000001", "Stens one"),
                _stock_row("4000000002", "Stens two"),
                _row(**{"Description": "Stens no id"}),
            ])],
        )
        monkeypatch.setattr(migrate, "connect", lambda: (_ for _ in ()).throw(AssertionError("connect")))
        rejects = tmp_path / "out.csv"
        assert loader.main([str(path), "--dry-run", "--rejects", str(rejects)]) == 0
        out = capsys.readouterr().out
        for line in (
            "  mode: stock-only, agronomy held",
            "  nonstock sheet: NONStock Items rows=1 (not loaded)",
            "  loaded: 1",
            "  held agronomy: 1",
            "  rejected conflicts: 2 rows (1 inventory ids)",
            "  rejected invalid ids: 2",
            "  skipped STENS: 2",
            "  skipped non-stock: 1",
        ):
            assert line in out.splitlines()
        text = rejects.read_text(encoding="utf-8")
        assert text.count("held_agronomy") == 1
        assert text.count("invalid_inventory_id") == 2

        assert loader.main([str(path), "--dry-run", "--rejects", str(rejects), "--include-agronomy"]) == 0
        out = capsys.readouterr().out
        assert "  mode: stock-only, agronomy included" in out.splitlines()
        assert "  loaded: 2" in out.splitlines()
        assert "  held agronomy: 0" in out.splitlines()

        assert loader.main([str(path), "--dry-run", "--rejects", str(rejects), "--include-nonstock"]) == 0
        out = capsys.readouterr().out
        assert "  mode: include-nonstock" in out.splitlines()
        assert "  loaded: 3" in out.splitlines()
        assert "  rejected conflicts: 4 rows (2 inventory ids)" in out.splitlines()

    def test_mode_flags_are_exclusive(self, tmp_path: Path):
        with pytest.raises(SystemExit):
            loader.main([str(tmp_path / "x.xlsx"), "--stock-only", "--include-nonstock"])


PRE_070 = """
CREATE TABLE IF NOT EXISTS estimates (
    id VARCHAR(36) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

_RESET = """
DROP TRIGGER IF EXISTS trg_material_price_load_bi;
DROP TRIGGER IF EXISTS trg_material_prices_bi;
DROP TRIGGER IF EXISTS trg_material_prices_bu;
DROP TABLE IF EXISTS material_price_loads;
DROP TABLE IF EXISTS material_prices;
DROP TABLE IF EXISTS materials;
DROP TABLE IF EXISTS catalog_prices;
DROP TABLE IF EXISTS estimates;
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


def _apply_070_072(conn) -> None:
    with conn.cursor() as cur:
        for stmt in migrate.split_statements(_RESET):
            cur.execute(stmt)
        for stmt in migrate.split_statements(PRE_070):
            cur.execute(stmt)
        for path in (MIGRATION, MIGRATION_072):
            for stmt in migrate.split_statements(path.read_text(encoding="utf-8")):
                cur.execute(stmt)
    conn.commit()


@pytest.fixture(scope="module")
def materials_db():
    try:
        conn = _connect()
    except pymysql.err.OperationalError as exc:
        pytest.skip(f"{SCRATCH_DB} is not reachable: {exc}")
    try:
        _apply_070_072(conn)
    except Exception:
        conn.rollback()
        conn.close()
        raise
    yield conn
    conn.close()


@pytest.fixture
def db(materials_db):
    with materials_db.cursor() as cur:
        cur.execute("DELETE FROM material_prices")
        cur.execute("DELETE FROM materials")
    materials_db.commit()
    return materials_db


def _price_rows(conn, inventory_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT inventory_id, unit_cost_cents, uom, vendor_name, is_current,
                      current_inventory_id, effective_from, effective_to, source, entered_by
                 FROM material_prices
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
        # Two vendor columns, only the first (name) filled: no vendor id.
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
                "SELECT preferred_vendor_name FROM materials WHERE inventory_id = %s",
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
        plan = loader.build_plan(path, include_nonstock=True)
        assert plan.items[0].inventory_id == "101"
        result = loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        assert result.prices_inserted == 1
        with db.cursor() as cur:
            cur.execute("SELECT inventory_id, description FROM materials")
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


def _all_price_rows(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, inventory_id, unit_cost_cents, is_current, current_inventory_id,
                      effective_from, effective_to
                 FROM material_prices
                ORDER BY inventory_id, is_current, effective_from, created_at"""
        )
        return list(cur.fetchall())


def _one_current_per_item(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT inventory_id, SUM(is_current) AS cur, COUNT(*) AS n
                 FROM material_prices GROUP BY inventory_id"""
        )
        rows = list(cur.fetchall())
    assert rows
    assert all(int(row["cur"]) == 1 for row in rows), rows


def _three_item_workbook(tmp_path: Path, name: str, costs: dict[str, str]) -> Path:
    return _workbook(
        tmp_path / name,
        stock=[
            _row(**{
                "Inventory ID": inventory_id,
                "Description": f"Item {inventory_id}",
                "Base UOM": "EA",
                "Last Cost": cost,
            })
            for inventory_id, cost in costs.items()
        ],
        nonstock=[],
    )


class TestLoaderRerun:
    """Price history now lives in the loader (070 has no triggers)."""

    COSTS = {"1000000101": "1.00", "1000000102": "2.00", "1000000103": "3.00"}

    def test_rerun_with_unchanged_costs_adds_no_rows(self, db, tmp_path: Path):
        plan = loader.build_plan(_three_item_workbook(tmp_path, "a.xlsx", self.COSTS))
        first = loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        assert (first.prices_inserted, first.prices_archived, first.prices_unchanged) == (3, 0, 0)
        before = _all_price_rows(db)
        assert len(before) == 3

        second = loader.apply_plan(db, plan, today=date(2026, 10, 5))
        db.commit()
        assert (second.prices_inserted, second.prices_archived, second.prices_unchanged) == (0, 0, 3)
        assert _all_price_rows(db) == before
        _one_current_per_item(db)

    def test_changed_cost_moves_old_row_to_history(self, db, tmp_path: Path):
        plan = loader.build_plan(_three_item_workbook(tmp_path, "a.xlsx", self.COSTS))
        loader.apply_plan(db, plan, today=TODAY)
        db.commit()

        changed = dict(self.COSTS, **{"1000000102": "2.50"})
        later = date(2026, 10, 5)
        plan2 = loader.build_plan(_three_item_workbook(tmp_path, "b.xlsx", changed))
        result = loader.apply_plan(db, plan2, today=later)
        db.commit()
        assert (result.prices_inserted, result.prices_archived, result.prices_unchanged) == (1, 1, 2)

        rows = _price_rows(db, "1000000102")
        assert len(rows) == 2
        old, new = rows  # ordered by is_current
        assert old["is_current"] == 0 and old["current_inventory_id"] is None
        assert int(old["unit_cost_cents"]) == 200
        assert old["effective_from"] == TODAY and old["effective_to"] == later
        assert new["is_current"] == 1 and new["current_inventory_id"] == "1000000102"
        assert int(new["unit_cost_cents"]) == 250
        assert new["effective_from"] == later and new["effective_to"] is None
        assert len(_all_price_rows(db)) == 4
        _one_current_per_item(db)

        # Re-running the changed workbook is a no-op.
        again = loader.apply_plan(db, plan2, today=date(2026, 10, 9))
        db.commit()
        assert (again.prices_inserted, again.prices_archived, again.prices_unchanged) == (0, 0, 3)
        assert len(_all_price_rows(db)) == 4

    def test_backdated_change_closes_on_the_current_rows_start(self, db, tmp_path: Path):
        """effective_to = max(old effective_from, new effective_from)."""
        plan = loader.build_plan(_three_item_workbook(tmp_path, "a.xlsx", {"1000000104": "5.00"}))
        loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        plan2 = loader.build_plan(_three_item_workbook(tmp_path, "b.xlsx", {"1000000104": "6.00"}))
        earlier = date(2026, 9, 1)
        loader.apply_plan(db, plan2, today=earlier)
        db.commit()
        old, new = _price_rows(db, "1000000104")
        assert old["effective_to"] == TODAY  # not before its own effective_from
        assert new["effective_from"] == earlier
        _one_current_per_item(db)

    def test_unique_key_rejects_a_second_current_row(self, db, tmp_path: Path):
        plan = loader.build_plan(_three_item_workbook(tmp_path, "a.xlsx", {"1000000105": "1.00"}))
        loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        with db.cursor() as cur:
            with pytest.raises(pymysql.err.IntegrityError):
                cur.execute(
                    """INSERT INTO material_prices
                           (id, inventory_id, unit_cost_cents, uom, effective_from, is_current, source)
                       VALUES ('dup-current', '1000000105', 1, 'EA', %s, 1, 'test')""",
                    (TODAY,),
                )
        db.rollback()
        _one_current_per_item(db)

    def test_generated_marker_cannot_be_written(self, db, tmp_path: Path):
        plan = loader.build_plan(_three_item_workbook(tmp_path, "a.xlsx", {"1000000106": "1.00"}))
        loader.apply_plan(db, plan, today=TODAY)
        db.commit()
        with db.cursor() as cur:
            with pytest.raises(pymysql.err.MySQLError):
                cur.execute(
                    "UPDATE material_prices SET current_inventory_id = 'x' WHERE inventory_id = '1000000106'"
                )
        db.rollback()


# The first 070 on juniper-dev: materials plus this material_prices, then
# ERROR 1419 at CREATE TRIGGER. Not recorded in schema_migrations.
HALF_APPLIED_PRICES = """
CREATE TABLE material_prices (
    id                   VARCHAR(36)  NOT NULL,
    inventory_id         VARCHAR(64)  NOT NULL,
    unit_cost_cents      BIGINT       NOT NULL,
    uom                  VARCHAR(32)  NOT NULL,
    vendor_id            VARCHAR(64)  DEFAULT NULL,
    vendor_name          VARCHAR(128) DEFAULT NULL,
    effective_from       DATE         NOT NULL,
    effective_to         DATE         DEFAULT NULL,
    is_current           TINYINT(1)   NOT NULL DEFAULT 0,
    current_inventory_id VARCHAR(64)  DEFAULT NULL,
    source               VARCHAR(32)  NOT NULL,
    estimate_id          VARCHAR(36)  DEFAULT NULL,
    entered_by           VARCHAR(255) DEFAULT NULL,
    notes                TEXT         DEFAULT NULL,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_material_prices_one_current (current_inventory_id),
    KEY idx_material_prices_item (inventory_id, effective_from),
    KEY idx_material_prices_current (inventory_id, is_current),
    KEY idx_material_prices_estimate (estimate_id),
    CONSTRAINT chk_material_prices_cost_nonnegative CHECK (unit_cost_cents >= 0),
    CONSTRAINT chk_material_prices_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT chk_material_prices_current_marker CHECK (
        (is_current = 0 AND current_inventory_id IS NULL)
        OR (is_current = 1 AND current_inventory_id IS NOT NULL)
    ),
    CONSTRAINT fk_material_prices_item
        FOREIGN KEY (inventory_id) REFERENCES materials (inventory_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_material_prices_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


class TestMigration070OnDatabase:
    """Apply 070 from scratch and over the half-applied first version."""

    @staticmethod
    def _run_file(conn, text: str) -> None:
        with conn.cursor() as cur:
            for stmt in migrate.split_statements(text):
                cur.execute(stmt)
        conn.commit()

    @staticmethod
    def _shape(conn) -> str:
        with conn.cursor() as cur:
            cur.execute("SHOW CREATE TABLE material_prices")
            return cur.fetchone()["Create Table"]

    def _reset(self, conn) -> None:
        self._run_file(conn, _RESET)
        self._run_file(conn, PRE_070)

    def test_from_scratch_and_over_half_applied_state(self, materials_db):
        conn = materials_db
        migration = MIGRATION.read_text(encoding="utf-8")
        try:
            self._reset(conn)
            assert migrate.detect_070(conn) is False
            self._run_file(conn, migration)
            assert migrate.detect_070(conn) is True
            scratch_shape = self._shape(conn)
            self._run_file(conn, migration)  # re-run is a no-op
            assert self._shape(conn) == scratch_shape

            # Recreate juniper-dev: materials (070's own DDL) + old-shape prices.
            self._reset(conn)
            materials_ddl = next(
                s for s in migrate.split_statements(migration)
                if s.startswith("CREATE TABLE IF NOT EXISTS materials")
            )
            self._run_file(conn, materials_ddl + ";" + HALF_APPLIED_PRICES)
            assert migrate.detect_070(conn) is False
            assert migrate.column_is_generated(conn, "material_prices", "current_inventory_id") is False

            self._run_file(conn, migration)
            assert migrate.detect_070(conn) is True
            assert self._shape(conn) == scratch_shape
            assert "chk_material_prices_current_marker" not in scratch_shape
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
                        WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_material_prices_item'"""
                )
                assert cur.fetchone() == {"UPDATE_RULE": "RESTRICT", "DELETE_RULE": "RESTRICT"}
                cur.execute(
                    "SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()"
                )
                assert cur.fetchone()["n"] == 0
        finally:
            # Leave the module fixture's schema in its applied state.
            self._reset(conn)
            self._run_file(conn, migration)
            self._run_file(conn, MIGRATION_072.read_text(encoding="utf-8"))

