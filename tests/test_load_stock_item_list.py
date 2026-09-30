"""Loader tests against the committed Acumatica stock item list.

scripts/data/acumatica_stock_items.xlsx: one "STOCK ITEMS" sheet,
12,498 rows, one vendor column (the vendor id), item classes in the
underscore class-id form. The DB test needs the crm_materials_loader_test
scratch schema and skips without it.
"""
from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

import pymysql
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.load_materials_catalog as loader  # noqa: E402
from tests.test_load_materials_catalog import SCRATCH_DB, _apply_070_072, _connect  # noqa: E402

ROWS = 12_498


@pytest.fixture(scope="module")
def plan():
    return loader.build_plan(loader.DEFAULT_WORKBOOK)


def _item(plan, inventory_id):
    return next(i for i in plan.items if i.inventory_id == inventory_id)


def test_every_row_loads_with_a_cost(plan):
    assert plan.stock_sheet == "STOCK ITEMS"
    assert plan.stock_rows == ROWS
    assert len(plan.items) == ROWS
    assert plan.rejects == []
    assert plan.without_cost == 0
    assert len({i.item_class for i in plan.items}) == 26
    assert sum(1 for i in plan.items if i.item_class.startswith("AGRONOMY")) == 149


def test_unit_warnings(plan):
    """One factor disagreement and seven vendor purchase units; all rows still load."""
    by_id = {w.inventory_id: w.message for w in plan.warnings}
    assert len(plan.warnings) == 8
    assert by_id["1070000077"] == "Unit Conversion Factor 2 != UOM Conversion 20 (stored the factor)"
    assert sum(1 for m in by_id.values() if m.startswith("Preferred Vendor Purchase UOM")) == 7
    assert "1030000149" not in by_id  # Ea vs EA is the same unit


def test_irrigation_row_mapping(plan):
    item = _item(plan, "6010003441")
    assert item.item_class == "IRRIGATION-PARTS_____"
    assert item.aspire_category == "IRRIGATION-PARTS"
    assert item.posting_class == "DIRMATL"
    assert item.manufacturer == "T-Christy Products"
    assert (item.base_uom, item.sales_uom, item.purchase_uom) == ("EA", "EA", "EA")
    assert item.purchase_to_base_factor == Decimal("1.000000")
    assert item.vendor_sku == "513260"
    # The single vendor column is the vendor id; the file has no vendor name.
    assert item.preferred_vendor_id == "HERILAND26"
    assert item.preferred_vendor_name is None
    assert (item.unit_cost_cents, item.cost_uom) == (5447, "EA")
    assert item.item_status == "Active"
    assert item.is_stock_item == 1


def test_purchase_uom_conversion(plan):
    item = _item(plan, "1010000031")  # Avenue South (2.5 GAL)
    assert item.item_class == "AGRONOMY__-HERBISIDE_"
    assert (item.base_uom, item.sales_uom, item.purchase_uom) == ("OZ", "OZ", "EA")
    assert item.purchase_to_base_factor == Decimal("320.000000")
    assert (item.unit_cost_cents, item.cost_uom) == (23750, "EA")
    assert item.preferred_vendor_id == "SITELAND26"


def test_load_is_idempotent(plan):
    try:
        conn = _connect()
    except pymysql.err.OperationalError as exc:
        pytest.skip(f"{SCRATCH_DB} is not reachable: {exc}")
    try:
        _apply_070_072(conn)
        today = date(2026, 9, 30)
        first = loader.apply_plan(conn, plan, today=today)
        conn.commit()
        assert (first.items_upserted, first.prices_inserted) == (ROWS, ROWS)
        second = loader.apply_plan(conn, plan, today=today)
        conn.commit()
        assert (second.prices_inserted, second.prices_unchanged, second.prices_archived) == (0, ROWS, 0)
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM materials")
            assert cur.fetchone()["n"] == ROWS
            cur.execute("SELECT COUNT(*) AS n FROM material_prices")
            assert cur.fetchone()["n"] == ROWS
            cur.execute("SELECT COUNT(*) AS n FROM materials WHERE preferred_vendor_id = 'HERILAND26'")
            assert cur.fetchone()["n"] == 6230
            cur.execute("SELECT COUNT(*) AS n FROM materials WHERE active = 1 AND item_status = 'Active'")
            assert cur.fetchone()["n"] == ROWS
    finally:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM material_prices")
            cur.execute("DELETE FROM materials")
        conn.commit()
        conn.close()
