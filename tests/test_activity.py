"""
Tests for new endpoints added in feat/comms-shared:
  GET  /api/leads/{lead_id}/activity
  GET  /api/settings/connections
  GET  /api/contacts/{contact_id}/consent
  PATCH /api/contacts/{contact_id}/consent
  GET  /api/compliance/check

DB is fully mocked via patch on api.server.query / api.server.execute.
Run with: PYTHONPATH=. venv/bin/pytest tests/test_activity.py -v
"""
from __future__ import annotations

import os
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, patch

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("TWILIO_ACCOUNT_SID", "")

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


def test_activity_maps_email_sent_to_email_channel():
    action_row = {
        "id": "act-1",
        "lead_id": "lead-1",
        "action_type": "email_sent",
        "detail": "Hello there",
        "performed_by": "u1",
        "performed_at": datetime(2026, 5, 1, 10, 0, 0),
        "recording_url": None,
        "duration_seconds": None,
        "external_message_id": None,
    }
    with patch("api.server.query", AsyncMock(return_value=[action_row])):
        resp = client.get("/api/leads/lead-1/activity")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["channel"] == "email"
    assert items[0]["direction"] == "out"
    assert items[0]["body"] == "Hello there"
    assert items[0]["performed_by"] == "u1"


def test_activity_maps_call_logged_to_call_channel():
    action_row = {
        "id": "act-2",
        "lead_id": "lead-1",
        "action_type": "call_logged",
        "detail": "Left voicemail",
        "performed_by": "u1",
        "performed_at": datetime(2026, 5, 1, 11, 0, 0),
        "recording_url": "https://example.com/rec.mp3",
        "duration_seconds": 45,
        "external_message_id": None,
    }
    with patch("api.server.query", AsyncMock(return_value=[action_row])):
        resp = client.get("/api/leads/lead-1/activity")
    items = resp.json()
    assert items[0]["channel"] == "call"
    assert items[0]["recording_url"] == "https://example.com/rec.mp3"
    assert items[0]["duration_seconds"] == 45


def test_activity_maps_sms_received_direction_in():
    action_row = {
        "id": "act-3",
        "lead_id": "lead-1",
        "action_type": "sms_received",
        "detail": "Thanks!",
        "performed_by": "",
        "performed_at": datetime(2026, 5, 1, 12, 0, 0),
        "recording_url": None,
        "duration_seconds": None,
        "external_message_id": "SM123",
    }
    with patch("api.server.query", AsyncMock(return_value=[action_row])):
        resp = client.get("/api/leads/lead-1/activity")
    items = resp.json()
    assert items[0]["channel"] == "sms"
    assert items[0]["direction"] == "in"
    assert items[0]["external_message_id"] == "SM123"


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
            "recording_url": None,
            "duration_seconds": None,
            "external_message_id": None,
        },
        {
            "id": "act-5",
            "lead_id": "lead-1",
            "action_type": "note_added",
            "detail": "Called property manager",
            "performed_by": "u1",
            "performed_at": datetime(2026, 5, 1, 13, 30, 0),
            "recording_url": None,
            "duration_seconds": None,
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
        "action_type": "sms_sent",
        "detail": "Hi",
        "performed_by": "u1",
        "performed_at": datetime(2026, 6, 1, 9, 0, 0),
        "recording_url": None,
        "duration_seconds": None,
        "external_message_id": None,
    }
    with patch("api.server.query", AsyncMock(return_value=[action_row])):
        resp = client.get("/api/leads/lead-1/activity")
    items = resp.json()
    # Should be a valid ISO 8601 string
    assert "2026-06-01" in items[0]["performed_at"]


# ── GET /api/settings/connections ────────────────────────────────────────────


def test_connections_returns_graph_and_telephony_keys():
    with patch("api.server.query", AsyncMock(return_value=[])):
        resp = client.get("/api/settings/connections")
    assert resp.status_code == 200
    body = resp.json()
    assert "graph" in body
    assert "telephony" in body
    assert "connected" in body["graph"]
    assert "configured" in body["telephony"]


def test_connections_graph_connected_true_when_token_row_exists():
    with patch("api.server.query", AsyncMock(return_value=[{"user_id": "u1"}])):
        resp = client.get("/api/settings/connections")
    assert resp.json()["graph"]["connected"] is True


def test_connections_graph_connected_false_when_no_token():
    with patch("api.server.query", AsyncMock(return_value=[])):
        resp = client.get("/api/settings/connections")
    assert resp.json()["graph"]["connected"] is False


def test_connections_graph_connected_false_when_query_fails():
    with patch("api.server.query", AsyncMock(side_effect=Exception("table not found"))):
        resp = client.get("/api/settings/connections")
    assert resp.status_code == 200
    assert resp.json()["graph"]["connected"] is False


