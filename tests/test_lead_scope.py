"""Sales-rep lead scope.

A field-sales rep's pipeline, analytics counts, and lead mutations are limited
to leads they are assigned to or created. That is `sales` (including legacy
`outside_sales`), `maintenance_sales`, and `install_sales`. Admin and
manager-type roles, and the existing `inside_sales` shared public queue, keep
company-wide visibility.

DB is mocked — patch api.server.query / api.server.execute, and
api.estimating.query / api.estimating.execute for lead attachments.
"""
from __future__ import annotations

import os
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_PORT", "3306")
os.environ.setdefault("MYSQL_USER", "crm_user")
os.environ.setdefault("MYSQL_PASSWORD", "secret")
os.environ.setdefault("MYSQL_DB", "crm")
os.environ.setdefault("ENTRA_CLIENT_ID", "test-client-id")
os.environ.setdefault("ENTRA_TENANT_ID", "test-tenant-id")
os.environ.setdefault("JWT_SECRET", "test-secret")

from api import authz  # noqa: E402
from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

REP_ID = "rep-rodrigo"
OTHER_ID = "rep-other"

_FORBIDDEN = "You can only access your own leads."

# Roles that must keep company-wide lead visibility.
_WIDE_ROLES = (
    "admin",
    "manager",
    "regional_director",
    "vice_president",
    "ceo",
    "inside_sales",
    "procurement",
    "marketing",
)


def _user(role: str, user_id: str = REP_ID, **extra) -> dict:
    user = {
        "id": user_id,
        "name": "Rodrigo",
        "email": "rodrigo@juniperlandscaping.com",
        "role": role,
        "branch_id": "Fort Myers",
        "avatar_initials": "RO",
    }
    user.update(extra)
    return user


def _lead(**over) -> dict:
    row = {
        "id": "lead-1",
        "property_name": "Silverleaf HOA",
        "status": "qualified",
        "assigned_to": OTHER_ID,
        "created_by": "inside-1",
        "city": "Fort Myers",
        "state": "FL",
        "lead_type": "HOA",
        "score": 70,
        "score_factors": None,
        "estimated_contract_value": 120000,
        "deleted_at": None,
        "created_at": datetime(2026, 9, 1, 12, 0, 0),
        "updated_at": datetime(2026, 9, 1, 12, 0, 0),
    }
    row.update(over)
    return row


@pytest.fixture
def as_user():
    def _set(role: str, user_id: str = REP_ID, **extra):
        user = _user(role, user_id, **extra)
        app.dependency_overrides[require_auth] = lambda: user
        return user

    yield _set
    app.dependency_overrides.clear()


def _list(role: str, as_user, **query):
    as_user(role)
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[{"cnt": 0}], []]
        resp = client.get("/api/leads", params=query or None)
    assert resp.status_code == 200
    sql, params = mock_query.call_args_list[0].args
    return sql, list(params or [])


# ── List + pipeline analytics source (GET /api/leads) ────────────────────────


def test_sales_list_is_scoped_without_mine_flag(as_user):
    """Pipeline and analytics call GET /api/leads with no mine flag."""
    sql, params = _list("sales", as_user)
    assert sql.count(authz.OWN_LEAD_PREDICATE) == 1
    assert params.count(REP_ID) == 2
    assert OTHER_ID not in params


def test_legacy_outside_sales_list_is_scoped(as_user):
    sql, params = _list("outside_sales", as_user)
    assert authz.OWN_LEAD_PREDICATE in sql
    assert params.count(REP_ID) == 2


@pytest.mark.parametrize("role", ("maintenance_sales", "install_sales"))
def test_split_sales_list_is_scoped_like_sales(as_user, role):
    """The sales split keeps the personal book. inside_sales does not."""
    sql, params = _list(role, as_user)
    assert sql.count(authz.OWN_LEAD_PREDICATE) == 1
    assert params.count(REP_ID) == 2
    assert OTHER_ID not in params


def test_sales_mine_flag_does_not_duplicate_the_predicate(as_user):
    sql, params = _list("sales", as_user, mine="true")
    assert sql.count(authz.OWN_LEAD_PREDICATE) == 1
    assert params.count(REP_ID) == 2


@pytest.mark.parametrize("role", ("maintenance_estimating", "install_estimating"))
def test_estimators_cannot_list_leads(as_user, role):
    as_user(role)
    resp = client.get("/api/leads")
    assert resp.status_code == 403


