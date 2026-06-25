"""
Tests for the new Graph-related server endpoints:
  POST /api/auth/ms-graph-token
  GET  /api/calendar/events
  POST /api/calendar/events
  POST /api/leads/{lead_id}/schedule-meeting
  POST /api/outreach/send (email channel — real Graph send)

DB and Graph HTTP are fully mocked.
Run with:  PYTHONPATH=. pytest tests/test_graph_endpoints.py -v
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("ENTRA_CLIENT_ID", "test-client-id")
os.environ.setdefault("ENTRA_TENANT_ID", "test-tenant-id")
os.environ.setdefault("JWT_SECRET", "test-secret")

from api.server import app, require_auth  # noqa: E402

_AUTHED_USER = {
    "id": "u1",
    "name": "Carlos Hernandez",
    "email": "carlos.hernandez@juniperlandscaping.com",
    "role": "inside_sales",
    "branch_id": "b1",
    "avatar_initials": "CH",
}

client = TestClient(app)


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[require_auth] = lambda: _AUTHED_USER
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# POST /api/auth/ms-graph-token
# ---------------------------------------------------------------------------

def test_store_ms_graph_token_returns_ok():
    """AC-server-1: storing tokens returns {ok: true}."""
    with patch("api.graph.execute", new_callable=AsyncMock):
        resp = client.post(
            "/api/auth/ms-graph-token",
            json={
                "access_token": "at-xxx",
                "refresh_token": "rt-xxx",
                "expires_in": 3600,
                "scope": "Mail.Send Calendars.ReadWrite",
            },
        )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_store_ms_graph_token_requires_access_and_refresh():
    """AC-server-2: missing required fields → 422."""
    resp = client.post("/api/auth/ms-graph-token", json={"expires_in": 3600})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/calendar/events
# ---------------------------------------------------------------------------

_SAMPLE_EVENT = {
    "id": "evt-001",
    "subject": "Site Walkthrough",
    "start": {"dateTime": "2026-06-27T10:00:00", "timeZone": "UTC"},
    "end": {"dateTime": "2026-06-27T11:00:00", "timeZone": "UTC"},
    "attendees": [],
    "onlineMeeting": None,
}


def test_calendar_list_events_returns_list():
    """AC-server-3: GET /api/calendar/events returns event list."""
    with patch("api.graph.list_events", new_callable=AsyncMock, return_value=[_SAMPLE_EVENT]):
        resp = client.get("/api/calendar/events?start=2026-06-27T00:00:00Z&end=2026-06-28T00:00:00Z")

    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 1
    assert events[0]["id"] == "evt-001"


def test_calendar_list_events_requires_start_and_end():
    """AC-server-4: missing query params → 422."""
    resp = client.get("/api/calendar/events?start=2026-06-27T00:00:00Z")
    assert resp.status_code == 422


def test_calendar_list_events_returns_400_when_no_token():
    """AC-server-5: user has no Graph token → 400 (not 500)."""
    with patch("api.graph.list_events", new_callable=AsyncMock, side_effect=ValueError("no Graph token")):
        resp = client.get("/api/calendar/events?start=2026-06-27T00:00:00Z&end=2026-06-28T00:00:00Z")

    assert resp.status_code == 400
    assert "no Graph token" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# POST /api/calendar/events
# ---------------------------------------------------------------------------

def test_calendar_create_event_returns_created_event():
    """AC-server-6: POST /api/calendar/events returns Graph event."""
    created = {**_SAMPLE_EVENT, "id": "new-evt"}
    with patch("api.graph.create_event", new_callable=AsyncMock, return_value=created):
        resp = client.post(
            "/api/calendar/events",
            json={
                "subject": "Site Walkthrough",
                "start_iso": "2026-06-27T10:00:00Z",
                "end_iso": "2026-06-27T11:00:00Z",
                "attendees": ["jennifer@silverleafhoa.org"],
                "online_meeting": True,
            },
        )

    assert resp.status_code == 200
    assert resp.json()["id"] == "new-evt"


def test_calendar_create_event_requires_subject_start_end():
    """AC-server-7: missing subject → 422."""
    resp = client.post(
        "/api/calendar/events",
        json={"start_iso": "2026-06-27T10:00:00Z", "end_iso": "2026-06-27T11:00:00Z"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/leads/{lead_id}/schedule-meeting
# ---------------------------------------------------------------------------

def test_schedule_meeting_creates_event_and_logs_action():
    """AC-server-8: schedule-meeting returns event + writes meeting_scheduled action."""
    created = {**_SAMPLE_EVENT, "id": "sched-evt-001"}
    with (
        patch("api.graph.create_event", new_callable=AsyncMock, return_value=created),
        patch("api.server.execute", new_callable=AsyncMock) as mock_exec,
    ):
        resp = client.post(
            "/api/leads/lead-uuid-1/schedule-meeting",
            json={
                "subject": "Proposal Discussion",
                "start_iso": "2026-06-28T14:00:00Z",
                "end_iso": "2026-06-28T15:00:00Z",
                "attendees": ["jennifer@silverleafhoa.org"],
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["lead_id"] == "lead-uuid-1"
    assert body["event"]["id"] == "sched-evt-001"
    mock_exec.assert_called_once()
    insert_sql = mock_exec.call_args[0][0]
    insert_params = mock_exec.call_args[0][1]
    assert "lead_actions" in insert_sql
    param_values = [p.value for p in insert_params]
    assert "meeting_scheduled" in param_values


def test_schedule_meeting_returns_400_when_no_graph_token():
    """AC-server-9: no Graph token → 400 with clear message."""
    with patch("api.graph.create_event", new_callable=AsyncMock, side_effect=ValueError("no Graph token")):
        resp = client.post(
            "/api/leads/lead-uuid-1/schedule-meeting",
            json={
                "subject": "Test",
                "start_iso": "2026-06-28T14:00:00Z",
                "end_iso": "2026-06-28T15:00:00Z",
            },
        )

    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/outreach/send — email channel (Graph integration)
# ---------------------------------------------------------------------------

_LEAD_WITH_EMAIL = [{"hoa_property_id": None, "contact_email": "jennifer@silverleafhoa.org"}]


def test_send_outreach_email_calls_graph_send_mail():
    """AC-server-10: email channel invokes graph.send_mail and stores external_message_id."""
    with (
        patch("api.graph.send_mail", new_callable=AsyncMock, return_value="graph-msg-id") as mock_send,
        patch("api.server.query", new_callable=AsyncMock, return_value=_LEAD_WITH_EMAIL),
        patch("api.server.execute", new_callable=AsyncMock),
    ):
        resp = client.post(
            "/api/outreach/send",
            json={"lead_id": "lead-uuid-1", "channel": "email", "message": "Hi Jennifer"},
        )

    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert resp.json()["message_id"] == "graph-msg-id"
    mock_send.assert_called_once()


def test_send_outreach_email_returns_400_when_no_graph_token():
    """AC-server-11: email channel, user has no Graph token → 400."""
    with (
        patch("api.graph.send_mail", new_callable=AsyncMock, side_effect=ValueError("no Graph token")),
        patch("api.server.query", new_callable=AsyncMock, return_value=_LEAD_WITH_EMAIL),
    ):
        resp = client.post(
            "/api/outreach/send",
            json={"lead_id": "lead-uuid-1", "channel": "email", "message": "Hi Jennifer"},
        )

    assert resp.status_code == 400
    assert "Microsoft Graph not connected" in resp.json()["detail"]


def test_send_outreach_non_email_channel_skips_graph():
    """AC-server-12: phone channel does NOT call graph.send_mail."""
    with (
        patch("api.graph.send_mail", new_callable=AsyncMock) as mock_send,
        patch("api.server.query", new_callable=AsyncMock, return_value=[{"hoa_property_id": None}]),
        patch("api.server.execute", new_callable=AsyncMock),
    ):
        resp = client.post(
            "/api/outreach/send",
            json={"lead_id": "lead-uuid-1", "channel": "phone", "message": "Called."},
        )

    assert resp.status_code == 200
    mock_send.assert_not_called()
