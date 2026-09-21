"""
Tests for api/graph.py — Microsoft Graph token management and API calls.
All HTTP is mocked; no live Graph calls are made.

Run with:  PYTHONPATH=. pytest tests/test_graph.py -v
"""
from __future__ import annotations

import base64
import os
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Minimal env to satisfy module-level imports
os.environ.setdefault("ENTRA_CLIENT_ID", "test-client-id")
os.environ.setdefault("ENTRA_TENANT_ID", "test-tenant-id")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("KMS_GRAPH_TOKEN_KEY", "projects/test/locations/us-central1/keyRings/test/cryptoKeys/test")

# Import the module under test once at module level so patches apply consistently
import api.graph  # noqa: E402
from api.graph import (  # noqa: E402
    get_valid_token,
    list_events,
    create_event,
    _encrypt,
    _decrypt,
    _refresh_scopes,
    _msal_app,
    find_token_row,
    has_graph_connection,
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


# ---------------------------------------------------------------------------
# KMS helpers — AC-KMS-1: _encrypt / _decrypt
# ---------------------------------------------------------------------------

def test_encrypt_decrypt_roundtrip():
    """AC-KMS-1a: _decrypt(_encrypt(plaintext)) returns the original plaintext."""
    plaintext = "super-secret-bearer-token-abc123"
    ciphertext_bytes = b"fake-ciphertext-bytes"
    ciphertext_b64 = base64.b64encode(ciphertext_bytes).decode()

    mock_kms_client = MagicMock()
    mock_kms_client.encrypt.return_value = MagicMock(ciphertext=ciphertext_bytes)
    mock_kms_client.decrypt.return_value = MagicMock(plaintext=plaintext.encode())

    with patch("api.graph.kms.KeyManagementServiceClient", return_value=mock_kms_client):
        encrypted = _encrypt(plaintext)
        decrypted = _decrypt(encrypted)

    assert decrypted == plaintext
    mock_kms_client.encrypt.assert_called_once()
    mock_kms_client.decrypt.assert_called_once()
    assert encrypted.startswith("v1:")
    assert encrypted != plaintext
    assert encrypted == "v1:" + ciphertext_b64


def test_encrypt_calls_kms_with_key_name():
    """AC-KMS-1b: _encrypt uses the configured KMS key name."""
    import api.graph as graph_module

    mock_kms_client = MagicMock()
    mock_kms_client.encrypt.return_value = MagicMock(ciphertext=b"cipher")

    with patch("api.graph.kms.KeyManagementServiceClient", return_value=mock_kms_client):
        result = _encrypt("token-value")

    call_request = mock_kms_client.encrypt.call_args[1]["request"]
    assert call_request["name"] == graph_module._KMS_KEY_NAME
    assert call_request["plaintext"] == b"token-value"
    assert result.startswith("v1:")


def test_decrypt_calls_kms_with_key_name():
    """AC-KMS-1c: _decrypt strips the v1: prefix, base64-decodes, and passes raw bytes to KMS."""
    import api.graph as graph_module

    plaintext_bytes = b"decoded-token"
    ciphertext_bytes = b"raw-cipher"
    ciphertext_b64 = base64.b64encode(ciphertext_bytes).decode()
    stored_value = "v1:" + ciphertext_b64

    mock_kms_client = MagicMock()
    mock_kms_client.decrypt.return_value = MagicMock(plaintext=plaintext_bytes)

    with patch("api.graph.kms.KeyManagementServiceClient", return_value=mock_kms_client):
        result = _decrypt(stored_value)

    call_request = mock_kms_client.decrypt.call_args[1]["request"]
    assert call_request["name"] == graph_module._KMS_KEY_NAME
    assert call_request["ciphertext"] == ciphertext_bytes
    assert result == "decoded-token"


def test_decrypt_passthrough_for_plaintext_rows():
    """AC-KMS-1d: _decrypt returns the value as-is (with a warning) for pre-migration plaintext rows."""
    import api.graph as graph_module

    plaintext_value = "eyJhbGciOiJSUzI1NiJ9.plain-bearer-token"  # no v1: prefix

    with patch.object(graph_module.logger, "warning") as mock_warning:
        result = _decrypt(plaintext_value)

    assert result == plaintext_value
    mock_warning.assert_called_once()
    assert "v1:" in str(mock_warning.call_args)


# ---------------------------------------------------------------------------
# AC-KMS-2: _upsert_tokens encrypts before writing to DB
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_upsert_tokens_encrypts_before_writing():
    """AC-KMS-2: plaintext tokens passed to _upsert_tokens are encrypted before the DB INSERT."""
    from api.graph import _upsert_tokens

    def fake_encrypt(plaintext: str) -> str:
        return f"v1:ENCRYPTED_{plaintext.split('-')[0].upper()}"

    with (
        patch("api.graph._encrypt", side_effect=fake_encrypt) as mock_encrypt,
        patch("api.graph.execute", new_callable=AsyncMock) as mock_execute,
    ):
        await _upsert_tokens(
            "u1",
            access_token="access-plain",
            refresh_token="refresh-plain",
            expires_at=_FUTURE,
            scope="Calendars.ReadWrite",
        )

    assert mock_encrypt.call_count == 2
    encrypt_calls = [c[0][0] for c in mock_encrypt.call_args_list]
    assert "access-plain" in encrypt_calls
    assert "refresh-plain" in encrypt_calls

    execute_params = mock_execute.call_args[0][1]
    assert "access-plain" not in execute_params
    assert "refresh-plain" not in execute_params
    assert any(str(p).startswith("v1:") for p in execute_params)


# ---------------------------------------------------------------------------
# AC-KMS-3: get_valid_token decrypts after reading from DB
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_valid_token_decrypts_after_reading():
    """AC-KMS-3: get_valid_token decrypts the ciphertext from the DB before returning."""
    ciphertext_row = {
        **_VALID_TOKEN_ROW,
        "access_token": "CIPHERTEXT_access",
        "refresh_token": "CIPHERTEXT_refresh",
    }
    decrypt_map = {
        "CIPHERTEXT_access": "plaintext-access-token",
        "CIPHERTEXT_refresh": "plaintext-refresh-token",
    }

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[ciphertext_row]),
        patch("api.graph._decrypt", side_effect=lambda x: decrypt_map[x]),
    ):
        token = await get_valid_token("u1")

    assert token == "plaintext-access-token"