def test_connections_twilio_not_configured_by_default():
    """TWILIO_ACCOUNT_SID is set to '' in test env."""
    with patch("api.server.query", AsyncMock(return_value=[])):
        resp = client.get("/api/settings/connections")
    body = resp.json()
    assert body["telephony"]["configured"] is False
    assert body["telephony"]["provider"] == ""


# ── GET /api/contacts/{contact_id}/consent ───────────────────────────────────


def test_get_consent_returns_defaults_when_no_record():
    with patch("api.server.query", AsyncMock(return_value=[])):
        resp = client.get("/api/contacts/c1/consent")
    assert resp.status_code == 200
    body = resp.json()
    assert body["contact_id"] == "c1"
    assert body["do_not_call"] is False
    assert body["do_not_email"] is False
    assert body["do_not_text"] is False


def test_get_consent_returns_existing_record():
    row = {
        "contact_id": "c1",
        "do_not_call": True,
        "do_not_text": False,
        "do_not_email": False,
        "consent_call": False,
        "consent_text": True,
        "consent_captured_at": None,
        "consent_source": "web_form",
        "consent_by": "u1",
        "updated_at": None,
    }
    with patch("api.server.query", AsyncMock(return_value=[row])):
        resp = client.get("/api/contacts/c1/consent")
    assert resp.status_code == 200
    body = resp.json()
    assert body["do_not_call"] is True
    assert body["consent_source"] == "web_form"


# ── PATCH /api/contacts/{contact_id}/consent ─────────────────────────────────


def test_patch_consent_inserts_when_no_existing_record():
    # First query (check existing) returns [], second query (re-fetch) returns updated
    updated_row = {
        "contact_id": "c1",
        "do_not_call": True,
        "do_not_text": False,
        "do_not_email": False,
        "consent_call": False,
        "consent_text": False,
        "consent_captured_at": None,
        "consent_source": None,
        "consent_by": None,
        "updated_at": None,
    }
    query_mock = AsyncMock(side_effect=[[], [updated_row]])
    execute_mock = AsyncMock(return_value=1)
    with patch("api.server.query", query_mock), patch("api.server.execute", execute_mock):
        resp = client.patch("/api/contacts/c1/consent", json={"do_not_call": True})
    assert resp.status_code == 200
    execute_mock.assert_called_once()
    # Verify it was an INSERT
    sql_called = execute_mock.call_args[0][0]
    assert "INSERT" in sql_called.upper()


def test_patch_consent_updates_when_existing_record():
    existing_row = {"contact_id": "c1"}
    updated_row = {
        "contact_id": "c1",
        "do_not_call": False,
        "do_not_text": True,
        "do_not_email": False,
        "consent_call": False,
        "consent_text": False,
        "consent_captured_at": None,
        "consent_source": None,
        "consent_by": None,
        "updated_at": None,
    }
    query_mock = AsyncMock(side_effect=[[existing_row], [updated_row]])
    execute_mock = AsyncMock(return_value=1)
    with patch("api.server.query", query_mock), patch("api.server.execute", execute_mock):
        resp = client.patch("/api/contacts/c1/consent", json={"do_not_text": True})
    assert resp.status_code == 200
    sql_called = execute_mock.call_args[0][0]
    assert "UPDATE" in sql_called.upper()


def test_patch_consent_ignores_unknown_fields():
    query_mock = AsyncMock(side_effect=[[], [{"contact_id": "c1", **{
        "do_not_call": False, "do_not_text": False, "do_not_email": False,
        "consent_call": False, "consent_text": False,
        "consent_captured_at": None, "consent_source": None,
        "consent_by": None, "updated_at": None,
    }}]])
    execute_mock = AsyncMock(return_value=1)
    with patch("api.server.query", query_mock), patch("api.server.execute", execute_mock):
        resp = client.patch(
            "/api/contacts/c1/consent",
            json={"do_not_call": False, "evil_field": "injection"},
        )
    assert resp.status_code == 200
    # The execute SQL should not contain "evil_field"
    sql_called = execute_mock.call_args[0][0]
    assert "evil_field" not in sql_called


# ── GET /api/compliance/check ─────────────────────────────────────────────────


def test_compliance_check_allowed_when_not_blocked():
    with patch("api.compliance.query", AsyncMock(return_value=[])):
        resp = client.get("/api/compliance/check?channel=email&to=test@test.com")
    assert resp.status_code == 200
    assert resp.json()["allowed"] is True


def test_compliance_check_blocked_when_phone_in_dnc():
    with patch("api.compliance.query", AsyncMock(return_value=[{"phone": "+16025551234"}])):
        resp = client.get("/api/compliance/check?channel=call&to=+16025551234")
    assert resp.status_code == 200
    body = resp.json()
    assert body["allowed"] is False
    assert "DNC" in body["reason"] or "dnc" in body["reason"].lower()


def test_compliance_check_requires_channel_and_to():
    resp = client.get("/api/compliance/check?channel=email")
    assert resp.status_code == 422  # missing `to`
