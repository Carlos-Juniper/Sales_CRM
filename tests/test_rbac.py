"""Roles, Permissions & Branch Scoping (server-side RBAC).

Acceptance criteria under test:
  * The 9 canonical roles exist in backend validation; legacy
    inside_sales/outside_sales map to sales.
  * An estimator-role session cannot POST adjustments (require_approver guard)
    or call approve-handback; a manager cannot approve a >$100k estimate (403).
  * manager/RD/VP/CEO/admin CAN mutate sections/services/components
    (previously 403). sales and procurement remain blocked.
  * list_estimates derives branch scope from the JWT, ignoring any client
    `branch` query param for non-cross-branch roles; exec/admin see all.
  * Approver identity (transition actor) comes from the JWT, not the body.
  * GET /api/estimating/config/branches returns Aspire-derived lists.

DB fully mocked — patch api.estimating.query/execute and api.authz.query.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
from api import authz  # noqa: E402

client = TestClient(app)


def _user(role: str, branch_id: str | None = "b1", **over) -> dict:
    u = {
        "id": "u1",
        "name": "Test User",
        "email": "test.user@juniperlandscaping.com",
        "role": role,
        "branch_id": branch_id,
        "avatar_initials": "TU",
    }
    u.update(over)
    return u


@pytest.fixture
def as_role():
    """Override require_auth with an arbitrary role; auto-clears."""
    def _set(role: str, branch_id: str | None = "b1", **over):
        app.dependency_overrides[require_auth] = lambda: _user(role, branch_id, **over)
    yield _set
    app.dependency_overrides.clear()


# ── Canonical role model ─────────────────────────────────────────────────────

class TestRoleModel:
    def test_nine_canonical_roles(self):
        assert authz.CANONICAL_ROLES == frozenset({
            "procurement", "sales", "admin", "manager", "regional_director",
            "maintenance_estimating", "install_estimating", "vice_president", "ceo",
        })

    def test_legacy_roles_normalize_to_sales(self):
        assert authz.normalize_role("inside_sales") == "sales"
        assert authz.normalize_role("outside_sales") == "sales"
        assert authz.normalize_role("manager") == "manager"

    def test_estimator_roles(self):
        for r in ("maintenance_estimating", "install_estimating", "admin"):
            assert authz.is_estimator(r), r
        for r in ("manager", "regional_director", "vice_president", "ceo", "sales", "procurement"):
            assert not authz.is_estimator(r), r

    def test_approver_roles(self):
        for r in ("manager", "regional_director", "vice_president", "ceo", "admin"):
            assert authz.is_approver(r), r
        for r in ("maintenance_estimating", "install_estimating", "sales", "procurement"):
            assert not authz.is_approver(r), r

    def test_require_approver_403s_estimator(self):
        with pytest.raises(HTTPException) as exc:
            authz.require_approver(_user("maintenance_estimating"))
        assert exc.value.status_code == 403

    def test_require_estimator_allows_approver_roles(self):
        # manager-tier roles now pass require_estimator.
        for role in ("manager", "regional_director", "vice_president", "ceo"):
            authz.require_estimator(_user(role))  # must not raise

    def test_require_estimator_403s_sales(self):
        with pytest.raises(HTTPException) as exc:
            authz.require_estimator(_user("sales"))
        assert exc.value.status_code == 403

    def test_require_estimator_403s_procurement(self):
        with pytest.raises(HTTPException) as exc:
            authz.require_estimator(_user("procurement"))
        assert exc.value.status_code == 403

    def test_approval_ceilings_match_tier_ladder(self):
        # manager <$100k · RD $250k · VP $1M · CEO unlimited (cents).
        assert authz.approval_ceiling_cents("manager") == 10_000_000
        assert authz.approval_ceiling_cents("regional_director") == 25_000_000
        assert authz.approval_ceiling_cents("vice_president") == 100_000_000
        assert authz.approval_ceiling_cents("ceo") is None
        assert authz.approval_ceiling_cents("admin") is None


# ── Line-item edit mutations (widened role set) ──────────────────────────────

class TestLineItemEditMutations:
    """manager-tier roles may now mutate sections/services/takeoff.

    sales and procurement are still blocked.  Approval-tier ceilings and the
    approve-handback guard are independently tested in TestApproverOwnedActions.
    """

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_sales_cannot_create_section(self, mock_query, mock_exec, as_role):
        as_role("sales")
        resp = client.post(
            "/api/estimating/estimates/est-1/sections", json={"name": "Front"}
        )
        assert resp.status_code == 403

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_procurement_cannot_create_section(self, mock_query, mock_exec, as_role):
        as_role("procurement")
        resp = client.post(
            "/api/estimating/estimates/est-1/sections", json={"name": "Front"}
        )
        assert resp.status_code == 403

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_manager_can_create_section(self, mock_query, mock_exec, as_role):
        as_role("manager")
        section_row = {
            "id": "sec-9", "estimate_id": "est-1", "name": "Front",
            "square_feet": 0, "sort_order": 0,
        }
        mock_query.side_effect = [
            [{"id": "est-1", "estimate_type": "install"}],
            [{"c": 0}],
            [],  # itb_projects lookup (recompute) -- no linked project, no-op
            [section_row],
            [],
        ]
        resp = client.post(
            "/api/estimating/estimates/est-1/sections", json={"name": "Front"}
        )
        assert resp.status_code == 201

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_regional_director_can_delete_section(self, mock_query, mock_exec, as_role):
        as_role("regional_director")
        mock_query.side_effect = [
            [{"id": "sec-1"}],
            [{"estimate_type": "install"}],
            [],  # itb_projects lookup (recompute) -- no linked project, no-op
        ]
        resp = client.delete("/api/estimating/estimates/est-1/sections/sec-1")
        assert resp.status_code == 204

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_estimator_can_create_section(self, mock_query, mock_exec, as_role):
        as_role("maintenance_estimating")
        section_row = {
            "id": "sec-9", "estimate_id": "est-1", "name": "Front",
            "square_feet": 0, "sort_order": 0,
        }
        mock_query.side_effect = [
            [{"id": "est-1", "estimate_type": "maintenance"}],
            [{"c": 0}],
            [],  # itb_projects lookup (recompute) -- no linked project, no-op
            [section_row],
            [],
        ]
        resp = client.post(
            "/api/estimating/estimates/est-1/sections", json={"name": "Front"}
        )
        assert resp.status_code == 201
        assert resp.json()["name"] == "Front"


# ── Approver-owned actions ───────────────────────────────────────────────────

def _est(status="approved", value_cents=5_000_000, **over):
    row = {"id": "est-1", "status": status, "contract_value_cents": value_cents}
    row.update(over)
    return row


class TestApproverOwnedActions:
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_estimator_cannot_approve_handback(self, mock_query, mock_exec, as_role):
        as_role("install_estimating")
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 403

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_manager_can_approve_below_100k(self, mock_query, mock_load, mock_exec, as_role):
        as_role("manager")
        mock_query.return_value = [_est(value_cents=5_000_000)]  # $50k
        mock_load.return_value = {"id": "est-1", "status": "handed_back"}
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 200

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_manager_cannot_approve_over_100k(self, mock_query, mock_load, mock_exec, as_role):
        as_role("manager")
        mock_query.return_value = [_est(value_cents=60_000_000)]  # $600k
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 403
        assert "tier" in resp.json()["detail"].lower()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_ceo_can_approve_over_1m(self, mock_query, mock_load, mock_exec, as_role):
        as_role("ceo")
        mock_query.return_value = [_est(value_cents=150_000_000)]  # $1.5M
        mock_load.return_value = {"id": "est-1", "status": "handed_back"}
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 200

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_actor_comes_from_jwt_not_body(self, mock_query, mock_load, mock_exec, as_role):
        as_role("manager", name="Jane Manager")
        mock_query.return_value = [_est()]
        mock_load.return_value = {"id": "est-1", "status": "handed_back"}
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback",
            json={"actor": "Spoofed Actor"},
        )
        assert resp.status_code == 200
        actors = {t["actor"] for t in resp.json()["transitions"]}
        assert actors == {"Jane Manager"}
        # And the persisted transition rows carry the JWT identity too.
        transition_params = [
            c.args[1] for c in mock_exec.await_args_list
            if "estimate_status_transitions" in c.args[0]
        ]
        assert transition_params
        for params in transition_params:
            assert "Jane Manager" in params
            assert "Spoofed Actor" not in params


# ── Estimate PATCH ownership split (C1 — margin/value approver-owned) ────────

def _patch_row(status="in_progress"):
    return [{"estimate_type": "maintenance", "status": status,
             "aspire_opportunity_id": None}]


@patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
@patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
@patch("api.estimating._load_estimate", new_callable=AsyncMock)
@patch("api.estimating.execute", new_callable=AsyncMock)
@patch("api.estimating.query", new_callable=AsyncMock)
class TestEstimatePatchOwnershipSplit:
    """The generic estimate PATCH enforces the refined ownership
    split: targetMargin is approver-only (the approval-tier lever);
    contractValueCents is estimator-or-approver (derived from estimator-owned
    line items); status is any authenticated role (the transition
    machine is the enforcement); all other scalar fields are estimator-owned
    (same convention as sections). Mixed bodies require every touched group's
    check (strictest-per-group)."""

    def _ok_mocks(self, mock_query, mock_load, status="in_progress"):
        mock_query.return_value = _patch_row(status)
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}

    def test_sales_cannot_patch_target_margin(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        as_role("sales")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"targetMargin": 0.55}
        )
        assert resp.status_code == 403
        mock_exec.assert_not_awaited()

    def test_estimator_cannot_patch_target_margin(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        as_role("maintenance_estimating")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"targetMargin": 0.55}
        )
        assert resp.status_code == 403
        mock_exec.assert_not_awaited()

    def test_estimator_can_patch_contract_value(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        # contractValueCents mirrors the line-item rollup the estimator edits;
        # there's no server-side rollup, so a Save legitimately includes it.
        as_role("install_estimating")
        self._ok_mocks(mock_query, mock_load)
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"contractValueCents": 12_000_000}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_sales_cannot_patch_contract_value(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        as_role("sales")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"contractValueCents": 12_000_000}
        )
        assert resp.status_code == 403
        mock_exec.assert_not_awaited()

    def test_estimator_can_patch_name(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        as_role("maintenance_estimating")
        self._ok_mocks(mock_query, mock_load)
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"name": "Renamed"}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_estimator_can_patch_status(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        as_role("maintenance_estimating")
        self._ok_mocks(mock_query, mock_load, status="queued")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"status": "in_progress"}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_approver_can_send_back_via_status(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        # ApprovalQueue.handleSendBack: an approver PATCHes {status:
        # 'in_progress'} from pending_approval (a legal edge) — status is not
        # estimator-gated; the transition machine is the enforcement.
        as_role("manager")
        self._ok_mocks(mock_query, mock_load, status="pending_approval")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"status": "in_progress"}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_sales_can_mark_lost_via_status(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        # LostTransition: a sales rep PATCHes {status: 'lost'} after hand-back
        # (handed_back → lost is a legal edge).
        as_role("sales")
        self._ok_mocks(mock_query, mock_load, status="handed_back")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"status": "lost"}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_sales_cannot_patch_name(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        # Plain scalar fields stay estimator-owned — sales only drives status.
        as_role("sales")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"name": "Renamed"}
        )
        assert resp.status_code == 403
        mock_exec.assert_not_awaited()

    def test_approver_can_patch_target_margin(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        as_role("manager")
        self._ok_mocks(mock_query, mock_load)
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"targetMargin": 0.55, "contractValueCents": 9_000_000},
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_approver_can_patch_plain_estimator_fields(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        # manager-tier roles now pass require_estimator for all
        # estimator-owned fields, including top-level estimate scalars like name.
        as_role("regional_director")
        self._ok_mocks(mock_query, mock_load)
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"name": "Renamed"}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_admin_passes_both_sides_of_the_split(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, as_role
    ):
        as_role("admin")
        self._ok_mocks(mock_query, mock_load)
        for body in ({"targetMargin": 0.5}, {"name": "Renamed"}):
            resp = client.patch("/api/estimating/estimates/est-1", json=body)
            assert resp.status_code == 200, body


# ── Branch scoping (BRD I-9.5) ───────────────────────────────────────────────

class TestBranchScoping:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_non_admin_scope_ignores_client_branch_param(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("sales", branch_id="Orlando, FL")
        mock_authz_query.return_value = [{"name": "Orlando, FL"}]
        mock_est_query.return_value = []
        resp = client.get("/api/estimating/estimates?branch=Raleigh, NC")
        assert resp.status_code == 200
        sql, params = mock_est_query.await_args_list[0].args
        assert "branch = %s" in sql
        assert "Orlando, FL" in params
        assert "Raleigh, NC" not in params

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_branch_id_resolves_via_sales_territories_table(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("maintenance_estimating", branch_id="Raleigh, NC")
        mock_authz_query.return_value = [{"name": "Raleigh, NC"}]
        mock_est_query.return_value = []
        client.get("/api/estimating/estimates")
        # Resolved the territory id → canonical name via sales_territories.
        authz_sql, authz_params = mock_authz_query.await_args_list[0].args
        assert "sales_territories" in authz_sql
        assert authz_params == ["Raleigh, NC"]
        _, params = mock_est_query.await_args_list[0].args
        assert "Raleigh, NC" in params

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_unmapped_branch_id_falls_back_to_raw_value(
        self, mock_est_query, mock_authz_query, as_role
    ):
        # crm rows where branch_id already holds the branch name keep working.
        as_role("manager", branch_id="Phoenix-Desert")
        mock_authz_query.return_value = []
        mock_est_query.return_value = []
        client.get("/api/estimating/estimates")
        _, params = mock_est_query.await_args_list[0].args
        assert "Phoenix-Desert" in params

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_exec_roles_see_all_branches(self, mock_est_query, mock_authz_query, as_role):
        for role in ("admin", "vice_president", "ceo"):
            as_role(role, branch_id="b1")
            mock_est_query.reset_mock()
            mock_est_query.return_value = []
            resp = client.get("/api/estimating/estimates")
            assert resp.status_code == 200
            sql = mock_est_query.await_args_list[0].args[0]
            assert "branch = %s" not in sql, role
        app.dependency_overrides.clear()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_exec_may_still_filter_by_branch_param(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_est_query.return_value = []
        client.get("/api/estimating/estimates?branch=Raleigh")
        sql, params = mock_est_query.await_args_list[0].args
        assert "branch = %s" in sql
        assert "Raleigh" in params

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_branchless_non_admin_sees_nothing(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("sales", branch_id=None)
        resp = client.get("/api/estimating/estimates")
        assert resp.status_code == 200
        assert resp.json() == []
        mock_est_query.assert_not_awaited()


# ── Config branches endpoint ──────────────────────────────────────────────────

class TestConfigBranches:
    def test_install_branches_excludes_fallback_cities(self, as_role):
        as_role("sales")
        resp = client.get("/api/estimating/config/branches?kind=install")
        assert resp.status_code == 200
        cities = [r["city"] for r in resp.json()]
        # Cities in ASPIRE_BRANCH_INSTALL_FALLBACKS must be absent from install list.
        from api.aspire_config import ASPIRE_BRANCH_INSTALL_FALLBACKS
        for city in ASPIRE_BRANCH_INSTALL_FALLBACKS:
            assert city not in cities, f"{city!r} should be excluded from install list"

    def test_install_branches_have_distinct_install_branch_ids(self, as_role):
        as_role("sales")
        from api.aspire_config import ASPIRE_BRANCH_MAP, ASPIRE_BRANCH_INSTALL_FALLBACKS
        resp = client.get("/api/estimating/config/branches?kind=install")
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) > 0
        for row in rows:
            city = row["city"]
            assert city not in ASPIRE_BRANCH_INSTALL_FALLBACKS
            # install BranchID must differ from maintenance BranchID for these cities.
            install_id = ASPIRE_BRANCH_MAP.get((city, True))
            maint_id = ASPIRE_BRANCH_MAP.get((city, False))
            assert install_id != maint_id, f"{city!r} should have distinct install branch"

    def test_maintenance_branches_includes_all_cities(self, as_role):
        as_role("maintenance_estimating")
        from api.aspire_config import ASPIRE_BRANCH_MAP
        resp = client.get("/api/estimating/config/branches?kind=maintenance")
        assert resp.status_code == 200
        cities = {r["city"] for r in resp.json()}
        all_maint_cities = {city for city, is_install in ASPIRE_BRANCH_MAP if not is_install}
        assert cities == all_maint_cities

    def test_branches_sorted_by_city(self, as_role):
        as_role("admin")
        for kind in ("install", "maintenance"):
            resp = client.get(f"/api/estimating/config/branches?kind={kind}")
            cities = [r["city"] for r in resp.json()]
            assert cities == sorted(cities), f"{kind} list is not sorted"

    def test_invalid_kind_returns_400(self, as_role):
        as_role("admin")
        resp = client.get("/api/estimating/config/branches?kind=bogus")
        assert resp.status_code == 400

    def test_requires_auth(self):
        resp = client.get("/api/estimating/config/branches?kind=install")
        # No auth override set — should 403 (no JWT).
        assert resp.status_code in (401, 403)
