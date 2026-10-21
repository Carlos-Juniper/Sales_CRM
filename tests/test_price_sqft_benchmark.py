"""Price-per-sq-ft benchmark aggregation.

The average is the unweighted mean of per-estimate cents per square foot
across every CRM maintenance estimate except the one on screen. Blank imports
(no sq ft, or no computed contract total), zero-sq-ft estimates, and the
current estimate are excluded. An empty cohort returns sampleSize 0 and a
null average — never a made-up number.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

import api.estimating as est  # noqa: E402
from api.price_sqft_benchmark import (  # noqa: E402
    COHORT_SQL,
    aggregate_price_per_sqft,
    cents_per_sqft,
    computed_contract_cents,
    measure_sqft,
    rows_to_estimates,
)
from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

_USER = {
    "id": "u1",
    "name": "Alice",
    "email": "a@x.com",
    "role": "maintenance_estimating",
    "branch_id": "Orlando, FL",
    "avatar_initials": "AX",
}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _line(
    *,
    line_id: str = "line-1",
    label: str = "Mowing",
    category_code: str | None = "turf",
    square_feet: float | None = None,
    qty: float = 1,
    unit_sell_cents: int | None = 2000,
    complexity_pct: float = 0,
) -> dict:
    return {
        "id": line_id,
        "label": label,
        "category_code": category_code,
        "square_feet": square_feet,
        "qty": qty,
        "unit_sell_cents": unit_sell_cents,
        "complexity_pct": complexity_pct,
    }


def _section(
    *,
    name: str = "Common Area",
    category_code: str | None = None,
    square_feet: float | None = 10_000,
    lines: list[dict] | None = None,
) -> dict:
    return {
        "name": name,
        "category_code": category_code,
        "square_feet": square_feet,
        "lines": [] if lines is None else lines,
    }


def _estimate(estimate_id: str, sections: dict[str, dict]) -> dict:
    return {"estimate_id": estimate_id, "sections": sections}


def _priced_region(estimate_id: str, *, sqft: float, cents_per_sqft: float, estimator: str = "u-a") -> dict:
    """One legacy region at ``cents_per_sqft``.

    Line total = (sqft/1000) * unit_sell, so cents/sqft = unit_sell/1000.
    unit_sell 2000 → 2¢, unit_sell 4000 → 4¢.
    """
    unit_sell = int(cents_per_sqft * 1000)
    estimate = _estimate(
        estimate_id,
        {
            "sec": _section(
                square_feet=sqft,
                lines=[_line(unit_sell_cents=unit_sell, category_code="turf")],
            )
        },
    )
    estimate["assigned_ls_estimator"] = estimator
    return estimate


def test_cohort_sql_is_every_maintenance_estimate():
    where = COHORT_SQL.lower().split("where", 1)[1]
    assert "estimate_type = 'maintenance'" in where
    assert "assigned_ls_estimator" not in COHORT_SQL.lower()
    assert "aspire_branch_id" not in where
    assert "contract_value_cents" not in COHORT_SQL.lower()


def test_mean_of_per_estimate_rates_not_area_weighted():
    """2¢ on 10,000 sq ft and 4¢ on 50,000 sq ft average to 3.0¢, not 3.666¢."""
    peers = [
        _priced_region("a", sqft=10_000, cents_per_sqft=2, estimator="estimator-a"),
        _priced_region("b", sqft=50_000, cents_per_sqft=4, estimator="estimator-b"),
    ]
    assert cents_per_sqft(peers[0]) == pytest.approx(2.0)
    assert cents_per_sqft(peers[1]) == pytest.approx(4.0)
    result = aggregate_price_per_sqft(peers, exclude_estimate_id="job")
    assert result == {"sampleSize": 2, "averageCentsPerSqft": pytest.approx(3.0)}


def test_acceptance_job_at_3_3_cents_is_excluded_from_the_3_cent_average():
    job = _priced_region("job", sqft=10_000, cents_per_sqft=3.3)
    assert cents_per_sqft(job) == pytest.approx(3.3)
    peers = [
        _priced_region("a", sqft=10_000, cents_per_sqft=2),
        _priced_region("b", sqft=50_000, cents_per_sqft=4),
        job,
    ]
    result = aggregate_price_per_sqft(peers, exclude_estimate_id="job")
    assert result["sampleSize"] == 2
    assert result["averageCentsPerSqft"] == pytest.approx(3.0)


def test_current_estimate_exclusion_leaves_sample_empty_when_it_is_the_only_row():
    only = _priced_region("job", sqft=10_000, cents_per_sqft=2)
    result = aggregate_price_per_sqft([only], exclude_estimate_id="job")
    assert result == {"sampleSize": 0, "averageCentsPerSqft": None}


def test_empty_database_returns_no_average():
    assert aggregate_price_per_sqft([], exclude_estimate_id="job") == {
        "sampleSize": 0,
        "averageCentsPerSqft": None,
    }


def test_blank_import_without_sections_is_excluded():
    blank = _estimate("blank", {})
    assert cents_per_sqft(blank) is None
    result = aggregate_price_per_sqft(
        [blank, _priced_region("a", sqft=10_000, cents_per_sqft=2)],
        exclude_estimate_id="job",
    )
    assert result["sampleSize"] == 1
    assert result["averageCentsPerSqft"] == pytest.approx(2.0)


def test_blank_import_with_null_square_feet_is_excluded():
    blank = _estimate(
        "blank",
        {"sec": _section(square_feet=None, lines=[_line(unit_sell_cents=500)])},
    )
    assert measure_sqft(blank)["sqftKnown"] is False
    assert cents_per_sqft(blank) is None


def test_blank_import_with_sqft_but_no_lines_has_no_computed_contract():
    blank = _estimate("blank", {"sec": _section(square_feet=12_000, lines=[])})
    assert measure_sqft(blank)["sqftKnown"] is True
    assert computed_contract_cents(blank) is None
    assert cents_per_sqft(blank) is None


def test_zero_sqft_estimate_is_excluded_and_does_not_become_a_zero_rate():
    zero = _estimate(
        "zero",
        {"sec": _section(square_feet=0, lines=[_line(unit_sell_cents=500)])},
    )
    assert measure_sqft(zero)["totalSqft"] == 0
    assert cents_per_sqft(zero) is None
    result = aggregate_price_per_sqft(
        [zero, _priced_region("a", sqft=10_000, cents_per_sqft=4)],
        exclude_estimate_id="job",
    )
    assert result["sampleSize"] == 1
    assert result["averageCentsPerSqft"] == pytest.approx(4.0)


def test_bed_section_square_feet_is_not_the_seeded_line_zero():
    """Bed lines are seeded at 0. The bed section's square feet is the area."""
    estimate = _estimate(
        "e",
        {
            "turf": _section(
                name="Turf",
                category_code="turf",
                square_feet=10_000,
                lines=[_line(line_id="mow", category_code="turf", square_feet=None, unit_sell_cents=300)],
            ),
            "beds": _section(
                name="Beds",
                category_code="bed_maint",
                square_feet=5_000,
                lines=[
                    _line(
                        line_id="bed",
                        label="Pruning",
                        category_code="bed_maint",
                        square_feet=0,
                        unit_sell_cents=100,
                    )
                ],
            ),
        },
    )
    areas = measure_sqft(estimate)
    assert areas["turfSqft"] == 10_000
    assert areas["bedSqft"] == 5_000
    assert areas["totalSqft"] == 15_000
    # Price still uses each section's square feet (not the seeded 0 line).
    # Turf line: (10000/1000)*300 = 3000. Bed line: (5000/1000)*100 = 500.
    assert computed_contract_cents(estimate) == 3_500
    assert cents_per_sqft(estimate) == pytest.approx(3_500 / 15_000)


