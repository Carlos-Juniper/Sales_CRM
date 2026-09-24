"""Per-rep client references and team roster, and the shared portfolio.

A sales rep edits their own roster. Another rep's rows are 403. Marketing
(and admin) edit any rep's rows by passing rep_id or user_id. The portfolio
is one shared set: sales and marketing can both add and edit it.

The rep dropdown reuses GET /api/users?role=sales (already covered in
tests/test_user_admin.py). Each user's id is the rep_id to pass here.
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

client = TestClient(app)

_EDIT_DENIED = "You can edit only your own client references and team roster."
_VIEW_DENIED = "You can view only your own client references and team roster."


def _user(role: str, **over) -> dict:
    u = {
        "id": "u1",
        "name": "Test User",
        "email": "test.user@juniperlandscaping.com",
        "role": role,
        "branch_id": "b1",
        "avatar_initials": "TU",
    }
    u.update(over)
    return u


@pytest.fixture
def as_role():
    def _set(role: str, **over):
        app.dependency_overrides[require_auth] = lambda: _user(role, **over)
    yield _set
    app.dependency_overrides.clear()


def _live(role: str, active: int = 1) -> list[dict]:
    return [{"role": role, "active": active}]


def _tm(**over) -> dict:
    row = {
        "id": "tm-1",
        "name": "Alex",
        "title": "manager",
        "team_type": "branch",
        "aspire_branch_id": None,
        "user_id": None,
        "location": None,
        "bio": "Bio",
        "headshot_object_key": None,
        "active": 1,
        "sort_order": 0,
        "owner_user_id": "rep-1",
    }
    row.update(over)
    return row


def _ref(**over) -> dict:
    row = {
        "id": "cr-1",
        "aspire_branch_id": None,
        "property_name": "Coral Bay HOA",
        "services_provided": "Maintenance",
        "contact_name": "Jane Doe",
        "contact_title": None,
        "phone": "555-1212",
        "email": "jane@example.com",
        "address": "1 Palm Way",
        "client_since_year": 2019,
        "active": 1,
        "owner_user_id": "rep-1",
    }
    row.update(over)
    return row


def _ref_body(**over) -> dict:
    body = {
        "propertyName": "Coral Bay HOA",
        "servicesProvided": "Maintenance",
        "contactName": "Jane Doe",
        "phone": "555-1212",
        "email": "jane@example.com",
        "address": "1 Palm Way",
        "clientSinceYear": 2019,
    }
    body.update(over)
    return body


def _portfolio(**over) -> dict:
    row = {
        "id": "pp-1",
        "name": "Pelican Landing",
        "city_state": "Bonita Springs, FL",
        "region_id": "east-coast",
        "photo_object_keys": "[]",
        "sort_order": 0,
        "active": 1,
    }
    row.update(over)
    return row


def _inserts(mock_exec, table: str) -> list:
    return [
        c for c in mock_exec.await_args_list
        if table in c.args[0] and "INSERT" in c.args[0].upper()
    ]


# ── A rep edits their own; another rep is blocked ────────────────────────────

class TestRepEditsOwnRoster:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_rep_patches_own_team_member(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_query.return_value = [_tm(owner_user_id="rep-1")]
        r = client.patch(
            "/api/settings/team-members/tm-1",
            json={"bio": "Updated by the owner."},
        )
        assert r.status_code == 200
        assert r.json()["ownerUserId"] == "rep-1"
        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "team_members" in c.args[0]
        ]
        assert updates and "Updated by the owner." in updates[0].args[1]

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_rep_patches_own_client_reference(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_query.return_value = [_ref(owner_user_id="rep-1")]
        r = client.patch(
            "/api/settings/client-references/cr-1",
            json={"contactName": "Pat Owner"},
        )
        assert r.status_code == 200
        assert r.json()["ownerUserId"] == "rep-1"

    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_rep_create_without_param_is_owned_by_caller(
        self, mock_query, mock_exec, as_role
    ):
        as_role("sales", id="rep-1")
        r = client.post(
            "/api/settings/team-members",
            json={"name": "Crew Lead", "title": "manager", "teamType": "branch"},
        )
        assert r.status_code == 201
        assert r.json()["ownerUserId"] == "rep-1"
        assert _inserts(mock_exec, "team_members")[0].args[1][-1] == "rep-1"

    @patch("api.proposals.query", new_callable=AsyncMock)
    async def test_rep_lists_own_roster(self, mock_query, as_role):
        as_role("sales", id="rep-1")
        mock_query.return_value = [_tm(owner_user_id="rep-1")]
        r = client.get("/api/proposals/config/team-members?rep_id=rep-1")
        assert r.status_code == 200
        sql, params = mock_query.call_args.args[0], mock_query.call_args.args[1]
        assert "owner_user_id = %s" in sql
        assert "rep-1" in params
        assert r.json()[0]["ownerUserId"] == "rep-1"


class TestRepBlockedFromAnotherRep:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_rep_cannot_patch_another_reps_team_member(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_authz_query.return_value = _live("sales")
        mock_query.return_value = [_tm(owner_user_id="rep-2")]
        r = client.patch(
            "/api/settings/team-members/tm-1",
            json={"bio": "Not yours."},
        )
        assert r.status_code == 403
        assert r.json()["detail"] == _EDIT_DENIED
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_rep_cannot_patch_another_reps_client_reference(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_authz_query.return_value = _live("sales")
        mock_query.return_value = [_ref(owner_user_id="rep-2")]
        r = client.patch(
            "/api/settings/client-references/cr-1",
            json={"contactName": "Not yours"},
        )
        assert r.status_code == 403
        assert r.json()["detail"] == _EDIT_DENIED
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    async def test_rep_cannot_create_for_another_rep(
        self, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_authz_query.return_value = _live("sales")
        r = client.post(
            "/api/settings/client-references?rep_id=rep-2",
            json=_ref_body(),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == _EDIT_DENIED
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_manager_cannot_edit_a_reps_owned_row(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # Branch scope does not unlock another rep's owned row.
        as_role("manager", id="mgr-1")
        mock_authz_query.return_value = _live("manager")
        mock_query.return_value = [_tm(owner_user_id="rep-2", aspire_branch_id=1403)]
        r = client.patch(
            "/api/settings/team-members/tm-1",
            json={"bio": "Branch override."},
        )
        assert r.status_code == 403
        assert r.json()["detail"] == _EDIT_DENIED
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.proposals.query", new_callable=AsyncMock)
    async def test_rep_cannot_list_another_reps_roster(
        self, mock_query, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_authz_query.return_value = _live("sales")
        r = client.get("/api/proposals/config/client-references?user_id=rep-2")
        assert r.status_code == 403
        assert r.json()["detail"] == _VIEW_DENIED
        mock_query.assert_not_awaited()


# ── Marketing edits any rep ───────────────────────────────────────────────────

class TestMarketingEditsAnyRep:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_creates_team_member_for_a_rep(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("marketing", id="mkt-1")
        mock_authz_query.return_value = _live("marketing")
        mock_query.return_value = [{"id": "rep-2", "role": "sales", "active": 1}]
        r = client.post(
            "/api/settings/team-members?rep_id=rep-2",
            json={"name": "Field Lead", "title": "manager", "teamType": "branch"},
        )
        assert r.status_code == 201
        assert r.json()["ownerUserId"] == "rep-2"
        assert _inserts(mock_exec, "team_members")[0].args[1][-1] == "rep-2"

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_patches_any_reps_client_reference(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("marketing", id="mkt-1")
        mock_authz_query.return_value = _live("marketing")
        mock_query.return_value = [_ref(owner_user_id="rep-2")]
        r = client.patch(
            "/api/settings/client-references/cr-1?user_id=rep-2",
            json={"phone": "239-555-0100"},
        )
        assert r.status_code == 200
        assert r.json()["ownerUserId"] == "rep-2"

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_creates_client_reference_for_a_rep(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin", id="adm-1")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [{"id": "rep-2", "role": "outside_sales", "active": 1}]
        r = client.post(
            "/api/settings/client-references",
            json=_ref_body(repId="rep-2"),
        )
        assert r.status_code == 201
        assert r.json()["ownerUserId"] == "rep-2"

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.proposals.query", new_callable=AsyncMock)
    async def test_marketing_lists_a_reps_roster(self, mock_query, mock_authz_query, as_role):
        as_role("marketing", id="mkt-1")
        mock_authz_query.return_value = _live("marketing")
        mock_query.return_value = [_ref(owner_user_id="rep-2")]
        r = client.get("/api/proposals/config/client-references?rep_id=rep-2")
        assert r.status_code == 200
        sql, params = mock_query.call_args.args[0], mock_query.call_args.args[1]
        assert "owner_user_id = %s" in sql
        assert "rep-2" in params
        assert r.json()[0]["ownerUserId"] == "rep-2"

    @patch("api.proposals.query", new_callable=AsyncMock)
    async def test_omitting_rep_id_keeps_the_unscoped_list(self, mock_query, as_role):
        """Proposal generation still lists every active row when rep_id is omitted."""
        as_role("sales", id="rep-1")
        mock_query.return_value = []
        r = client.get("/api/proposals/config/client-references")
        assert r.status_code == 200
        sql = mock_query.call_args.args[0]
        assert "owner_user_id" not in sql

    @patch("api.settings.execute", new_callable=AsyncMock)
    async def test_mismatched_rep_params_are_400(self, mock_exec, as_role):
        as_role("marketing", id="mkt-1")
        r = client.post(
            "/api/settings/team-members?rep_id=rep-2&user_id=rep-3",
            json={"name": "X", "title": "Y", "teamType": "branch"},
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "rep_id and user_id must be the same rep."
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_rep_id_must_be_an_active_sales_rep(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("marketing", id="mkt-1")
        mock_authz_query.return_value = _live("marketing")
        mock_query.return_value = [{"id": "mgr-1", "role": "manager", "active": 1}]
        r = client.post(
            "/api/settings/client-references?rep_id=mgr-1",
            json=_ref_body(),
        )
        assert r.status_code == 400
        assert "sales role" in r.json()["detail"]
        mock_exec.assert_not_awaited()

        mock_query.return_value = []
        missing = client.post(
            "/api/settings/client-references?rep_id=missing",
            json=_ref_body(),
        )
        assert missing.status_code == 404
        assert missing.json()["detail"] == "Sales rep not found."


# ── Shared portfolio ──────────────────────────────────────────────────────────

class TestSharedPortfolio:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_sales_can_add_a_portfolio_property(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_authz_query.return_value = _live("sales")
        r = client.post(
            "/api/settings/portfolio",
            json={"name": "Shared Estate", "cityState": "Naples, FL", "regionId": "east-coast"},
        )
        assert r.status_code == 201
        assert r.json()["name"] == "Shared Estate"

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_can_edit_the_same_shared_portfolio(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("marketing", id="mkt-1")
        mock_authz_query.return_value = _live("marketing")
        mock_query.return_value = [_portfolio()]
        r = client.patch(
            "/api/settings/portfolio/pp-1",
            json={"cityState": "Naples, FL"},
        )
        assert r.status_code == 200
        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "portfolio_properties" in c.args[0]
        ]
        assert updates and "Naples, FL" in updates[0].args[1]

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_sales_can_edit_any_portfolio_property(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_authz_query.return_value = _live("sales")
        mock_query.return_value = [_portfolio()]
        r = client.patch("/api/settings/portfolio/pp-1", json={"sortOrder": 3})
        assert r.status_code == 200

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_sales_can_list_the_shared_portfolio(
        self, mock_query, mock_authz_query, as_role
    ):
        as_role("sales", id="rep-1")
        mock_authz_query.return_value = _live("sales")
        mock_query.return_value = [_portfolio()]
        r = client.get("/api/settings/portfolio")
        assert r.status_code == 200
        assert r.json()[0]["name"] == "Pelican Landing"