# ---------------------------------------------------------------------------
# AC-1: get_valid_token — happy path (token not expired)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_valid_token_returns_access_token_when_not_expired():
    """AC-1a: non-expired token is returned directly without refresh."""
    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph._decrypt", side_effect=lambda x: x),
    ):
        token = await get_valid_token("u1")

    assert token == "valid-access-token"


@pytest.mark.asyncio
async def test_get_valid_token_raises_when_no_token_stored():
    """AC-1b: user has never granted Graph scopes → raises GraphNotConnected (a ValueError subclass)."""
    with patch("api.graph.query", new_callable=AsyncMock, return_value=[]):
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
        patch("api.graph._msal_app", return_value=mock_msal_app),
        patch("api.graph._decrypt", side_effect=lambda x: x),
        patch("api.graph._encrypt", side_effect=lambda x: x),
    ):
        token = await get_valid_token("u1")

    assert token == "new-access-token"
    mock_msal_app.acquire_token_by_refresh_token.assert_called_once()
    refresh_scopes = mock_msal_app.acquire_token_by_refresh_token.call_args[1]["scopes"]
    assert "offline_access" not in refresh_scopes
    assert "Calendars.ReadWrite" in refresh_scopes
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
        patch("api.graph._msal_app", return_value=mock_msal_app),
        patch("api.graph._decrypt", side_effect=lambda x: x),
    ):
        with pytest.raises(GraphTokenRefreshFailed, match="token refresh failed"):
            await get_valid_token("u1")

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_EXPIRED_TOKEN_ROW]),
        patch("api.graph._msal_app", return_value=mock_msal_app),
        patch("api.graph._decrypt", side_effect=lambda x: x),
    ):
        with pytest.raises(ValueError, match="token refresh failed"):
            await get_valid_token("u1")


def test_refresh_scopes_strips_oidc_and_offline_access():
    """Refresh must not send offline_access / openid — MSAL adds those itself."""
    assert _refresh_scopes("openid profile email offline_access Calendars.ReadWrite Mail.Send") == [
        "Calendars.ReadWrite",
        "Mail.Send",
    ]
    assert _refresh_scopes("") == ["Mail.Send", "Mail.Read", "Calendars.ReadWrite"]
    assert "offline_access" not in _refresh_scopes("offline_access")


def test_msal_app_uses_confidential_client_when_secret_set():
    """Production has ENTRA_CLIENT_SECRET; refresh must send it or AAD rejects."""
    mock_confidential = MagicMock()
    with (
        patch.dict(os.environ, {"ENTRA_CLIENT_SECRET": "super-secret"}, clear=False),
        patch("api.graph.msal.ConfidentialClientApplication", return_value=mock_confidential) as ctor,
        patch("api.graph.msal.PublicClientApplication") as public_ctor,
    ):
        app = _msal_app()
    assert app is mock_confidential
    ctor.assert_called_once()
    assert ctor.call_args[1]["client_credential"] == "super-secret"
    public_ctor.assert_not_called()