def test_bed_line_area_counts_and_does_not_change_job_price():
    def region(bed_sqft: float) -> dict:
        return _estimate(
            "e",
            {
                "sec": _section(
                    name="Common Area",
                    square_feet=10_000,
                    lines=[
                        _line(line_id="mow", label="Mowing", category_code="turf", unit_sell_cents=300),
                        _line(
                            line_id="bed",
                            label="Bed Maintenance",
                            category_code="bed_maint",
                            square_feet=bed_sqft,
                            unit_sell_cents=100,
                        ),
                    ],
                )
            },
        )

    unset = region(0)
    entered = region(2_500)
    assert computed_contract_cents(unset) == computed_contract_cents(entered)
    assert computed_contract_cents(entered) == 4_000  # both lines priced on 10,000 sq ft
    assert measure_sqft(unset)["bedSqft"] == 0
    assert measure_sqft(entered)["bedSqft"] == 2_500
    assert measure_sqft(entered)["totalSqft"] == 12_500
    assert cents_per_sqft(entered) == pytest.approx(4_000 / 12_500)


def test_bed_category_wins_over_a_non_bed_name():
    estimate = _estimate(
        "e",
        {
            "sec": _section(
                name="Common Area",
                category_code="bed_maint",
                square_feet=4_000,
                lines=[_line(category_code="bed_maint", square_feet=0, unit_sell_cents=250)],
            )
        },
    )
    areas = measure_sqft(estimate)
    assert areas["bedSqft"] == 4_000
    assert areas["turfSqft"] == 0


