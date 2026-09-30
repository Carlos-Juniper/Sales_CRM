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
AGRONOMY_ROWS = 149


@pytest.fixture(scope="module")
def stock_plan():
    return loader.build_plan(loader.DEFAULT_WORKBOOK)


@pytest.fixture(scope="module")
def full_plan():
    return loader.build_plan(loader.DEFAULT_WORKBOOK, include_agronomy=True)


def _item(plan, inventory_id):
    return next(i for i in plan.items if i.inventory_id == inventory_id)


def test_default_holds_agronomy(stock_plan):
    assert stock_plan.stock_sheet == "STOCK ITEMS"
    assert stock_plan.stock_rows == ROWS
    assert len(stock_plan.items) == ROWS - AGRONOMY_ROWS
    assert stock_plan.reject_count(loader.HELD_AGRONOMY_REASON) == AGRONOMY_ROWS
    assert len(stock_plan.rejects) == AGRONOMY_ROWS
    assert not any((i.item_class or "").startswith("AGRONOMY") for i in stock_plan.items)


def test_include_agronomy_loads_every_row_with_a_cost(full_plan):
    assert len(full_plan.items) == ROWS
    assert full_plan.rejects == []
    assert full_plan.without_cost == 0
    assert len({i.item_class for i in full_plan.items}) == 26


def test_irrigation_row_mapping(stock_plan):
    item = _item(stock_plan, "6010003441")
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


def test_purchase_uom_conversion(full_plan):
    item = _item(full_plan, "1010000031")  # Avenue South (2.5 GAL)
    assert item.item_class == "AGRONOMY__-HERBISIDE_"
    assert (item.base_uom, item.sales_uom, item.purchase_uom) == ("OZ", "OZ", "EA")
    assert item.purchase_to_base_factor == Decimal("320.000000")
    assert (item.unit_cost_cents, item.cost_uom) == (23750, "EA")
    assert item.preferred_vendor_id == "SITELAND26"


def test_load_is_idempotent(full_plan):
    try:
        conn = _connect()
    except pymysql.err.OperationalError as exc:
        pytest.skip(f"{SCRATCH_DB} is not reachable: {exc}")
    try:
        _apply_070_072(conn)
        today = date(2026, 9, 30)
        first = loader.apply_plan(conn, full_plan, today=today)
        conn.commit()
        assert (first.items_upserted, first.prices_inserted) == (ROWS, ROWS)
        second = loader.apply_plan(conn, full_plan, today=today)
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
