"""Commission HTTP endpoints."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
from api import commissions  # noqa: E402

client = TestClient(app)


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
        assert body["balances_period_filtered"] is False
        assert body["plan_key"] is None
        assert body["plan_name"] is None

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

    def test_payout_schedule_period_uses_close_date_like_list(self, as_role, monkeypatch):
        """start_date/end_date bound commissions.created_at, same as list.

        The default close-year clip does not also apply, so a period in
        another year is not dropped. Rep scoping is unchanged.
        """
        monkeypatch.setattr("api.commissions.et_today", lambda: date(2026, 9, 25))
        in_period = datetime(2025, 11, 2, 16, 0, tzinfo=timezone.utc)
        rows = [{
            "commission_id": "c-old",
            "commission_amount_cents": 40,
            "commission_status": "approved",
            "created_at": in_period,
            "installment_id": "i-old",
            "installment_number": 1,
            "payout_period_label": "December 2025",
            "payout_date": date(2025, 12, 31),
            "amount_cents": 40,
            "installment_status": "scheduled",
        }]

        as_role("sales", user_id="rep-1")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=rows) as denied_q:
            denied = client.get(
                "/api/commissions/payout-schedule?user_id=other"
                "&start_date=2025-01-01&end_date=2025-12-31"
            )
        assert denied.status_code == 403
        denied_q.assert_not_awaited()

        captured = {}

        async def fake_query(sql, params=None):
            captured["sql"] = sql
            captured["params"] = list(params or [])
            return rows

        with patch("api.commissions.query", new=fake_query):
            resp = client.get(
                "/api/commissions/payout-schedule?start_date=2025-01-01&end_date=2025-12-31"
            )
        assert resp.status_code == 200
        body = resp.json()
        assert captured["params"] == ["rep-1", "2025-01-01", "2025-12-31"]
        assert "c.created_at >= %s" in captured["sql"]
        assert "c.created_at <= %s" in captured["sql"]
        assert "c.user_id = %s" in captured["sql"]
        assert body["quarters"][0]["close_quarter"] == "2025-Q4"
        assert body["quarters"][0]["sales_count"] == 1
        assert body["by_payout_period"][0]["amount_cents"] == 40

        async def start_only(sql, params=None):
            assert list(params) == ["rep-1", "2026-06-01"]
            assert "c.created_at >= %s" in sql
            assert "c.created_at <= %s" not in sql
            return []

        with patch("api.commissions.query", new=start_only):
            open_ended = client.get("/api/commissions/payout-schedule?start_date=2026-06-01")
        assert open_ended.status_code == 200
        assert open_ended.json()["quarters"] == []

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

    def test_reps_without_assignment_keep_null_plan(self, as_role):
        as_role("admin")
        seen = {}

        async def fake_query(sql, params=None):
            seen["sql"] = sql
            return [{
                "id": "rep-cady",
                "name": "Michelle Cady",
                "email": "michelle.cady@example.com",
                "commission_rate": Decimal("0.04000"),
                "effective_date": date(2026, 1, 1),
                "plan_key": None,
                "plan_name": None,
            }]

        with patch("api.commissions.query", new=fake_query):
            resp = client.get("/api/commissions/reps")
        assert resp.status_code == 200
        row = resp.json()[0]
        assert row["plan_key"] is None
        assert row["plan_name"] is None
        assert row["commission_rate"] == 0.04
        assert "COALESCE" not in seen["sql"]
        assert "'standard'" not in seen["sql"]

    def test_open_checks_ignore_period_and_summary_returns_rep_plan(self, as_role, monkeypatch):
        as_role("vice_president", user_id="vp-1")
        monkeypatch.setattr("api.commissions.et_today", lambda: date(2026, 9, 25))

        async def fake_query(sql, params=None):
            if "scheduled_ytd_cents" in sql:
                assert params[0] == "rep-9"
                assert params[1] == "2026-01-01"
                return [{"scheduled_ytd_cents": 1, "paid_ytd_cents": 0}]
            if "commission_installments" in sql:
                assert params == ["rep-9"]
                assert "created_at" not in sql
                return [{
                    "id": "i1",
                    "installment_number": 1,
                    "payout_period_label": "October 2026",
                    "payout_date": date(2026, 10, 1),
                    "amount_cents": 80,
                    "status": "scheduled",
                    "commission_status": "approved",
                }]
            if "v_current_commission_plans" in sql:
                assert params == ["rep-9"]
                return [{"plan_key": "standard", "plan_name": "Standard Sales Commission"}]
            raise AssertionError(sql)

        with patch("api.commissions.query", new=fake_query):
            resp = client.get(
                "/api/commissions/summary?user_id=rep-9&start_date=2026-01-01&end_date=2026-01-31"
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["balances_period_filtered"] is False
        assert body["upcoming_cents"] == 80
        assert body["plan_key"] == "standard"
        assert body["plan_name"] == "Standard Sales Commission"

    def test_list_includes_rep_plan_without_replacing_snapshot(self, as_role):
        as_role("sales", user_id="rep-1")
        created = datetime(2026, 2, 10, 16, 0, tzinfo=timezone.utc)

        async def fake_query(sql, params=None):
            if "commission_installments" in sql:
                return []
            if "v_current_commission_plans" in sql:
                assert params == ["rep-1"]
                return []
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
                "plan_key": None,
                "client_type": None,
                "rep_name": "Michelle Cady",
                "rep_email": "m@x.com",
                "property_name": "Oak",
                "estimate_number": 4,
                "aspire_number": None,
                "estimate_type": "maintenance",
            }]

        with patch("api.commissions.query", new=fake_query):
            resp = client.get("/api/commissions/list")
        assert resp.status_code == 200
        row = resp.json()[0]
        assert row["plan_key"] is None
        assert row["rep_plan_key"] is None
        assert row["plan_name"] is None

    def test_installment_mark_paid_excludes_manager_and_regional_director(self, as_role):
        for role in ("manager", "regional_director"):
            as_role(role)
            denied = client.post("/api/commissions/installments/i1/mark-paid")
            assert denied.status_code == 403
            assert denied.json()["detail"] == "Only admin, VP, or CEO can mark commissions as paid"
            whole = client.post(
                "/api/commissions/c1/mark-paid",
                json={"payment_period": "April 2026"},
            )
            assert whole.status_code == 403

        as_role("ceo")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=[]):
            missing = client.post("/api/commissions/installments/nope/mark-paid")
        assert missing.status_code == 404

    def test_mark_paid_updates_installments_and_keeps_auth(self, as_role):
        as_role("sales")
        denied = client.post(
            "/api/commissions/c1/mark-paid",
            json={"payment_period": "April 2026"},
        )
        assert denied.status_code == 403

        as_role("admin")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=[]), \
             patch("api.commissions.execute", new_callable=AsyncMock, return_value=0) as missing:
            resp = client.post(
                "/api/commissions/missing/mark-paid",
                json={"payment_period": "April 2026"},
            )
        assert resp.status_code == 404
        assert missing.await_count == 1

        with patch(
            "api.commissions.query",
            new_callable=AsyncMock,
            return_value=[{"status": "pending_billing_data", "amount_cents": None}],
        ), patch("api.commissions.execute", new_callable=AsyncMock) as blocked:
            resp = client.post(
                "/api/commissions/c1/mark-paid",
                json={"payment_period": "April 2026"},
            )
        assert resp.status_code == 409
        blocked.assert_not_awaited()

        with patch(
            "api.commissions.query",
            new_callable=AsyncMock,
            return_value=[{"status": "scheduled", "amount_cents": 100}],
        ), patch("api.commissions.execute", new_callable=AsyncMock, return_value=1) as paid:
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
                    "amount_cents": 50,
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
                    "amount_cents": 40,
                    "payout_period_label": "July 2026",
                    "commission_status": "approved",
                }]
            return [
                {
                    "installment_number": 1, "status": "paid",
                    "payout_period_label": "April 2026", "payout_date": date(2026, 4, 1),
                },
                {
                    "installment_number": 2, "status": "paid",
                    "payout_period_label": "July 2026", "payout_date": date(2026, 7, 1),
                },
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
                    "amount_cents": 10,
                    "payout_period_label": "June 2026",
                    "commission_status": "approved",
                }]
            return [
                {
                    "installment_number": 1, "status": "paid",
                    "payout_period_label": "June 2026", "payout_date": date(2026, 6, 30),
                },
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
                    "amount_cents": 20,
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

        async def pending_or_null(sql, params=None):
            return [{
                "id": "i3",
                "commission_id": "c1",
                "status": "pending_billing_data",
                "amount_cents": None,
                "payout_period_label": None,
                "commission_status": "approved",
            }]

        with patch("api.commissions.query", new=pending_or_null), \
             patch("api.commissions.execute", new_callable=AsyncMock) as exec_mock:
            blocked = client.post("/api/commissions/installments/i3/mark-paid")
        assert blocked.status_code == 409
        exec_mock.assert_not_awaited()

        async def null_amount(sql, params=None):
            return [{
                "id": "i1",
                "commission_id": "c1",
                "status": "scheduled",
                "amount_cents": None,
                "payout_period_label": "April 2026",
                "commission_status": "approved",
            }]

        with patch("api.commissions.query", new=null_amount), \
             patch("api.commissions.execute", new_callable=AsyncMock) as exec_mock:
            blocked = client.post("/api/commissions/installments/i1/mark-paid")
        assert blocked.status_code == 409
        exec_mock.assert_not_awaited()

        queries["n"] = 0

        async def latest_dated(sql, params=None):
            queries["n"] += 1
            if queries["n"] == 1:
                return [{
                    "id": "i2",
                    "commission_id": "c1",
                    "status": "scheduled",
                    "amount_cents": 40,
                    "payout_period_label": "June 2026",
                    "commission_status": "approved",
                }]
            return [
                {
                    "installment_number": 1, "status": "paid",
                    "payout_period_label": "December 2026", "payout_date": date(2026, 12, 31),
                },
                {
                    "installment_number": 2, "status": "paid",
                    "payout_period_label": "June 2026", "payout_date": date(2026, 6, 30),
                },
            ]

        with patch("api.commissions.query", new=latest_dated), \
             patch("api.commissions.execute", new_callable=AsyncMock, return_value=1) as exec_mock:
            done = client.post("/api/commissions/installments/i2/mark-paid")
        assert done.status_code == 200
        assert exec_mock.await_count == 2
        commission_sql, commission_params = exec_mock.await_args_list[1].args
        assert "UPDATE commissions" in commission_sql
        # Later payout_date wins over the higher installment number.
        assert commission_params[0] == "December 2026"

    @pytest.mark.asyncio
    async def test_cancel_commission_cancels_unpaid_installments(self):
        from contextlib import asynccontextmanager

        seen = []

        @asynccontextmanager
        async def tx():
            seen.append("begin")
            try:
                yield None
                seen.append("commit")
            except BaseException:
                seen.append("rollback")
                raise

        with patch("api.commission_service.transaction", new=tx), \
             patch("api.commission_service.execute", new_callable=AsyncMock) as exec_mock:
            await commissions.cancel_commission("c1")
        sqls = [call.args[0] for call in exec_mock.await_args_list]
        assert seen == ["begin", "commit"]
        assert "UPDATE commissions" in sqls[0]
        assert "cancelled" in sqls[0]
        assert "commission_installments" in sqls[1]
        assert "cancelled" in sqls[1]
        assert "status != 'paid'" in sqls[1]
        assert exec_mock.await_args_list[1].args[1] == ["c1"]


