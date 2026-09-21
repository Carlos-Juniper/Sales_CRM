"""
Tests for endpoints in feat/comms-shared:
  GET  /api/leads/{lead_id}/activity
  GET  /api/settings/connections

DB is fully mocked via patch on api.server.query / api.server.execute.
Run with: PYTHONPATH=. venv/bin/pytest tests/test_activity.py -v
"""
from __future__ import annotations

import os
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, patch

os.environ.setdefault("JWT_SECRET", "test-secret")

from fastapi.testclient import TestClient  # noqa: E402
from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

_AUTHED_USER = {
    "id": "u1",
    "name": "Test User",
    "email": "test@test.com",
    "role": "inside_sales",
    "branch_id": "b1",
}


@pytest.fixture(autouse=True)
def auth_override():
    app.dependency_overrides[require_auth] = lambda: _AUTHED_USER
    yield
    app.dependency_overrides.clear()


# ── GET /api/leads/{lead_id}/activity ─────────────────────────────────────────


def test_activity_returns_empty_list_when_no_actions():
    with patch("api.server.query", AsyncMock(return_value=[])):
        resp = client.get("/api/leads/lead-1/activity")
    assert resp.status_code == 200
    assert resp.json() == []


def test_activity_maps_note_added_to_note_channel():
    action_row = {
        "id": "act-5",
        "lead_id": "lead-1",
        "action_type": "note_added",
        "detail": "Called property manager",
        "performed_by": "u1",
        "performed_at": datetime(2026, 5, 1, 13, 30, 0),
        "external_message_id": None,
    }
    with patch("api.server.query", AsyncMock(return_value=[action_row])):
        resp = client.get("/api/leads/lead-1/activity")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["channel"] == "note"
    assert items[0]["direction"] == "out"
    assert items[0]["body"] == "Called property manager"
    assert items[0]["performed_by"] == "u1"


def test_activity_maps_meeting_scheduled_to_meeting_channel():
    action_row = {
        "id": "act-6",
        "lead_id": "lead-1",
        "action_type": "meeting_scheduled",
        "detail": "Site walk at Silverleaf",
        "performed_by": "u1",
        "performed_at": datetime(2026, 5, 2, 9, 0, 0),
        "external_message_id": "event-abc",
    }
    with patch("api.server.query", AsyncMock(return_value=[action_row])):
        resp = client.get("/api/leads/lead-1/activity")
    items = resp.json()
    assert items[0]["channel"] == "meeting"
    assert items[0]["external_message_id"] == "event-abc"


def test_activity_filters_out_status_change_actions():
    """status_change action_type should be excluded from the activity feed."""
    rows = [
        {
            "id": "act-4",
            "lead_id": "lead-1",
            "action_type": "status_change",
            "detail": None,
            "performed_by": "u1",
            "performed_at": datetime(2026, 5, 1, 13, 0, 0),
            "external_message_id": None,
        },
        {
            "id": "act-5",
            "lead_id": "lead-1",
            "action_type": "note_added",
            "detail": "Called property manager",
            "performed_by": "u1",
            "performed_at": datetime(2026, 5, 1, 13, 30, 0),
            "external_message_id": None,
        },
    ]
    with patch("api.server.query", AsyncMock(return_value=rows)):
        resp = client.get("/api/leads/lead-1/activity")
    items = resp.json()
    # status_change filtered out, note_added kept
    assert len(items) == 1
    assert items[0]["channel"] == "note"


def test_activity_performed_at_is_iso_string():
    action_row = {
        "id": "act-6",
        "lead_id": "lead-1",
        "action_type": "note_added",
        "detail": "Hi",
        "performed_by": "u1",
        "performed_at": datetime(2026, 6, 1, 9, 0, 0),
        "external_message_id": None,
    }
    with patch("api.server.query", AsyncMock(return_value=[action_row])):
        resp = client.get("/api/leads/lead-1/activity")
    items = resp.json()
    assert "2026-06-01" in items[0]["performed_at"]


# ── GET /api/settings/connections ────────────────────────────────────────────


def test_connections_returns_graph_key():
    with patch("api.graph.has_graph_connection", AsyncMock(return_value=False)):
        resp = client.get("/api/settings/connections")
    assert resp.status_code == 200
    body = resp.json()
    assert "graph" in body
    assert "connected" in body["graph"]
    assert "telephony" not in body


def test_connections_graph_connected_true_when_token_row_exists():
    with patch("api.graph.has_graph_connection", AsyncMock(return_value=True)):
        resp = client.get("/api/settings/connections")
    assert resp.json()["graph"]["connected"] is True


def test_connections_graph_connected_false_when_no_token():
    with patch("api.graph.has_graph_connection", AsyncMock(return_value=False)):
        resp = client.get("/api/settings/connections")
    assert resp.json()["graph"]["connected"] is False


def test_connections_graph_connected_false_when_query_fails():
    with patch("api.graph.has_graph_connection", AsyncMock(side_effect=Exception("table not found"))):
        resp = client.get("/api/settings/connections")
    assert resp.status_code == 200
    assert resp.json()["graph"]["connected"] is False


def test_connections_lookup_uses_jwt_id_and_email():
    """Settings must use the same id+email lookup Calendar uses."""
    with patch("api.graph.has_graph_connection", AsyncMock(return_value=True)) as mock_has:
        resp = client.get("/api/settings/connections")
    assert resp.json()["graph"]["connected"] is True
    mock_has.assert_awaited_once_with(_AUTHED_USER["id"], _AUTHED_USER["email"])
