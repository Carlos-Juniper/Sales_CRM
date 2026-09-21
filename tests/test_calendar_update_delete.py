"""
Tests for the new calendar PATCH/DELETE endpoints:
  PATCH  /api/calendar/events/{event_id}
  DELETE /api/calendar/events/{event_id}

DB and Graph HTTP are fully mocked.
Run with:  PYTHONPATH=. pytest tests/test_calendar_update_delete.py -v
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, call, patch

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


@pytest.fixture(autouse=True)
def clear_auth_override(override_auth):
    yield


_UPDATED_EVENT = {
    "id": "evt-001",
    "subject": "Updated Subject",
    "start": {"dateTime": "2026-06-27T10:00:00", "timeZone": "UTC"},
    "end": {"dateTime": "2026-06-27T11:00:00", "timeZone": "UTC"},
    "attendees": [],
    "onlineMeeting": None,
}


# ---------------------------------------------------------------------------
# PATCH /api/calendar/events/{event_id} — auth
# ---------------------------------------------------------------------------

def test_patch_event_requires_auth():
    """AC-cal-1: PATCH without session cookie → 401/403."""
    app.dependency_overrides.clear()
    resp = client.patch(
        "/api/calendar/events/evt-001",
        json={"subject": "New Subject"},
    )
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# DELETE /api/calendar/events/{event_id} — auth
# ---------------------------------------------------------------------------

def test_delete_event_requires_auth():
    """AC-cal-2: DELETE without session cookie → 401/403."""
    app.dependency_overrides.clear()
    resp = client.delete("/api/calendar/events/evt-001")
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# PATCH — GraphNotConnected → 400
# ---------------------------------------------------------------------------

def test_patch_event_returns_400_when_graph_not_connected():
    """AC-cal-3: Graph not connected raises ValueError → HTTP 400."""
    with patch(
        "api.graph.update_event",
        new_callable=AsyncMock,
        side_effect=ValueError("no Graph token stored for user"),
    ):
        resp = client.patch(
            "/api/calendar/events/evt-001",
            json={"subject": "Any"},
        )
    assert resp.status_code == 400
    assert "no Graph token" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# DELETE — GraphNotConnected → 400
# ---------------------------------------------------------------------------

def test_delete_event_returns_400_when_graph_not_connected():
    """AC-cal-4: Graph not connected raises ValueError → HTTP 400."""
    with patch(
        "api.graph.delete_event",
        new_callable=AsyncMock,
        side_effect=ValueError("no Graph token stored for user"),
    ):
        resp = client.delete("/api/calendar/events/evt-001")
    assert resp.status_code == 400
    assert "no Graph token" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# PATCH — Graph error → 502
# ---------------------------------------------------------------------------

def test_patch_event_returns_502_when_graph_fails():
    """AC-cal-5: Graph HTTP error surfaces as 502."""
    from fastapi import HTTPException

    with patch(
        "api.graph.update_event",
        new_callable=AsyncMock,
        side_effect=HTTPException(status_code=502, detail="Microsoft Graph event update failed: 500"),
    ):
        resp = client.patch(
            "/api/calendar/events/evt-001",
            json={"subject": "Any"},
        )
    assert resp.status_code == 502


# ---------------------------------------------------------------------------
# DELETE — Graph error → 502
# ---------------------------------------------------------------------------

def test_delete_event_returns_502_when_graph_fails():
    """AC-cal-6: Graph HTTP error surfaces as 502."""
    from fastapi import HTTPException

    with patch(
        "api.graph.delete_event",
        new_callable=AsyncMock,
        side_effect=HTTPException(status_code=502, detail="Microsoft Graph event deletion failed: 500"),
    ):
        resp = client.delete("/api/calendar/events/evt-001")
    assert resp.status_code == 502


# ---------------------------------------------------------------------------
# PATCH — sends only provided fields
# ---------------------------------------------------------------------------

def test_patch_event_sends_only_provided_fields():
    """AC-cal-7: PATCH forwards only non-None kwargs to update_event."""
    with patch("api.graph.update_event", new_callable=AsyncMock, return_value=_UPDATED_EVENT) as mock_update:
        resp = client.patch(
            "/api/calendar/events/evt-001",
            json={"subject": "New Title"},
        )

    assert resp.status_code == 200
    assert resp.json()["id"] == "evt-001"
    mock_update.assert_called_once_with(
        "u1",
        "evt-001",
        subject="New Title",
        start_iso=None,
        end_iso=None,
        attendees=None,
        body=None,
        email="carlos.hernandez@juniperlandscaping.com",
    )


def test_patch_event_sends_multiple_fields():
    """AC-cal-8: PATCH with multiple fields passes all of them."""
    with patch("api.graph.update_event", new_callable=AsyncMock, return_value=_UPDATED_EVENT) as mock_update:
        resp = client.patch(
            "/api/calendar/events/evt-001",
            json={
                "subject": "New Title",
                "start_iso": "2026-06-27T10:00:00Z",
                "end_iso": "2026-06-27T11:00:00Z",
            },
        )

    assert resp.status_code == 200
    mock_update.assert_called_once_with(
        "u1",
        "evt-001",
        subject="New Title",
        start_iso="2026-06-27T10:00:00Z",
        end_iso="2026-06-27T11:00:00Z",
        attendees=None,
        body=None,
        email="carlos.hernandez@juniperlandscaping.com",
    )


# ---------------------------------------------------------------------------
# DELETE — records meeting_cancelled when meeting_scheduled action exists
# ---------------------------------------------------------------------------

def test_delete_event_records_meeting_cancelled_when_action_exists():
    """AC-cal-9: DELETE records meeting_cancelled when a matching meeting_scheduled row exists."""
    existing_action_row = {
        "lead_id": "lead-uuid-1",
        "detail": "Proposal Discussion",
    }

    with (
        patch("api.graph.delete_event", new_callable=AsyncMock),
        patch("api.server.query", new_callable=AsyncMock, return_value=[existing_action_row]) as mock_query,
        patch("api.server.execute", new_callable=AsyncMock) as mock_exec,
    ):
        resp = client.delete("/api/calendar/events/evt-001")

    assert resp.status_code == 204

    mock_query.assert_called_once()
    query_sql = mock_query.call_args[0][0]
    query_params = mock_query.call_args[0][1]
    assert "lead_actions" in query_sql
    assert "meeting_scheduled" in query_sql
    assert "evt-001" in query_params

    mock_exec.assert_called_once()
    insert_sql = mock_exec.call_args[0][0]
    insert_params = mock_exec.call_args[0][1]
    assert "lead_actions" in insert_sql
    assert "meeting_cancelled" in insert_params
    assert "lead-uuid-1" in insert_params
    assert "evt-001" in insert_params


# ---------------------------------------------------------------------------
# DELETE — no action row when no matching meeting_scheduled exists
# ---------------------------------------------------------------------------

def test_delete_event_no_action_when_no_meeting_scheduled():
    """AC-cal-10: DELETE does not write a lead action when no meeting_scheduled row exists."""
    with (
        patch("api.graph.delete_event", new_callable=AsyncMock),
        patch("api.server.query", new_callable=AsyncMock, return_value=[]),
        patch("api.server.execute", new_callable=AsyncMock) as mock_exec,
    ):
        resp = client.delete("/api/calendar/events/evt-002")

    assert resp.status_code == 204
    mock_exec.assert_not_called()


# ---------------------------------------------------------------------------
# DELETE — 204 on Graph 404 (idempotent)
# ---------------------------------------------------------------------------

def test_delete_event_returns_204_on_graph_404():
    """AC-cal-11: DELETE treats Graph 404 as success (idempotent delete)."""
    with (
        patch("api.graph.delete_event", new_callable=AsyncMock),
        patch("api.server.query", new_callable=AsyncMock, return_value=[]),
        patch("api.server.execute", new_callable=AsyncMock),
    ):
        resp = client.delete("/api/calendar/events/already-deleted-evt")

    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# meeting_cancelled surfaced in activity feed
# ---------------------------------------------------------------------------

def test_meeting_cancelled_in_action_to_channel():
    """AC-cal-12: _ACTION_TO_CHANNEL_FULL maps meeting_cancelled to 'meeting'."""
    from api.server import _ACTION_TO_CHANNEL_FULL

    assert _ACTION_TO_CHANNEL_FULL.get("meeting_cancelled") == "meeting"
