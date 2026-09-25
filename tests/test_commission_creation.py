"""Commission creation on won, cancellation on lost, and the write transaction."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
from api.commission_calc import calendar_date  # noqa: E402
from api.commission_service import create_on_won  # noqa: E402
import db  # noqa: E402

client = TestClient(app)

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


@asynccontextmanager
async def _noop_tx():
    yield None


async def _run_create(query_fn, exec_fn):
    with patch("api.commission_service.query", new=query_fn), \
         patch("api.commission_service.execute", new=exec_fn), \
         patch("api.commission_service.transaction", new=_noop_tx):
        await create_on_won("est-1")


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
            if "v_current_commission_plans" in sql:
                return []
            if "v_current_commission_rates" in sql:
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
            if "v_current_commission_plans" in sql:
                return []
            if "v_current_commission_rates" in sql:
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

        with patch("api.commission_service.datetime") as clock:
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
            if "v_current_commission_plans" in sql:
                return []
            if "v_current_commission_rates" in sql:
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

        with patch("api.commission_service.datetime") as clock:
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
            if "v_current_commission_plans" in sql:
                return []
            if "v_current_commission_rates" in sql:
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
            if "v_current_commission_plans" in sql:
                return [{"plan_key": "custom"}]
            if "v_current_commission_rates" in sql:
                raise AssertionError("legacy rate query must not run when a plan is assigned")
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
            if "v_current_commission_plans" in sql:
                return []
            if "v_current_commission_rates" in sql:
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
            if "v_current_commission_plans" in sql:
                return []
            if "v_current_commission_rates" in sql:
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
            if "v_current_commission_plans" in sql:
                return []
            if "v_current_commission_rates" in sql:
                return []
            if "FROM users" in sql:
                return [{"role": "install_sales"}]
            if "e.estimate_type = 'install'" in sql:
                assert "YEAR(" in sql
                assert "client_type = 'new' OR c.client_type IS NULL" in sql
                assert params[2] == calendar_date(datetime.now(timezone.utc)).year
                return [{"prior_cents": 200_000_000}]
            if "commission_plan_rules" in sql:
                assert "client_type <=> %s" in sql
                assert sql.count("%s") == 3
                assert params[2] == "new"
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
            if "v_current_commission_plans" in sql:
                return []
            if "v_current_commission_rates" in sql:
                return []
            if "FROM users" in sql:
                return [{"role": "sales"}]
            if "e.estimate_type = 'install'" in sql:
                assert "YEAR(" in sql
                assert "America/New_York" in sql
                assert "client_type = 'new' OR c.client_type IS NULL" in sql
                return [{"prior_cents": 0}]
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

    @pytest.mark.asyncio
    async def test_installment_failure_does_not_commit_the_commission(self):
        events = []

        @asynccontextmanager
        async def tx():
            events.append("begin")
            try:
                yield None
                events.append("commit")
            except BaseException:
                events.append("rollback")
                raise

        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{
                    "contract_value_cents": 10_000,
                    "lead_id": "lead-1",
                    "estimate_type": "maintenance",
                    "crm_rep_id": "rep-1",
                }]
            if "v_current_commission_plans" in sql or "v_current_commission_rates" in sql:
                return []
            if "commission_plan_rules" in sql:
                return MAINT_RULES
            raise AssertionError(sql)

        async def fake_exec(sql, params=None):
            if "commission_installments" in sql:
                raise RuntimeError("installment insert failed")
            events.append("commission-insert")
            return 1

        with patch("api.commission_service.query", new=fake_query), \
             patch("api.commission_service.execute", new=fake_exec), \
             patch("api.commission_service.transaction", new=tx):
            with pytest.raises(RuntimeError, match="installment insert failed"):
                await create_on_won("est-1")
        assert events == ["begin", "commission-insert", "rollback"]

    def test_lost_transition_cancels_open_commission(self, as_role):
        as_role("maintenance_estimating")
        events = []

        @asynccontextmanager
        async def tx():
            events.append("begin")
            yield None
            events.append("commit")

        async def fake_service_query(sql, params=None):
            assert params == ["est-1"]
            return [{"id": "c-open"}]

        execs = []

        async def fake_service_exec(sql, params=None):
            execs.append((sql, list(params or [])))
            return 1

        with patch("api.estimating.query", new_callable=AsyncMock) as est_query, \
             patch("api.estimating.execute", new_callable=AsyncMock), \
             patch("api.estimating._load_estimate", new_callable=AsyncMock) as loaded, \
             patch("api.estimating._sync_status_bg", new_callable=AsyncMock), \
             patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock), \
             patch("api.commission_service.query", new=fake_service_query), \
             patch("api.commission_service.execute", new=fake_service_exec), \
             patch("api.commission_service.transaction", new=tx):
            est_query.return_value = [{
                "estimate_type": "maintenance",
                "status": "handed_back",
                "aspire_opportunity_id": None,
            }]
            loaded.return_value = {"id": "est-1", "estimateType": "maintenance"}
            resp = client.patch("/api/estimating/estimates/est-1", json={"status": "lost"})
        assert resp.status_code == 200, resp.text
        assert events == ["begin", "commit"]
        assert len(execs) == 2
        assert "UPDATE commissions" in execs[0][0]
        assert "cancelled" in execs[0][0]
        assert execs[0][1] == ["c-open"]
        assert "commission_installments" in execs[1][0]
        assert "status != 'paid'" in execs[1][0]


@pytest.mark.asyncio
async def test_transaction_rolls_back_and_reuses_one_connection(monkeypatch):
    events = []

    class Cursor:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def execute(self, sql, params=None):
            events.append(sql)

        async def fetchall(self):
            return [{"ok": 1}]

        rowcount = 1

    class Conn:
        def cursor(self):
            return Cursor()

        async def begin(self):
            events.append("begin")

        async def commit(self):
            events.append("commit")

        async def rollback(self):
            events.append("rollback")

    class Pool:
        def acquire(self):
            return self

        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *_args):
            return False

    async def fake_pool():
        return Pool()

    monkeypatch.setattr(db, "_get_pool", fake_pool)
    async with db.transaction():
        rows = await db.query("SELECT 1")
        await db.execute("INSERT INTO commissions (id) VALUES (%s)", ["c1"])
    assert rows == [{"ok": 1}]
    assert events == ["begin", "SELECT 1", "INSERT INTO commissions (id) VALUES (%s)", "commit"]

    events.clear()
    with pytest.raises(RuntimeError, match="boom"):
        async with db.transaction():
            await db.execute("INSERT INTO commissions (id) VALUES (%s)", ["c1"])
            raise RuntimeError("boom")
    assert events == ["begin", "INSERT INTO commissions (id) VALUES (%s)", "rollback"]
    assert "commit" not in events