@pytest.mark.parametrize("role", _WIDE_ROLES)
def test_non_sales_list_stays_company_wide(as_user, role):
    sql, params = _list(role, as_user)
    assert authz.OWN_LEAD_PREDICATE not in sql
    assert REP_ID not in params


@pytest.mark.parametrize("role", ["maintenance_estimating", "install_estimating"])
def test_estimators_cannot_list_leads(as_user, role):
    """PR #23 closes the lead list to estimating disciplines."""
    as_user(role)
    resp = client.get("/api/leads")
    assert resp.status_code == 403


def test_inside_sales_public_queue_is_not_forced_onto_one_rep(as_user):
    sql, params = _list(
        "inside_sales", as_user, sources="higher_gov,sam_gov", unassigned_only="true"
    )
    assert authz.OWN_LEAD_PREDICATE not in sql
    assert "assigned_to IS NULL" in sql
    assert "higher_gov" in params


def test_manager_can_still_opt_into_mine(as_user):
    sql, params = _list("manager", as_user, mine="true")
    assert authz.OWN_LEAD_PREDICATE in sql
    assert params.count(REP_ID) == 2


# ── Single lead read / update / delete ───────────────────────────────────────


@pytest.mark.parametrize("role", ("maintenance_sales", "install_sales"))
def test_split_sales_cannot_read_another_reps_lead(as_user, role):
    as_user(role)
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]):
        resp = client.get("/api/leads/lead-1")
    assert resp.status_code == 403
    assert resp.json()["detail"] == _FORBIDDEN


@pytest.mark.parametrize("role", ("maintenance_sales", "install_sales"))
def test_split_sales_can_read_a_lead_assigned_to_them(as_user, role):
    as_user(role)
    with patch(
        "api.server.query",
        new_callable=AsyncMock,
        return_value=[_lead(assigned_to=REP_ID)],
    ):
        resp = client.get("/api/leads/lead-1")
    assert resp.status_code == 200


def test_inside_sales_can_read_another_reps_lead(as_user):
    """Existing inside_sales stays company-wide, including another rep's lead."""
    as_user("inside_sales")
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]):
        resp = client.get("/api/leads/lead-1")
    assert resp.status_code == 200


def test_sales_cannot_read_another_reps_lead(as_user):
    as_user("sales")
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]):
        resp = client.get("/api/leads/lead-1")
    assert resp.status_code == 403
    assert resp.json()["detail"] == _FORBIDDEN


def test_sales_can_read_a_lead_assigned_to_them(as_user):
    as_user("sales")
    with patch(
        "api.server.query",
        new_callable=AsyncMock,
        return_value=[_lead(assigned_to=REP_ID)],
    ):
        resp = client.get("/api/leads/lead-1")
    assert resp.status_code == 200
    assert resp.json()["property_name"] == "Silverleaf HOA"


def test_sales_can_read_a_lead_they_created(as_user):
    as_user("sales")
    with patch(
        "api.server.query",
        new_callable=AsyncMock,
        return_value=[_lead(assigned_to=None, created_by=REP_ID)],
    ):
        resp = client.get("/api/leads/lead-1")
    assert resp.status_code == 200


def test_manager_can_read_another_reps_lead(as_user):
    as_user("manager")
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]):
        resp = client.get("/api/leads/lead-1")
    assert resp.status_code == 200


def test_sales_cannot_patch_another_reps_lead(as_user):
    as_user("sales")
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]), \
         patch("api.server.execute", new_callable=AsyncMock) as mock_execute:
        resp = client.patch("/api/leads/lead-1", json={"notes": "taken"})
    assert resp.status_code == 403
    mock_execute.assert_not_called()


def test_sales_can_patch_their_own_lead(as_user):
    owned = _lead(assigned_to=REP_ID)
    updated = {**owned, "notes": "mine"}
    as_user("sales")
    with patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1) as mock_execute:
        mock_query.side_effect = [[owned], [updated]]
        resp = client.patch("/api/leads/lead-1", json={"notes": "mine"})
    assert resp.status_code == 200
    mock_execute.assert_called_once()


def test_sales_cannot_delete_another_reps_lead(as_user):
    """Deleting is global (one row). A sales rep must not be able to do it to someone else's lead."""
    as_user("sales")
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]), \
         patch("api.server.execute", new_callable=AsyncMock) as mock_execute:
        resp = client.delete("/api/leads/lead-1")
    assert resp.status_code == 403
    mock_execute.assert_not_called()