def test_zero_bed_section_uses_positive_line_area():
    estimate = _estimate(
        "e",
        {
            "sec": _section(
                name="Beds",
                category_code="bed_maint",
                square_feet=0,
                lines=[
                    _line(
                        label="Bed Maintenance",
                        category_code="bed_maint",
                        square_feet=3_000,
                        unit_sell_cents=100,
                    )
                ],
            )
        },
    )
    # Section sq ft is 0, so the line price is 0 and there is no contract.
    # The bed measurement itself is the typed line, not a hardcoded 0.
    assert measure_sqft(estimate)["bedSqft"] == 3_000
    assert cents_per_sqft(estimate) is None


def test_negative_square_feet_raises():
    with pytest.raises(Exception, match="negative"):
        rows_to_estimates(
            [
                {
                    "estimate_id": "e",
                    "section_id": "s",
                    "section_name": "Turf",
                    "section_square_feet": -5,
                    "section_category_code": "turf",
                    "line_id": None,
                }
            ]
        )


def test_rows_to_estimates_groups_lines_and_skips_blank_section():
    rows = [
        {
            "estimate_id": "blank",
            "section_id": None,
            "section_name": None,
            "section_square_feet": None,
            "section_category_code": None,
            "line_id": None,
            "line_label": None,
            "line_square_feet": None,
            "qty": None,
            "unit_sell_cents": None,
            "complexity_pct": None,
            "line_category_code": None,
        },
        {
            "estimate_id": "priced",
            "section_id": "sec",
            "section_name": "Turf",
            "section_square_feet": 10_000,
            "section_category_code": "turf",
            "line_id": "line",
            "line_label": "Mowing",
            "line_square_feet": None,
            "qty": 1,
            "unit_sell_cents": 2000,
            "complexity_pct": 0,
            "line_category_code": "turf",
        },
    ]
    estimates = rows_to_estimates(rows)
    result = aggregate_price_per_sqft(estimates, exclude_estimate_id="other")
    assert result["sampleSize"] == 1
    assert result["averageCentsPerSqft"] == pytest.approx(2.0)


def test_exclude_id_is_required():
    with pytest.raises(Exception):
        aggregate_price_per_sqft([], exclude_estimate_id="")


def test_endpoint_empty_database(authed):
    async def fake_query(sql, params=None):
        if "FROM estimates e" in sql:
            return []
        return [{"id": "job", "estimate_type": "maintenance"}]

    with patch("api.estimating.query", new=AsyncMock(side_effect=fake_query)):
        response = client.get("/api/estimating/estimates/job/price-sqft-benchmark")
    assert response.status_code == 200
    assert response.json() == {"sampleSize": 0, "averageCentsPerSqft": None}


def test_endpoint_refuses_install_estimates(authed):
    with patch(
        "api.estimating.query",
        new=AsyncMock(return_value=[{"id": "job", "estimate_type": "install"}]),
    ) as mocked:
        response = client.get("/api/estimating/estimates/job/price-sqft-benchmark")
    assert response.status_code == 400
    assert mocked.await_count == 1


def test_endpoint_missing_estimate_is_404(authed):
    with patch("api.estimating.query", new=AsyncMock(return_value=[])):
        response = client.get("/api/estimating/estimates/missing/price-sqft-benchmark")
    assert response.status_code == 404
