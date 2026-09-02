"""Status Write-Path Hardening.

The generic PATCH /api/estimating/estimates/{id} must route status writes
through the transition machine (STATUS_TRANSITIONS): illegal edges are rejected
with a 4xx (409, matching approve-handback), legal edges still succeed, and a
same-status PATCH stays an idempotent no-op. DB fully mocked.
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

# Canonical estimator role — status PATCHes are open to any
# authenticated role (the transition machine enforces edges), but the scalar
# fields some tests send are estimator-owned, so authenticate as an estimator.
_USER = {"id": "u1", "name": "Carlos", "email": "c@x.com",
         "role": "maintenance_estimating",
         "branch_id": "Orlando, FL", "avatar_initials": "CH"}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _current(status: str) -> list[dict]:
    return [{"estimate_type": "maintenance", "status": status,
             "aspire_opportunity_id": None}]


def _patch_status(frm: str, to: str, mock_query, mock_load, extra: dict | None = None):
    mock_query.return_value = _current(frm)
    mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
    return client.patch(
        "/api/estimating/estimates/est-1", json={"status": to, **(extra or {})}
    )


@patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
@patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
@patch("api.estimating._load_estimate", new_callable=AsyncMock)
@patch("api.estimating.execute", new_callable=AsyncMock)
@patch("api.estimating.query", new_callable=AsyncMock)
class TestIllegalEdgesRejected:
    def test_new_from_sales_to_won_is_409(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch_status("new_from_sales", "won", mock_query, mock_load)
        assert resp.status_code == 409
        mock_exec.assert_not_awaited()   # nothing written
        mock_sync.assert_not_awaited()   # no Aspire write-back scheduled

    def test_in_progress_to_won_is_409(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch_status("in_progress", "won", mock_query, mock_load)
        assert resp.status_code == 409
        mock_exec.assert_not_awaited()
        mock_sync.assert_not_awaited()

    def test_queued_to_lost_is_409(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        # won/lost are reachable only via approved → handed_back → won|lost.
        resp = _patch_status("queued", "lost", mock_query, mock_load)
        assert resp.status_code == 409

    def test_terminal_status_cannot_move(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch_status("won", "in_progress", mock_query, mock_load)
        assert resp.status_code == 409

    def test_unknown_status_value_is_409(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        # Stale legacy values (draft/sent) are not legal targets from any state.
        resp = _patch_status("in_progress", "draft", mock_query, mock_load)
        assert resp.status_code == 409

    def test_409_detail_names_the_edge(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch_status("new_from_sales", "won", mock_query, mock_load)
        assert "new_from_sales" in resp.json()["detail"]
        assert "won" in resp.json()["detail"]


@patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
@patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
@patch("api.estimating._load_estimate", new_callable=AsyncMock)
@patch("api.estimating.execute", new_callable=AsyncMock)
@patch("api.estimating.query", new_callable=AsyncMock)
class TestLegalEdgesStillSucceed:
    @pytest.mark.parametrize("frm,to", [
        ("new_from_sales", "queued"),
        ("new_from_sales", "in_progress"),
        ("queued", "in_progress"),
        ("in_progress", "review"),
        ("in_progress", "pending_approval"),
        ("in_progress", "approved"),
        ("review", "in_progress"),
        ("pending_approval", "approved"),
        ("approved", "handed_back"),
        ("handed_back", "won"),
        ("handed_back", "lost"),
    ])
    def test_every_machine_edge_passes(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed, frm, to
    ):
        resp = _patch_status(frm, to, mock_query, mock_load)
        assert resp.status_code == 200, resp.text
        mock_exec.assert_awaited()

    def test_handed_back_to_won_still_schedules_writeback(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch_status("handed_back", "won", mock_query, mock_load)
        assert resp.status_code == 200
        mock_sync.assert_awaited_once()
        assert mock_sync.call_args.args[1] == "won"

    def test_same_status_patch_is_idempotent_noop(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        # Re-sending the current status (e.g. a full-form Save) must not 409.
        resp = _patch_status("in_progress", "in_progress", mock_query, mock_load)
        assert resp.status_code == 200
        mock_sync.assert_not_awaited()

    def test_patch_without_status_is_unaffected(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        mock_query.return_value = _current("in_progress")
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.patch(
            "/api/estimating/estimates/est-1", json={"notes": "no status here"}
        )
        assert resp.status_code == 200
        mock_exec.assert_awaited()

    def test_other_fields_ride_along_on_a_legal_edge(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch_status(
            "queued", "in_progress", mock_query, mock_load,
            extra={"priority": "high"},
        )
        assert resp.status_code == 200
        # The ride-along fields land in the _apply_updates UPDATE. That is no
        # longer guaranteed to be the LAST execute — entering in_progress also
        # fires the crew-rate clear (§2.6) after it — so scan all writes.
        field_updates = [
            c.args[0] for c in mock_exec.await_args_list
            if "status = %s" in c.args[0] and "priority = %s" in c.args[0]
        ]
        assert field_updates, "estimates UPDATE carrying status + priority not found"
