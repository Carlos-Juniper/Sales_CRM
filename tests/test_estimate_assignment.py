"""Handoff 54 §6 — estimate assignment endpoint and mine filter.

Tests:
  POST /api/estimating/estimates/{id}/assign
    - Manager can assign ls_estimator
    - Reassignment captures old value as from_user_id in audit row
    - Non-manager (plain estimator) gets 403
    - Manager assigning to out-of-scope branch estimate gets 403
    - Assigning same estimator is a no-op (no audit row written)

  GET /api/estimating/estimates?mine=true
    - Returns only estimates where the caller is assigned_ls_estimator or
      assigned_irr_estimator (post-query Python filter)

All DB I/O is mocked via AsyncMock side-effects; no FakeDb needed here because
the assignment endpoint does direct SELECT + UPDATE + INSERT, not going through
the nested _load_estimate tree.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, call, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

# ── Identities ────────────────────────────────────────────────────────────────

_MANAGER = {
    "id": "mgr-1",
    "name": "Maria Manager",
    "email": "m@x.com",
    "role": "maintenance_estimating_manager",
    "branch_id": None,
    "avatar_initials": "MM",
}

_ESTIMATOR = {
    "id": "est-1",
    "name": "Ed Estimator",
    "email": "e@x.com",
    "role": "maintenance_estimating",
    "branch_id": None,
    "avatar_initials": "EE",
}

_LS_USER_ID = "ls-user-1"
_IRR_USER_ID = "irr-user-1"
_BRANCH_ID = 3668


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def as_manager():
    app.dependency_overrides[require_auth] = lambda: _MANAGER
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def as_estimator():
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    yield
    app.dependency_overrides.clear()


# ── Helper: build the SELECT row returned when the estimate exists ─────────────

def _est_row(**override) -> dict:
    row = {
        "id": "est-abc",
        "aspire_branch_id": _BRANCH_ID,
        "assigned_ls_estimator": None,
        "assigned_irr_estimator": None,
    }
    row.update(override)
    return row


# ── POST assign tests ─────────────────────────────────────────────────────────

class TestAssignEndpoint:
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    def test_manager_can_assign_ls_estimator(
        self, mock_authz_q, mock_query, mock_exec, as_manager
    ):
        """A manager can assign an LS estimator; the estimates row is updated
        and an estimate_assignments audit row is written with from_user_id=NULL."""
        # authz.resolve_branch_scope → user_branches for manager
        mock_authz_q.return_value = [{"aspire_branch_id": _BRANCH_ID}]
        # estimates SELECT
        mock_query.return_value = [_est_row()]

        resp = client.post(
            "/api/estimating/estimates/est-abc/assign",
            json={"lsEstimatorId": _LS_USER_ID},
        )

        assert resp.status_code == 204

        # Should have issued UPDATE on estimates
        update_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE estimates" in c.args[0]
        ]
        assert len(update_calls) == 1
        assert "assigned_ls_estimator" in update_calls[0].args[0]

        # Should have inserted audit row
        audit_calls = [
            c for c in mock_exec.call_args_list
            if "INSERT INTO estimate_assignments" in c.args[0]
        ]
        assert len(audit_calls) == 1
        audit_params = audit_calls[0].args[1]
        # params order: id, estimate_id, from_user_id, to_user_id, role, assigned_by, note
        assert "est-abc" in audit_params       # estimate_id
        assert _LS_USER_ID in audit_params     # to_user_id
        assert "ls" in audit_params            # role
        assert _MANAGER["id"] in audit_params  # assigned_by
        # from_user_id is None because no prior assignee
        assert None in audit_params

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    def test_assign_creates_audit_row_with_from_user(
        self, mock_authz_q, mock_query, mock_exec, as_manager
    ):
        """Reassigning captures the old estimator as from_user_id."""
        old_ls = "old-ls-user"
        mock_authz_q.return_value = [{"aspire_branch_id": _BRANCH_ID}]
        mock_query.return_value = [_est_row(assigned_ls_estimator=old_ls)]

        resp = client.post(
            "/api/estimating/estimates/est-abc/assign",
            json={"lsEstimatorId": _LS_USER_ID},
        )

        assert resp.status_code == 204
        audit_calls = [
            c for c in mock_exec.call_args_list
            if "INSERT INTO estimate_assignments" in c.args[0]
        ]
        assert len(audit_calls) == 1
        audit_params = audit_calls[0].args[1]
        assert old_ls in audit_params      # from_user_id is the old estimator
        assert _LS_USER_ID in audit_params  # to_user_id is the new one

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    def test_non_manager_gets_403(
        self, mock_authz_q, mock_query, mock_exec, as_estimator
    ):
        """A plain estimator cannot assign — 403."""
        resp = client.post(
            "/api/estimating/estimates/est-abc/assign",
            json={"lsEstimatorId": _LS_USER_ID},
        )
        assert resp.status_code == 403
        # No DB writes should have happened
        mock_exec.assert_not_called()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    def test_assign_out_of_scope_branch_gets_403(
        self, mock_authz_q, mock_query, mock_exec, as_manager
    ):
        """Manager cannot assign to an estimate outside their branch scope."""
        # Manager's branches do NOT include the estimate's branch
        mock_authz_q.return_value = [{"aspire_branch_id": 9999}]
        mock_query.return_value = [_est_row(aspire_branch_id=_BRANCH_ID)]

        resp = client.post(
            "/api/estimating/estimates/est-abc/assign",
            json={"lsEstimatorId": _LS_USER_ID},
        )
        assert resp.status_code == 403
        mock_exec.assert_not_called()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    def test_assign_noop_same_estimator(
        self, mock_authz_q, mock_query, mock_exec, as_manager
    ):
        """Assigning the same estimator who is already assigned is a no-op —
        no UPDATE and no audit row written."""
        mock_authz_q.return_value = [{"aspire_branch_id": _BRANCH_ID}]
        # Pre-existing assignment is the same user we're trying to assign
        mock_query.return_value = [_est_row(assigned_ls_estimator=_LS_USER_ID)]

        resp = client.post(
            "/api/estimating/estimates/est-abc/assign",
            json={"lsEstimatorId": _LS_USER_ID},
        )
        assert resp.status_code == 204
        # Neither update nor audit insert should fire
        mock_exec.assert_not_called()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    def test_assign_estimate_not_found_gets_404(
        self, mock_authz_q, mock_query, mock_exec, as_manager
    ):
        """404 when the estimate doesn't exist."""
        mock_authz_q.return_value = [{"aspire_branch_id": _BRANCH_ID}]
        mock_query.return_value = []  # estimate SELECT returns nothing

        resp = client.post(
            "/api/estimating/estimates/no-such-est/assign",
            json={"lsEstimatorId": _LS_USER_ID},
        )
        assert resp.status_code == 404


