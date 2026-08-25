"""Tests for api/properties.py — app-owned canonical property records.

Local table is the SOURCE OF TRUTH: search reads local; create writes local
ONLY (aspire_sync_status='unsynced', NO auto-push — Handoff 15: the only Aspire
trigger is estimate submission). Create is an upsert on (source_type, source_id)
so promotion is idempotent. The Aspire opportunity-history proxy is best-effort
and returns [] when sync is disabled. DB + port fully mocked.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
import api.properties as props  # noqa: E402
from api.aspire_sync import PropertySyncResult  # noqa: E402

client = TestClient(app)

_USER = {"id": "u1", "name": "Carlos", "email": "c@x.com", "role": "estimator",
         "branch_id": "Orlando, FL", "avatar_initials": "CH"}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _prop_row(**over):
    row = {
        "id": "prop-1", "name": "Sunny HOA", "address1": "123 Palm St", "address2": None,
        "city": "Orlando", "state": "FL", "zip": "32807", "branch_city": "Orlando, FL",
        "customer_type": "hoa", "management_company_id": None, "aspire_property_id": None,
        "aspire_sync_status": "unsynced", "aspire_sync_error": None, "aspire_synced_at": None,
        "property_type": "hoa", "source_type": "hoa", "source_id": "hoa-1",
        "created_at": None, "updated_at": None,
    }
    row.update(over)
    return row


class TestSearch:
    @patch("api.properties.query", new_callable=AsyncMock)
    def test_search_reads_local_table(self, mock_query, authed):
        mock_query.return_value = [_prop_row()]
        resp = client.get("/api/properties?search=sun")
        assert resp.status_code == 200
        body = resp.json()
        assert body[0]["id"] == "prop-1"
        assert body[0]["aspireSyncStatus"] == "unsynced"
        assert body[0]["propertyType"] == "hoa"
        assert body[0]["sourceType"] == "hoa"
        assert body[0]["sourceId"] == "hoa-1"
        # LIKE search over the local table
        sql = mock_query.call_args.args[0]
        assert "LIKE" in sql.upper() and "properties" in sql


class TestCreate:
    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    @patch("api.properties.execute", new_callable=AsyncMock)
    def test_create_is_local_only_no_aspire_push(self, mock_exec, mock_query, mock_bg, authed):
        """Handoff 15: create never auto-pushes; the row stays unsynced until an
        estimate submission triggers the sync."""
        mock_query.return_value = [_prop_row(source_type="manual", source_id=None,
                                             property_type="hoa")]   # reload after insert
        resp = client.post("/api/properties", json={
            "name": "Sunny HOA", "address1": "123 Palm St", "city": "Orlando",
            "state": "FL", "zip": "32807", "branchCity": "Orlando, FL", "customerType": "hoa"})
        assert resp.status_code == 201
        assert resp.json()["aspireSyncStatus"] == "unsynced"
        mock_bg.assert_not_awaited()
        mock_bg.assert_not_called()
        insert_params = mock_exec.call_args_list[0].args[1]
        assert "Sunny HOA" in insert_params

    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    @patch("api.properties.execute", new_callable=AsyncMock)
    def test_create_accepts_origin_fields(self, mock_exec, mock_query, mock_bg, authed):
        mock_query.side_effect = [
            [],               # upsert pre-check: not yet promoted
            [_prop_row()],    # reload after insert
        ]
        resp = client.post("/api/properties", json={
            "name": "Sunny HOA", "propertyType": "hoa",
            "sourceType": "hoa", "sourceId": "hoa-1"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["propertyType"] == "hoa"
        assert body["sourceType"] == "hoa"
        assert body["sourceId"] == "hoa-1"
        insert_sql, insert_params = mock_exec.call_args_list[0].args
        assert "property_type" in insert_sql and "source_type" in insert_sql and "source_id" in insert_sql
        assert "hoa-1" in insert_params
        mock_bg.assert_not_called()

    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    @patch("api.properties.execute", new_callable=AsyncMock)
    def test_create_is_upsert_on_source_key(self, mock_exec, mock_query, mock_bg, authed):
        """Creating for an already-promoted (source_type, source_id) returns the
        existing row without inserting a duplicate."""
        mock_query.return_value = [_prop_row()]   # pre-check finds the existing row
        resp = client.post("/api/properties", json={
            "name": "Sunny HOA", "sourceType": "hoa", "sourceId": "hoa-1"})
        assert resp.status_code == 201
        assert resp.json()["id"] == "prop-1"
        mock_exec.assert_not_called()
        mock_bg.assert_not_called()


class TestOpportunityHistoryProxy:
    def test_returns_empty_when_sync_disabled(self, authed, monkeypatch):
        monkeypatch.delenv("ASPIRE_SYNC_ENABLED", raising=False)
        with patch("api.properties.query", new_callable=AsyncMock) as mq:
            mq.return_value = [_prop_row(aspire_property_id=None)]
            resp = client.get("/api/properties/prop-1/opportunities")
        assert resp.status_code == 200
        assert resp.json() == []


class TestSyncPropertyBg:
    @patch("api.properties.execute", new_callable=AsyncMock)
    @patch("api.properties._persist_property_result", new_callable=AsyncMock)
    @patch("api.properties.aspire_sync")
    @patch("api.properties.query", new_callable=AsyncMock)
    async def test_pushes_and_persists(self, mock_query, mock_sync, mock_persist, mock_exec):
        mock_query.return_value = [_prop_row()]
        mock_sync.push_property = AsyncMock(
            return_value=PropertySyncResult(status="synced", aspire_property_id=715389))
        await props._sync_property_bg("prop-1")
        mock_sync.push_property.assert_awaited_once()
        mock_persist.assert_awaited_once()

    @patch("api.properties.execute", new_callable=AsyncMock)
    @patch("api.properties._persist_property_result", new_callable=AsyncMock)
    @patch("api.properties.aspire_sync")
    @patch("api.properties.query", new_callable=AsyncMock)
    async def test_marks_pending_at_start_of_push(self, mock_query, mock_sync, mock_persist, mock_exec):
        """The push sets aspire_sync_status='pending' before calling Aspire."""
        mock_query.return_value = [_prop_row()]
        mock_sync.push_property = AsyncMock(
            return_value=PropertySyncResult(status="synced", aspire_property_id=715389))
        await props._sync_property_bg("prop-1")
        pending_sql, pending_params = mock_exec.call_args_list[0].args
        assert "pending" in pending_sql or "pending" in pending_params
        assert "prop-1" in pending_params


class TestSyncPropertyIfNeeded:
    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    async def test_pushes_unsynced_property(self, mock_query, mock_bg):
        mock_query.return_value = [{"aspire_sync_status": "unsynced"}]
        await props.sync_property_if_needed("prop-1")
        mock_bg.assert_awaited_once_with("prop-1")

    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    async def test_repushes_failed_property(self, mock_query, mock_bg):
        mock_query.return_value = [{"aspire_sync_status": "failed"}]
        await props.sync_property_if_needed("prop-1")
        mock_bg.assert_awaited_once_with("prop-1")

    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    async def test_skips_synced_property(self, mock_query, mock_bg):
        mock_query.return_value = [{"aspire_sync_status": "synced"}]
        await props.sync_property_if_needed("prop-1")
        mock_bg.assert_not_awaited()

    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    async def test_skips_in_flight_pending_property(self, mock_query, mock_bg):
        mock_query.return_value = [{"aspire_sync_status": "pending"}]
        await props.sync_property_if_needed("prop-1")
        mock_bg.assert_not_awaited()

    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    async def test_missing_property_is_a_noop(self, mock_query, mock_bg):
        mock_query.return_value = []
        await props.sync_property_if_needed("prop-1")
        mock_bg.assert_not_awaited()


class TestPromotePropertyEndpoint:
    @patch("api.properties.pipeline")
    def test_promote_creates_lead_from_property(self, mock_pipeline, authed):
        lead = MagicMock()
        lead.to_dict.return_value = {"id": "lead-1", "property_id": "prop-1", "status": "new"}
        mock_pipeline.promote_property_to_lead = AsyncMock(return_value=lead)
        resp = client.post("/api/properties/prop-1/promote")
        assert resp.status_code == 201
        assert resp.json()["property_id"] == "prop-1"
        mock_pipeline.promote_property_to_lead.assert_awaited_once_with("prop-1")

    @patch("api.properties.pipeline")
    def test_promote_404_when_property_missing(self, mock_pipeline, authed):
        mock_pipeline.promote_property_to_lead = AsyncMock(
            side_effect=ValueError("Property nope not found"))
        resp = client.post("/api/properties/nope/promote")
        assert resp.status_code == 404

    @patch("api.properties.execute", new_callable=AsyncMock)
    async def test_persist_writes_id_and_status(self, mock_exec):
        await props._persist_property_result(
            "prop-1", PropertySyncResult(status="synced", aspire_property_id=715389))
        _, params = mock_exec.call_args.args
        assert 715389 in params and "synced" in params
