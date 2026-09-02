"""Slice 13a backend CRUD — team_members, client_references, portfolio_properties.

Acceptance criteria (H37 §3 scope matrix):

  team_members (branch-scoped):
    * BM scoped to branch X can CREATE/UPDATE a row for X.
    * BM scoped to branch X is 403 for branch Y.
    * BM cannot write a company-wide (aspire_branch_id=NULL) row — admin only.
    * admin can write any branch or company-wide row.
    * Deactivate sets active=0; no hard DELETE is emitted.
    * Each successful write produces exactly ONE config_audit row with correct
      scope/actor/from/to.

  client_references (branch-scoped, same scope rules):
    * BM scoped to X can CREATE/UPDATE for X; 403 for Y; 403 for NULL branch.
    * admin can write any.
    * Deactivate sets active=0.
    * One audit row per write.

  portfolio_properties (company-wide, admin-only):
    * Non-admin PATCH/POST -> 403.
    * Admin create/update -> 200/201.
    * portfolio_properties has NO `active` column -> deactivate is a hard DELETE
      (flagged in report: needs migration adding `active` TINYINT NOT NULL DEFAULT 1).

DB fully mocked — patch api.settings.query / api.settings.execute, and
api.authz.query (live role / scope re-reads happen in authz).
asyncio_mode = auto (set in pytest.ini / pyproject.toml).
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


# ── Fixtures / helpers ────────────────────────────────────────────────────────

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
    """Override require_auth with an arbitrary token claim; auto-clears."""
    def _set(role: str, **over):
        app.dependency_overrides[require_auth] = lambda: _user(role, **over)
    yield _set
    app.dependency_overrides.clear()


def _live(role: str, active: int = 1) -> list[dict]:
    """Simulate api.authz.query returning a live role row."""
    return [{"role": role, "active": active}]


def _scoped_to(*branch_ids: int) -> list[dict]:
    """Simulate api.authz.query returning user_branches rows."""
    return [{"aspire_branch_id": bid} for bid in branch_ids]


def _audit_calls(mock_exec) -> list:
    """Filter execute calls that are config_audit INSERTs."""
    return [c for c in mock_exec.await_args_list if "config_audit" in c.args[0]]


def _flat_audit(audit_call) -> str:
    """Flatten audit INSERT params to a single string for easy assertion."""
    return " ".join(str(p) for p in audit_call.args[1])


# ── team_members CRUD ─────────────────────────────────────────────────────────

class TestTeamMembersCreate:
    """POST /api/settings/team-members"""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_creates_row_for_own_branch_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        # resolve_branch_scope reads user_branches -> only branch 1403.
        mock_authz_query.return_value = _scoped_to(1403)
        r = client.post("/api/settings/team-members", json={
            "name": "Alice Smith",
            "title": "manager",
            "teamType": "branch",
            "aspireBranchId": 1403,
            "bio": "Branch manager bio.",
            "sortOrder": 0,
        })
        assert r.status_code == 201
        body = r.json()
        assert body["name"] == "Alice Smith"
        assert body["aspireBranchId"] == 1403

        # One INSERT into team_members.
        inserts = [c for c in mock_exec.await_args_list if "team_members" in c.args[0] and "INSERT" in c.args[0].upper()]
        assert len(inserts) == 1

        # One config_audit row with branch scope and correct scope_id.
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "branch" in flat
        assert "1403" in flat
        assert "test.user@juniperlandscaping.com" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_create_out_of_scope_branch_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        r = client.post("/api/settings/team-members", json={
            "name": "Bob Jones",
            "title": "manager",
            "teamType": "branch",
            "aspireBranchId": 3696,  # NOT in scope
            "bio": "Bio.",
            "sortOrder": 0,
        })
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_cannot_create_company_wide_row_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # aspireBranchId=None means company-wide; BM may not write those.
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        r = client.post("/api/settings/team-members", json={
            "name": "CEO Guy",
            "title": "executive",
            "teamType": "executive",
            "aspireBranchId": None,
            "bio": "Exec bio.",
            "sortOrder": 0,
        })
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_creates_company_wide_row_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        # admin -> resolve_branch_scope returns kind='all' (no user_branches lookup).
        # authz.query is also called for the live-admin re-read.
        mock_authz_query.return_value = _live("admin")
        r = client.post("/api/settings/team-members", json={
            "name": "CEO Guy",
            "title": "executive",
            "teamType": "executive",
            "aspireBranchId": None,
            "bio": "Exec bio.",
            "sortOrder": 0,
        })
        assert r.status_code == 201
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        # Company-wide rows audit as scope_type='company', scope_id=None.
        assert "company" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_creates_branch_row_for_any_branch_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        r = client.post("/api/settings/team-members", json={
            "name": "Jane Doe",
            "title": "manager",
            "teamType": "branch",
            "aspireBranchId": 9999,  # a branch outside any BM's scope
            "bio": "Bio.",
            "sortOrder": 1,
        })
        assert r.status_code == 201
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "branch" in flat
        assert "9999" in flat


class TestTeamMembersUpdate:
    """PATCH /api/settings/team-members/{id}"""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_updates_own_branch_row_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        # First query: fetch the existing row to get aspire_branch_id + from_values.
        mock_query.return_value = [{
            "id": "tm-1",
            "aspire_branch_id": 1403,
            "name": "Alice Smith",
            "title": "manager",
            "team_type": "branch",
            "user_id": None,
            "location": None,
            "bio": "Old bio.",
            "headshot_object_key": None,
            "active": 1,
            "sort_order": 0,
        }]
        r = client.patch("/api/settings/team-members/tm-1", json={"bio": "Updated bio."})
        assert r.status_code == 200

        updates = [c for c in mock_exec.await_args_list if "team_members" in c.args[0] and "UPDATE" in c.args[0].upper()]
        assert len(updates) == 1
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "1403" in flat
        assert "Old bio." in flat
        assert "Updated bio." in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_updates_out_of_scope_row_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [{
            "id": "tm-2",
            "aspire_branch_id": 3696,  # belongs to a DIFFERENT branch
            "name": "Bob",
            "title": "manager",
            "team_type": "branch",
            "user_id": None,
            "location": None,
            "bio": "Bio.",
            "headshot_object_key": None,
            "active": 1,
            "sort_order": 0,
        }]
        r = client.patch("/api/settings/team-members/tm-2", json={"bio": "Hack."})
        assert r.status_code == 403
        # No UPDATE or audit should have fired.
        updates = [c for c in mock_exec.await_args_list if "UPDATE" in c.args[0].upper()]
        assert len(updates) == 0

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_cannot_update_company_wide_row_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [{
            "id": "tm-3",
            "aspire_branch_id": None,  # company-wide
            "name": "CEO",
            "title": "executive",
            "team_type": "executive",
            "user_id": None,
            "location": None,
            "bio": "Exec bio.",
            "headshot_object_key": None,
            "active": 1,
            "sort_order": 0,
        }]
        r = client.patch("/api/settings/team-members/tm-3", json={"bio": "Hack."})
        assert r.status_code == 403


class TestTeamMembersDeactivate:
    """DELETE /api/settings/team-members/{id} -> soft-delete (active=0)."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_deactivate_sets_active_zero_no_hard_delete(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [{
            "id": "tm-1",
            "aspire_branch_id": 1403,
            "name": "Alice",
            "title": "manager",
            "team_type": "branch",
            "user_id": None,
            "location": None,
            "bio": "Bio.",
            "headshot_object_key": None,
            "active": 1,
            "sort_order": 0,
        }]
        r = client.delete("/api/settings/team-members/tm-1")
        assert r.status_code == 200

        # Must issue an UPDATE with active=0, never a hard DELETE.
        updates = [c for c in mock_exec.await_args_list if "UPDATE" in c.args[0].upper() and "team_members" in c.args[0]]
        deletes = [c for c in mock_exec.await_args_list if "DELETE" in c.args[0].upper() and "team_members" in c.args[0]]
        assert len(updates) == 1
        assert len(deletes) == 0

        # The UPDATE must set active = 0.
        update_params = updates[0].args[1]
        assert 0 in update_params

        # One audit row.
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "active" in flat or "0" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_deactivate_out_of_scope_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [{
            "id": "tm-2",
            "aspire_branch_id": 3696,
            "name": "Bob",
            "title": "manager",
            "team_type": "branch",
            "user_id": None,
            "location": None,
            "bio": "Bio.",
            "headshot_object_key": None,
            "active": 1,
            "sort_order": 0,
        }]
        r = client.delete("/api/settings/team-members/tm-2")
        assert r.status_code == 403
        mock_exec.assert_not_awaited()