# ── GET estimates?mine=true tests ──────────────────────────────────────────────

class TestMineFilter:
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    def test_mine_filter_returns_only_assigned_estimates(
        self, mock_authz_q, mock_query, mock_load, as_manager
    ):
        """mine=true keeps only estimates where caller is ls or irr estimator."""
        mgr_id = _MANAGER["id"]
        # authz: manager sees all branches (cross-branch role? No, manager role
        # is not in CROSS_BRANCH_ROLES). Use user_branches approach.
        # maintenance_estimating_manager is not in CROSS_BRANCH_ROLES — it uses
        # user_branches. Return a branch so scope.kind == "branch".
        mock_authz_q.return_value = [{"aspire_branch_id": _BRANCH_ID}]

        # query returns 3 estimate ids
        mock_query.return_value = [
            {"id": "est-mine-ls"},
            {"id": "est-mine-irr"},
            {"id": "est-other"},
        ]
        # _load_estimate returns full estimate objects; only two belong to manager
        async def _fake_load(est_id, sla_window_days=None):
            data = {
                "est-mine-ls":  {"id": "est-mine-ls",  "assignedLsEstimator": mgr_id, "assignedIrrEstimator": None},
                "est-mine-irr": {"id": "est-mine-irr", "assignedLsEstimator": None,   "assignedIrrEstimator": mgr_id},
                "est-other":    {"id": "est-other",    "assignedLsEstimator": "other", "assignedIrrEstimator": "other2"},
            }
            return data[est_id]

        mock_load.side_effect = _fake_load

        resp = client.get("/api/estimating/estimates?mine=true")
        assert resp.status_code == 200
        ids = [e["id"] for e in resp.json()]
        assert "est-mine-ls" in ids
        assert "est-mine-irr" in ids
        assert "est-other" not in ids

    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.query", new_callable=AsyncMock)
    def test_mine_false_returns_all_estimates(
        self, mock_authz_q, mock_query, mock_load, as_manager
    ):
        """mine=false (default) returns all in-scope estimates without filtering."""
        mgr_id = _MANAGER["id"]
        mock_authz_q.return_value = [{"aspire_branch_id": _BRANCH_ID}]
        mock_query.return_value = [
            {"id": "est-mine-ls"},
            {"id": "est-other"},
        ]

        async def _fake_load(est_id, sla_window_days=None):
            data = {
                "est-mine-ls": {"id": "est-mine-ls", "assignedLsEstimator": mgr_id, "assignedIrrEstimator": None},
                "est-other":   {"id": "est-other",   "assignedLsEstimator": "other", "assignedIrrEstimator": "other2"},
            }
            return data[est_id]

        mock_load.side_effect = _fake_load

        resp = client.get("/api/estimating/estimates")
        assert resp.status_code == 200
        ids = [e["id"] for e in resp.json()]
        assert "est-mine-ls" in ids
        assert "est-other" in ids
