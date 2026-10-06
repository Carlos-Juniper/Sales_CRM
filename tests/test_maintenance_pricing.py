"""Tests for H59 maintenance pricing — component+markup model."""
from __future__ import annotations

import pytest  # noqa: F401  (asyncio_mode=auto)

from unittest.mock import AsyncMock, patch

from conftest import FakeDb
from api.maintenance_pricing import (
    LABOR_BASELINE_CENTS,
    component_sell_cents,
    derived_gm,
    reprice_open_drafts_v2,
)

BRANCH_ID = 42


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _put(db: FakeDb, table: str, row: dict) -> None:
    db.tables[table][row["id"]] = row


def _estimate(db: FakeDb, estimate_id: str, branch_id: int, status: str) -> None:
    _put(db, "estimates", {
        "id": estimate_id,
        "status": status,
        "estimate_type": "maintenance",
        "aspire_branch_id": branch_id,
    })


def _section(db: FakeDb, section_id: str, estimate_id: str) -> None:
    _put(db, "estimate_sections", {"id": section_id, "estimate_id": estimate_id})


def _kit(db: FakeDb, kit_id: str, **fields) -> None:
    _put(db, "service_kits", {"id": kit_id, **fields})


def _line(db: FakeDb, service_id: str, section_id: str, kit_id: str, cents: int) -> None:
    _put(db, "section_services", {
        "id": service_id,
        "section_id": section_id,
        "service_kit_id": kit_id,
        "unit_sell_cents": cents,
    })


# ---------------------------------------------------------------------------
# TestComponentPricingFormula
# ---------------------------------------------------------------------------

class TestComponentPricingFormula:

    def test_mowing_labor_only_sell(self):
        """Mowing kit: labor only, markup=1.00 on both, no materials."""
        # labor_cost = (50000 / 35000) * 2319 = 3312.857...
        # sell = 3312.857 * (1 + 1.00) = 6625.714... → rounds to 6626
        sell = component_sell_cents(
            area_sf=50_000,
            production_rate=35_000,
            labor_rate_cents=2319,
            labor_markup_pct=1.00,
            material_markup_pct=1.00,
            material_unit_cost_cents=None,
            material_qty_per_unit=None,
            target_gm=None,
        )
        assert sell == 6626

    def test_fertilize_turf_labor_plus_material(self):
        """Fertilizer Turf kit: combined labor + material cost with separate markups."""
        # labor_cost = (50000 / 36000) * 2319 = 1.38889 * 2319 = 3220.833...
        # material_cost = 0.000154 * 3200 * 50000 = 24640
        # sell = 3220.833 * 3.20 + 24640 * 1.37
        #      = 10306.667 + 33756.80 = 44063.467... → rounds to 44063
        sell = component_sell_cents(
            area_sf=50_000,
            production_rate=36_000,
            labor_rate_cents=2319,
            labor_markup_pct=2.20,
            material_unit_cost_cents=3200,
            material_qty_per_unit=0.000154,
            material_markup_pct=0.37,
            target_gm=None,
        )
        assert sell == 44063

    def test_gm_override_reprices(self):
        """Same fertilizer kit but target_gm=0.50 triggers GM-override path."""
        # labor_cost = (50000 / 36000) * 2319 = 3220.833...
        # material_cost = 0.000154 * 3200 * 50000 = 24640
        # sell = (3220.833 + 24640) / (1 - 0.50) = 27860.833 / 0.50 = 55721.667 → 55722
        sell = component_sell_cents(
            area_sf=50_000,
            production_rate=36_000,
            labor_rate_cents=2319,
            labor_markup_pct=2.20,
            material_unit_cost_cents=3200,
            material_qty_per_unit=0.000154,
            material_markup_pct=0.37,
            target_gm=0.50,
        )
        assert sell == 55722

    def test_labor_baseline_is_2319(self):
        """The default crew_rate baseline must be 2319 cents/hr, not 22500."""
        assert LABOR_BASELINE_CENTS == 2319

    def test_material_only_kit(self):
        """Count-based kit with no production_rate: qty passed directly."""
        # sell = qty * material_unit_cost_cents * (1 + material_markup_pct)
        #      = 10 * 350 * 2.00 = 7000
        sell = component_sell_cents(
            area_sf=0,
            production_rate=None,
            labor_rate_cents=0,
            labor_markup_pct=0.0,
            material_unit_cost_cents=350,
            material_qty_per_unit=1.0,
            material_markup_pct=1.00,
            target_gm=None,
            qty=10,
        )
        assert sell == 7000

    def test_null_gm_uses_markup_formula(self):
        """target_gm=None must use the markup formula, not GM-override."""
        sell_with_null_gm = component_sell_cents(
            area_sf=50_000,
            production_rate=35_000,
            labor_rate_cents=2319,
            labor_markup_pct=1.00,
            material_markup_pct=1.00,
            target_gm=None,
        )
        sell_with_zero_gm = component_sell_cents(
            area_sf=50_000,
            production_rate=35_000,
            labor_rate_cents=2319,
            labor_markup_pct=1.00,
            material_markup_pct=1.00,
            target_gm=0.0,
        )
        # null GM → markup path → 6626
        # zero GM → GM-override path → labor_cost / 1.0 = 3313 (different result)
        assert sell_with_null_gm == 6626
        assert sell_with_null_gm != sell_with_zero_gm

    def test_aspire_derived_gm(self):
        """derived_gm returns 1 - cost/sell; for symmetric markup it's ~0.5."""
        gm = derived_gm(labor_cost_cents=3312, material_cost_cents=0, sell_cents=6624)
        assert abs(gm - 0.5) < 0.001


