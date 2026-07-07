"""
Tests for api/graph.py — Microsoft Graph token management and API calls.
All HTTP is mocked; no live Graph calls are made.

Run with:  PYTHONPATH=. pytest tests/test_graph.py -v
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Minimal env to satisfy module-level imports
os.environ.setdefault("ENTRA_CLIENT_ID", "test-client-id")
os.environ.setdefault("ENTRA_TENANT_ID", "test-tenant-id")
os.environ.setdefault("JWT_SECRET", "test-secret")

# Import the module under test once at module level so patches apply consistently
import api.graph  # noqa: E402
from api.graph import (  # noqa: E402
    get_valid_token,
    send_mail,
    list_events,
    create_event,
    GraphNotConnected,
    GraphTokenRefreshFailed,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_NOW = datetime.now(tz=timezone.utc)
_FUTURE = _NOW + timedelta(hours=1)
_PAST = _NOW - timedelta(minutes=5)

_VALID_TOKEN_ROW = {
    "user_id": "u1",
    "access_token": "valid-access-token",
    "refresh_token": "valid-refresh-token",
    "scope": "Mail.Send Calendars.ReadWrite",
    "expires_at": _FUTURE,
    "updated_at": _NOW,
}

_EXPIRED_TOKEN_ROW = {
    "user_id": "u1",
    "access_token": "expired-access-token",
    "refresh_token": "valid-refresh-token",
    "scope": "Mail.Send Calendars.ReadWrite",
    "expires_at": _PAST,
    "updated_at": _NOW,
}


def _make_response(*, status: int = 200, json_data: dict | None = None, headers: dict | None = None):
    """Build a single mock HTTP response."""
    mock_response = MagicMock()
    mock_response.status_code = status
    mock_response.headers = headers or {}
    mock_response.raise_for_status = MagicMock()
    if json_data is not None:
        mock_response.json = MagicMock(return_value=json_data)
    return mock_response


def _make_http_client(*, status: int = 200, json_data: dict | None = None, headers: dict | None = None):
    """Return a mock AsyncClient context manager with a single response for all calls."""
    mock_response = _make_response(status=status, json_data=json_data, headers=headers)
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


def _make_http_client_multi_post(*responses):
    """Return a mock AsyncClient whose .post() returns each response in sequence.

    Used for the two-call send_mail flow (create draft, then send).
    """
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=list(responses))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


# ---------------------------------------------------------------------------
# AC-1: get_valid_token — happy path (token not expired)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_valid_token_returns_access_token_when_not_expired():
    """AC-1a: non-expired token is returned directly without refresh."""
    with patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]):
        token = await get_valid_token("u1")

    assert token == "valid-access-token"


@pytest.mark.asyncio
async def test_get_valid_token_raises_when_no_token_stored():
    """AC-1b: user has never granted Graph scopes → raises GraphNotConnected (a ValueError subclass)."""
    with patch("api.graph.query", new_callable=AsyncMock, return_value=[]):
        # GraphNotConnected must be catchable as a plain ValueError so server.py
        # handlers continue to work without modification.
        with pytest.raises(GraphNotConnected, match="no Graph token"):
            await get_valid_token("u1")
        with patch("api.graph.query", new_callable=AsyncMock, return_value=[]):
            with pytest.raises(ValueError, match="no Graph token"):
                await get_valid_token("u1")


# ---------------------------------------------------------------------------
# AC-1: get_valid_token — refresh path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_valid_token_refreshes_expired_token():
    """AC-1c: expired token triggers MSAL refresh and persists new tokens."""
    new_token_result = {
        "access_token": "new-access-token",
        "refresh_token": "new-refresh-token",
        "expires_in": 3600,
    }
    mock_msal_app = MagicMock()
    mock_msal_app.acquire_token_by_refresh_token.return_value = new_token_result

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_EXPIRED_TOKEN_ROW]),
        patch("api.graph.execute", new_callable=AsyncMock) as mock_execute,
        patch("api.graph.msal.PublicClientApplication", return_value=mock_msal_app),
    ):
        token = await get_valid_token("u1")

    assert token == "new-access-token"
    mock_msal_app.acquire_token_by_refresh_token.assert_called_once()
    mock_execute.assert_called_once()


@pytest.mark.asyncio
async def test_get_valid_token_raises_when_refresh_fails():
    """AC-1d: MSAL refresh returns error dict → raises GraphTokenRefreshFailed (a ValueError subclass)."""
    mock_msal_app = MagicMock()
    mock_msal_app.acquire_token_by_refresh_token.return_value = {
        "error": "invalid_grant",
        "error_description": "Refresh token expired",
    }

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_EXPIRED_TOKEN_ROW]),
        patch("api.graph.msal.PublicClientApplication", return_value=mock_msal_app),
    ):
        # Must be catchable as both the specific subclass and plain ValueError.
        with pytest.raises(GraphTokenRefreshFailed, match="token refresh failed"):
            await get_valid_token("u1")

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_EXPIRED_TOKEN_ROW]),
        patch("api.graph.msal.PublicClientApplication", return_value=mock_msal_app),
    ):
        with pytest.raises(ValueError, match="token refresh failed"):
            await get_valid_token("u1")


# ---------------------------------------------------------------------------
# AC-2: send_mail
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_mail_posts_to_graph_and_returns_message_id():
    """AC-2a: uses draft-then-send flow; returns the durable draft message id.

    Graph POST /me/sendMail returns 202 with no body and only a transient
    x-ms-request-id header.  The correct flow is:
      1. POST /me/messages  → draft JSON with durable ``id``
      2. POST /me/messages/{id}/send → 202, empty body
    The returned value must be the draft ``id``, not a header value.
    """
    draft_response = _make_response(status=201, json_data={"id": "durable-msg-id-001"})
    send_response = _make_response(status=202)
    mock_client = _make_http_client_multi_post(draft_response, send_response)

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        msg_id = await send_mail(
            "u1",
            to=["jennifer@silverleafhoa.org"],
            subject="Juniper Landscaping Introduction",
            body_html="<p>Hi Jennifer</p>",
        )

    assert msg_id == "durable-msg-id-001"
    assert mock_client.post.call_count == 2

    # First call must target /me/messages (draft creation)
    first_url = mock_client.post.call_args_list[0][0][0]
    assert first_url.endswith("/me/messages")

    # Second call must target /me/messages/{id}/send
    second_url = mock_client.post.call_args_list[1][0][0]
    assert second_url.endswith(f"/me/messages/{msg_id}/send")


@pytest.mark.asyncio
async def test_send_mail_raises_502_on_graph_http_error():
    """AC-2b: Graph returns 4xx/5xx on draft creation → raises HTTPException 502."""
    import httpx as _httpx
    from fastapi import HTTPException

    mock_client = AsyncMock()
    mock_response_obj = MagicMock()
    mock_response_obj.status_code = 403
    # Error raised on the first POST (draft creation)
    mock_client.post = AsyncMock(
        side_effect=_httpx.HTTPStatusError(
            "Forbidden", request=MagicMock(), response=mock_response_obj
        )
    )
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await send_mail(
                "u1",
                to=["bad@example.com"],
                subject="Test",
                body_html="<p>test</p>",
            )

    assert exc_info.value.status_code == 502


@pytest.mark.asyncio
async def test_send_mail_includes_cc_when_provided():
    """AC-2c: cc recipients appear in ccRecipients in the draft creation payload."""
    draft_response = _make_response(status=201, json_data={"id": "msg-cc-test"})
    send_response = _make_response(status=202)
    mock_client = _make_http_client_multi_post(draft_response, send_response)

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        await send_mail(
            "u1",
            to=["primary@example.com"],
            subject="Test",
            body_html="<p>test</p>",
            cc=["cc@example.com"],
        )

    # The draft-creation POST carries the message fields directly (not nested under "message")
    draft_json = mock_client.post.call_args_list[0][1]["json"]
    assert "ccRecipients" in draft_json
    assert draft_json["ccRecipients"][0]["emailAddress"]["address"] == "cc@example.com"


# ---------------------------------------------------------------------------
# AC-3: list_events
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_events_returns_list_of_dicts():
    """AC-3a: calendarView returns structured event list."""
    graph_events = [
        {
            "id": "evt-001",
            "subject": "Site walkthrough — Silverleaf HOA",
            "start": {"dateTime": "2026-06-26T10:00:00", "timeZone": "UTC"},
            "end": {"dateTime": "2026-06-26T11:00:00", "timeZone": "UTC"},
            "attendees": [{"emailAddress": {"address": "jennifer@silverleafhoa.org"}}],
        }
    ]
    mock_client = _make_http_client(status=200, json_data={"value": graph_events})

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        events = await list_events("u1", "2026-06-26T00:00:00Z", "2026-06-27T00:00:00Z")

    assert isinstance(events, list)
    assert len(events) == 1
    assert events[0]["id"] == "evt-001"
    assert events[0]["subject"] == "Site walkthrough — Silverleaf HOA"


@pytest.mark.asyncio
async def test_list_events_returns_empty_list_when_none():
    """AC-3b: empty calendarView returns []."""
    mock_client = _make_http_client(status=200, json_data={"value": []})

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        events = await list_events("u1", "2026-06-26T00:00:00Z", "2026-06-26T01:00:00Z")

    assert events == []


@pytest.mark.asyncio
async def test_list_events_sends_correct_query_params():
    """AC-3c: startDateTime and endDateTime are sent as query params."""
    mock_client = _make_http_client(status=200, json_data={"value": []})

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        await list_events("u1", "2026-06-26T00:00:00Z", "2026-06-27T00:00:00Z")

    call_params = mock_client.get.call_args[1]["params"]
    assert call_params["startDateTime"] == "2026-06-26T00:00:00Z"
    assert call_params["endDateTime"] == "2026-06-27T00:00:00Z"


@pytest.mark.asyncio
async def test_list_events_sends_prefer_utc_header():
    """AC-3d (FIX #9a): Prefer: outlook.timezone=UTC header is sent so times come back in UTC."""
    mock_client = _make_http_client(status=200, json_data={"value": []})

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        await list_events("u1", "2026-06-26T00:00:00Z", "2026-06-27T00:00:00Z")

    call_headers = mock_client.get.call_args[1]["headers"]
    assert "Prefer" in call_headers
    assert "UTC" in call_headers["Prefer"]


@pytest.mark.asyncio
async def test_list_events_follows_next_link_pagination():
    """AC-3e (FIX #9b): events from all pages are combined when @odata.nextLink is present."""
    page1_event = {"id": "evt-page1", "subject": "Meeting 1"}
    page2_event = {"id": "evt-page2", "subject": "Meeting 2"}

    page1_response = _make_response(
        status=200,
        json_data={
            "value": [page1_event],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=abc",
        },
    )
    page2_response = _make_response(
        status=200,
        json_data={"value": [page2_event]},  # no nextLink → last page
    )

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=[page1_response, page2_response])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        events = await list_events("u1", "2026-06-26T00:00:00Z", "2026-06-27T00:00:00Z")

    assert len(events) == 2
    assert events[0]["id"] == "evt-page1"
    assert events[1]["id"] == "evt-page2"
    assert mock_client.get.call_count == 2

    # Second GET must use the absolute nextLink URL directly, not a re-composed URL
    second_call_url = mock_client.get.call_args_list[1][0][0]
    assert second_call_url == "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=abc"


