"""Maintenance margin groups sum to the contract, or they raise."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from api.margin_groups import (  # noqa: E402
    MARGIN_GROUPS,
    UnassignedMarginGroupError,
    line_price_cents,
    maintenance_group_prices,
    rounded_share_percents,
)


def _line(label, square_feet, unit_sell_cents, qty, complexity_pct, **extra):
    return {
        "label": label,
        "square_feet": square_feet,
        "unit_sell_cents": unit_sell_cents,
        "qty": qty,
        "complexity_pct": complexity_pct,
        **extra,
    }


def test_group_prices_sum_to_the_contract_total():
    lines = [
        _line("Small Area / Island Production Mowing", 120_000, 450, 42, 0.10),
        _line("Insect and Disease Control", 120_000, 320, 26, 0.05),
        _line("Mulch", 45_000, 180, 12, 0, service_type="Optional Services"),
        _line("Subcontractors", 45_000, 2200, 3, 0),
    ]
    groups = maintenance_group_prices(lines)
    assert list(groups) == list(MARGIN_GROUPS)
    assert groups["Mowing"] == line_price_cents(120_000, 450, 42, 0.10)
    assert sum(groups.values()) == sum(
        line_price_cents(
            line["square_feet"], line["unit_sell_cents"], line["qty"], line["complexity_pct"]
        )
        for line in lines
    )
    percents = rounded_share_percents(list(groups.values()), sum(groups.values()))
    assert sum(percents) == 100


def test_small_area_names_are_mowing():
    lines = [
        _line("Small Area / Island Production Mowing", 1000, 100, 1, 0),
        _line("Small Area Island Production Mowing", 1000, 50, 1, 0),
    ]
    groups = maintenance_group_prices(lines)
    assert groups["Mowing"] == line_price_cents(1000, 100, 1, 0) + line_price_cents(1000, 50, 1, 0)
    assert groups["Pest Control"] == 0


def test_unassigned_service_raises_and_is_not_dropped():
    lines = [
        _line("Mowing", 1000, 100, 1, 0),
        _line("Mystery Work", 1000, 999, 1, 0),
        _line("Detail / Bed Maintenance", 1000, 50, 1, 0),
    ]
    with pytest.raises(UnassignedMarginGroupError) as caught:
        maintenance_group_prices(lines)
    assert caught.value.labels == ["Mystery Work", "Detail / Bed Maintenance"]


def test_equal_prices_round_to_34_33_33():
    assert rounded_share_percents([1, 1, 1], 3) == [34, 33, 33]
    assert rounded_share_percents([0, 0, 0, 0], 0) == [0, 0, 0, 0]