def test_msal_app_uses_public_client_without_secret(monkeypatch):
    monkeypatch.delenv("ENTRA_CLIENT_SECRET", raising=False)
    mock_public = MagicMock()
    with (
        patch("api.graph.msal.PublicClientApplication", return_value=mock_public) as ctor,
        patch("api.graph.msal.ConfidentialClientApplication") as confidential_ctor,
    ):
        app = _msal_app()
    assert app is mock_public
    ctor.assert_called_once()
    confidential_ctor.assert_not_called()


@pytest.mark.asyncio
async def test_find_token_row_falls_back_to_email():
    """Tokens keyed by email still count as connected for a UUID JWT id."""
    email_row = {**_VALID_TOKEN_ROW, "user_id": "carlos@juniperlandscaping.com"}

    with patch("api.graph.query", new_callable=AsyncMock, return_value=[email_row]) as mock_query:
        row = await find_token_row("uuid-1", "carlos@juniperlandscaping.com")

    assert row["user_id"] == "carlos@juniperlandscaping.com"
    sql = mock_query.call_args[0][0]
    assert "IN" in sql
    assert mock_query.call_args[0][1] == ["uuid-1", "carlos@juniperlandscaping.com"]


@pytest.mark.asyncio
async def test_find_token_row_prefers_jwt_id_when_both_match():
    id_row = {**_VALID_TOKEN_ROW, "user_id": "uuid-1"}
    email_row = {**_VALID_TOKEN_ROW, "user_id": "carlos@juniperlandscaping.com"}
    with patch("api.graph.query", new_callable=AsyncMock, return_value=[email_row, id_row]):
        row = await find_token_row("uuid-1", "carlos@juniperlandscaping.com")
    assert row["user_id"] == "uuid-1"


@pytest.mark.asyncio
async def test_get_valid_token_uses_row_keyed_by_email():
    email_row = {**_VALID_TOKEN_ROW, "user_id": "carlos@juniperlandscaping.com"}
    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[email_row]),
        patch("api.graph._decrypt", side_effect=lambda x: x),
    ):
        token = await get_valid_token("uuid-1", "carlos@juniperlandscaping.com")
    assert token == "valid-access-token"


@pytest.mark.asyncio
async def test_has_graph_connection_true_for_email_keyed_row():
    email_row = {**_VALID_TOKEN_ROW, "user_id": "carlos@juniperlandscaping.com"}
    with patch("api.graph.query", new_callable=AsyncMock, return_value=[email_row]):
        assert await has_graph_connection("uuid-1", "carlos@juniperlandscaping.com") is True


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
        patch("api.graph._decrypt", side_effect=lambda x: x),
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
        patch("api.graph._decrypt", side_effect=lambda x: x),
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
        patch("api.graph._decrypt", side_effect=lambda x: x),
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
        patch("api.graph._decrypt", side_effect=lambda x: x),
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
        json_data={"value": [page2_event]},
    )

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=[page1_response, page2_response])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph._decrypt", side_effect=lambda x: x),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
    ):
        events = await list_events("u1", "2026-06-26T00:00:00Z", "2026-06-27T00:00:00Z")

    assert len(events) == 2
    assert events[0]["id"] == "evt-page1"
    assert events[1]["id"] == "evt-page2"
    assert mock_client.get.call_count == 2

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
    mock_client.get = AsyncMock(return_value=always_next)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("api.graph.query", new_callable=AsyncMock, return_value=[_VALID_TOKEN_ROW]),
        patch("api.graph._decrypt", side_effect=lambda x: x),
        patch("api.graph.httpx.AsyncClient", return_value=mock_client),
        patch.object(graph_module.logger, "warning") as mock_warning,
    ):
        events = await list_events("u1", "2026-06-26T00:00:00Z", "2026-06-27T00:00:00Z")

    assert mock_client.get.call_count == graph_module._LIST_EVENTS_MAX_PAGES
    assert len(events) == graph_module._LIST_EVENTS_MAX_PAGES
    mock_warning.assert_called_once()
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
        patch("api.graph._decrypt", side_effect=lambda x: x),
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
        patch("api.graph._decrypt", side_effect=lambda x: x),
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
        patch("api.graph._decrypt", side_effect=lambda x: x),
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
