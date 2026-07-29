"""Tests for the Aspire wiring in api/estimating.py.

DB and the aspire_sync port are fully mocked — no MySQL, no HTTP. The domain must
never block on Aspire: create/patch always succeed locally and the push is a
best-effort background task whose result is persisted to the estimate's own
sync-status columns.
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
import api.estimating as est  # noqa: E402
from api.aspire_sync import OpportunityInput, SyncResult  # noqa: E402

client = TestClient(app)

_USER = {"id": "u1", "name": "Carlos", "email": "c@x.com", "role": "estimator",
         "branch_id": "Orlando, FL", "avatar_initials": "CH"}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _est_row(**over):
    row = {
        "id": "est-1", "estimate_type": "maintenance", "name": "Sunny HOA",
        "property_id": "prop-1", "crm_rep": "u9", "customer_type": "hoa",
        "branch": "Florida", "status": "handed_back", "aspire_opportunity_id": None,
    }
    row.update(over)
    return row


# ── enrichment: domain row → neutral OpportunityInput ────────────────────────

class TestBuildOpportunityInput:
    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_pulls_property_and_rep_refs(self, mock_query):
        # first call → property row, second → crm_user row
        mock_query.side_effect = [
            [{"aspire_property_id": 238431, "branch_city": "Orlando, FL"}],
            [{"aspire_rep_id": 278690}],
        ]
        inp = await est._build_opportunity_input(_est_row())
        assert isinstance(inp, OpportunityInput)
        assert inp.aspire_property_id == 238431
        assert inp.branch_city == "Orlando, FL"
        assert inp.aspire_rep_contact_id == 278690
        assert inp.is_install is False
        assert inp.service_line == "Maintenance: Contract"   # default per type
        assert inp.sales_type == "HOA"

    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_install_defaults_and_flag(self, mock_query):
        mock_query.side_effect = [
            [{"aspire_property_id": 1, "branch_city": "Orlando, FL"}],
            [{"aspire_rep_id": None}],
        ]
        inp = await est._build_opportunity_input(_est_row(estimate_type="install"))
        assert inp.is_install is True
        assert inp.service_line == "Install: Landscape"

    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_property_not_synced_yields_none(self, mock_query):
        mock_query.side_effect = [[{"aspire_property_id": None, "branch_city": "X"}], [{"aspire_rep_id": 1}]]
        inp = await est._build_opportunity_input(_est_row())
        assert inp.aspire_property_id is None


# ── persistence of a SyncResult back onto the estimate ───────────────────────

class TestPersistSyncResult:
    @patch("api.estimating.execute", new_callable=AsyncMock)
    async def test_synced_writes_ids_and_status(self, mock_exec):
        await est._persist_sync_result("est-1", SyncResult(
            status="synced", aspire_opportunity_id=99, aspire_number="8"))
        sql, params = mock_exec.call_args.args
        assert "aspire_sync_status" in sql
        assert 99 in params and "8" in params and "synced" in params

    @patch("api.estimating.execute", new_callable=AsyncMock)
    async def test_failed_writes_error_and_status(self, mock_exec):
        await est._persist_sync_result("est-1", SyncResult(status="failed", error="boom"))
        _, params = mock_exec.call_args.args
        assert "failed" in params and "boom" in params

    @patch("api.estimating.execute", new_callable=AsyncMock)
    async def test_disabled_leaves_pending(self, mock_exec):
        await est._persist_sync_result("est-1", SyncResult(status="disabled"))
        _, params = mock_exec.call_args.args
        assert "pending" in params
        assert "disabled" not in params        # never write the non-enum value


# ── background push orchestration ────────────────────────────────────────────

class TestSyncNewOpportunityBg:
    @patch("api.estimating._persist_sync_result", new_callable=AsyncMock)
    @patch("api.estimating.aspire_sync")
    @patch("api.estimating._build_opportunity_input", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_pushes_and_persists(self, mock_query, mock_build, mock_sync, mock_persist):
        mock_query.return_value = [_est_row()]
        mock_build.return_value = OpportunityInput(
            name="x", service_line="Maintenance: Contract", branch_city="Orlando, FL",
            is_install=False, aspire_property_id=1)
        mock_sync.push_new_opportunity = AsyncMock(
            return_value=SyncResult(status="synced", aspire_opportunity_id=7, aspire_number="8"))
        await est._sync_new_opportunity_bg("est-1")
        mock_sync.push_new_opportunity.assert_awaited_once()
        mock_persist.assert_awaited_once()


# ── HTTP: create schedules the push, never blocks ────────────────────────────

class TestCreateSchedulesSync:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    def test_create_persists_property_link_and_schedules(self, mock_exec, mock_load, mock_bg, authed):
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "propertyId": "prop-1"})
        assert resp.status_code == 201
        # background task ran (TestClient executes background tasks)
        mock_bg.assert_awaited_once()
        # property link persisted in the INSERT
        insert_params = mock_exec.call_args_list[0].args[1]
        assert "prop-1" in insert_params


# ── HTTP: won/lost schedule the write-back ───────────────────────────────────

class TestWonLostWriteBack:
    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_won_applies_side_effects_and_schedules(self, mock_query, mock_exec, mock_load, mock_bg, authed):
        mock_query.return_value = [{"estimate_type": "maintenance", "status": "handed_back",
                                    "aspire_opportunity_id": 7}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={"status": "won"})
        assert resp.status_code == 200
        mock_bg.assert_awaited_once()
        assert mock_bg.call_args.args[1] == "won"
        # WON side effects folded into the UPDATE
        update_sql = mock_exec.call_args.args[0]
        assert "aspire_owner" in update_sql and "lifecycle" in update_sql

    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_illegal_jump_to_won_does_not_write_back(self, mock_query, mock_exec, mock_load, mock_bg, authed):
        # in_progress → won is NOT a legal terminal transition; no Aspire write-back.
        mock_query.return_value = [{"estimate_type": "maintenance", "status": "in_progress",
                                    "aspire_opportunity_id": 7}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={"status": "won"})
        assert resp.status_code == 200
        mock_bg.assert_not_awaited()

    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_lost_forwards_reason(self, mock_query, mock_exec, mock_load, mock_bg, authed):
        mock_query.return_value = [{"estimate_type": "maintenance", "status": "handed_back",
                                    "aspire_opportunity_id": 7}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1",
                             json={"status": "lost", "lostReasonId": 13})
        assert resp.status_code == 200
        assert mock_bg.call_args.args[1] == "lost"
        assert mock_bg.call_args.args[2] == 13


# ── HTTP: manual retry endpoint ──────────────────────────────────────────────

class TestRetryEndpoint:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_retry_reschedules_opportunity_when_unsynced(self, mock_query, mock_bg, authed):
        mock_query.return_value = [_est_row(aspire_opportunity_id=None, status="handed_back")]
        resp = client.post("/api/estimating/estimates/est-1/retry-aspire-sync")
        assert resp.status_code in (200, 202)
        mock_bg.assert_awaited_once()

    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_retry_404_when_missing(self, mock_query, authed):
        mock_query.return_value = []
        resp = client.post("/api/estimating/estimates/nope/retry-aspire-sync")
        assert resp.status_code == 404


# ── background sweep over pending/failed rows ────────────────────────────────

class TestSweep:
    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_sweep_repushes_unsynced_and_terminal(self, mock_query, mock_new, mock_status):
        mock_query.return_value = [
            {"id": "est-1", "status": "handed_back", "aspire_opportunity_id": None},
            {"id": "est-2", "status": "won", "aspire_opportunity_id": 7},
        ]
        await est.sweep_once()
        mock_new.assert_awaited_once()          # est-1 not yet synced
        mock_status.assert_awaited_once()       # est-2 terminal, already has opp id