@pytest.mark.asyncio
async def test_list_events_stops_at_page_cap_and_logs_warning():
    """AC-3f (FIX #9b): stops after _LIST_EVENTS_MAX_PAGES pages and emits a warning."""
    import api.graph as graph_module

    always_next = _make_response(
        status=200,
        json_data={
            "value": [{"id": "evt"}],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=infinite",
        },
    )

    mock_client = AsyncMock()
    # Return the same response every time (infinite next links)
    mock_client.get = AsyncMock(return_value=always_next)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
        patch.object(graph_module.logger, "warning") as mock_warning,
    ):
        events = await list_events("u1", "2026-06-26T00:00:00Z", "2026-06-27T00:00:00Z")

    assert mock_client.get.call_count == graph_module._LIST_EVENTS_MAX_PAGES
    assert len(events) == graph_module._LIST_EVENTS_MAX_PAGES
    mock_warning.assert_called_once()
    # Warning message must mention the cap so it's actionable in logs
    assert "cap" in mock_warning.call_args[0][0].lower() or "cap" in str(mock_warning.call_args)


# ---------------------------------------------------------------------------
# AC-4: create_event
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_event_posts_to_graph_and_returns_event():
    """AC-4a: create_event POSTs to /me/events and returns the created event dict."""
    created_event = {
        "id": "new-evt-001",
        "subject": "Proposal Review",
        "start": {"dateTime": "2026-06-27T14:00:00", "timeZone": "UTC"},
        "end": {"dateTime": "2026-06-27T15:00:00", "timeZone": "UTC"},
        "onlineMeeting": {"joinUrl": "https://teams.microsoft.com/l/meetup/..."},
    }
    mock_client = _make_http_client(status=201, json_data=created_event)

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        event = await create_event(
            "u1",
            subject="Proposal Review",
            start_iso="2026-06-27T14:00:00Z",
            end_iso="2026-06-27T15:00:00Z",
            attendees=["jennifer@silverleafhoa.org"],
            online_meeting=True,
        )

    assert event["id"] == "new-evt-001"
    mock_client.post.assert_called_once()
    url = mock_client.post.call_args[0][0]
    assert url.endswith("/me/events")


