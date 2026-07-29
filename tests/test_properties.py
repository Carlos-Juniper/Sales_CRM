"""Tests for api/properties.py — app-owned property records, pushed to Aspire.

Local table is the SOURCE OF TRUTH: search reads local, create writes local +
schedules a best-effort background push. The Aspire opportunity-history proxy is
best-effort and returns [] when sync is disabled. DB + port fully mocked.
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
        "aspire_sync_status": "pending", "aspire_sync_error": None, "aspire_synced_at": None,
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
        assert body[0]["aspireSyncStatus"] == "pending"
        # LIKE search over the local table
        sql = mock_query.call_args.args[0]
        assert "LIKE" in sql.upper() and "properties" in sql


class TestCreate:
    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    @patch("api.properties.execute", new_callable=AsyncMock)
    def test_create_is_local_first_and_schedules_push(self, mock_exec, mock_query, mock_bg, authed):
        mock_query.return_value = [_prop_row()]   # reload after insert
        resp = client.post("/api/properties", json={
            "name": "Sunny HOA", "address1": "123 Palm St", "city": "Orlando",
            "state": "FL", "zip": "32807", "branchCity": "Orlando, FL", "customerType": "hoa"})
        assert resp.status_code == 201
        assert resp.json()["aspireSyncStatus"] == "pending"
        mock_bg.assert_awaited_once()
        insert_params = mock_exec.call_args_list[0].args[1]
        assert "Sunny HOA" in insert_params


class TestOpportunityHistoryProxy:
    def test_returns_empty_when_sync_disabled(self, authed, monkeypatch):
        monkeypatch.delenv("ASPIRE_SYNC_ENABLED", raising=False)
        with patch("api.properties.query", new_callable=AsyncMock) as mq:
            mq.return_value = [_prop_row(aspire_property_id=None)]
            resp = client.get("/api/properties/prop-1/opportunities")
        assert resp.status_code == 200
        assert resp.json() == []


class TestSyncPropertyBg:
    @patch("api.properties._persist_property_result", new_callable=AsyncMock)
    @patch("api.properties.aspire_sync")
    @patch("api.properties.query", new_callable=AsyncMock)
    async def test_pushes_and_persists(self, mock_query, mock_sync, mock_persist):
        mock_query.return_value = [_prop_row()]
        mock_sync.push_property = AsyncMock(
            return_value=PropertySyncResult(status="synced", aspire_property_id=715389))
        await props._sync_property_bg("prop-1")
        mock_sync.push_property.assert_awaited_once()
        mock_persist.assert_awaited_once()

    @patch("api.properties.execute", new_callable=AsyncMock)
    async def test_persist_writes_id_and_status(self, mock_exec):
        await props._persist_property_result(
            "prop-1", PropertySyncResult(status="synced", aspire_property_id=715389))
        _, params = mock_exec.call_args.args
        assert 715389 in params and "synced" in params