# ---------------------------------------------------------------------------
# TestRateSnapshotAsymmetry — §F open drafts use live rate, approved freeze
# ---------------------------------------------------------------------------

MOWING_KIT_ID = "kit-mowing-42"

MOWING_KIT = {
    "id": MOWING_KIT_ID,
    "description": "Standard Mowing",
    "unit_sell_cents": 0,
    "production_rate": 35_000.0,
    "target_gm": None,
    "labor_markup_pct": 1.00,
    "material_markup_pct": 1.00,
    "material_unit_cost_cents": None,
    "material_qty_per_unit": None,
}


class TestRateSnapshotAsymmetry:

    async def test_reprice_open_drafts_uses_new_markup_formula(self):
        """reprice_open_drafts_v2 updates an open in_progress line with new sell."""
        old_rate = 2319
        new_rate = 2500

        # old sell at old_rate: (50000/35000) * 2319 * 2 — but the line stores
        # a per-unit sell computed for 1000 sf (what the function actually stores).
        # For simplicity: pre-seed the line with old formula result.
        old_sell = component_sell_cents(
            area_sf=1000,
            production_rate=35_000,
            labor_rate_cents=old_rate,
            labor_markup_pct=1.00,
            material_markup_pct=1.00,
            target_gm=None,
        )
        new_sell = component_sell_cents(
            area_sf=1000,
            production_rate=35_000,
            labor_rate_cents=new_rate,
            labor_markup_pct=1.00,
            material_markup_pct=1.00,
            target_gm=None,
        )

        fake = FakeDb()
        fake.tables["service_kits"][MOWING_KIT_ID] = dict(MOWING_KIT)
        _estimate(fake, "est-open", BRANCH_ID, "in_progress")
        _section(fake, "sec-open", "est-open")
        _line(fake, "svc-open", "sec-open", MOWING_KIT_ID, old_sell)

        with patch("api.estimating.query", new=AsyncMock(side_effect=fake.query)), \
             patch("api.estimating.execute", new=AsyncMock(side_effect=fake.execute)):
            updated = await reprice_open_drafts_v2(
                aspire_branch_id=BRANCH_ID,
                previous_rate=old_rate,
                new_rate=new_rate,
            )

        assert updated == 1
        assert fake.tables["section_services"]["svc-open"]["unit_sell_cents"] == new_sell

    async def test_reprice_skips_approved(self):
        """reprice_open_drafts_v2 must not touch approved estimates."""
        old_rate = 2319
        new_rate = 2500

        old_sell = component_sell_cents(
            area_sf=1000,
            production_rate=35_000,
            labor_rate_cents=old_rate,
            labor_markup_pct=1.00,
            material_markup_pct=1.00,
            target_gm=None,
        )

        fake = FakeDb()
        fake.tables["service_kits"][MOWING_KIT_ID] = dict(MOWING_KIT)
        _estimate(fake, "est-approved", BRANCH_ID, "approved")
        _section(fake, "sec-approved", "est-approved")
        _line(fake, "svc-approved", "sec-approved", MOWING_KIT_ID, old_sell)

        with patch("api.estimating.query", new=AsyncMock(side_effect=fake.query)), \
             patch("api.estimating.execute", new=AsyncMock(side_effect=fake.execute)):
            updated = await reprice_open_drafts_v2(
                aspire_branch_id=BRANCH_ID,
                previous_rate=old_rate,
                new_rate=new_rate,
            )

        assert updated == 0
        assert fake.tables["section_services"]["svc-approved"]["unit_sell_cents"] == old_sell
