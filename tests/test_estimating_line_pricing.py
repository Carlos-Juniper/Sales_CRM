"""Line sell pricing: flat catalog UOM vs per-1,000 sq ft.

Paired with studio/src/lib/estimating/calc.ts `lineSellCents`. The numbers are
the Coral Bay seed (scripts/seed_contract_estimate.py) and the catalog units
in sql/migrations/009_seed_catalog_items.sql. Every seeded line stores uom
'/yr'; flatness comes from the catalog item.
"""
from __future__ import annotations

import os

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.estimating import _is_flat_catalog_uom, _line_sell_cents  # noqa: E402


class TestFlatCatalogUom:
    def test_square_foot_units_are_area_priced(self):
        assert _is_flat_catalog_uom("Sq. Ft.") is False
        assert _is_flat_catalog_uom("sq ft") is False
        assert _is_flat_catalog_uom("SF") is False

    def test_non_area_units_are_flat(self):
        assert _is_flat_catalog_uom("EA") is True
        assert _is_flat_catalog_uom("CT") is True
        assert _is_flat_catalog_uom("LF") is True
        assert _is_flat_catalog_uom("3CF Bag") is True

    def test_missing_catalog_unit_is_not_flat(self):
        assert _is_flat_catalog_uom(None) is False
        assert _is_flat_catalog_uom("") is False


class TestLineSellCents:
    def test_coral_bay_mulch_and_flowers_are_qty_times_unit_sell(self):
        # Entrance & Amenity is 28,500 sq ft. The old path printed
        # 28.5 × 420,000 = $119,700 and 28.5 × 860,000 = $245,100.
        assert _line_sell_cents("maintenance", 1, 420_000, 28_500, 0, "EA") == 420_000
        assert _line_sell_cents("maintenance", 1, 860_000, 28_500, 0, "CT") == 860_000

    def test_flat_price_ignores_complexity(self):
        assert _line_sell_cents("maintenance", 1, 420_000, 28_500, 0.1, "EA") == 420_000

    def test_square_foot_service_is_unchanged(self):
        # Prune Medium, qty 6, 1,400 cents / 1,000 sf, 28,500 sq ft.
        assert _line_sell_cents("maintenance", 6, 1400, 28_500, 0, "Sq. Ft.") == 239_400
        # Standard Production Mowing on the 342,000 sq ft main section.
        assert _line_sell_cents("maintenance", 12, 350, 342_000, 0, "Sq. Ft.") == 1_436_400

    def test_other_non_area_seed_lines_are_flat(self):
        # Weed Eat is LF; Tree Canopy and Common Area Zones are CT.
        assert _line_sell_cents("maintenance", 6, 200, 342_000, 0, "LF") == 1_200
        assert _line_sell_cents("maintenance", 4, 250, 342_000, 0, "CT") == 1_000
        assert _line_sell_cents("maintenance", 12, 1000, 28_500, 0, "CT") == 12_000

    def test_missing_catalog_uom_stays_on_the_area_engine(self):
        # A hand-entered line, or a line whose catalog unit was not joined.
        # 28.5 × 420,000 = 11,970,000 — the bug this guards against when the
        # catalog unit IS known, and the historical result when it is not.
        assert _line_sell_cents("maintenance", 1, 420_000, 28_500, 0, None) == 11_970_000

    def test_install_stays_qty_times_unit_sell(self):
        assert _line_sell_cents("install", 3, 125_050, 10_000, 0.1, "Sq. Ft.") == 375_150

    def test_coral_bay_estimate_total(self):
        lines = [
            ("maintenance", 12, 350, 342_000, "Sq. Ft."),
            ("maintenance", 12, 200, 342_000, "Sq. Ft."),
            ("maintenance", 4, 300, 342_000, "Sq. Ft."),
            ("maintenance", 6, 200, 342_000, "LF"),
            ("maintenance", 4, 250, 342_000, "CT"),
            ("maintenance", 6, 1400, 28_500, "Sq. Ft."),
            ("maintenance", 12, 1000, 28_500, "CT"),
            ("maintenance", 1, 420_000, 28_500, "EA"),
            ("maintenance", 1, 860_000, 28_500, "CT"),
        ]
        total = sum(_line_sell_cents(t, q, u, sf, 0, uom) for t, q, u, sf, uom in lines)
        # Was 40,481,400 cents ($404,814.00) when every line used the area engine.
        assert total == 4_201_200
