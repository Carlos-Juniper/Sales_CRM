"""Commission payout cadence, standard plan math, and the new endpoints.

DB calls are patched (tests/conftest.py). Cadence math is pure and does not
touch MariaDB. detect_065 is exercised the same way as detect_064.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
from api import commissions, estimating  # noqa: E402
from api.commission_calc import (  # noqa: E402
    CommissionTier,
    build_installment_rows,
    build_payout_schedule,
    close_quarter_label,
    compute_plan_amount,
    derive_installment_status,
    effective_rate,
    resolve_rate_source,
    maintenance_known_halves,
    sum_prior_install_cents,
)
import scripts.migrate as M  # noqa: E402

client = TestClient(app)
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
NEW_RULES = [
    {"tier_min_cents": 0, "tier_max_cents": 100_000_000, "rate": Decimal("0.00400"), "basis": "calendar_year_cumulative_revenue", "payout_schedule": "construction_billing_quarterly"},
    {"tier_min_cents": 100_000_000, "tier_max_cents": 200_000_000, "rate": Decimal("0.00800"), "basis": "calendar_year_cumulative_revenue", "payout_schedule": "construction_billing_quarterly"},
    {"tier_min_cents": 200_000_000, "tier_max_cents": None, "rate": Decimal("0.01200"), "basis": "calendar_year_cumulative_revenue", "payout_schedule": "construction_billing_quarterly"},
]
MAINT_RULES = [
    {"tier_min_cents": 0, "tier_max_cents": None, "rate": Decimal("0.03000"), "basis": "first_year_revenue", "payout_schedule": "maintenance_3_payment"},
]


def _user(role: str, user_id: str = "rep-1") -> dict:
    return {
        "id": user_id,
        "name": "Test User",
        "email": "test.user@juniperlandscaping.com",
        "role": role,
        "branch_id": "b1",
        "avatar_initials": "TU",
    }


@pytest.fixture
def as_role():
    def _set(role: str, user_id: str = "rep-1"):
        app.dependency_overrides[require_auth] = lambda: _user(role, user_id)

    yield _set
    app.dependency_overrides.clear()


def _marginal(cumulative: int, deal: int, tiers: list[CommissionTier]) -> int:
    from api.commission_calc import marginal_amount_cents
    return marginal_amount_cents(cumulative, deal, tiers)


# ── quarter → installments ───────────────────────────────────────────────────

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

    def test_construction_and_enhancement_wait_on_billing(self):
        for schedule in ("construction_billing_quarterly", "enhancement_month_after_quarter"):
            rows = build_installment_rows(datetime(2026, 5, 15, tzinfo=ET), 101, schedule)
            assert len(rows) == 1
            assert rows[0]["installment_number"] == 1
            assert rows[0]["status"] == "pending_billing_data"
            assert rows[0]["payout_date"] is None
            assert rows[0]["amount_cents"] is None
            assert rows[0]["payout_period"] is None

    def test_unknown_schedule_is_rejected(self):
        with pytest.raises(ValueError):
            build_installment_rows(datetime(2026, 1, 1, tzinfo=ET), 10, "weekly")


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

    def test_prior_sum_uses_eastern_year_and_client_bucket(self):
        rows = [
            {
                "contract_value_cents": 200_000_000,
                "created_at": datetime(2026, 2, 1, 15, 0, tzinfo=timezone.utc),
                "client_type": None,
                "estimate_id": "a",
            },
            {
                # 2026-01-01 04:30 UTC is still 2025-12-31 23:30 ET.
                "contract_value_cents": 900_000_000,
                "created_at": datetime(2026, 1, 1, 4, 30, tzinfo=timezone.utc),
                "client_type": "new",
                "estimate_id": "b",
            },
            {
                "contract_value_cents": 50_000_000,
                "created_at": datetime(2026, 6, 1, tzinfo=ET),
                "client_type": "existing",
                "estimate_id": "c",
            },
        ]
        assert sum_prior_install_cents(rows, 2026, "new") == 200_000_000
        assert sum_prior_install_cents(rows, 2025, "new") == 900_000_000
        assert sum_prior_install_cents(rows, 2026, "existing") == 50_000_000

    def test_enhancement_basis_is_not_computed(self):
        amount = compute_plan_amount(
            estimate_type="enhancement",
            contract_value_cents=1_000_000,
            rules=[{
                "tier_min_cents": 0,
                "tier_max_cents": None,
                "rate": Decimal("0.03000"),
                "basis": "enhancement_collected_gp_gte_55",
            }],
        )
        assert amount is None

    def test_plan_resolution_follows_estimate_type(self):
        assert resolve_rate_source(None, False, "maintenance") == ("plan", "standard")
        assert resolve_rate_source(None, False, "install") == ("plan", "standard")
        assert resolve_rate_source(None, False, "enhancement") == ("plan", "standard")
        assert resolve_rate_source(None, True, "install") == ("legacy", None)
        assert resolve_rate_source("custom", True, "maintenance") == ("plan", "custom")
        assert resolve_rate_source("custom", False, "sales") == ("plan", "custom")
        assert resolve_rate_source(None, False, "sales") == ("none", None)
        assert resolve_rate_source(None, False, None) == ("none", None)
        assert resolve_rate_source(None, True, None) == ("legacy", None)


# ── creation on won ──────────────────────────────────────────────────────────

async def _run_create(query_fn, exec_fn):
    with patch("api.estimating.query", new=query_fn), patch("api.estimating.execute", new=exec_fn):
        await estimating._create_commission_on_won("est-1")


class TestCreateCommissionOnWon:
    @pytest.mark.asyncio
    async def test_no_rep_does_not_write(self):
        seen = []

        async def fake_query(sql, params=None):
            seen.append(sql)
            return [{
                "contract_value_cents": 100,
                "lead_id": "lead-1",
                "estimate_type": "maintenance",
                "crm_rep_id": None,
            }]

        execs = []

        async def fake_exec(sql, params=None):
            execs.append(sql)
            return 1

        await _run_create(fake_query, fake_exec)
        assert len(seen) == 1
        assert execs == []

    @pytest.mark.asyncio
    async def test_maintenance_standard_when_unassigned_and_no_legacy_rate(self):
        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{
                    "contract_value_cents": 10_000_000,
                    "lead_id": "lead-1",
                    "estimate_type": "maintenance",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return []
            if "FROM commission_rates" in sql:
                return []
            if "FROM users" in sql:
                return [{"role": "sales"}]
            if "commission_plan_rules" in sql:
                return MAINT_RULES
            if "e.estimate_type = 'install'" in sql:
                raise AssertionError("maintenance must not load install history")
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append((sql, list(params or [])))
            return 1

        await _run_create(fake_query, fake_exec)
        assert len(execs) == 2
        commission_params = execs[0][1]
        assert 300_000 in commission_params
        assert "standard" in commission_params
        assert None in commission_params  # client_type
        assert "commission_installments" in execs[1][0]
        assert execs[1][1].count(150_000) == 2
        assert execs[1][1].count("scheduled") == 1
        assert execs[1][1].count("pending_billing_data") == 2
        assert 6 in execs[1][1]
        assert 12 in execs[1][1]

    @pytest.mark.asyncio
    async def test_legacy_rate_keeps_amount_and_uses_plan_schedule(self):
        frozen = datetime(2026, 5, 15, 15, 0, tzinfo=timezone.utc)

        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{
                    "contract_value_cents": 20_000,
                    "lead_id": "lead-1",
                    "estimate_type": "install",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return []
            if "FROM commission_rates" in sql:
                return [{"commission_rate": Decimal("0.05000")}]
            if "FROM users" in sql:
                return [{"role": "sales"}]
            if "payout_schedule" in sql:
                assert list(params) == ["standard", "install"]
                return [{"payout_schedule": "construction_billing_quarterly"}]
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append((sql, list(params or [])))
            return 1

        with patch("api.estimating.datetime") as clock:
            clock.now.return_value = frozen
            await _run_create(fake_query, fake_exec)
        assert len(execs) == 2
        params = execs[0][1]
        assert 1_000 in params  # 5% of 20_000 cents
        assert "standard" not in params
        assert params.count(None) >= 1  # plan_key
        installment = execs[1][1]
        assert "pending_billing_data" in installment
        assert 1_000 not in installment
        assert 500 not in installment
        assert "2026-06-30" not in installment

    async def test_legacy_maintenance_rate_still_splits(self):
        frozen = datetime(2026, 2, 15, 15, 0, tzinfo=timezone.utc)

        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{
                    "contract_value_cents": 10_000,
                    "lead_id": "lead-1",
                    "estimate_type": "maintenance",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return []
            if "FROM commission_rates" in sql:
                return [{"commission_rate": Decimal("0.03000")}]
            if "FROM users" in sql:
                return [{"role": "maintenance_sales"}]
            if "payout_schedule" in sql:
                assert list(params) == ["standard", "maintenance"]
                return [{"payout_schedule": "maintenance_3_payment"}]
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append((sql, list(params or [])))
            return 1

        with patch("api.estimating.datetime") as clock:
            clock.now.return_value = frozen
            await _run_create(fake_query, fake_exec)
        installment = execs[1][1]
        assert installment.count(150) == 2
        assert "2026-03-31" in installment
        assert "March 2026" in installment
        assert "2026-04-01" not in installment
        assert installment.count("pending_billing_data") == 2

    async def test_missing_schedule_inserts_commission_without_installments(self):
        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{
                    "contract_value_cents": 20_000,
                    "lead_id": "lead-1",
                    "estimate_type": "install",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return []
            if "FROM commission_rates" in sql:
                return [{"commission_rate": Decimal("0.05000")}]
            if "FROM users" in sql:
                return [{"role": "sales"}]
            if "payout_schedule" in sql:
                return []
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append(sql)
            return 1

        await _run_create(fake_query, fake_exec)
        assert len(execs) == 1
        assert "INSERT IGNORE INTO commissions" in execs[0]

    @pytest.mark.asyncio
    async def test_assignment_wins_over_legacy_rate(self):
        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{
                    "contract_value_cents": 10_000,
                    "lead_id": "lead-1",
                    "estimate_type": "maintenance",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return [{"plan_key": "custom"}]
            if "FROM commission_rates" in sql:
                return [{"commission_rate": Decimal("0.05000")}]
            if "FROM users" in sql:
                return [{"role": "sales"}]
            if "commission_plan_rules" in sql:
                assert params[0] == "custom"
                return [{
                    "tier_min_cents": 0,
                    "tier_max_cents": None,
                    "rate": Decimal("0.10000"),
                    "basis": "first_year_revenue",
                    "payout_schedule": "maintenance_3_payment",
                }]
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append((sql, list(params or [])))
            return 1

        await _run_create(fake_query, fake_exec)
        params = execs[0][1]
        assert 1_000 in params  # 10% of 10_000, not the legacy 5% (500)
        assert 500 not in params
        assert "custom" in params
        assert execs[1][1].count(500) == 2
        assert execs[1][1].count("pending_billing_data") == 2

    @pytest.mark.asyncio
    async def test_unknown_estimate_type_without_rate_or_plan_is_a_no_op(self):
        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{
                    "contract_value_cents": 10_000,
                    "lead_id": "lead-1",
                    "estimate_type": "other",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return []
            if "FROM commission_rates" in sql:
                return []
            if "FROM users" in sql:
                raise AssertionError("plan resolution must not read users.role")
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append(sql)
            return 1

        await _run_create(fake_query, fake_exec)
        assert execs == []

    async def test_maintenance_plan_does_not_require_sales_role(self):
        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{
                    "contract_value_cents": 10_000_000,
                    "lead_id": "lead-1",
                    "estimate_type": "maintenance",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return []
            if "FROM commission_rates" in sql:
                return []
            if "FROM users" in sql:
                raise AssertionError("plan resolution must not read users.role")
            if "commission_plan_rules" in sql:
                return MAINT_RULES
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append((sql, list(params or [])))
            return 1

        await _run_create(fake_query, fake_exec)
        assert len(execs) == 2
        assert "standard" in execs[0][1]
        assert execs[1][1].count(150_000) == 2

    @pytest.mark.asyncio
    async def test_install_uses_provisional_new_tiers_and_year_cumulative(self):
        async def fake_query(sql, params=None):
            if "FROM estimates e" in sql and "crm_rep" in sql:
                return [{
                    "contract_value_cents": 100_000_000,
                    "lead_id": "lead-1",
                    "estimate_type": "install",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return []
            if "FROM commission_rates" in sql:
                return []
            if "FROM users" in sql:
                return [{"role": "install_sales"}]
            if "e.estimate_type = 'install'" in sql:
                return [{
                    "estimate_id": "older",
                    "contract_value_cents": 200_000_000,
                    "created_at": datetime.now(timezone.utc),
                    "client_type": None,
                }]
            if "commission_plan_rules" in sql:
                return NEW_RULES
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append((sql, list(params or [])))
            return 1

        await _run_create(fake_query, fake_exec)
        params = execs[0][1]
        assert 1_200_000 in params
        assert "standard" in params
        assert any(isinstance(p, str) and "provisional new-client" in p for p in params)
        # client_type stored NULL (the unresolved signal), not the word "new".
        assert "new" not in params
        assert len(execs) == 2
        assert "pending_billing_data" in execs[1][1]
        assert 1_200_000 not in execs[1][1]
        assert 600_000 not in execs[1][1]

    @pytest.mark.asyncio
    async def test_prior_year_install_does_not_fill_the_ladder(self):
        async def fake_query(sql, params=None):
            if "FROM estimates e" in sql and "crm_rep" in sql:
                return [{
                    "contract_value_cents": 100_000_000,
                    "lead_id": "lead-1",
                    "estimate_type": "install",
                    "crm_rep_id": "rep-1",
                }]
            if "FROM user_commission_plans" in sql:
                return []
            if "FROM commission_rates" in sql:
                return []
            if "FROM users" in sql:
                return [{"role": "sales"}]
            if "e.estimate_type = 'install'" in sql:
                return [{
                    "estimate_id": "old-year",
                    "contract_value_cents": 200_000_000,
                    "created_at": datetime(2020, 6, 1, tzinfo=timezone.utc),
                    "client_type": "new",
                }]
            if "commission_plan_rules" in sql:
                return NEW_RULES
            raise AssertionError(sql)

        execs = []

        async def fake_exec(sql, params=None):
            execs.append((sql, list(params or [])))
            return 1

        await _run_create(fake_query, fake_exec)
        # First $1M of a fresh year is 0.4% = $4,000 = 400_000 cents.
        assert 400_000 in execs[0][1]
        assert "pending_billing_data" in execs[1][1]
        assert 400_000 not in execs[1][1]
        assert 200_000 not in execs[1][1]


# ── endpoints ────────────────────────────────────────────────────────────────

class TestCommissionEndpoints:
    def test_summary_adds_next_payout_without_dropping_ytd(self, as_role, monkeypatch):
        as_role("sales", user_id="rep-1")
        monkeypatch.setattr("api.commissions.et_today", lambda: date(2026, 3, 15))

        async def fake_query(sql, params=None):
            if "scheduled_ytd_cents" in sql:
                assert params[0] == "rep-1"
                return [{"scheduled_ytd_cents": 10, "paid_ytd_cents": 4}]
            if "commission_installments" in sql:
                return [{
                    "id": "i1",
                    "installment_number": 1,
                    "payout_period_label": "April 2026",
                    "payout_date": date(2026, 4, 1),
                    "amount_cents": 100,
                    "status": "scheduled",
                    "commission_status": "approved",
                }]
            return []

        with patch("api.commissions.query", new=fake_query):
            own = client.get("/api/commissions/summary")
            other = client.get("/api/commissions/summary?user_id=someone-else")
        assert other.status_code == 403
        assert own.status_code == 200
        body = own.json()
        assert body["scheduled_ytd_cents"] == 10
        assert body["paid_ytd_cents"] == 4
        assert body["upcoming_cents"] == 100
        assert body["due_cents"] == 0
        assert body["next_payout"] == {
            "payout_period": "April 2026",
            "payout_date": "2026-04-01",
            "amount_cents": 100,
        }

    def test_list_includes_quarter_plan_and_installments(self, as_role, monkeypatch):
        as_role("sales", user_id="rep-1")
        monkeypatch.setattr("api.commissions.et_today", lambda: date(2026, 4, 1))
        created = datetime(2026, 2, 10, 16, 0, tzinfo=timezone.utc)

        async def fake_query(sql, params=None):
            if "commission_installments" in sql:
                return [
                    {
                        "id": "i1", "commission_id": "c1", "installment_number": 1,
                        "payout_period_label": "April 2026", "payout_date": date(2026, 4, 1),
                        "amount_cents": 1, "status": "scheduled",
                    },
                    {
                        "id": "i2", "commission_id": "c1", "installment_number": 2,
                        "payout_period_label": "July 2026", "payout_date": date(2026, 7, 1),
                        "amount_cents": 2, "status": "scheduled",
                    },
                ]
            return [{
                "id": "c1",
                "estimate_id": "e1",
                "lead_id": "l1",
                "user_id": "rep-1",
                "contract_value_cents": 100,
                "commission_rate": Decimal("0.03000"),
                "commission_amount_cents": 3,
                "status": "approved",
                "approved_at": created,
                "paid_at": None,
                "payment_period": None,
                "notes": None,
                "created_at": created,
                "updated_at": created,
                "plan_key": "standard",
                "client_type": None,
                "rep_name": "Alex",
                "rep_email": "a@x.com",
                "property_name": "Oak",
                "estimate_number": 4,
                "aspire_number": None,
                "estimate_type": "maintenance",
            }]

        with patch("api.commissions.query", new=fake_query):
            resp = client.get("/api/commissions/list")
        assert resp.status_code == 200
        row = resp.json()[0]
        assert row["commission_amount_cents"] == 3
        assert row["close_quarter"] == "2026-Q1"
        assert row["plan_key"] == "standard"
        assert row["client_type"] is None
        assert row["installments"][0]["status"] == "due"
        assert row["installments"][1]["status"] == "upcoming"
        assert row["installments"][0]["id"] == "i1"
        assert row["installments"][0]["payout_period"] == "April 2026"
        assert row["installments"][0]["amount_cents"] + row["installments"][1]["amount_cents"] == 3

    def test_payout_schedule_auth_and_shape(self, as_role, monkeypatch):
        monkeypatch.setattr("api.commissions.et_today", lambda: date(2026, 3, 15))
        created = datetime(2026, 2, 10, 16, 0, tzinfo=timezone.utc)
        rows = [
            {
                "commission_id": "c1",
                "commission_amount_cents": 100,
                "commission_status": "approved",
                "created_at": created,
                "installment_id": "i1",
                "installment_number": 1,
                "payout_period_label": "April 2026",
                "payout_date": date(2026, 4, 1),
                "amount_cents": 50,
                "installment_status": "scheduled",
            },
            {
                "commission_id": "c1",
                "commission_amount_cents": 100,
                "commission_status": "approved",
                "created_at": created,
                "installment_id": "i2",
                "installment_number": 2,
                "payout_period_label": "July 2026",
                "payout_date": date(2026, 7, 1),
                "amount_cents": 50,
                "installment_status": "scheduled",
            },
        ]

        as_role("sales", user_id="rep-1")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=rows) as mock_q:
            denied = client.get("/api/commissions/payout-schedule?user_id=other&year=2026")
        assert denied.status_code == 403
        mock_q.assert_not_awaited()

        with patch("api.commissions.query", new_callable=AsyncMock, return_value=rows):
            own = client.get("/api/commissions/payout-schedule?year=2026")
        assert own.status_code == 200
        body = own.json()
        assert body["user_id"] == "rep-1"
        assert body["year"] == 2026
        assert body["quarters"][0]["close_quarter"] == "2026-Q1"
        assert body["quarters"][0]["sales_count"] == 1
        assert body["quarters"][0]["commission_total_cents"] == 100
        assert body["by_payout_period"][0]["payout_period"] == "April 2026"
        assert body["by_payout_period"][0]["amount_cents"] == 50
        assert body["by_payout_period"][0]["status"] == "upcoming"

        as_role("regional_director", user_id="rd-1")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=[]):
            allowed = client.get("/api/commissions/payout-schedule?user_id=rep-9&year=2026")
        assert allowed.status_code == 200
        assert allowed.json()["user_id"] == "rep-9"
        assert allowed.json()["quarters"] == []

    def test_reps_include_plan_fields(self, as_role):
        as_role("admin")

        async def fake_query(sql, params=None):
            assert "sales" in params
            assert "maintenance_sales" in params
            return [{
                "id": "rep-1",
                "name": "Alex",
                "email": "a@x.com",
                "commission_rate": Decimal("0.05000"),
                "effective_date": date(2026, 1, 1),
                "plan_key": "standard",
                "plan_name": "Standard Sales Commission",
            }]

        with patch("api.commissions.query", new=fake_query):
            resp = client.get("/api/commissions/reps")
        assert resp.status_code == 200
        row = resp.json()[0]
        assert row["plan_key"] == "standard"
        assert row["plan_name"] == "Standard Sales Commission"
        assert row["commission_rate"] == 0.05

    def test_mark_paid_updates_installments_and_keeps_auth(self, as_role):
        as_role("sales")
        denied = client.post(
            "/api/commissions/c1/mark-paid",
            json={"payment_period": "April 2026"},
        )
        assert denied.status_code == 403

        as_role("admin")
        with patch("api.commissions.execute", new_callable=AsyncMock, return_value=0) as missing:
            resp = client.post(
                "/api/commissions/missing/mark-paid",
                json={"payment_period": "April 2026"},
            )
        assert resp.status_code == 404
        assert missing.await_count == 1

        with patch("api.commissions.execute", new_callable=AsyncMock, return_value=1) as paid:
            resp = client.post(
                "/api/commissions/c1/mark-paid",
                json={"payment_period": "April 2026"},
            )
        assert resp.status_code == 200
        assert resp.json() == {"success": True}
        sqls = [call.args[0] for call in paid.await_args_list]
        assert "payment_period" in sqls[0]
        assert "commission_installments" in sqls[1]
        assert paid.await_args_list[1].args[1] == ["c1"]

    def test_installment_mark_paid(self, as_role):
        as_role("sales")
        denied = client.post("/api/commissions/installments/i1/mark-paid")
        assert denied.status_code == 403

        as_role("vice_president")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=[]):
            missing = client.post("/api/commissions/installments/nope/mark-paid")
        assert missing.status_code == 404

        async def cancelled_query(sql, params=None):
            return [{
                "id": "i1",
                "commission_id": "c1",
                "status": "cancelled",
                "payout_period_label": "April 2026",
                "commission_status": "cancelled",
            }]

        with patch("api.commissions.query", new=cancelled_query), \
             patch("api.commissions.execute", new_callable=AsyncMock) as exec_mock:
            blocked = client.post("/api/commissions/installments/i1/mark-paid")
        assert blocked.status_code == 409
        exec_mock.assert_not_awaited()

        queries = {"n": 0}

        async def one_open(sql, params=None):
            queries["n"] += 1
            if queries["n"] == 1:
                return [{
                    "id": "i1",
                    "commission_id": "c1",
                    "status": "scheduled",
                    "payout_period_label": "April 2026",
                    "commission_status": "approved",
                }]
            return [
                {"installment_number": 1, "status": "paid", "payout_period_label": "April 2026"},
                {"installment_number": 2, "status": "scheduled", "payout_period_label": "July 2026"},
            ]

        with patch("api.commissions.query", new=one_open), \
             patch("api.commissions.execute", new_callable=AsyncMock, return_value=1) as exec_mock:
            partial = client.post("/api/commissions/installments/i1/mark-paid")
        assert partial.status_code == 200
        assert exec_mock.await_count == 1
        assert "commission_installments" in exec_mock.await_args_list[0].args[0]

        queries["n"] = 0

        async def both_paid(sql, params=None):
            queries["n"] += 1
            if queries["n"] == 1:
                return [{
                    "id": "i2",
                    "commission_id": "c1",
                    "status": "scheduled",
                    "payout_period_label": "July 2026",
                    "commission_status": "approved",
                }]
            return [
                {"installment_number": 1, "status": "paid", "payout_period_label": "April 2026"},
                {"installment_number": 2, "status": "paid", "payout_period_label": "July 2026"},
            ]

        with patch("api.commissions.query", new=both_paid), \
             patch("api.commissions.execute", new_callable=AsyncMock, return_value=1) as exec_mock:
            done = client.post("/api/commissions/installments/i2/mark-paid")
        assert done.status_code == 200
        assert exec_mock.await_count == 2
        commission_sql, commission_params = exec_mock.await_args_list[1].args
        assert "UPDATE commissions" in commission_sql
        assert commission_params[0] == "July 2026"
        assert commission_params[1] == "c1"

        queries["n"] = 0

        async def single_paid(sql, params=None):
            queries["n"] += 1
            if queries["n"] == 1:
                return [{
                    "id": "i1",
                    "commission_id": "c1",
                    "status": "scheduled",
                    "payout_period_label": "June 2026",
                    "commission_status": "approved",
                }]
            return [
                {"installment_number": 1, "status": "paid", "payout_period_label": "June 2026"},
            ]

        with patch("api.commissions.query", new=single_paid), \
             patch("api.commissions.execute", new_callable=AsyncMock, return_value=1) as exec_mock:
            done = client.post("/api/commissions/installments/i1/mark-paid")
        assert done.status_code == 200
        assert exec_mock.await_count == 2
        commission_sql, commission_params = exec_mock.await_args_list[1].args
        assert "UPDATE commissions" in commission_sql
        assert commission_params[0] == "June 2026"
        assert commission_params[1] == "c1"

        queries["n"] = 0

        async def third_still_pending(sql, params=None):
            queries["n"] += 1
            if queries["n"] == 1:
                return [{
                    "id": "i2",
                    "commission_id": "c1",
                    "status": "scheduled",
                    "payout_period_label": None,
                    "commission_status": "approved",
                }]
            return [
                {"installment_number": 1, "status": "paid", "payout_period_label": "March 2026"},
                {"installment_number": 2, "status": "paid", "payout_period_label": None},
                {"installment_number": 3, "status": "pending_billing_data", "payout_period_label": None},
            ]

        with patch("api.commissions.query", new=third_still_pending), \
             patch("api.commissions.execute", new_callable=AsyncMock, return_value=1) as exec_mock:
            waiting = client.post("/api/commissions/installments/i2/mark-paid")
        assert waiting.status_code == 200
        assert exec_mock.await_count == 1

        queries["n"] = 0

        async def all_three_paid(sql, params=None):
            queries["n"] += 1
            if queries["n"] == 1:
                return [{
                    "id": "i3",
                    "commission_id": "c1",
                    "status": "pending_billing_data",
                    "payout_period_label": None,
                    "commission_status": "approved",
                }]
            return [
                {"installment_number": 1, "status": "paid", "payout_period_label": "March 2026"},
                {"installment_number": 2, "status": "paid", "payout_period_label": None},
                {"installment_number": 3, "status": "paid", "payout_period_label": "December 2026"},
            ]

        with patch("api.commissions.query", new=all_three_paid), \
             patch("api.commissions.execute", new_callable=AsyncMock, return_value=1) as exec_mock:
            done = client.post("/api/commissions/installments/i3/mark-paid")
        assert done.status_code == 200
        assert exec_mock.await_count == 2
        commission_sql, commission_params = exec_mock.await_args_list[1].args
        assert "UPDATE commissions" in commission_sql
        assert commission_params[0] == "December 2026"

    @pytest.mark.asyncio
    async def test_cancel_commission_cancels_unpaid_installments(self):
        with patch("api.commissions.execute", new_callable=AsyncMock) as exec_mock:
            await commissions.cancel_commission("c1")
        sqls = [call.args[0] for call in exec_mock.await_args_list]
        assert "UPDATE commissions" in sqls[0]
        assert "cancelled" in sqls[0]
        assert "commission_installments" in sqls[1]
        assert "cancelled" in sqls[1]
        assert "status != 'paid'" in sqls[1]
        assert exec_mock.await_args_list[1].args[1] == ["c1"]


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
        assert april["status"] == "due"


# ── migration 065 ────────────────────────────────────────────────────────────

class TestMigration065:
    def test_detector_registered_and_keys_on_own_effects(self, monkeypatch):
        assert M._DETECT["065_commission_cadence_and_plans"] is M.detect_065

        def boom(*_args, **_kwargs):
            raise AssertionError("detector queried before schema was present")

        monkeypatch.setattr(M, "_fetch_one", boom)
        monkeypatch.setattr(M, "table_exists", lambda conn, name: False)
        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(M, "index_exists", lambda conn, table, index: True)
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, table, column: not (table == "commissions" and column == "plan_key"),
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, table, column: not (
                table == "commission_plan_rules" and column == "payout_schedule"
            ),
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(
            M, "table_exists",
            lambda conn, name: name != "commission_billing_events",
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, table, column: not (
                table == "commissions" and column == "contract_start_date"
            ),
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(
            M, "index_exists",
            lambda conn, table, index: index != "uq_commission_installment",
        )
        assert M.detect_065(None) is False

    def test_detector_requires_seed_and_complete_backfill(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(M, "index_exists", lambda conn, table, index: True)
        state = {"maint": 1, "install": 1, "enh": 1, "missing": 0}

        def fetch(_conn, sql, params=()):
            if "first_year_revenue" in sql:
                return {"cnt": state["maint"]}
            if "client_type = 'new'" in sql:
                return {"cnt": state["install"]}
            if "enhancement_collected_gp_gte_55" in sql:
                return {"cnt": state["enh"]}
            if "installment_number = 1" in sql:
                return {"cnt": state["missing"]}
            raise AssertionError(sql)

        monkeypatch.setattr(M, "_fetch_one", fetch)
        assert M.detect_065(None) is True

        state["maint"] = 0
        assert M.detect_065(None) is False
        state["maint"] = 1
        state["enh"] = 0
        assert M.detect_065(None) is False
        state["enh"] = 1
        state["missing"] = 3
        assert M.detect_065(None) is False
        state["missing"] = 0
        assert M.detect_065(None) is True

    def test_sql_is_idempotent_and_seeds_standard_rules_only(self):
        path = M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql"
        sql = path.read_text()
        upper = sql.upper()
        assert "CREATE TABLE IF NOT EXISTS" in upper
        assert "ON DUPLICATE KEY UPDATE" in upper
        assert "INSERT INTO COMMISSION_PLANS" in upper
        assert "INSERT INTO COMMISSION_PLAN_RULES" in upper
        assert "INSERT INTO USER_COMMISSION_PLANS" not in upper
        assert "INSERT IGNORE INTO USER_COMMISSION_PLANS" not in upper
        assert "INSERT INTO COMMISSION_RATES" not in upper
        assert "UPDATE COMMISSION_RATES" not in upper
        assert "'maintenance_3_payment'" in sql
        assert "'construction_billing_quarterly'" in sql
        assert "'enhancement_month_after_quarter'" in sql
        assert "pending_billing_data" in sql
        assert "commission_billing_events" in sql
        assert "contract_start_date" in sql
        assert "billing_installment_number" in sql
        assert "collected_amount_cents" in sql
        assert "INSERT INTO COMMISSION_BILLING_EVENTS" not in upper
        assert "COALESCE(e.estimate_type, '') = 'maintenance'" in sql
        assert "COALESCE(e.estimate_type, '') <> 'maintenance'" in sql
        assert "SELECT 3" in upper
        assert "maintenance_split_lagged" not in sql
        assert "'quarter_end'" not in sql
        assert "0.03000" in sql
        assert "0.00400" in sql
        assert "0.00800" in sql
        assert "0.01200" in sql
        assert "0.00000" in sql
        assert "0.01500" in sql
        assert "100000000" in sql
        assert "200000000" in sql
        assert "300000000" in sql
        assert "enhancement_collected_gp_gte_55" in sql
        assert "first_year_revenue" in sql
        assert "calendar_year_cumulative_revenue" in sql
        assert "NOT EXISTS" in upper
        stmts = M.split_statements(sql)
        first_words = [s.split()[0].upper() for s in stmts]
        assert "ALTER" not in first_words
        assert "SET" in first_words
        assert "INSERT" in first_words
        assert any("information_schema" in s.lower() for s in stmts)
        assert any("PREPARE" == word for word in first_words)
