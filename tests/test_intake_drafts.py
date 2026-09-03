"""Intake Modal Completions (backend).

DB fully mocked — no MySQL. Contract under test:

  POST   /api/estimating/intake/drafts        → persist a partial intake to
         intake_submissions with is_draft=1. Creates NO estimate and fires NO
         Aspire push (property sync is estimate-submit only).
  GET    /api/estimating/intake/drafts        → list the caller's drafts
         (per-user, device-independent resume).
  DELETE /api/estimating/intake/drafts/{id}   → discard a draft (e.g. after a
         successful submit).

  estimates.rfi_status → first-class tracked field: persisted on create,
  updatable via PATCH, surfaced in the serialized estimate. Capture/display
  only — nothing gates approval on it.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest  # noqa: F401  (asyncio_mode=auto)
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
import api.estimating as est  # noqa: E402

client = TestClient(app)

_USER = {"id": "u1", "name": "Carlos", "email": "c@x.com", "role": "maintenance_estimating",
         "branch_id": "Orlando, FL", "avatar_initials": "CH"}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _draft_row(**over) -> dict:
    row = {
        "id": "ins-draft000001",
        "estimate_id": None,
        "estimate_type": "install",
        "payload": '{"opportunityName": "Greenfield Estate Install"}',
        "submitted_by": "u1",
        "is_draft": 1,
        "created_at": "2026-08-01 10:00:00",
    }
    row.update(over)
    return row


# ── POST /api/estimating/intake/drafts ───────────────────────────────────────

class TestSaveDraft:
    @patch("api.properties.sync_property_if_needed", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_post_persists_draft_row(self, mock_query, mock_exec, mock_bg, mock_prop, authed):
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "install",
            "payload": {"opportunityName": "Greenfield Estate Install"},
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["isDraft"] is True
        assert body["estimateType"] == "install"
        assert body["payload"] == {"opportunityName": "Greenfield Estate Install"}
        assert body["submittedBy"] == "u1"
        # exactly one INSERT into intake_submissions, flagged as draft
        insert_sql = mock_exec.call_args_list[0].args[0]
        assert "intake_submissions" in insert_sql
        assert "is_draft" in insert_sql

    @patch("api.properties.sync_property_if_needed", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_post_creates_no_estimate_and_fires_no_aspire_push(
        self, mock_query, mock_exec, mock_bg, mock_prop, authed
    ):
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "install", "payload": {"a": 1},
        })
        assert resp.status_code == 201
        for call in mock_exec.call_args_list:
            assert "INSERT INTO estimates" not in call.args[0]
        mock_bg.assert_not_called()
        mock_prop.assert_not_called()

    def test_post_rejects_bad_estimate_type(self, authed):
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "bogus", "payload": {"a": 1},
        })
        assert resp.status_code == 400

    def test_post_rejects_missing_payload(self, authed):
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "install",
        })
        assert resp.status_code == 400

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_post_with_draft_id_updates_existing_draft(self, mock_query, mock_exec, authed):
        mock_query.return_value = [_draft_row()]
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "install",
            "payload": {"opportunityName": "Updated"},
            "draftId": "ins-draft000001",
        })
        assert resp.status_code == 200
        assert resp.json()["id"] == "ins-draft000001"
        assert resp.json()["payload"] == {"opportunityName": "Updated"}
        update_sql = mock_exec.call_args_list[0].args[0]
        assert "UPDATE intake_submissions" in update_sql

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_post_with_unknown_draft_id_404s(self, mock_query, mock_exec, authed):
        mock_query.return_value = []
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "install", "payload": {"a": 1}, "draftId": "nope",
        })
        assert resp.status_code == 404


# ── GET /api/estimating/intake/drafts ────────────────────────────────────────

class TestListDrafts:
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_lists_only_the_callers_drafts(self, mock_query, authed):
        mock_query.return_value = [_draft_row()]
        resp = client.get("/api/estimating/intake/drafts")
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["id"] == "ins-draft000001"
        assert rows[0]["isDraft"] is True
        assert rows[0]["payload"] == {"opportunityName": "Greenfield Estate Install"}
        sql, params = mock_query.call_args.args
        assert "is_draft" in sql
        assert "submitted_by" in sql
        assert "u1" in params

    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_filters_by_estimate_type(self, mock_query, authed):
        mock_query.return_value = []
        resp = client.get("/api/estimating/intake/drafts?estimate_type=install")
        assert resp.status_code == 200
        sql, params = mock_query.call_args.args
        assert "estimate_type" in sql
        assert "install" in params


# ── DELETE /api/estimating/intake/drafts/{id} ────────────────────────────────

class TestDeleteDraft:
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_deletes_own_draft(self, mock_query, mock_exec, authed):
        mock_query.return_value = [_draft_row()]
        resp = client.delete("/api/estimating/intake/drafts/ins-draft000001")
        assert resp.status_code == 204
        delete_sql = mock_exec.call_args.args[0]
        assert "DELETE FROM intake_submissions" in delete_sql

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_404s_on_someone_elses_or_missing_draft(self, mock_query, mock_exec, authed):
        mock_query.return_value = []
        resp = client.delete("/api/estimating/intake/drafts/ins-x")
        assert resp.status_code == 404
        mock_exec.assert_not_called()


# ── estimates.rfi_status — first-class tracked field ─────────────────────────

def _full_est_row(**over) -> dict:
    row = {
        "id": "est-1", "estimate_type": "install", "name": "Greenfield",
        "aspire_number": None, "client_name": "Greenfield LLC",
        "branch": "Phoenix-Desert", "customer_type": "commercial",
        "acreage": None, "contract_value_cents": 0, "target_margin": 0.22,
        "status": "new_from_sales", "lifecycle": "bidding",
        "aspire_owner": "estimating", "priority": "medium",
        "win_probability": 0.5, "site_walk_date": None,
        "due_back_date": "2026-08-18", "anticipated_close_date": None,
        "service_start_date": None, "assigned_ls_estimator": None,
        "assigned_irr_estimator": None, "crm_rep": None,
        "notify_bm_rd_on_return": 1, "notes": None, "property_id": None,
        "aspire_opportunity_id": None, "aspire_sync_status": "pending",
        "rfi_status": "Awaiting GC response",
        "created_at": "2026-08-04 10:00:00", "updated_at": "2026-08-04 10:00:00",
    }
    row.update(over)
    return row


class TestRfiStatusFirstClass:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_create_persists_rfi_status(self, mock_query, mock_exec, mock_load, mock_bg, authed):
        mock_query.return_value = []  # itb_scopes read (auto-gen)
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "install", "name": "Greenfield", "clientName": "LLC",
            "aspireBranchId": 3579, "branchCity": "Orlando, FL",
            "rfiStatus": "Awaiting GC response on storm drain details",
        })
        assert resp.status_code == 201
        insert_sql, insert_params = mock_exec.call_args_list[0].args
        assert "rfi_status" in insert_sql
        assert "Awaiting GC response on storm drain details" in insert_params

    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_updates_rfi_status(self, mock_query, mock_exec, mock_load, authed):
        mock_query.return_value = [{
            "estimate_type": "install", "status": "in_progress", "aspire_opportunity_id": None,
        }]
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.patch("/api/estimating/estimates/est-1", json={
            "rfiStatus": "RFI answered — pricing final",
        })
        assert resp.status_code == 200
        update_sql, update_params = mock_exec.call_args.args
        assert "rfi_status = %s" in update_sql
        assert "RFI answered — pricing final" in update_params

    def test_estimate_out_surfaces_rfi_status(self):
        out = est._estimate_out(_full_est_row(), [])
        assert out["rfiStatus"] == "Awaiting GC response"

    def test_estimate_out_tolerates_pre_migration_rows(self):
        row = _full_est_row()
        row.pop("rfi_status")
        out = est._estimate_out(row, [])
        assert out["rfiStatus"] is None