@pytest.mark.asyncio
async def test_create_event_sets_online_meeting_flag():
    """AC-4b: online_meeting=True includes isOnlineMeeting + teamsForBusiness."""
    mock_client = _make_http_client(status=201, json_data={"id": "x", "subject": "Test"})

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        await create_event(
            "u1",
            subject="Online meeting",
            start_iso="2026-06-28T10:00:00Z",
            end_iso="2026-06-28T11:00:00Z",
            attendees=[],
            online_meeting=True,
        )

    call_json = mock_client.post.call_args[1]["json"]
    assert call_json["isOnlineMeeting"] is True
    assert call_json["onlineMeetingProvider"] == "teamsForBusiness"


@pytest.mark.asyncio
async def test_create_event_includes_attendees():
    """AC-4c: attendees list maps to Graph attendees array."""
    mock_client = _make_http_client(status=201, json_data={"id": "x"})

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        await create_event(
            "u1",
            subject="Meeting",
            start_iso="2026-06-28T10:00:00Z",
            end_iso="2026-06-28T11:00:00Z",
            attendees=["a@example.com", "b@example.com"],
        )

    call_json = mock_client.post.call_args[1]["json"]
    addresses = [a["emailAddress"]["address"] for a in call_json["attendees"]]
    assert "a@example.com" in addresses
    assert "b@example.com" in addresses