# ── client_references CRUD ────────────────────────────────────────────────────

class TestClientReferencesCreate:
    """POST /api/settings/client-references"""

    _VALID_BODY = {
        "propertyName": "Pelican Bay HOA",
        "servicesProvided": "Full landscape maintenance",
        "contactName": "John Doe",
        "contactTitle": "Facilities Manager",
        "phone": "239-555-0100",
        "email": "john.doe@pelicanbay.com",
        "address": "1000 Pelican Bay Blvd, Naples, FL 34108",
        "clientSinceYear": 2018,
        "aspireBranchId": 1403,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_creates_for_own_branch_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        r = client.post("/api/settings/client-references", json=self._VALID_BODY)
        assert r.status_code == 201
        body = r.json()
        assert body["propertyName"] == "Pelican Bay HOA"
        assert body["aspireBranchId"] == 1403

        inserts = [c for c in mock_exec.await_args_list if "client_references" in c.args[0] and "INSERT" in c.args[0].upper()]
        assert len(inserts) == 1
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "branch" in flat and "1403" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_create_out_of_scope_branch_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        body = {**self._VALID_BODY, "aspireBranchId": 3696}
        r = client.post("/api/settings/client-references", json=body)
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_cannot_create_company_wide_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        body = {**self._VALID_BODY, "aspireBranchId": None}
        r = client.post("/api/settings/client-references", json=body)
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_creates_company_wide_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        body = {**self._VALID_BODY, "aspireBranchId": None}
        r = client.post("/api/settings/client-references", json=body)
        assert r.status_code == 201
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_creates_any_branch_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        body = {**self._VALID_BODY, "aspireBranchId": 9999}
        r = client.post("/api/settings/client-references", json=body)
        assert r.status_code == 201


class TestClientReferencesUpdate:
    """PATCH /api/settings/client-references/{id}"""

    _EXISTING_ROW = {
        "id": "cr-1",
        "aspire_branch_id": 1403,
        "property_name": "Pelican Bay HOA",
        "services_provided": "Maintenance",
        "contact_name": "John Doe",
        "contact_title": "FM",
        "phone": "239-555-0100",
        "email": "jd@pb.com",
        "address": "1000 Pelican Bay Blvd",
        "client_since_year": 2018,
        "active": 1,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_updates_own_branch_row_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.patch("/api/settings/client-references/cr-1", json={"contactName": "Jane Doe"})
        assert r.status_code == 200

        updates = [c for c in mock_exec.await_args_list if "UPDATE" in c.args[0].upper() and "client_references" in c.args[0]]
        assert len(updates) == 1
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "1403" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_update_out_of_scope_row_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        row = {**self._EXISTING_ROW, "aspire_branch_id": 3696}
        mock_query.return_value = [row]
        r = client.patch("/api/settings/client-references/cr-1", json={"contactName": "Hax."})
        assert r.status_code == 403

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_cannot_update_company_wide_row_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        row = {**self._EXISTING_ROW, "aspire_branch_id": None}
        mock_query.return_value = [row]
        r = client.patch("/api/settings/client-references/cr-1", json={"contactName": "Hax."})
        assert r.status_code == 403


class TestClientReferencesDeactivate:
    """DELETE /api/settings/client-references/{id} -> soft-delete (active=0)."""

    _EXISTING_ROW = {
        "id": "cr-1",
        "aspire_branch_id": 1403,
        "property_name": "Pelican Bay HOA",
        "services_provided": "Maintenance",
        "contact_name": "John Doe",
        "contact_title": "FM",
        "phone": "239-555-0100",
        "email": "jd@pb.com",
        "address": "1000 Pelican Bay Blvd",
        "client_since_year": 2018,
        "active": 1,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_deactivate_sets_active_zero_no_hard_delete(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.delete("/api/settings/client-references/cr-1")
        assert r.status_code == 200

        updates = [c for c in mock_exec.await_args_list if "UPDATE" in c.args[0].upper() and "client_references" in c.args[0]]
        deletes = [c for c in mock_exec.await_args_list if "DELETE" in c.args[0].upper() and "client_references" in c.args[0]]
        assert len(updates) == 1
        assert len(deletes) == 0

        update_params = updates[0].args[1]
        assert 0 in update_params

        audits = _audit_calls(mock_exec)
        assert len(audits) == 1

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_deactivate_out_of_scope_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        row = {**self._EXISTING_ROW, "aspire_branch_id": 3696}
        mock_query.return_value = [row]
        r = client.delete("/api/settings/client-references/cr-1")
        assert r.status_code == 403
        mock_exec.assert_not_awaited()


# ── portfolio_properties CRUD ─────────────────────────────────────────────────
# portfolio_properties has NO `active` column and NO `aspire_branch_id`.
# -> company-wide, admin-only.
# -> Deactivate performs a hard DELETE (no soft-delete column exists).
# -> Migration needed: ALTER TABLE portfolio_properties ADD COLUMN `active`
#    TINYINT(1) NOT NULL DEFAULT 1. Flag scheduled for post-Slice-13 sprint.

class TestPortfolioPropertiesCreate:
    """POST /api/settings/portfolio — admin-only."""

    _VALID_BODY = {
        "name": "Pelican Landing",
        "cityState": "Bonita Springs, FL",
        "regionId": "east-coast",
        "photoObjectKeys": ["gcs/portfolio/pelican-1.jpg"],
        "beforeAfterObjectKeys": None,
        "sortOrder": 5,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_create_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        r = client.post("/api/settings/portfolio", json=self._VALID_BODY)
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_create_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        r = client.post("/api/settings/portfolio", json=self._VALID_BODY)
        assert r.status_code == 201
        body = r.json()
        assert body["name"] == "Pelican Landing"
        assert body["regionId"] == "east-coast"

        inserts = [c for c in mock_exec.await_args_list if "portfolio_properties" in c.args[0] and "INSERT" in c.args[0].upper()]
        assert len(inserts) == 1

        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat
        assert "test.user@juniperlandscaping.com" in flat


class TestPortfolioPropertiesUpdate:
    """PATCH /api/settings/portfolio/{id} — admin-only."""

    _EXISTING_ROW = {
        "id": "pp-1",
        "name": "Pelican Landing",
        "city_state": "Bonita Springs, FL",
        "region_id": "east-coast",
        "photo_object_keys": "[]",
        "before_after_object_keys": None,
        "sort_order": 5,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_update_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.patch("/api/settings/portfolio/pp-1", json={"cityState": "Naples, FL"})
        assert r.status_code == 403
        updates = [c for c in mock_exec.await_args_list if "UPDATE" in c.args[0].upper()]
        assert len(updates) == 0

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_update_200_and_audits(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.patch("/api/settings/portfolio/pp-1", json={"sortOrder": 10})
        assert r.status_code == 200

        updates = [c for c in mock_exec.await_args_list if "UPDATE" in c.args[0].upper() and "portfolio_properties" in c.args[0]]
        assert len(updates) == 1
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat
        assert "sort_order" in flat


class TestPortfolioPropertiesDeactivate:
    """DELETE /api/settings/portfolio/{id} — admin-only hard delete (no active col)."""

    _EXISTING_ROW = {
        "id": "pp-1",
        "name": "Pelican Landing",
        "city_state": "Bonita Springs, FL",
        "region_id": "east-coast",
        "photo_object_keys": "[]",
        "before_after_object_keys": None,
        "sort_order": 5,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_delete_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.delete("/api/settings/portfolio/pp-1")
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_delete_200_hard_deletes_and_audits(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.delete("/api/settings/portfolio/pp-1")
        assert r.status_code == 200

        deletes = [c for c in mock_exec.await_args_list if "DELETE" in c.args[0].upper() and "portfolio_properties" in c.args[0]]
        assert len(deletes) == 1

        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat
