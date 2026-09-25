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
    def test_canonical_roles(self):
        assert authz.CANONICAL_ROLES == frozenset({
            "procurement", "sales", "maintenance_sales", "install_sales",
            "inside_sales", "admin", "regional_sales_rep", "vp_sales", "manager",
            "regional_director", "maintenance_estimating", "install_estimating",
            "vice_president", "ceo",
            # Handoff 50 §3 (437c508): cross-branch owner of the company-wide
            # proposal assets. Not an estimator or approver — the two tests
            # below pin it out of those sets.
            "marketing",
        })

    def test_marketing_is_neither_estimator_nor_approver(self):
        assert "marketing" not in authz.ESTIMATOR_ROLES
        assert "marketing" not in authz.APPROVER_ROLES

    def test_only_outside_sales_normalizes_to_sales(self):
        assert authz.normalize_role("outside_sales") == "sales"
        assert authz.normalize_role("inside_sales") == "inside_sales"
        assert authz.normalize_role("manager") == "manager"

    def test_estimator_roles(self):
        for r in ("maintenance_estimating", "install_estimating", "admin"):
            assert authz.is_estimator(r), r
        for r in (
            "manager", "regional_director", "vice_president", "ceo",
            "sales", "maintenance_sales", "install_sales", "procurement",
        ):
            assert not authz.is_estimator(r), r

    def test_approver_roles(self):
        for r in ("manager", "regional_director", "vice_president", "ceo", "admin"):
            assert authz.is_approver(r), r
        for r in (
            "maintenance_estimating", "install_estimating",
            "sales", "maintenance_sales", "install_sales", "procurement",
        ):
            assert not authz.is_approver(r), r

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_require_approver_403s_estimator(self, mock_authz_query):
        # Live re-read confirms the JWT role (still an estimator here).
        mock_authz_query.return_value = [{"role": "maintenance_estimating", "active": 1}]
        with pytest.raises(HTTPException) as exc:
            await authz.require_approver(_user("maintenance_estimating"))
        assert exc.value.status_code == 403

    def test_require_estimator_allows_approver_roles(self):
        # manager-tier roles now pass require_estimator.
        for role in ("manager", "regional_director", "vice_president", "ceo"):
            authz.require_estimator(_user(role))  # must not raise

    def test_require_estimator_403s_sales(self):
        for role in ("sales", "maintenance_sales", "install_sales"):
            with pytest.raises(HTTPException) as exc:
                authz.require_estimator(_user(role))
            assert exc.value.status_code == 403

    def test_require_estimator_403s_procurement(self):
        with pytest.raises(HTTPException) as exc:
            authz.require_estimator(_user("procurement"))
        assert exc.value.status_code == 403

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_approval_ceiling_reads_from_table(self, mock_authz_query):
        # The ceiling is whatever the approval_tiers row says, not a constant.
        mock_authz_query.return_value = [{"max_value_cents": 10_000_000}]
        assert await authz.approval_ceiling_cents("manager") == 10_000_000
        # The emitted SQL reads approval_tiers keyed on the role.
        sql, params = mock_authz_query.await_args_list[0].args
        assert "approval_tiers" in sql
        assert "manager" in params

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_approval_ceiling_follows_edited_table_value(self, mock_authz_query):
        # Proves it reads the table, not APPROVAL_CEILING_CENTS: a DIFFERENT
        # mocked row for the SAME role yields a DIFFERENT ceiling. This is the
        # §5.1 defect — an admin editing the tier moves the real 403 boundary.
        mock_authz_query.return_value = [{"max_value_cents": 7_500_000}]
        assert await authz.approval_ceiling_cents("manager") == 7_500_000

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_approval_ceiling_null_max_is_unlimited(self, mock_authz_query):
        # CEO's top tier has max_value_cents NULL → unlimited.
        mock_authz_query.return_value = [{"max_value_cents": None}]
        assert await authz.approval_ceiling_cents("ceo") is None


# ── Split field-sales roles (maintenance_sales / install_sales) ──────────────

_PRIVILEGED_ROLE_SETS = (
    "ESTIMATOR_ROLES",
    "APPROVER_ROLES",
    "LINE_ITEM_EDIT_ROLES",
    "CROSS_BRANCH_ROLES",
    "REP_VIEWER_ROLES",
    "MARKETING_ROLES",
)

_BOTH_INTAKES = ["maintenance", "install"]


class TestSplitSalesRoles:
    """maintenance_sales and install_sales match sales access, then lock intake.

    Legacy `sales` stays canonical. Nothing here rewrites stored users.
    REP_VIEWER_ROLES is pinned exactly so the split cannot widen who sees
    every rep's numbers.
    """

    def test_legacy_sales_stays_canonical(self):
        assert "sales" in authz.CANONICAL_ROLES
        assert authz.normalize_role("sales") == "sales"
        assert authz.normalize_role("outside_sales") == "sales"
        assert authz.normalize_role("maintenance_sales") == "maintenance_sales"
        assert authz.normalize_role("install_sales") == "install_sales"

    def test_rep_viewer_roles_unchanged(self):
        assert authz.REP_VIEWER_ROLES == frozenset({
            "admin", "regional_sales_rep", "vp_sales",
            "vice_president", "ceo", "manager", "regional_director",
        })
        for role in ("sales", "maintenance_sales", "install_sales"):
            assert role not in authz.REP_VIEWER_ROLES

    def test_split_roles_match_sales_on_every_authz_set(self):
        for role in ("maintenance_sales", "install_sales"):
            assert role in authz.CANONICAL_ROLES
            assert role in authz.FIELD_SALES_ROLES
            for set_name in _PRIVILEGED_ROLE_SETS:
                role_set = getattr(authz, set_name)
                assert (role in role_set) == ("sales" in role_set), set_name
            assert authz.is_estimator(role) == authz.is_estimator("sales")
            assert authz.is_approver(role) == authz.is_approver("sales")
            assert authz.sees_all_branches(role) == authz.sees_all_branches("sales")
            assert authz.is_marketing_manager(role) == authz.is_marketing_manager("sales")
            assert authz.is_roster_rep(role) == authz.is_roster_rep("sales")
            assert authz.is_portfolio_editor(role) == authz.is_portfolio_editor("sales")
            assert authz.requires_aspire_sales_rep(role)
            assert authz.is_sales_rep(role)
            sql, params = authz.own_lead_filter(_user(role, id="rep-1"))
            assert sql == authz.OWN_LEAD_PREDICATE
            assert params == ["rep-1", "rep-1"]
        assert authz.requires_aspire_sales_rep("sales")
        assert authz.is_sales_rep("sales")
        assert authz.is_sales_rep("outside_sales")
        assert not authz.requires_aspire_sales_rep("manager")
        assert not authz.requires_aspire_sales_rep("inside_sales")
        # Existing inside_sales keeps the shared queue: company-wide leads.
        assert not authz.is_sales_rep("inside_sales")
        assert authz.own_lead_filter(_user("inside_sales")) == ("", [])
        # Roster ownership is wider than the lead book: inside_sales counts.
        for roster_role in (
            "sales", "outside_sales", "inside_sales",
            "maintenance_sales", "install_sales",
        ):
            assert authz.is_roster_rep(roster_role), roster_role
            assert authz.is_portfolio_editor(roster_role), roster_role
        assert "inside_sales" not in authz.FIELD_SALES_ROLES
        assert "inside_sales" in authz.ROSTER_REP_ROLES
        assert authz.is_portfolio_editor("marketing")
        assert authz.is_portfolio_editor("admin")
        assert not authz.is_roster_rep("marketing")
        assert not authz.is_portfolio_editor("manager")
        for wide in ("admin", "manager", "regional_director", "vice_president", "ceo"):
            assert not authz.is_sales_rep(wide)
            assert authz.own_lead_filter(_user(wide)) == ("", [])

    def test_split_roles_cannot_open_an_estimate(self):
        # Same gate as sales: the queue is visible, estimate detail is not.
        for role in ("sales", "maintenance_sales", "install_sales"):
            with pytest.raises(HTTPException) as exc:
                authz.require_estimate_viewer(_user(role))
            assert exc.value.status_code == 403

    def test_intake_lock_and_open_roles(self):
        assert authz.allowed_intake_types("maintenance_sales") == ["maintenance"]
        assert authz.allowed_intake_types("install_sales") == ["install"]
        for role in (
            "sales", "inside_sales", "admin", "manager", "regional_director",
            "vice_president", "ceo", "procurement", "marketing",
            "maintenance_estimating", "install_estimating",
        ):
            assert authz.allowed_intake_types(role) == _BOTH_INTAKES, role
        # A missing claim is not locked.
        assert authz.allowed_intake_types(None) == _BOTH_INTAKES
        assert authz.allowed_intake_types("  maintenance_sales  ") == ["maintenance"]

    def test_require_intake_type_blocks_only_the_other_intake(self):
        authz.require_intake_type(_user("maintenance_sales"), "maintenance")
        authz.require_intake_type(_user("install_sales"), "install")
        authz.require_intake_type(_user("sales"), "install")
        authz.require_intake_type(_user("admin"), "maintenance")
        authz.require_intake_type(_user("manager"), "install")
        with pytest.raises(HTTPException) as exc:
            authz.require_intake_type(_user("maintenance_sales"), "install")
        assert exc.value.status_code == 403
        assert "maintenance" in exc.value.detail
        with pytest.raises(HTTPException) as exc:
            authz.require_intake_type(_user("install_sales"), "maintenance")
        assert exc.value.status_code == 403
        assert "install" in exc.value.detail

    def test_me_exposes_role_and_allowed_intake_types(self, as_role):
        as_role("maintenance_sales")
        body = client.get("/api/auth/me").json()
        assert body["role"] == "maintenance_sales"
        assert body["allowed_intake_types"] == ["maintenance"]

        as_role("install_sales")
        body = client.get("/api/auth/me").json()
        assert body["role"] == "install_sales"
        assert body["allowed_intake_types"] == ["install"]

        as_role("sales")
        assert client.get("/api/auth/me").json()["allowed_intake_types"] == _BOTH_INTAKES

        as_role("admin")
        assert client.get("/api/auth/me").json()["allowed_intake_types"] == _BOTH_INTAKES

        as_role("regional_director")
        assert client.get("/api/auth/me").json()["allowed_intake_types"] == _BOTH_INTAKES

    def test_create_estimate_enforces_intake_lock(self, as_role):
        # Forbidden type is rejected before any write (no DB mock needed).
        as_role("install_sales")
        blocked = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "aspireBranchId": 1,
        })
        assert blocked.status_code == 403

        as_role("maintenance_sales")
        blocked = client.post("/api/estimating/estimates", json={
            "estimateType": "install", "aspireBranchId": 1,
        })
        assert blocked.status_code == 403

        # Legacy sales, admin, and a manager-tier role pass the lock and fail
        # later on the missing branch id — not on role.
        for role, estimate_type in (
            ("sales", "install"),
            ("sales", "maintenance"),
            ("admin", "maintenance"),
            ("manager", "install"),
            ("vice_president", "maintenance"),
        ):
            as_role(role)
            resp = client.post("/api/estimating/estimates", json={"estimateType": estimate_type})
            assert resp.status_code == 400, role
            assert "aspireBranchId" in resp.json()["detail"]

    def test_draft_enforces_intake_lock(self, as_role):
        as_role("maintenance_sales")
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "install", "payload": {"a": 1},
        })
        assert resp.status_code == 403

        as_role("install_sales")
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "maintenance", "payload": {"a": 1},
        })
        assert resp.status_code == 403

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_draft_allows_matching_and_unlocked_roles(self, mock_query, mock_exec, as_role):
        for role, estimate_type in (
            ("maintenance_sales", "maintenance"),
            ("install_sales", "install"),
            ("sales", "install"),
            ("sales", "maintenance"),
            ("admin", "install"),
            ("ceo", "maintenance"),
        ):
            as_role(role)
            resp = client.post("/api/estimating/intake/drafts", json={
                "estimateType": estimate_type, "payload": {"a": 1},
            })
            assert resp.status_code == 201, (role, resp.text)
            assert resp.json()["estimateType"] == estimate_type

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_draft_resume_rejects_stored_other_type(self, mock_query, mock_exec, as_role):
        as_role("maintenance_sales")
        mock_query.return_value = [{
            "id": "ins-1",
            "estimate_id": None,
            "estimate_type": "install",
            "payload": "{}",
            "submitted_by": "u1",
            "is_draft": 1,
            "created_at": "2026-08-01 10:00:00",
        }]
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "maintenance",
            "payload": {"a": 1},
            "draftId": "ins-1",
        })
        assert resp.status_code == 403
        mock_exec.assert_not_called()

    @patch("api.commissions.query", new_callable=AsyncMock, return_value=[])
    @patch("api.sales_performance.query", new_callable=AsyncMock, return_value=[])
    def test_rep_selectors_include_split_roles(self, mock_perf, mock_comm, as_role):
        as_role("admin")
        assert client.get("/api/sales-performance/reps").status_code == 200
        assert client.get("/api/commissions/reps").status_code == 200
        for mock in (mock_perf, mock_comm):
            params = list(mock.await_args.args[1])
            assert "sales" in params
            assert "maintenance_sales" in params
            assert "install_sales" in params
            assert "inside_sales" in params
            assert "outside_sales" in params


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


def _live_user(role: str, active: int = 1):
    """The users-table re-read (role + active) that approver guards now do."""
    return [{"role": role, "active": active}]


def _tier(max_value_cents):
    """The approval_tiers ceiling re-read the authority guard now does."""
    return [{"max_value_cents": max_value_cents}]


class TestApproverOwnedActions:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_estimator_cannot_approve_handback(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("install_estimating")
        mock_authz_query.return_value = _live_user("install_estimating")
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 403

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_manager_can_approve_below_100k(
        self, mock_query, mock_load, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_query.return_value = [_est(value_cents=5_000_000)]  # $50k
        # require_approver re-read, then approval_ceiling_cents tier read.
        mock_authz_query.side_effect = [_live_user("manager"), _tier(10_000_000)]
        mock_load.return_value = {"id": "est-1", "status": "handed_back"}
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 200

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_manager_cannot_approve_over_100k(
        self, mock_query, mock_load, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_query.return_value = [_est(value_cents=60_000_000)]  # $600k
        mock_authz_query.side_effect = [_live_user("manager"), _tier(10_000_000)]
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 403
        assert "tier" in resp.json()["detail"].lower()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_ceo_can_approve_over_1m(
        self, mock_query, mock_load, mock_exec, mock_authz_query, as_role
    ):
        as_role("ceo")
        mock_query.return_value = [_est(value_cents=150_000_000)]  # $1.5M
        mock_authz_query.side_effect = [_live_user("ceo"), _tier(None)]
        mock_load.return_value = {"id": "est-1", "status": "handed_back"}
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 200

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_actor_comes_from_jwt_not_body(
        self, mock_query, mock_load, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager", name="Jane Manager")
        mock_query.return_value = [_est()]
        mock_authz_query.side_effect = [_live_user("manager"), _tier(10_000_000)]
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

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_demoted_manager_403s_despite_stale_jwt(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # B.2: the JWT still says manager, but the live users row now says
        # sales. The very next approver call must 403 — role is re-read.
        as_role("manager")
        mock_query.return_value = [_est(value_cents=5_000_000)]
        mock_authz_query.return_value = _live_user("sales")
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 403

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_deactivated_approver_403s(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # B.2: still a manager by role, but active=0 → approval authority
        # revoked immediately, before the token expires.
        as_role("manager")
        mock_query.return_value = [_est(value_cents=5_000_000)]
        mock_authz_query.return_value = _live_user("manager", active=0)
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 403


# ── Estimate PATCH ownership split (C1 — margin/value approver-owned) ────────

def _patch_row(status="in_progress"):
    return [{"estimate_type": "maintenance", "status": status,
             "aspire_opportunity_id": None}]


@patch("api.authz.query", new_callable=AsyncMock)
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
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
    ):
        as_role("sales")
        mock_authz_query.return_value = _live_user("sales")  # live re-read (B.2)
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"targetMargin": 0.55}
        )
        assert resp.status_code == 403
        mock_exec.assert_not_awaited()

    def test_estimator_cannot_patch_target_margin(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
    ):
        as_role("maintenance_estimating")
        mock_authz_query.return_value = _live_user("maintenance_estimating")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"targetMargin": 0.55}
        )
        assert resp.status_code == 403
        mock_exec.assert_not_awaited()

    def test_estimator_can_patch_contract_value(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
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
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
    ):
        as_role("sales")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"contractValueCents": 12_000_000}
        )
        assert resp.status_code == 403
        mock_exec.assert_not_awaited()

    def test_estimator_can_patch_name(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
    ):
        as_role("maintenance_estimating")
        self._ok_mocks(mock_query, mock_load)
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"name": "Renamed"}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_estimator_can_patch_status(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
    ):
        as_role("maintenance_estimating")
        self._ok_mocks(mock_query, mock_load, status="queued")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"status": "in_progress"}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_approver_can_send_back_via_status(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
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
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
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
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
    ):
        # Plain scalar fields stay estimator-owned — sales only drives status.
        as_role("sales")
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"name": "Renamed"}
        )
        assert resp.status_code == 403
        mock_exec.assert_not_awaited()

    def test_approver_can_patch_target_margin(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live_user("manager")  # live re-read (B.2)
        self._ok_mocks(mock_query, mock_load)
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"targetMargin": 0.55, "contractValueCents": 9_000_000},
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_approver_can_patch_plain_estimator_fields(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
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
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live_user("admin")  # live re-read (B.2)
        self._ok_mocks(mock_query, mock_load)
        for body in ({"targetMargin": 0.5}, {"name": "Renamed"}):
            resp = client.patch("/api/estimating/estimates/est-1", json=body)
            assert resp.status_code == 200, body


# ── Branch scoping (BRD I-9.5) ───────────────────────────────────────────────

class TestBranchScope:
    """resolve_branch_scope now derives a LIST of aspire_branch_id ints from
    user_branches (Amendment B.1), keyed on the JWT user id — not a single
    resolved territory string.
    """

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_scoped_role_gets_int_id_list(self, mock_authz_query):
        # A manager holding two Fort Myers rows (Install 1403, Maint 3696).
        mock_authz_query.return_value = [
            {"aspire_branch_id": 1403}, {"aspire_branch_id": 3696}
        ]
        scope = await authz.resolve_branch_scope(_user("manager"))
        assert scope.kind == "branch"
        assert scope.ids == [1403, 3696]
        # Keyed on the JWT user id against user_branches.
        sql, params = mock_authz_query.await_args_list[0].args
        assert "user_branches" in sql
        assert params == ["u1"]

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_regional_director_holds_many_rows(self, mock_authz_query):
        # RD reach comes from holding ~8 user_branches rows, NOT the role set.
        ids = [1401, 1402, 1403, 3694, 3695, 3696, 3679, 3680]
        mock_authz_query.return_value = [{"aspire_branch_id": i} for i in ids]
        scope = await authz.resolve_branch_scope(_user("regional_director"))
        assert scope.kind == "branch"
        assert scope.ids == ids

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_no_rows_yields_none_scope(self, mock_authz_query):
        mock_authz_query.return_value = []
        scope = await authz.resolve_branch_scope(_user("manager"))
        assert scope.kind == "none"
        assert scope.ids == []

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_exec_roles_see_all(self, mock_authz_query):
        for role in ("admin", "regional_sales_rep", "vp_sales", "vice_president", "ceo"):
            scope = await authz.resolve_branch_scope(_user(role))
            assert scope.kind == "all", role
        # sees_all short-circuits before touching user_branches.
        mock_authz_query.assert_not_awaited()


class TestBranchScopedQueries:
    """The two consuming endpoints build an aspire_branch_id IN (...) clause
    with exactly the scoped ids, and return [] for a none-scope.
    """

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_list_estimates_builds_in_clause(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = [
            {"aspire_branch_id": 1403}, {"aspire_branch_id": 3696}
        ]
        mock_est_query.return_value = []
        resp = client.get("/api/estimating/estimates")
        assert resp.status_code == 200
        sql, params = mock_est_query.await_args_list[0].args
        assert "aspire_branch_id IN (%s, %s)" in sql
        assert 1403 in params and 3696 in params

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_list_estimates_none_scope_returns_empty(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = []  # no user_branches rows
        resp = client.get("/api/estimating/estimates")
        assert resp.status_code == 200
        assert resp.json() == []
        mock_est_query.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_list_estimates_exec_has_no_branch_restriction(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_est_query.return_value = []
        resp = client.get("/api/estimating/estimates")
        assert resp.status_code == 200
        sql = mock_est_query.await_args_list[0].args[0]
        assert "aspire_branch_id IN" not in sql
        mock_authz_query.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_list_itb_projects_builds_in_clause_on_estimates(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = [{"aspire_branch_id": 1403}]
        mock_est_query.return_value = []  # no projects → early return
        resp = client.get("/api/estimating/itb/projects")
        assert resp.status_code == 200
        sql, params = mock_est_query.await_args_list[0].args
        assert "e.aspire_branch_id IN (%s)" in sql
        assert 1403 in params

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_list_itb_projects_none_scope_returns_empty(
        self, mock_est_query, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = []
        resp = client.get("/api/estimating/itb/projects")
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


# ── regional_sales_rep / vp_sales (admin-equivalent, still commission earners)


_ADMIN_EQUIVALENT_SALES = ("regional_sales_rep", "vp_sales")


class TestAdminEquivalentSalesRoles:
    """New roles share admin's grants and stay out of the field-sales lock.

    regional_director and vice_president keep their existing meanings.
    Approval ceilings mirror admin: no approval_tiers rows, so the ceiling is 0.
    """

    def test_membership(self):
        assert authz.ADMIN_EQUIVALENT_ROLES == frozenset({
            "admin", "regional_sales_rep", "vp_sales",
        })
        for role in _ADMIN_EQUIVALENT_SALES:
            assert role in authz.CANONICAL_ROLES
            assert role in authz.ADMIN_EQUIVALENT_ROLES
            for set_name in (
                "ESTIMATOR_ROLES",
                "APPROVER_ROLES",
                "LINE_ITEM_EDIT_ROLES",
                "CROSS_BRANCH_ROLES",
                "REP_VIEWER_ROLES",
                "FULL_ACCESS_ROLES",
                "PUBLIC_LEADS_ROLES",
                "ANALYTICS_DASHBOARD_ROLES",
                "MARKETING_ROLES",
                "PORTFOLIO_EDITOR_ROLES",
            ):
                assert role in getattr(authz, set_name), set_name
            assert role in authz.SALES_REP_DB_ROLES
            assert role not in authz.ESTIMATING_ONLY_ROLES
            assert role not in authz.FIELD_SALES_ROLES
            assert role not in authz.MANAGEMENT_ROLES
            assert role not in authz.ROSTER_REP_ROLES
            assert authz.is_estimator(role)
            assert authz.is_approver(role)
            assert authz.sees_all_branches(role)
            assert authz.is_marketing_manager(role)
            assert authz.is_portfolio_editor(role)
            assert not authz.is_roster_rep(role)
            assert not authz.is_estimating_only(role)
            assert not authz.requires_aspire_sales_rep(role)
            assert not authz.is_sales_rep(role)
            assert authz.own_lead_filter(_user(role, id="rep-9")) == ("", [])
            assert authz.allowed_intake_types(role) == ["maintenance", "install"]

    def test_regional_director_and_vice_president_are_unchanged(self):
        assert authz.normalize_role("regional_director") == "regional_director"
        assert authz.normalize_role("vice_president") == "vice_president"
        assert authz.normalize_role("regional_sales_rep") == "regional_sales_rep"
        assert authz.normalize_role("vp_sales") == "vp_sales"
        for role in ("regional_director", "vice_president"):
            assert role not in authz.ADMIN_EQUIVALENT_ROLES
            assert role not in authz.SALES_REP_DB_ROLES
            assert role in authz.APPROVER_ROLES
            assert role in authz.REP_VIEWER_ROLES
            assert role in authz.MANAGEMENT_ROLES
        assert "regional_director" not in authz.CROSS_BRANCH_ROLES
        assert "vice_president" in authz.CROSS_BRANCH_ROLES
        assert "admin" in authz.ADMIN_EQUIVALENT_ROLES

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_approval_ceiling_matches_admin_with_no_tier_rows(self, mock_authz_query):
        mock_authz_query.return_value = []
        assert await authz.approval_ceiling_cents("admin") == 0
        assert await authz.approval_ceiling_cents("regional_sales_rep") == 0
        assert await authz.approval_ceiling_cents("vp_sales") == 0
        queried = [call.args[1][0] for call in mock_authz_query.await_args_list]
        assert queried == ["admin", "regional_sales_rep", "vp_sales"]
        for sql, _params in (call.args for call in mock_authz_query.await_args_list):
            assert "approval_tiers" in sql

    def test_require_estimator_allows_admin_equivalent_sales_roles(self):
        for role in _ADMIN_EQUIVALENT_SALES:
            authz.require_estimator(_user(role))

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_require_approver_allows_admin_equivalent_sales_roles(self, mock_authz_query):
        for role in _ADMIN_EQUIVALENT_SALES:
            mock_authz_query.return_value = [{"role": role, "active": 1}]
            assert await authz.require_approver(_user(role)) == role
