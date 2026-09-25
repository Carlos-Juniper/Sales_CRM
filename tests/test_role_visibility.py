"""Backend role visibility (R4).

Estimating disciplines reach estimating, not leads, proposals, sales
performance, the analytics dashboard, or public leads.

Sales reaches leads, proposals, and its own sales-performance and commission
rows. It does not reach the public-lead queue or the analytics dashboard.
maintenance_sales and install_sales follow sales on every check below.
inside_sales is the existing public-queue role and is not a field-sales role.

Public leads: inside_sales, admin, and management.
Analytics dashboard: admin and management only. Sales, outside_sales,
inside_sales, estimators, procurement, and marketing are refused.
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
        "admin", "vp_sales",
        "vice_president", "ceo", "manager", "regional_director",
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


_FIELD_SALES = ("sales", "maintenance_sales", "install_sales", "outside_sales")


class TestFieldSalesMatchSales:
    """Split roles stay on the sales side of every visibility check."""

    def test_sets(self):
        for role in ("maintenance_sales", "install_sales", "sales"):
            assert role not in authz.ESTIMATING_ONLY_ROLES
            assert role not in authz.PUBLIC_LEADS_ROLES
            assert role not in authz.ANALYTICS_DASHBOARD_ROLES
            assert authz.hides_public_lead_queue({"role": role})
            assert not authz.is_estimating_only(role)
        assert "inside_sales" in authz.PUBLIC_LEADS_ROLES
        assert "inside_sales" not in authz.ANALYTICS_DASHBOARD_ROLES
        assert not authz.hides_public_lead_queue({"role": "inside_sales"})

    @pytest.mark.parametrize("role", _FIELD_SALES)
    def test_lists_leads_but_not_the_public_queue(self, as_role, role):
        as_role(role)
        with patch("api.server.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [[{"cnt": 0}], []]
            resp = client.get("/api/leads")
        assert resp.status_code == 200, role
        sql, params = mock_query.call_args_list[0].args
        assert authz.OWN_LEAD_PREDICATE in sql
        assert "NOT (source IN (%s, %s) AND assigned_to IS NULL)" in sql
        assert list(params[-2:]) == ["higher_gov", "sam_gov"]
        denied = client.get("/api/leads?unassigned_only=true&sources=higher_gov,sam_gov")
        assert denied.status_code == 403

    @pytest.mark.parametrize("role", ("maintenance_sales", "install_sales", "sales"))
    def test_cannot_open_a_public_lead_or_the_dashboard(self, as_role, role):
        as_role(role)
        with patch("api.server.query", new_callable=AsyncMock, return_value=[_PUBLIC_LEAD]):
            resp = client.get("/api/leads/lead-pub")
        assert resp.status_code == 403
        assert client.get("/api/dashboard/inside-sales").status_code == 403

    @pytest.mark.parametrize("role", ("maintenance_sales", "install_sales"))
    def test_can_open_own_lead_proposals_and_own_performance(self, as_role, role):
        as_role(role, user_id="rep-1")
        with patch("api.server.query", new_callable=AsyncMock, return_value=[_MANUAL_LEAD]):
            lead = client.get("/api/leads/lead-1")
        assert lead.status_code == 200
        with patch("api.proposals.query", new_callable=AsyncMock, return_value=[]):
            proposals = client.get("/api/proposals")
        assert proposals.status_code == 200
        with patch("api.sales_performance.query", new=AsyncMock(return_value=[])):
            summary = client.get("/api/sales-performance/summary")
            other = client.get("/api/sales-performance/summary?user_id=someone-else")
        assert summary.status_code == 200
        assert other.status_code == 403


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

    def test_sales_cannot_open_the_analytics_dashboard(self, as_role):
        as_role("sales")
        assert client.get("/api/dashboard/inside-sales").status_code == 403
        as_role("outside_sales")
        assert client.get("/api/dashboard/inside-sales").status_code == 403
        as_role("inside_sales")
        assert client.get("/api/dashboard/inside-sales").status_code == 403

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
        assert "rep-1" in captured[0]
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
        [
            "inside_sales", "admin", "vp_sales",
            "manager", "regional_director", "vice_president", "ceo",
        ],
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

    @pytest.mark.parametrize("role", ["sales", "regional_sales", "procurement", "marketing"])
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
        [
            "admin", "vp_sales",
            "manager", "regional_director", "vice_president", "ceo",
        ],
    )
    def test_leadership_can_open_analytics(self, as_role, role):
        as_role(role)
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
            assert "assigned_to" not in sql
            assert "created_by" not in sql

    @pytest.mark.parametrize(
        "role",
        ["sales", "outside_sales", "regional_sales", "inside_sales", "procurement", "marketing", "maintenance_estimating", "install_estimating"],
    )
    def test_non_management_cannot_open_analytics(self, as_role, role):
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

    def test_vp_sales_may_list_reps_and_read_another_rep(self, as_role):
        as_role("vp_sales", user_id="lead-1")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=[]):
            reps = client.get("/api/commissions/reps")
        assert reps.status_code == 200
        with patch("api.sales_performance.query", new_callable=AsyncMock, return_value=[]):
            summary = client.get("/api/sales-performance/summary?user_id=someone-else")
        assert summary.status_code == 200

    def test_regional_sales_picker_is_self_and_direct_reports(self, as_role):
        as_role("regional_sales", user_id="lead-1")
        with patch("api.commissions.query", new_callable=AsyncMock, return_value=[]) as mock_query:
            reps = client.get("/api/commissions/reps")
        assert reps.status_code == 200
        sql, params = mock_query.await_args.args
        assert "reports_to_user_id" in sql
        assert params == ["lead-1", "lead-1"]

        with patch("api.sales_performance.query", new_callable=AsyncMock, return_value=[]) as perf:
            listed = client.get("/api/sales-performance/reps")
        assert listed.status_code == 200
        sql, params = perf.await_args.args
        assert "reports_to_user_id" in sql
        assert params == ["lead-1", "lead-1"]

        with patch("api.authz.query", new_callable=AsyncMock, return_value=[]):
            denied = client.get("/api/sales-performance/summary?user_id=someone-else")
        assert denied.status_code == 403
        assert denied.json()["detail"] == "You can only view yourself and your direct reports."

        captured: list[list] = []

        async def fake_query(sql, params=None):
            captured.append(list(params or []))
            return []

        with (
            patch("api.authz.query", new_callable=AsyncMock, return_value=[{"id": "rep-9"}]),
            patch("api.sales_performance.query", new=AsyncMock(side_effect=fake_query)),
        ):
            allowed = client.get("/api/sales-performance/summary?user_id=rep-9")
        assert allowed.status_code == 200
        assert any("rep-9" in params for params in captured)
        assert all("someone-else" not in params for params in captured)


class TestAdminEquivalentSalesRoleSets:
    def test_vp_sales_is_a_viewer_and_not_field_sales(self):
        role = "vp_sales"
        assert role in authz.REP_VIEWER_ROLES
        assert role in authz.CROSS_BRANCH_ROLES
        assert role in authz.APPROVER_ROLES
        assert role in authz.SALES_REP_DB_ROLES
        assert role not in authz.FIELD_SALES_ROLES
        assert not authz.requires_aspire_sales_rep(role)
        assert not authz.is_sales_rep(role)
        assert authz.own_lead_filter({"role": role, "id": "lead-1"}) == ("", [])

    def test_regional_sales_is_field_sales_with_a_team_filter(self):
        role = "regional_sales"
        assert role not in authz.REP_VIEWER_ROLES
        assert role not in authz.CROSS_BRANCH_ROLES
        assert role not in authz.APPROVER_ROLES
        assert role not in authz.ANALYTICS_DASHBOARD_ROLES
        assert role in authz.SALES_REP_DB_ROLES
        assert role in authz.FIELD_SALES_ROLES
        assert authz.requires_aspire_sales_rep(role)
        assert authz.is_sales_rep(role)
        sql, params = authz.own_lead_filter({"role": role, "id": "lead-1"})
        assert "reports_to_user_id" in sql
        assert "user_branches" in sql
        assert params == ["lead-1"] * 5

    def test_regional_director_and_vice_president_unchanged(self):
        assert authz.normalize_role("regional_director") == "regional_director"
        assert authz.normalize_role("vice_president") == "vice_president"
        assert "regional_director" not in authz.ADMIN_EQUIVALENT_ROLES
        assert "vice_president" not in authz.ADMIN_EQUIVALENT_ROLES
        assert "regional_director" not in authz.CROSS_BRANCH_ROLES
        assert "vice_president" in authz.CROSS_BRANCH_ROLES
        assert "regional_director" not in authz.SALES_REP_DB_ROLES
        assert "vice_president" not in authz.SALES_REP_DB_ROLES
