"""Installment status and payout-schedule response shaping."""
from __future__ import annotations

from datetime import date

import pytest

from api.commission_schedule import (
    build_payout_schedule,
    derive_installment_status,
    rollup_status,
)


class TestInstallmentStatus:
    def test_paid_due_upcoming_cancelled_with_frozen_today(self):
        today = date(2026, 4, 1)
        assert derive_installment_status(
            stored_status="scheduled", commission_status="approved",
            payout_date=date(2026, 7, 1), today=today,
        ) == "upcoming"
        assert derive_installment_status(
            stored_status="scheduled", commission_status="approved",
            payout_date=date(2026, 4, 1), today=today,
        ) == "due"
        assert derive_installment_status(
            stored_status="pending_billing_data", commission_status="approved",
            payout_date=None, today=today,
        ) == "pending_billing_data"
        assert derive_installment_status(
            stored_status="scheduled", commission_status="approved",
            payout_date=date(2026, 3, 1), today=today,
        ) == "due"
        assert derive_installment_status(
            stored_status="paid", commission_status="approved",
            payout_date=date(2026, 7, 1), today=today,
        ) == "paid"
        assert derive_installment_status(
            stored_status="scheduled", commission_status="paid",
            payout_date=date(2026, 12, 1), today=today,
        ) == "paid"
        assert derive_installment_status(
            stored_status="scheduled", commission_status="cancelled",
            payout_date=date(2026, 4, 1), today=today,
        ) == "cancelled"
        assert derive_installment_status(
            stored_status="cancelled", commission_status="approved",
            payout_date=date(2026, 4, 1), today=today,
        ) == "cancelled"
        # A installment already marked paid stays paid if the parent is cancelled.
        assert derive_installment_status(
            stored_status="paid", commission_status="cancelled",
            payout_date=date(2026, 4, 1), today=today,
        ) == "paid"


# ── plan math ────────────────────────────────────────────────────────────────

