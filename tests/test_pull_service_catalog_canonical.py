"""Tests for H59 A1 — canonical production rate + labor/material split parsing.

All tests use the fixture JSON; no live Aspire in CI.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from statistics import mode

import pytest

REPO = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(REPO))

import scripts.pull_aspire_service_catalog as P  # noqa: E402


# ── load fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def kit_items():
    return json.loads((FIXTURES / "aspire_kit_items_sample.json").read_text())


@pytest.fixture(scope="module")
def service_markups():
    return json.loads((FIXTURES / "aspire_service_markups_sample.json").read_text())


@pytest.fixture(scope="module")
def mowing_kit_items(kit_items):
    return [i for i in kit_items if i["_service"] == "mowing"]


@pytest.fixture(scope="module")
def fert_kit_items(kit_items):
    return [i for i in kit_items if i["_service"] == "fertilizer_turf"]


@pytest.fixture(scope="module")
def pruning_kit_items(kit_items):
    return [i for i in kit_items if i["_service"] == "pruning"]


@pytest.fixture(scope="module")
def mowing_markups(service_markups):
    return [r for r in service_markups if r["ServiceID"] == 101]


@pytest.fixture(scope="module")
def fert_markups(service_markups):
    return [r for r in service_markups if r["ServiceID"] == 411]


# ── TestProductionRateNameParse ───────────────────────────────────────────────

class TestProductionRateNameParse:
    def test_parse_35k_from_mowing_name(self):
        result = P.parse_production_rate('Standard Production Mowing 48"-52" (Production Rate 35k)')
        assert result == 35000

    def test_parse_3_2k(self):
        result = P.parse_production_rate('Push 21" Mowing (Production Rate 3.2K)')
        assert result == 3200

    def test_parse_18k(self):
        result = P.parse_production_rate("Low-Production 30\" Mowing (Production Rate 18K)")
        assert result == 18000

    def test_parse_no_rate_returns_none(self):
        result = P.parse_production_rate("Maintenance Division Labor")
        assert result is None


# ── TestUnitMap ───────────────────────────────────────────────────────────────

class TestUnitMap:
    def test_sq_ft_maps_to_SF(self):
        assert P.map_uom("Sq. Ft.") == "SF"

    def test_LF_maps_to_LF(self):
        assert P.map_uom("LF") == "LF"

    def test_CT_maps_to_CT(self):
        assert P.map_uom("CT") == "CT"

    def test_HR_maps_to_HR(self):
        assert P.map_uom("HR") == "HR"


# ── TestItemClassification ────────────────────────────────────────────────────

class TestItemClassification:
    def test_labor_item_classified_as_labor(self):
        row = {"ItemType": "Labor", "TakeOffItemID": None}
        assert P.classify_kit_item(row) == "labor"

    def test_material_item_classified_as_material(self):
        row = {"ItemType": "Material", "TakeOffItemID": None}
        assert P.classify_kit_item(row) == "material"

    def test_kit_item_classified_as_kit(self):
        row = {"ItemType": "Kit", "TakeOffItemID": 3422}
        assert P.classify_kit_item(row) == "kit"


# ── TestCoverageFactor ────────────────────────────────────────────────────────

class TestCoverageFactor:
    def test_invert_factor_true_coverage(self, fert_kit_items):
        """InvertFactorOrig=True + ItemFactorOrig=6500 → qty_per_unit = 1/6500 ≈ 0.000154.

        When InvertFactor is True, ItemFactor represents area-per-unit (sqft per bag),
        so qty per sqft = 1 / factor.
        """
        material = next(i for i in fert_kit_items if i["ItemType"] == "Material")
        qty = P.coverage_factor(material)
        assert qty == pytest.approx(1 / 6500.0, rel=1e-4)

    def test_invert_factor_false_coverage(self):
        """InvertFactorOrig=False, ItemFactorOrig=0.01 → material_qty_per_unit = 0.01."""
        row = {
            "ItemFactorOrig": 0.01,
            "InvertFactorOrig": False,
        }
        assert P.coverage_factor(row) == pytest.approx(0.01, rel=1e-6)


# ── TestMarkupExtraction ──────────────────────────────────────────────────────

class TestMarkupExtraction:
    def test_mode_markup_mowing(self, mowing_markups):
        labor_pct, material_pct = P.extract_markups(mowing_markups)
        assert labor_pct == pytest.approx(1.00, rel=1e-6)
        assert material_pct == pytest.approx(1.00, rel=1e-6)

    def test_mode_markup_fertilizer(self, fert_markups):
        labor_pct, material_pct = P.extract_markups(fert_markups)
        assert labor_pct == pytest.approx(2.20, rel=1e-6)
        assert material_pct == pytest.approx(0.37, rel=1e-6)


# ── TestSeedShape ─────────────────────────────────────────────────────────────

class TestSeedShape:
    @pytest.fixture(scope="class")
    def sample_plan(self):
        """A minimal plan derived from the fake data used in the existing suite."""
        import asyncio
        import sys

        # Import the FakeAspire harness from the existing test module.
        existing = sys.modules.get("tests.test_pull_aspire_service_catalog")
        if existing is None:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "tests.test_pull_aspire_service_catalog",
                REPO / "tests" / "test_pull_aspire_service_catalog.py",
            )
            existing = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(existing)

        FakeAspire = existing.FakeAspire
        build_data = existing.build_data

        raw = asyncio.run(P.pull(FakeAspire(build_data()), log=lambda *_: None))
        return P.derive(raw, P.load_baseline_kits())

    def test_seed_sql_includes_markup_columns(self, sample_plan):
        sql = P.render_sql(sample_plan)
        assert "labor_markup_pct" in sql
        assert "material_markup_pct" in sql

    def test_seed_sql_includes_is_primary(self, sample_plan):
        sql = P.render_sql(sample_plan)
        assert "is_primary" in sql

    def test_labor_material_sum_approx_kit_cost(self, fert_kit_items):
        """For the fertilizer fixture: labor_cost + material_cost ≈ kit ItemCostOrig (within 10%)."""
        labor = next(i for i in fert_kit_items if i["ItemType"] == "Labor")
        material = next(i for i in fert_kit_items if i["ItemType"] == "Material")
        kit = next(i for i in fert_kit_items if i["ItemType"] == "Kit")

        labor_cost = P.as_float(P.f(labor, "ItemCostOrig")) or 0.0
        material_cost = P.as_float(P.f(material, "ItemCostOrig")) or 0.0
        kit_cost = P.as_float(P.f(kit, "ItemCostOrig")) or 0.0

        component_sum = labor_cost + material_cost
        assert kit_cost > 0, "fixture kit cost must be positive"
        ratio = abs(component_sum - kit_cost) / kit_cost
        assert ratio < 0.10, (
            f"labor ({labor_cost}) + material ({material_cost}) = {component_sum}, "
            f"kit = {kit_cost}, diff = {ratio:.1%} (>10% tolerance)"
        )
