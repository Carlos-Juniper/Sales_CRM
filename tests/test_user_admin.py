"""User administration API — Slice 6 (Handoff 38 §2.8).

Acceptance criteria under test (§6):

  * Authorize-from-directory: an admin picks a person returned by the M365
    directory search and POSTs it; a users row lands with the LOWERCASED email
    (Entra SSO matches on lowercased email, so a directory pick makes typos
    impossible) and the authorize is audited.

  * Hard-block field sales without a resolved aspire_rep_id (§2.8,
    prevent-don't-repair): saving role sales / maintenance_sales / install_sales
    with an unresolved aspire_rep_id is REJECTED (422/400) with the EXACT §2.8
    copy. Any other role saves with no Aspire link and no warning.

  * Activate/deactivate, never delete: a PATCH toggles users.active; NO DELETE is
    ever emitted. A deactivated user drops from GET /api/users?role=sales (which
    filters active=1) yet a historical name lookup still resolves (no FK, row
    stays).

  * Branches: setting a user's branches is a replace-set on user_branches and is
    audited.

  * Admin-only writes: every user-admin write re-reads the LIVE role from the
    users table (Amendment B.2), so a non-admin (even holding an admin claim)
    403s — a stale/forged claim cannot widen scope.

DB + graph + aspire fully mocked — patch api.settings.query / api.settings.execute,
api.authz.query (live role re-read), api.graph.search_directory, and
api.aspire_sync.resolve_aspire_rep_id.
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


# The EXACT §2.8 copy the sales-without-rep block must return, character for
# character — the UI keys off it, so a drift here is a real regression.
SALES_BLOCK_COPY = (
    "No Aspire contact matches this email. Create an Aspire user with the same "
    "email address, then click Link Aspire Rep. Until then, estimates from this "
    "rep push to Aspire without a sales rep — and opportunities already pushed "
    "must be corrected in Aspire by hand."
)


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
    return [{"role": role, "active": active}]


# ── Admin-only write boundary (live role re-read, B.2) ───────────────────────


class TestUserAdminAuthBoundary:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_authorize_403_even_with_admin_claim(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # Token CLAIMS admin, the live users row says manager → must 403.
        as_role("admin")
        mock_authz_query.return_value = _live("manager")
        r = client.post(
            "/api/settings/users",
            json={
                "name": "Jane Doe",
                "email": "jane.doe@juniperlandscaping.com",
                "role": "manager",
            },
        )
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_patch_user_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        r = client.patch(
            "/api/settings/users/u9",
            json={"active": False},
        )
        assert r.status_code == 403
        mock_exec.assert_not_awaited()


# ── Directory search + authorize (M365 pick) ─────────────────────────────────


class TestAuthorizeFromDirectory:
    @patch("api.graph.search_directory", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_directory_search_proxies_graph(
        self, mock_authz_query, mock_search, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_search.return_value = [
            {"name": "Jane Doe", "email": "Jane.Doe@juniperlandscaping.com"},
        ]
        r = client.get("/api/settings/users/directory", params={"q": "jane"})
        assert r.status_code == 200
        assert r.json() == [
            {"name": "Jane Doe", "email": "Jane.Doe@juniperlandscaping.com"}
        ]
        mock_search.assert_awaited_once()

    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_authorize_inserts_lowercased_email_and_audits(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # No existing user with that email.
        mock_query.return_value = []
        mock_resolve.return_value = None  # non-sales role: rep not needed
        r = client.post(
            "/api/settings/users",
            json={
                "name": "Jane Doe",
                "email": "Jane.Doe@JuniperLandscaping.com",  # mixed case in
                "role": "manager",
            },
        )
        assert r.status_code == 201, r.text

        insert_sqls = [
            c for c in mock_exec.await_args_list
            if "INSERT INTO users" in c.args[0]
        ]
        assert len(insert_sqls) == 1
        insert_params = insert_sqls[0].args[1]
        # Email stored lowercased so Entra SSO's lowercased-email match hits.
        assert "jane.doe@juniperlandscaping.com" in insert_params
        assert "Jane.Doe@JuniperLandscaping.com" not in insert_params

        audit_sqls = [
            c for c in mock_exec.await_args_list if "config_audit" in c.args[0]
        ]
        assert len(audit_sqls) >= 1
        flat = " ".join(str(p) for c in audit_sqls for p in c.args[1])
        assert "jane.doe@juniperlandscaping.com" in flat
        assert "test.user@juniperlandscaping.com" in flat  # actor


# ── Hard-block sales without a resolved aspire_rep_id (§2.8) ──────────────────


class TestSalesAspireRepBlock:
    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_sales_without_rep_rejected_with_exact_copy(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = []
        mock_resolve.return_value = None  # no Aspire contact matches the email
        r = client.post(
            "/api/settings/users",
            json={
                "name": "Sal Esrep",
                "email": "sal.esrep@juniperlandscaping.com",
                "role": "sales",
            },
        )
        assert r.status_code in (400, 422)
        assert r.json()["detail"] == SALES_BLOCK_COPY
        # Nothing may persist — prevent, don't repair.
        insert_sqls = [
            c for c in mock_exec.await_args_list if "INSERT INTO users" in c.args[0]
        ]
        assert not insert_sqls

    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_sales_with_resolved_rep_saves(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = []
        mock_resolve.return_value = 4242  # Aspire ContactID resolved
        r = client.post(
            "/api/settings/users",
            json={
                "name": "Sal Esrep",
                "email": "sal.esrep@juniperlandscaping.com",
                "role": "sales",
            },
        )
        assert r.status_code == 201, r.text
        insert_sqls = [
            c for c in mock_exec.await_args_list if "INSERT INTO users" in c.args[0]
        ]
        assert len(insert_sqls) == 1
        assert 4242 in insert_sqls[0].args[1]  # rep id persisted

    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_sales_role_saves_without_rep_no_warning(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = []
        mock_resolve.return_value = None  # no rep; irrelevant for non-sales
        r = client.post(
            "/api/settings/users",
            json={
                "name": "Manny Ger",
                "email": "manny.ger@juniperlandscaping.com",
                "role": "manager",
            },
        )
        assert r.status_code == 201, r.text
        # The block copy must NOT appear anywhere in the response.
        assert SALES_BLOCK_COPY not in r.text

    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_split_sales_roles_share_the_aspire_block(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        """Admin can assign the new roles, with the same Aspire hard-block as sales."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = []

        mock_resolve.return_value = None
        for role in ("maintenance_sales", "install_sales"):
            r = client.post(
                "/api/settings/users",
                json={
                    "name": "Split Rep",
                    "email": f"{role}@juniperlandscaping.com",
                    "role": role,
                },
            )
            assert r.status_code == 422, role
            assert r.json()["detail"] == SALES_BLOCK_COPY

        mock_exec.reset_mock()
        mock_resolve.return_value = 5150
        r = client.post(
            "/api/settings/users",
            json={
                "name": "Maint Rep",
                "email": "maint.rep@juniperlandscaping.com",
                "role": "maintenance_sales",
            },
        )
        assert r.status_code == 201, r.text
        assert r.json()["role"] == "maintenance_sales"
        assert r.json()["aspire_rep_id"] == 5150
        insert_sqls = [
            c for c in mock_exec.await_args_list if "INSERT INTO users" in c.args[0]
        ]
        assert len(insert_sqls) == 1
        assert "maintenance_sales" in insert_sqls[0].args[1]

    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_reassign_sales_keeps_aspire_link(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        """Moving sales → a split role does not drop a stored Aspire contact."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [
            {"id": "u9", "email": "sal@juniperlandscaping.com", "name": "Sal",
             "role": "sales", "active": 1, "aspire_rep_id": 4242}
        ]
        r = client.patch("/api/settings/users/u9", json={"role": "install_sales"})
        assert r.status_code == 200, r.text
        mock_resolve.assert_not_called()
        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE users SET role" in c.args[0]
        ]
        assert len(updates) == 1
        assert "install_sales" in updates[0].args[1]
        assert 4242 in updates[0].args[1]


# ── Activate / deactivate, never delete ──────────────────────────────────────


class TestActivateDeactivate:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_deactivate_sets_active_zero_no_delete(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Existing user row (from_value source for the audit).
        mock_query.return_value = [
            {"id": "u9", "email": "old.hand@juniperlandscaping.com",
             "role": "sales", "active": 1, "aspire_rep_id": 4242}
        ]
        r = client.patch("/api/settings/users/u9", json={"active": False})
        assert r.status_code == 200, r.text

        # active toggled to 0 via UPDATE, and NO DELETE anywhere.
        update_sqls = [
            c.args[0] for c in mock_exec.await_args_list
            if "UPDATE users" in c.args[0]
        ]
        assert len(update_sqls) == 1
        assert "active" in update_sqls[0]
        for c in mock_exec.await_args_list:
            assert "DELETE" not in c.args[0].upper()

        audit_sqls = [
            c for c in mock_exec.await_args_list if "config_audit" in c.args[0]
        ]
        assert len(audit_sqls) >= 1

    @patch("api.server.query", new_callable=AsyncMock)
    async def test_list_users_role_filter_excludes_inactive(
        self, mock_server_query, as_role
    ):
        # GET /api/users?role=sales must filter active=1 so a deactivated user
        # drops from the assignee picker. Assert the SQL carries the filter.
        as_role("admin")
        mock_server_query.return_value = [
            {"id": "u1", "name": "Active Sales", "email": "a@x.com",
             "role": "sales", "branch_id": "b1", "avatar_initials": "AS"}
        ]
        r = client.get("/api/users", params={"role": "sales"})
        assert r.status_code == 200
        sql = mock_server_query.await_args_list[0].args[0]
        assert "active = 1" in sql
        assert "role = %s" in sql

    @patch("api.server.query", new_callable=AsyncMock)
    async def test_historical_name_lookup_still_resolves_deactivated(
        self, mock_server_query, as_role
    ):
        # A deactivated user's row is NOT deleted (no FK), so a by-id lookup
        # still resolves the name on historical estimates. list_users without a
        # role filter and without active gating returns the row.
        as_role("admin")
        mock_server_query.return_value = [
            {"id": "u9", "name": "Old Hand", "email": "old.hand@x.com",
             "role": "sales", "branch_id": "b1", "avatar_initials": "OH"}
        ]
        r = client.get("/api/users")
        assert r.status_code == 200
        assert any(u["name"] == "Old Hand" for u in r.json())


# ── Role + branches (replace-set) ────────────────────────────────────────────


class TestRoleAndBranches:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_set_branches_replaces_and_audits(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [
            {"id": "u9", "email": "bm@juniperlandscaping.com",
             "role": "manager", "active": 1, "aspire_rep_id": None}
        ]
        r = client.patch(
            "/api/settings/users/u9",
            json={"branches": [1403, 3696]},
        )
        assert r.status_code == 200, r.text

        # Replace-set: delete old user_branches, then insert new ones.
        ub_deletes = [
            c for c in mock_exec.await_args_list
            if "DELETE FROM user_branches" in c.args[0]
        ]
        ub_inserts = [
            c for c in mock_exec.await_args_list
            if "INSERT INTO user_branches" in c.args[0]
        ]
        assert len(ub_deletes) == 1
        assert len(ub_inserts) == 2  # one per branch
        audit_sqls = [
            c for c in mock_exec.await_args_list if "config_audit" in c.args[0]
        ]
        assert len(audit_sqls) >= 1

    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_patch_role_to_sales_without_rep_blocked(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Existing user is a manager with no aspire_rep_id.
        mock_query.return_value = [
            {"id": "u9", "email": "bm@juniperlandscaping.com",
             "role": "manager", "active": 1, "aspire_rep_id": None}
        ]
        mock_resolve.return_value = None
        r = client.patch("/api/settings/users/u9", json={"role": "sales"})
        assert r.status_code in (400, 422)
        assert r.json()["detail"] == SALES_BLOCK_COPY

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_invalid_role_rejected(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [
            {"id": "u9", "email": "bm@juniperlandscaping.com",
             "role": "manager", "active": 1, "aspire_rep_id": None}
        ]
        r = client.patch("/api/settings/users/u9", json={"role": "wizard"})
        assert r.status_code in (400, 422)


# ── Link Aspire Rep ──────────────────────────────────────────────────────────


class TestLinkAspireRep:
    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_link_resolves_and_sets_rep_id(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [
            {"id": "u9", "email": "sal@juniperlandscaping.com",
             "role": "sales", "active": 1, "aspire_rep_id": None}
        ]
        mock_resolve.return_value = 7777
        r = client.post("/api/settings/users/u9/link-aspire-rep")
        assert r.status_code == 200, r.text
        update_sqls = [
            c for c in mock_exec.await_args_list
            if "UPDATE users" in c.args[0] and "aspire_rep_id" in c.args[0]
        ]
        assert len(update_sqls) == 1
        assert 7777 in update_sqls[0].args[1]

    @patch("api.aspire_sync.resolve_aspire_rep_id", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_link_unresolved_returns_block_copy(
        self, mock_query, mock_exec, mock_authz_query, mock_resolve, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [
            {"id": "u9", "email": "sal@juniperlandscaping.com",
             "role": "sales", "active": 1, "aspire_rep_id": None}
        ]
        mock_resolve.return_value = None
        r = client.post("/api/settings/users/u9/link-aspire-rep")
        assert r.status_code in (400, 422)
        assert r.json()["detail"] == SALES_BLOCK_COPY


# ── Task #15: enrich GET /api/users (active, aspire_rep_id, branches) ─────────


class TestListUsersEnriched:
    """GET /api/users must include active, aspireRepId, and branches[] fields.

    Additive enrichment — existing ?role= filter behavior must be preserved.
    Callers that only look at id/name/email/role are unaffected.
    """

    @patch("api.server.query", new_callable=AsyncMock)
    async def test_plain_list_includes_active_and_aspire_rep_id(
        self, mock_server_query, as_role
    ):
        """Plain GET /api/users must return active and aspireRepId fields."""
        as_role("admin")
        mock_server_query.return_value = [
            {
                "id": "u1", "name": "Alice Sales", "email": "a@x.com",
                "role": "sales", "branch_id": "b1", "avatar_initials": "AS",
                "active": 1, "aspire_rep_id": 4242,
                "aspire_branch_ids": None,  # second query returns branch ids
            }
        ]
        r = client.get("/api/users")
        assert r.status_code == 200
        users = r.json()
        assert len(users) >= 1
        u = users[0]
        assert "active" in u, "active field must be present"
        assert "aspireRepId" in u, "aspireRepId field must be present"
        assert "branches" in u, "branches array must be present"

    @patch("api.server.query", new_callable=AsyncMock)
    async def test_role_filter_excludes_inactive_and_returns_enriched_fields(
        self, mock_server_query, as_role
    ):
        """?role=sales must filter active=1 AND return active/aspireRepId/branches."""
        as_role("admin")
        mock_server_query.return_value = [
            {
                "id": "u1", "name": "Active Sales", "email": "a@x.com",
                "role": "sales", "branch_id": "b1", "avatar_initials": "AS",
                "active": 1, "aspire_rep_id": 4242,
                "aspire_branch_ids": "1403,3696",
            }
        ]
        r = client.get("/api/users", params={"role": "sales"})
        assert r.status_code == 200

        # SQL must carry both filters.
        sql = mock_server_query.await_args_list[0].args[0]
        assert "active = 1" in sql
        assert "role = %s" in sql

        users = r.json()
        u = users[0]
        assert u["active"] is True or u["active"] == 1
        assert u["aspireRepId"] == 4242
        # branches must be a list (even if empty).
        assert isinstance(u["branches"], list)

    @patch("api.server.query", new_callable=AsyncMock)
    async def test_plain_list_still_returns_inactive_users(
        self, mock_server_query, as_role
    ):
        """A plain GET /api/users (no role param) must still return inactive users
        so historical name lookups resolve for old estimates."""
        as_role("admin")
        mock_server_query.return_value = [
            {
                "id": "u9", "name": "Old Hand", "email": "old@x.com",
                "role": "sales", "branch_id": None, "avatar_initials": "OH",
                "active": 0, "aspire_rep_id": None,
                "aspire_branch_ids": None,
            }
        ]
        r = client.get("/api/users")
        assert r.status_code == 200
        assert any(u["name"] == "Old Hand" for u in r.json())

        # No active=1 filter in SQL for plain list.
        sql = mock_server_query.await_args_list[0].args[0]
        assert "active = 1" not in sql

    @patch("api.server.query", new_callable=AsyncMock)
    async def test_branches_array_populated_from_user_branches(
        self, mock_server_query, as_role
    ):
        """branches[] must contain the user's aspire_branch_ids from user_branches."""
        as_role("admin")
        # Simulate user with two branches (returned as comma-separated string
        # from GROUP_CONCAT or as a second query — implementation detail).
        mock_server_query.return_value = [
            {
                "id": "u1", "name": "BM", "email": "bm@x.com",
                "role": "manager", "branch_id": None, "avatar_initials": "BM",
                "active": 1, "aspire_rep_id": None,
                "aspire_branch_ids": "1403,3696",
            }
        ]
        r = client.get("/api/users")
        assert r.status_code == 200
        u = r.json()[0]
        assert isinstance(u["branches"], list)
        assert 1403 in u["branches"]
        assert 3696 in u["branches"]
