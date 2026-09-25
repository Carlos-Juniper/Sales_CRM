"""Kit Catalog loader (scripts/load_catalog_items.py).

The loader parses the real Aspire kit workbook Carlos provided
(`business docs/Juniper_Aspire_Kit_Review.xlsx` — pulled live from Aspire,
80 active + bid-available install kits, plus the maintenance takeoff-item
catalog with observed production rates) and emits a reviewable, IDEMPOTENT
seed SQL for `catalog_items` (INSERT … ON DUPLICATE KEY UPDATE).

Acceptance criteria under test:
  * `catalog_items` is populated from real source data via a reviewable loader.
  * Loader is idempotent and count-validated (deterministic ids, stable output,
    expected_counts() drives the live-DB verification in --verify mode).
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest  # noqa: F401  (asyncio_mode=auto)

REPO = Path(__file__).resolve().parents[1]
WORKBOOK = REPO / "business docs" / "Juniper_Aspire_Kit_Review.xlsx"


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "load_catalog_items", REPO / "scripts" / "load_catalog_items.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["load_catalog_items"] = mod  # dataclass introspection needs this
    spec.loader.exec_module(mod)
    return mod


loader = _load_module()


class TestInstallKitExtraction:
    def test_extracts_the_full_80_kit_install_catalog(self):
        rows = loader.extract_install_kits(WORKBOOK)
        # Kit Review email + workbook README: 80 active, bid-available kits.
        assert len(rows) == 80
        assert all(r.kit_type == "install_quantity" for r in rows)

    def test_install_kits_carry_embedded_cost_and_metadata(self):
        rows = loader.extract_install_kits(WORKBOOK)
        by_desc = {r.description: r for r in rows}
        pop_up = by_desc['4" Pop Up Installed']
        assert pop_up.unit_cost_cents == 645  # 6.445766 → cents, rounded
        assert pop_up.uom == "EA"
        assert pop_up.branch == "All Branches"
        assert pop_up.service_type == "Irrigation"
        assert pop_up.active is True
        # install kits are quantity-driven — no production rate
        assert pop_up.production_rate is None
        # default sell derives from cost ÷ (1 − target GM); estimator overrides
        assert pop_up.target_gm > 0
        assert pop_up.unit_sell_cents > pop_up.unit_cost_cents


class TestMaintenanceKitExtraction:
    def test_extracts_active_takeoff_items_with_observed_rates(self):
        rows = loader.extract_maintenance_kits(WORKBOOK)
        assert all(r.kit_type == "maintenance_hours" for r in rows)
        by_id = {r.id: r for r in rows}
        # Standard Production Mowing (takeoff item 3422): $17.50/hr, 67,650 sqft/hr
        mow = by_id["kit-maint-3422"]
        assert mow.description == "Standard Production Mowing"
        assert mow.production_rate == 67650
        assert mow.unit_cost_cents == 1750  # crew labor rate, cents per hour
        assert mow.uom == "Sq. Ft."
        assert mow.service_type == "Turf Area"
        assert mow.active is True

    def test_unsampled_items_keep_null_production_rate(self):
        # "Not sampled" rows land with NULL production_rate — the save guard
        # then blocks estimates against them until the team
        # supplies a rate. That is the intended behavior, not a data bug.
        rows = loader.extract_maintenance_kits(WORKBOOK)
        by_id = {r.id: r for r in rows}
        prune = by_id["kit-maint-3435"]  # Bed Area / Prune Easy — not sampled
        assert prune.production_rate is None
        assert prune.unit_cost_cents == 0

    def test_inactive_takeoff_groups_map_to_inactive_rows(self):
        rows = loader.extract_maintenance_kits(WORKBOOK)
        by_id = {r.id: r for r in rows}
        assert by_id["kit-maint-5388"].active is False  # "4 Unit Lot" group inactive

    def test_legacy_unmapped_items_are_excluded(self):
        rows = loader.extract_maintenance_kits(WORKBOOK)
        descriptions = {r.description for r in rows}
        # Legacy/unmapped names (Canary Palm, Queen Palm, …) are review items,
        # not catalog rows.
        assert "Canary Palm" not in descriptions
        assert "Queen Palm" not in descriptions


class TestIdempotency:
    def test_extraction_is_deterministic_across_runs(self):
        first = loader.extract_all(WORKBOOK)
        second = loader.extract_all(WORKBOOK)
        assert [r.id for r in first] == [r.id for r in second]
        assert first == second

    def test_ids_are_unique(self):
        rows = loader.extract_all(WORKBOOK)
        ids = [r.id for r in rows]
        assert len(ids) == len(set(ids))

    def test_seed_sql_is_idempotent_upsert_and_stable(self):
        rows = loader.extract_all(WORKBOOK)
        sql = loader.generate_seed_sql(rows)
        assert "ON DUPLICATE KEY UPDATE" in sql
        assert "INSERT INTO service_kits" in sql
        # re-running the generator produces byte-identical, reviewable SQL
        assert sql == loader.generate_seed_sql(loader.extract_all(WORKBOOK))

    def test_seed_sql_does_not_write_dropped_branch_column(self):
        """Migration 022 dropped catalog_items.branch. Regenerated seed SQL
        must not name that column (aspire_branch_id is left untouched)."""
        row = loader.CatalogRow(
            id="kit-inst-abc",
            description="Shrub 50'",
            uom="EA",
            unit_cost_cents=100,
            unit_sell_cents=200,
            target_gm=0.45,
            kit_type="install_quantity",
            production_rate=None,
            branch="All Branches",
            active=True,
            service_type="Irrigation",
        )
        sql = loader.generate_seed_sql([row])
        assert "branch" not in sql.split("VALUES", 1)[0]
        assert "VALUES(branch)" not in sql
        assert "All Branches" not in sql
        assert "Shrub 50''" in sql

    def test_seed_sql_escapes_quotes_in_item_names(self):
        rows = loader.extract_all(WORKBOOK)
        sql = loader.generate_seed_sql(rows)
        # e.g. "Fenced Backyards 50'" / "Allee Elm, 10-12' x 4-5', …" —
        # apostrophes must be doubled so the seed is valid MySQL
        assert "Fenced Backyards 50''" in sql
        assert "Allee Elm, 10-12'' x 4-5''" in sql


class TestCountValidation:
    def test_expected_counts_match_extraction(self):
        rows = loader.extract_all(WORKBOOK)
        counts = loader.expected_counts(rows)
        assert counts["install_quantity"] == 80
        assert counts["maintenance_hours"] == len(rows) - 80
        assert counts["total"] == len(rows)

    async def test_verify_counts_compares_against_db(self, monkeypatch):
        rows = loader.extract_all(WORKBOOK)

        async def fake_query(sql, params=None):
            assert "service_kits" in sql
            return [
                {"kit_type": "install_quantity", "c": 80},
                {"kit_type": "maintenance_hours",
                 "c": loader.expected_counts(rows)["maintenance_hours"]},
            ]

        ok, report = await loader.verify_counts(rows, query=fake_query)
        assert ok is True
        assert "install_quantity" in report

    async def test_verify_counts_flags_mismatch(self):
        rows = loader.extract_all(WORKBOOK)

        async def fake_query(sql, params=None):
            return [{"kit_type": "install_quantity", "c": 5}]  # stale demo rows

        ok, report = await loader.verify_counts(rows, query=fake_query)
        assert ok is False
        assert "MISMATCH" in report