class TestScheduleRollup:
    def test_two_deals_roll_into_one_check(self):
        schedule = build_payout_schedule([
            {
                "close_quarter": "2026-Q1",
                "commission_amount_cents": 101,
                "installments": [
                    {"installment_number": 1, "payout_period": "April 2026", "payout_date": "2026-04-01", "amount_cents": 50, "status": "due"},
                    {"installment_number": 2, "payout_period": "July 2026", "payout_date": "2026-07-01", "amount_cents": 51, "status": "upcoming"},
                ],
            },
            {
                "close_quarter": "2026-Q1",
                "commission_amount_cents": 40,
                "installments": [
                    {"installment_number": 1, "payout_period": "April 2026", "payout_date": "2026-04-01", "amount_cents": 20, "status": "paid"},
                    {"installment_number": 2, "payout_period": "July 2026", "payout_date": "2026-07-01", "amount_cents": 20, "status": "upcoming"},
                ],
            },
        ])
        quarter = schedule["quarters"][0]
        assert quarter["sales_count"] == 2
        assert quarter["commission_total_cents"] == 141
        assert quarter["installments"][0]["amount_cents"] == 70
        assert quarter["installments"][0]["status"] == "due"
        april = schedule["by_payout_period"][0]
        assert april["amount_cents"] == 70
        assert april["amount_partial"] is False
        assert april["status"] == "due"
        assert april["bucket"] == "dated"

    def test_null_amounts_stay_null_and_partial_sums_are_flagged(self):
        schedule = build_payout_schedule([
            {
                "close_quarter": "2026-Q3",
                "commission_amount_cents": 300,
                "installments": [
                    {
                        "installment_number": 3,
                        "payout_period": None,
                        "payout_date": None,
                        "amount_cents": None,
                        "status": "pending_billing_data",
                    },
                ],
            },
            {
                "close_quarter": "2026-Q1",
                "commission_amount_cents": 80,
                "installments": [
                    {
                        "installment_number": 1,
                        "payout_period": "April 2026",
                        "payout_date": "2026-04-01",
                        "amount_cents": 50,
                        "status": "upcoming",
                    },
                    {
                        "installment_number": 1,
                        "payout_period": "April 2026",
                        "payout_date": "2026-04-01",
                        "amount_cents": None,
                        "status": "upcoming",
                    },
                ],
            },
        ])
        pending = schedule["quarters"][1]["installments"][0]
        assert pending["amount_cents"] is None
        assert pending["amount_partial"] is False
        mixed = schedule["quarters"][0]["installments"][0]
        assert mixed["amount_cents"] == 50
        assert mixed["amount_partial"] is True
        april = next(row for row in schedule["by_payout_period"] if row["payout_date"] == "2026-04-01")
        assert april["amount_cents"] == 50
        assert april["amount_partial"] is True

    def test_undated_known_amounts_do_not_share_a_bucket_with_unknown(self):
        schedule = build_payout_schedule([
            {
                "close_quarter": "2026-Q3",
                "commission_amount_cents": 900,
                "installments": [
                    {
                        "installment_number": 1,
                        "payout_period": "September 2026",
                        "payout_date": "2026-09-30",
                        "amount_cents": 150,
                        "status": "upcoming",
                    },
                    {
                        "installment_number": 2,
                        "payout_period": None,
                        "payout_date": None,
                        "amount_cents": 150,
                        "status": "pending_billing_data",
                    },
                    {
                        "installment_number": 3,
                        "payout_period": None,
                        "payout_date": None,
                        "amount_cents": None,
                        "status": "pending_billing_data",
                    },
                ],
            },
            {
                "close_quarter": "2026-Q3",
                "commission_amount_cents": 400,
                "installments": [
                    {
                        "installment_number": 1,
                        "payout_period": None,
                        "payout_date": None,
                        "amount_cents": None,
                        "status": "pending_billing_data",
                    },
                ],
            },
        ])
        periods = schedule["by_payout_period"]
        assert [row["bucket"] for row in periods] == [
            "dated", "unscheduled", "pending_billing_data",
        ]
        assert periods[0]["amount_cents"] == 150
        assert periods[0]["amount_partial"] is False
        assert periods[1]["payout_date"] is None
        assert periods[1]["payout_period"] == "Unscheduled"
        assert periods[1]["amount_cents"] == 150
        assert periods[1]["amount_partial"] is False
        assert periods[2]["amount_cents"] is None
        assert periods[2]["amount_partial"] is False
        assert periods[2]["status"] == "pending_billing_data"

    def test_upcoming_is_not_hidden_by_a_pending_sibling(self):
        assert rollup_status(["upcoming", "pending_billing_data"]) == "upcoming"
        assert rollup_status(["due", "upcoming", "pending_billing_data"]) == "due"
        assert rollup_status(["pending_billing_data", "paid"]) == "pending_billing_data"
        schedule = build_payout_schedule([
            {
                "close_quarter": "2026-Q3",
                "commission_amount_cents": 300,
                "installments": [
                    {
                        "installment_number": 1,
                        "payout_period": "September 2026",
                        "payout_date": "2026-09-30",
                        "amount_cents": 150,
                        "status": "upcoming",
                    },
                    {
                        "installment_number": 1,
                        "payout_period": None,
                        "payout_date": None,
                        "amount_cents": None,
                        "status": "pending_billing_data",
                    },
                ],
            },
        ])
        rows = schedule["quarters"][0]["installments"]
        assert len(rows) == 2
        upcoming = next(row for row in rows if row["status"] == "upcoming")
        pending = next(row for row in rows if row["status"] == "pending_billing_data")
        assert upcoming["payout_date"] == "2026-09-30"
        assert upcoming["amount_cents"] == 150
        assert upcoming["amount_partial"] is False
        assert pending["amount_cents"] is None
        assert pending["payout_date"] is None

    def test_unknown_status_is_not_treated_as_upcoming(self):
        with pytest.raises(ValueError, match="mystery"):
            rollup_status(["mystery"])

    def test_undated_periods_sort_last(self):
        schedule = build_payout_schedule([
            {
                "close_quarter": "2026-Q1",
                "commission_amount_cents": 10,
                "installments": [
                    {
                        "installment_number": 2,
                        "payout_period": None,
                        "payout_date": None,
                        "amount_cents": 10,
                        "status": "pending_billing_data",
                    },
                    {
                        "installment_number": 1,
                        "payout_period": "December 2026",
                        "payout_date": "2026-12-31",
                        "amount_cents": 10,
                        "status": "upcoming",
                    },
                ],
            },
        ])
        assert [row["bucket"] for row in schedule["by_payout_period"]] == [
            "dated", "unscheduled",
        ]