def test_sales_delete_of_own_lead_still_soft_deletes_the_shared_row(as_user):
    as_user("sales")
    with patch(
        "api.server.query",
        new_callable=AsyncMock,
        return_value=[_lead(assigned_to=REP_ID)],
    ), patch("api.server.execute", new_callable=AsyncMock, return_value=1) as mock_execute:
        resp = client.delete("/api/leads/lead-1")
    assert resp.status_code == 204
    sql = mock_execute.await_args[0][0]
    assert "deleted_at" in sql.lower()


def test_admin_can_still_delete_any_lead(as_user):
    as_user("admin")
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]), \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1) as mock_execute:
        resp = client.delete("/api/leads/lead-1")
    assert resp.status_code == 204
    mock_execute.assert_called_once()


def test_render_token_may_read_the_pinned_lead_even_for_sales():
    authz.require_own_lead(
        {"id": REP_ID, "role": "sales", "scope": "proposal_render"},
        _lead(),
    )


# ── Activity + schedule-meeting ──────────────────────────────────────────────


def test_sales_cannot_read_another_reps_activity(as_user):
    as_user("sales")
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]) as mock_query:
        resp = client.get("/api/leads/lead-1/activity")
    assert resp.status_code == 403
    assert mock_query.await_count == 1


def test_sales_activity_on_own_lead_still_returns_the_feed(as_user):
    as_user("sales")
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[_lead(assigned_to=REP_ID)], []]
        resp = client.get("/api/leads/lead-1/activity")
    assert resp.status_code == 200
    assert resp.json() == []


def test_sales_cannot_schedule_a_meeting_on_another_reps_lead(as_user):
    as_user("sales")
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_lead()]), \
         patch("api.graph.create_event", new_callable=AsyncMock) as mock_event:
        resp = client.post(
            "/api/leads/lead-1/schedule-meeting",
            json={
                "subject": "Walkthrough",
                "start_iso": "2026-09-28T14:00:00Z",
                "end_iso": "2026-09-28T15:00:00Z",
            },
        )
    assert resp.status_code == 403
    mock_event.assert_not_called()


# ── Dashboard counts (pipeline analytics totals) ─────────────────────────────


def _dashboard(role: str, as_user):
    as_user(role)
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
    return mock_query.await_args_list


@pytest.mark.parametrize(
    "role", ("sales", "maintenance_sales", "install_sales", "inside_sales")
)
def test_non_leadership_dashboard_is_denied(as_user, role):
    """Analytics dashboard is admin/management only, including the sales split."""
    as_user(role)
    resp = client.get("/api/dashboard/inside-sales")
    assert resp.status_code == 403


def test_manager_dashboard_counts_stay_company_wide(as_user):
    calls = _dashboard("manager", as_user)
    for call in calls:
        sql = call.args[0]
        assert authz.OWN_LEAD_PREDICATE not in sql
        assert "deleted_at IS NULL" in sql


# ── Lead attachments ─────────────────────────────────────────────────────────


def test_sales_cannot_list_attachments_on_another_reps_lead(as_user):
    as_user("sales")
    with patch("api.estimating.query", new_callable=AsyncMock, return_value=[_lead()]) as mock_query:
        resp = client.get("/api/leads/lead-1/attachments")
    assert resp.status_code == 403
    assert mock_query.await_count == 1


def test_sales_can_list_attachments_on_their_own_lead(as_user):
    as_user("sales")
    with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
        own = [_lead(created_by=REP_ID, assigned_to=None)]
        mock_query.side_effect = [own, []]
        resp = client.get("/api/leads/lead-1/attachments")
    assert resp.status_code == 200
    assert resp.json() == []


def test_sales_cannot_delete_an_attachment_on_another_reps_lead(as_user):
    as_user("sales")
    with patch("api.estimating.query", new_callable=AsyncMock, return_value=[_lead()]), \
         patch("api.estimating.execute", new_callable=AsyncMock) as mock_execute:
        resp = client.delete("/api/leads/lead-1/attachments/att-1")
    assert resp.status_code == 403
    mock_execute.assert_not_called()


def test_inside_sales_can_still_list_attachments_on_any_lead(as_user):
    as_user("inside_sales")
    with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[_lead()], []]
        resp = client.get("/api/leads/lead-1/attachments")
    assert resp.status_code == 200
