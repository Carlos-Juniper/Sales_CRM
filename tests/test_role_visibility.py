"""Backend role visibility (R4).

Estimating disciplines reach estimating, not leads, proposals, sales
performance, the analytics dashboard, or public leads.

Sales reaches leads, proposals, its own sales-performance and commission
rows, and the analytics dashboard scoped to leads it owns. It does not
reach the public-lead queue.

Public leads: inside_sales, admin, and management.
Analytics dashboard: sales (including outside_sales), inside_sales, admin,
and management. Sales counts use own_lead_filter; the others are company-wide.
Estimators, procurement, and marketing are refused.
REP_VIEWER_ROLES may read any rep; every other role is self-scoped.
The reps-listing endpoints stay 403 outside that set.
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

from api.server import app, require_auth  # noqa: E402
from api import authz  # noqa: E402

client = TestClient(app)

_LEAD_BODY = {
    "property_name": "Silverleaf HOA",
    "city": "Tampa",
    "state": "FL",
    "lead_type": "HOA",
}

_MANUAL_LEAD = {
    "id": "lead-1",
    "source": "manual",
    "assigned_to": "rep-1",
    "property_name": "Silverleaf HOA",
    "deleted_at": None,
}

_PUBLIC_LEAD = {
    "id": "lead-pub",
    "source": "higher_gov",
    "assigned_to": None,
    "property_name": "County Bid",
    "deleted_at": None,
}


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


def test_rep_viewer_roles_unchanged():
    assert authz.REP_VIEWER_ROLES == frozenset({
        "admin", "vice_president", "ceo", "manager", "regional_director",
    })


class TestEstimatingDisciplineDenied:
    @pytest.mark.parametrize("role", ["maintenance_estimating", "install_estimating"])
    def test_cannot_list_or_create_leads(self, as_role, role):
        as_role(role)
        assert client.get("/api/leads").status_code == 403
        assert client.post("/api/leads", json=_LEAD_BODY).status_code == 403
        assert client.get("/api/leads?unassigned_only=true&sources=higher_gov,sam_gov").status_code == 403

    @pytest.mark.parametrize("role", ["maintenance_estimating", "install_estimating"])
    def test_cannot_open_proposals_performance_or_analytics(self, as_role, role):
        as_role(role)
        assert client.get("/api/proposals").status_code == 403
        assert client.get("/api/sales-performance/summary").status_code == 403
        assert client.get("/api/sales-performance/reps").status_code == 403
        assert client.get("/api/dashboard/inside-sales").status_code == 403
        assert client.get("/api/leads/lead-1/attachments").status_code == 403

    def test_can_open_the_estimate_queue(self, as_role):
        as_role("maintenance_estimating")
        with (
            patch("api.authz.query", new_callable=AsyncMock, return_value=[{"aspire_branch_id": 12}]),
            patch("api.estimating.query", new_callable=AsyncMock, return_value=[]),
        ):
            resp = client.get("/api/estimating/estimates")
        assert resp.status_code == 200
        assert resp.json() == []


class TestSalesWorkspace:
    def test_sales_lists_leads_but_not_the_public_queue(self, as_role):
        as_role("sales")
        with patch("api.server.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [[{"cnt": 0}], []]
            resp = client.get("/api/leads")
        assert resp.status_code == 200
        sql, params = mock_query.call_args_list[0].args
        assert "NOT (source IN (%s, %s) AND assigned_to IS NULL)" in sql
        assert list(params[-2:]) == ["higher_gov", "sam_gov"]

        denied = client.get("/api/leads?unassigned_only=true&sources=higher_gov,sam_gov")
        assert denied.status_code == 403

    def test_sales_cannot_open_a_public_lead(self, as_role):
        as_role("sales")
        with patch("api.server.query", new_callable=AsyncMock, return_value=[_PUBLIC_LEAD]):
            resp = client.get("/api/leads/lead-pub")
        assert resp.status_code == 403

    def test_sales_can_open_an_assigned_lead_and_proposals(self, as_role):
        as_role("sales")
        with patch("api.server.query", new_callable=AsyncMock, return_value=[_MANUAL_LEAD]):
            lead = client.get("/api/leads/lead-1")
        assert lead.status_code == 200
        with patch("api.proposals.query", new_callable=AsyncMock, return_value=[]):
            proposals = client.get("/api/proposals")
        assert proposals.status_code == 200

    def test_sales_performance_is_self_scoped(self, as_role):
        as_role("sales", user_id="rep-1")
        captured: list[list] = []

        async def fake_query(sql, params=None):
            captured.append(list(params or []))
            return []

        with patch("api.sales_performance.query", new=AsyncMock(side_effect=fake_query)):
            ok = client.get("/api/sales-performance/summary")
            other = client.get("/api/sales-performance/summary?user_id=someone-else")
            won = client.get("/api/sales-performance/won-deals")
        assert ok.status_code == 200
        assert other.status_code == 403
        assert won.status_code == 200
        assert all("rep-1" in params for params in captured)
        assert client.get("/api/sales-performance/reps").status_code == 403

    def test_commissions_are_self_scoped_and_reps_stay_forbidden(self, as_role):
        as_role("sales", user_id="rep-1")
        captured: list[list] = []

        async def fake_query(sql, params=None):
            captured.append(list(params or []))
            return [{"scheduled_ytd_cents": 0, "paid_ytd_cents": 0}]

        with patch("api.commissions.query", new=AsyncMock(side_effect=fake_query)):
            ok = client.get("/api/commissions/summary")
            other = client.get("/api/commissions/summary?user_id=someone-else")
        assert ok.status_code == 200
        assert other.status_code == 403
        assert captured[0][0] == "rep-1"
        assert client.get("/api/commissions/reps").status_code == 403

    def test_estimator_commissions_stay_self_scoped(self, as_role):
        """Own-data scoping covers roles outside REP_VIEWER_ROLES, including estimators."""
        as_role("install_estimating", user_id="est-1")
        captured: list[list] = []

        async def fake_query(sql, params=None):
            captured.append(list(params or []))
            return [{"scheduled_ytd_cents": 0, "paid_ytd_cents": 0}]

        with patch("api.commissions.query", new=AsyncMock(side_effect=fake_query)):
            resp = client.get("/api/commissions/summary?user_id=someone-else")
            own = client.get("/api/commissions/list")
        assert resp.status_code == 403
        assert own.status_code == 200
        assert captured[0][0] == "est-1"
        assert client.get("/api/commissions/reps").status_code == 403


class TestPublicLeadsAndAnalytics:
    @pytest.mark.parametrize(
        "role",
        ["inside_sales", "admin", "manager", "regional_director", "vice_president", "ceo"],
    )
    def test_qualifiers_can_open_the_public_queue(self, as_role, role):
        as_role(role)
        with patch("api.server.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [[{"cnt": 0}], []]
            resp = client.get("/api/leads?unassigned_only=true&sources=higher_gov,sam_gov")
        assert resp.status_code == 200
        sql, _params = mock_query.call_args_list[0].args
        assert "assigned_to IS NULL" in sql
        assert "NOT (source IN" not in sql

    @pytest.mark.parametrize("role", ["sales", "procurement", "marketing"])
    def test_other_roles_cannot_open_the_public_queue(self, as_role, role):
        as_role(role)
        assert client.get("/api/leads?unassigned_only=true").status_code == 403

    def test_inside_sales_can_read_a_public_lead(self, as_role):
        as_role("inside_sales")
        with patch("api.server.query", new_callable=AsyncMock, return_value=[_PUBLIC_LEAD]):
            resp = client.get("/api/leads/lead-pub")
        assert resp.status_code == 200

    @pytest.mark.parametrize(
        "role",
        ["inside_sales", "admin", "manager", "regional_director", "vice_president", "ceo"],
    )
    def test_company_wide_roles_open_analytics_without_an_owner_filter(self, as_role, role):
        as_role(role, user_id="leader-1")
        with patch("api.server.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [
                [{"cnt": 1}],
                [{"cnt": 1}],
                [],
                [{"avg_score": None}],
                [],
            ]
            resp = client.get("/api/dashboard/inside-sales")
        assert resp.status_code == 200
        for call in mock_query.await_args_list:
            sql = call.args[0]
            params = call.args[1] if len(call.args) > 1 else None
            assert authz.OWN_LEAD_PREDICATE not in sql
            assert params in (None, [])

    @pytest.mark.parametrize("role", ["sales", "outside_sales"])
    def test_sales_dashboard_is_limited_to_owned_leads(self, as_role, role):
        as_role(role, user_id="rep-1")
        with patch("api.server.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [
                [{"cnt": 1}],
                [{"cnt": 1}],
                [{"status": "new", "cnt": 1}],
                [{"avg_score": 10}],
                [{"state": "FL", "cnt": 1}],
            ]
            resp = client.get("/api/dashboard/inside-sales")
        assert resp.status_code == 200
        assert len(mock_query.await_args_list) == 5
        for call in mock_query.await_args_list:
            sql, params = call.args
            assert authz.OWN_LEAD_PREDICATE in sql
            assert list(params) == ["rep-1", "rep-1"]
            where_at = sql.index(authz.OWN_LEAD_PREDICATE)
            for keyword in ("GROUP BY", "ORDER BY"):
                if keyword in sql:
                    assert where_at < sql.index(keyword)

    @pytest.mark.parametrize(
        "role",
        ["procurement", "marketing", "maintenance_estimating", "install_estimating"],
    )
    def test_other_roles_cannot_open_analytics(self, as_role, role):
        as_role(role)
        assert client.get("/api/dashboard/inside-sales").status_code == 403


class TestRepViewerScope:
    def test_manager_may_read_another_rep_and_list_reps(self, as_role):
        as_role("manager", user_id="mgr-1")
        captured: list[list] = []

        async def fake_query(sql, params=None):
            captured.append(list(params or []))
            return []

        with patch("api.sales_performance.query", new=AsyncMock(side_effect=fake_query)):
            summary = client.get("/api/sales-performance/summary?user_id=rep-9")
            reps = client.get("/api/sales-performance/reps")
        assert summary.status_code == 200
        assert any("rep-9" in params for params in captured)
        assert reps.status_code == 200

    def test_regional_director_may_list_commission_reps(self, as_role):
        as_role("regional_director")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=[]):
            resp = client.get("/api/commissions/reps")
        assert resp.status_code == 200
