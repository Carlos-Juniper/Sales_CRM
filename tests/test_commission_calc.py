"""Pure commission date, tier, and cent math."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from api.commission_calc import (
    CommissionTier,
    build_installment_rows,
    calendar_date,
    close_quarter_label,
    compute_plan_amount,
    effective_rate,
    maintenance_known_halves,
    marginal_amount_cents,
)

ET = ZoneInfo("America/New_York")

NEW_TIERS = [
    CommissionTier(0, 100_000_000, Decimal("0.004")),
    CommissionTier(100_000_000, 200_000_000, Decimal("0.008")),
    CommissionTier(200_000_000, None, Decimal("0.012")),
]
EXISTING_TIERS = [
    CommissionTier(0, 300_000_000, Decimal("0.000")),
    CommissionTier(300_000_000, None, Decimal("0.004")),
]
MAINT_RULES = [
    {"tier_min_cents": 0, "tier_max_cents": None, "rate": Decimal("0.03000"), "basis": "first_year_revenue", "payout_schedule": "maintenance_3_payment"},
]


def _marginal(cumulative: int, deal: int, tiers: list[CommissionTier]) -> int:
    return marginal_amount_cents(cumulative, deal, tiers)


class TestPayoutCadence:
    def test_maintenance_three_payments_follow_the_start_quarter(self):
        cases = [
            (datetime(2026, 1, 1, 0, 10, tzinfo=ET), "2026-Q1", date(2026, 3, 31), "March 2026"),
            (datetime(2026, 3, 31, 23, 30, tzinfo=ET), "2026-Q1", date(2026, 3, 31), "March 2026"),
            (datetime(2026, 4, 1, 0, 10, tzinfo=ET), "2026-Q2", date(2026, 6, 30), "June 2026"),
            (datetime(2026, 6, 30, 23, 59, tzinfo=ET), "2026-Q2", date(2026, 6, 30), "June 2026"),
            (datetime(2026, 9, 30, 12, 0, tzinfo=ET), "2026-Q3", date(2026, 9, 30), "September 2026"),
            (datetime(2026, 12, 31, 23, 30, tzinfo=ET), "2026-Q4", date(2026, 12, 31), "December 2026"),
        ]
        for close_at, quarter, payout, label in cases:
            assert close_quarter_label(close_at) == quarter
            rows = build_installment_rows(close_at, 300, "maintenance_3_payment")
            assert [row["installment_number"] for row in rows] == [1, 2, 3]
            assert rows[0]["status"] == "scheduled"
            assert rows[0]["payout_date"] == payout
            assert rows[0]["payout_period"] == label
            assert rows[0]["amount_cents"] == 150
            assert rows[1]["status"] == "pending_billing_data"
            assert rows[1]["payout_date"] is None
            assert rows[1]["amount_cents"] == 150
            assert rows[1]["billing_installment_number"] == 6
            assert rows[2]["status"] == "pending_billing_data"
            assert rows[2]["payout_date"] is None
            assert rows[2]["amount_cents"] is None
            assert rows[2]["billing_installment_number"] == 12

    def test_contract_start_dates_payment_one(self):
        rows = build_installment_rows(
            datetime(2026, 1, 15, tzinfo=ET),
            300,
            "maintenance_3_payment",
            contract_start=date(2026, 8, 1),
        )
        assert rows[0]["payout_date"] == date(2026, 9, 30)
        assert rows[0]["payout_period"] == "September 2026"
        assert rows[1]["payout_date"] is None
        assert rows[2]["payout_date"] is None

    def test_et_utc_boundary_mar_31_and_apr_1(self):
        q1_et = datetime(2026, 3, 31, 23, 30, tzinfo=ET)
        q2_et = datetime(2026, 4, 1, 0, 10, tzinfo=ET)
        # Same instants expressed in UTC. Late March 2026 is EDT (UTC-4).
        q1_utc = q1_et.astimezone(timezone.utc)
        q2_utc = q2_et.astimezone(timezone.utc)
        assert q1_utc == datetime(2026, 4, 1, 3, 30, tzinfo=timezone.utc)
        assert q2_utc == datetime(2026, 4, 1, 4, 10, tzinfo=timezone.utc)
        assert close_quarter_label(q1_et) == "2026-Q1"
        assert close_quarter_label(q1_utc) == "2026-Q1"
        assert close_quarter_label(q2_et) == "2026-Q2"
        assert close_quarter_label(q2_utc) == "2026-Q2"
        # Naive strings are UTC, so the UTC clock can already say April while
        # Eastern is still March.
        assert close_quarter_label("2026-04-01 03:30:00") == "2026-Q1"
        assert close_quarter_label("2026-04-01 04:10:00") == "2026-Q2"
        # UTC midnight April 1 is still March 31 evening in Eastern.
        assert close_quarter_label(datetime(2026, 4, 1, 1, 0, tzinfo=timezone.utc)) == "2026-Q1"

    def test_q4_utc_new_year_stays_in_prior_eastern_quarter(self):
        q4_et = datetime(2026, 12, 31, 23, 30, tzinfo=ET)
        q4_utc = q4_et.astimezone(timezone.utc)
        assert q4_utc.year == 2027
        assert close_quarter_label(q4_utc) == "2026-Q4"
        rows = build_installment_rows(q4_utc, 300, "maintenance_3_payment")
        assert rows[0]["payout_date"] == date(2026, 12, 31)
        assert rows[0]["payout_period"] == "December 2026"
        assert rows[1]["payout_date"] is None
        assert rows[2]["payout_date"] is None

    def test_known_halves_reconcile_to_the_annual_commission(self):
        for total in (0, 1, 2, 5, 100, 101, 999, 2_400_000):
            first, second = maintenance_known_halves(total)
            assert first + second == total
        rows = build_installment_rows(datetime(2026, 5, 1, tzinfo=ET), 101, "maintenance_3_payment")
        assert rows[0]["amount_cents"] == 51
        assert rows[1]["amount_cents"] == 50
        assert rows[2]["amount_cents"] is None

    def test_construction_waits_on_billing(self):
        rows = build_installment_rows(
            datetime(2026, 5, 15, tzinfo=ET), 101, "construction_billing_quarterly",
        )
        assert len(rows) == 1
        assert rows[0]["installment_number"] == 1
        assert rows[0]["status"] == "pending_billing_data"
        assert rows[0]["payout_date"] is None
        assert rows[0]["amount_cents"] is None
        assert rows[0]["payout_period"] is None

    def test_enhancement_schedule_is_not_a_plan_schedule(self):
        with pytest.raises(ValueError):
            build_installment_rows(
                datetime(2026, 5, 15, tzinfo=ET), 101, "enhancement_month_after_quarter",
            )

    def test_unknown_schedule_is_rejected(self):
        with pytest.raises(ValueError):
            build_installment_rows(datetime(2026, 1, 1, tzinfo=ET), 10, "weekly")


class TestPlanMath:
    def test_maintenance_three_percent_of_annual_value(self):
        # $100,000 annual contract → $3,000.
        amount = compute_plan_amount(
            estimate_type="maintenance",
            contract_value_cents=10_000_000,
            rules=MAINT_RULES,
        )
        assert amount == 300_000
        assert effective_rate(amount, 10_000_000) == Decimal("0.03000")
        # 101 cents * 3% = 3.03 → 3 cents, and the split still reconciles.
        odd = compute_plan_amount(
            estimate_type="maintenance",
            contract_value_cents=101,
            rules=MAINT_RULES,
        )
        assert odd == 3
        first, second = maintenance_known_halves(odd)
        assert (first, second) == (2, 1)

    def test_new_client_three_million_is_24k(self):
        amount = _marginal(0, 300_000_000, NEW_TIERS)
        assert amount == 2_400_000  # $24,000

    def test_existing_client_nine_million_is_24k(self):
        amount = _marginal(0, 900_000_000, EXISTING_TIERS)
        assert amount == 2_400_000

    def test_cumulative_two_deals_then_year_reset(self):
        first = _marginal(0, 200_000_000, NEW_TIERS)
        second = _marginal(200_000_000, 100_000_000, NEW_TIERS)
        assert first == 1_200_000  # $4k + $8k
        assert second == 1_200_000  # the next $1M is entirely in the 1.2% band
        assert first + second == 2_400_000
        # A new calendar year starts the ladder over.
        reset = _marginal(0, 100_000_000, NEW_TIERS)
        assert reset == 400_000

    def test_date_only_values_are_not_shifted(self):
        assert calendar_date(date(2026, 4, 1)) == date(2026, 4, 1)
        assert calendar_date("2026-04-01") == date(2026, 4, 1)
        # UTC midnight April 1 is still March 31 evening in Eastern.
        assert calendar_date(datetime(2026, 4, 1, 1, 0, tzinfo=timezone.utc)) == date(2026, 3, 31)

    def test_unknown_basis_is_not_computed(self):
        amount = compute_plan_amount(
            estimate_type="install",
            contract_value_cents=1_000_000,
            rules=[{
                "tier_min_cents": 0,
                "tier_max_cents": None,
                "rate": Decimal("0.03000"),
                "basis": "not_a_revenue_basis",
            }],
        )
        assert amount is None


