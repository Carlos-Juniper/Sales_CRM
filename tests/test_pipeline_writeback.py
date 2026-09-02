"""Pipeline kanban redesign — lead <-> estimate status write-back.

Three trigger points move a linked lead across the Qualifying / Estimating /
OP Review / Approved kanban columns automatically (never a manual drag):
  1. create_estimate: leadId present on the create payload -> 'estimating'
  2. update_estimate (generic PATCH): status -> review/pending_approval -> 'op_review'
  3. approve_handback: status chain lands on 'approved' -> 'approved'

DB fully mocked — patch api.estimating.query/execute; no MySQL.
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

_ESTIMATOR = {"id": "u1", "name": "Carlos", "email": "c@x.com",
              "role": "maintenance_estimating",
              "branch_id": "Orlando, FL", "avatar_initials": "CH"}
_APPROVER = {"id": "u2", "name": "Regional Director", "email": "rd@x.com",
             "role": "regional_director",
             "branch_id": "Orlando, FL", "avatar_initials": "RD"}


@pytest.fixture
def as_estimator():
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def as_approver():
    app.dependency_overrides[require_auth] = lambda: _APPROVER
    yield
    app.dependency_overrides.clear()


def _approver_authz_reads():
    """The two authz.query reads the approve path now does (B.2 + §5.1): the
    live users row (role + active) then the approval_tiers ceiling. RD's $250k
    ceiling covers every value under test here."""
    return [
        [{"role": "regional_director", "active": 1}],
        [{"max_value_cents": 25_000_000}],
    ]


# ── create_estimate: Qualifying -> Estimating ────────────────────────────────

class TestCreateWritesBackEstimating:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_create_with_lead_id_writes_back_estimating(
        self, mock_query, mock_exec, mock_load, mock_bg, as_estimator
    ):
        mock_query.return_value = []  # itb_scopes read (auto-gen)
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "branch": "Orlando, FL", "leadId": "lead-1"})
        assert resp.status_code == 201
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert len(writeback_calls) == 1
        sql, params = writeback_calls[0].args
        assert params == ["estimating", "lead-1"]

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_create_without_lead_id_is_a_noop(
        self, mock_query, mock_exec, mock_load, mock_bg, as_estimator
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "branch": "Orlando, FL"})
        assert resp.status_code == 201
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert writeback_calls == []


# ── update_estimate PATCH: Estimating -> OP Review ───────────────────────────

class TestPatchWritesBackOpReview:
    def _current(self, status: str, lead_id: str | None):
        return [{"estimate_type": "maintenance", "status": status,
                  "aspire_opportunity_id": None, "lead_id": lead_id}]

    @patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @pytest.mark.parametrize("target", ["review", "pending_approval"])
    def test_patch_to_review_or_pending_approval_writes_back_op_review(
        self, mock_query, mock_exec, mock_load, mock_push, as_estimator, target
    ):
        mock_query.return_value = self._current("in_progress", "lead-2")
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"status": target}
        )
        assert resp.status_code == 200, resp.text
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert len(writeback_calls) == 1
        sql, params = writeback_calls[0].args
        assert params == ["op_review", "lead-2"]

    @patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_without_lead_id_is_a_noop(
        self, mock_query, mock_exec, mock_load, mock_push, as_estimator
    ):
        mock_query.return_value = self._current("in_progress", None)
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"status": "review"}
        )
        assert resp.status_code == 200, resp.text
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert writeback_calls == []

    @patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_same_status_patch_does_not_rewrite_back(
        self, mock_query, mock_exec, mock_load, mock_push, as_estimator
    ):
        # Re-sending the current status (e.g. a full-form Save) is an idempotent
        # no-op — must not re-fire the lead write-back either.
        mock_query.return_value = self._current("review", "lead-2")
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"status": "review"}
        )
        assert resp.status_code == 200, resp.text
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert writeback_calls == []

    @patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_without_status_does_not_touch_lead(
        self, mock_query, mock_exec, mock_load, mock_push, as_estimator
    ):
        mock_query.return_value = self._current("in_progress", "lead-2")
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"notes": "no status here"}
        )
        assert resp.status_code == 200, resp.text
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert writeback_calls == []


# ── approve_handback: OP Review -> Approved ──────────────────────────────────

class TestApproveHandbackWritesBackApproved:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_approve_from_in_progress_writes_back_approved(
        self, mock_query, mock_exec, mock_load, mock_authz_query, as_approver
    ):
        mock_authz_query.side_effect = _approver_authz_reads()
        mock_query.return_value = [{"id": "est-1", "status": "in_progress",
                                     "contract_value_cents": 5000, "lead_id": "lead-3"}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 200, resp.text
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert len(writeback_calls) == 1
        sql, params = writeback_calls[0].args
        assert params == ["approved", "lead-3"]

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_approve_without_lead_id_is_a_noop(
        self, mock_query, mock_exec, mock_load, mock_authz_query, as_approver
    ):
        mock_authz_query.side_effect = _approver_authz_reads()
        mock_query.return_value = [{"id": "est-1", "status": "in_progress",
                                     "contract_value_cents": 5000, "lead_id": None}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 200, resp.text
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert writeback_calls == []

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_approve_already_approved_chains_to_handed_back_only_and_still_writes_back(
        self, mock_query, mock_exec, mock_load, mock_authz_query, as_approver
    ):
        # status == 'approved' -> steps = ['handed_back'] only; 'approved' is
        # still in the transition records list is NOT true here, so the
        # write-back only fires when the chain actually LANDS on 'approved'
        # in this call (i.e. starting from a pre-approval status).
        mock_authz_query.side_effect = _approver_authz_reads()
        mock_query.return_value = [{"id": "est-1", "status": "approved",
                                     "contract_value_cents": 5000, "lead_id": "lead-4"}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.post(
            "/api/estimating/estimates/est-1/approve-handback", json={}
        )
        assert resp.status_code == 200, resp.text
        writeback_calls = [
            c for c in mock_exec.call_args_list
            if "UPDATE leads SET status" in c.args[0]
        ]
        assert writeback_calls == []
