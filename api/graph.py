"""
Microsoft Graph API helpers — token management + mail + calendar.

Token lifecycle:
  1. Frontend exchanges the PKCE auth code with Graph scopes and POSTs the
     resulting access_token + refresh_token to POST /api/auth/ms-graph-token.
  2. Backend stores them in user_graph_tokens (MySQL).
  3. Every outbound Graph call goes through get_valid_token(), which refreshes
     via MSAL PublicClientApplication when the stored token is within 5 min of
     expiry (or already expired).

Env vars required:
  ENTRA_CLIENT_ID   — Azure app registration client ID (shared with SSO)
  ENTRA_TENANT_ID   — Azure tenant ID
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import msal
from fastapi import HTTPException

from db import execute, query

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_REFRESH_BUFFER = timedelta(minutes=5)

# Maximum pages to follow via @odata.nextLink in list_events to avoid infinite loops.
_LIST_EVENTS_MAX_PAGES = 10


# ── Custom error types (FIX #10a) ────────────────────────────────────────────

class GraphNotConnected(ValueError):
    """Raised when no Graph token row exists for the user.

    Subclasses ValueError so existing ``except ValueError`` handlers in
    server.py continue to catch it and return HTTP 400.
    """


class GraphTokenRefreshFailed(ValueError):
    """Raised when the MSAL token refresh call returns an error response.

    Subclasses ValueError so existing ``except ValueError`` handlers in
    server.py continue to catch it and return HTTP 400.
    """


# ── Token management ─────────────────────────────────────────────────────────

async def _upsert_tokens(
    user_id: str,
    *,
    access_token: str,
    refresh_token: str,
    expires_at: datetime,
    scope: str,
) -> None:
    """Upsert a user's Graph token row (updates all fields incl. scope)."""
    await execute(
        """
        INSERT INTO user_graph_tokens
            (user_id, access_token, refresh_token, scope, expires_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            access_token  = VALUES(access_token),
            refresh_token = VALUES(refresh_token),
            scope         = VALUES(scope),
            expires_at    = VALUES(expires_at),
            updated_at    = NOW()
        """,
        [user_id, access_token, refresh_token, scope, expires_at],
    )


async def get_valid_token(user_id: str) -> str:
    """Return a non-expired access token, refreshing + persisting when needed."""
    rows = await query(
        "SELECT * FROM user_graph_tokens WHERE user_id = %s LIMIT 1",
        [user_id],
    )
    if not rows:
        raise GraphNotConnected(
            f"no Graph token stored for user {user_id!r} — user must grant Microsoft permissions"
        )

    row = rows[0]
    expires_at: datetime = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at - _REFRESH_BUFFER > datetime.now(tz=timezone.utc):
        return row["access_token"]

    # Token is expired or close to expiry — refresh via MSAL
    client_id = os.environ["ENTRA_CLIENT_ID"]
    tenant_id = os.environ["ENTRA_TENANT_ID"]
    authority = f"https://login.microsoftonline.com/{tenant_id}"

    msal_app = msal.PublicClientApplication(client_id=client_id, authority=authority)
    result = msal_app.acquire_token_by_refresh_token(
        row["refresh_token"],
        scopes=["Mail.Send", "Mail.Read", "Calendars.ReadWrite"],
    )

    if "error" in result:
        logger.error("MSAL refresh failed: %s — %s", result.get("error"), result.get("error_description"))
        raise GraphTokenRefreshFailed(
            f"token refresh failed: {result.get('error_description', result.get('error'))}"
        )

    new_access = result["access_token"]
    new_refresh = result.get("refresh_token", row["refresh_token"])
    new_expires = datetime.now(tz=timezone.utc) + timedelta(seconds=result.get("expires_in", 3600))

    await _upsert_tokens(
        user_id,
        access_token=new_access,
        refresh_token=new_refresh,
        expires_at=new_expires,
        scope=row.get("scope") or "",
    )

    return new_access


async def store_tokens(
    user_id: str,
    *,
    access_token: str,
    refresh_token: str,
    expires_in: int,
    scope: str = "",
) -> None:
    """Upsert Graph tokens for a user (called from POST /api/auth/ms-graph-token)."""
    expires_at = datetime.now(tz=timezone.utc) + timedelta(seconds=expires_in)
    await _upsert_tokens(
        user_id,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        scope=scope,
    )



# ── Calendar ─────────────────────────────────────────────────────────────────

async def list_events(user_id: str, start_iso: str, end_iso: str) -> list[dict]:
    """GET /me/calendarView for the given time window, following pagination.

    Fixes applied:
    - ``Prefer: outlook.timezone="UTC"`` header ensures Graph returns
      event start/end times in UTC regardless of the mailbox default timezone.
    - Follows ``@odata.nextLink`` across pages (up to ``_LIST_EVENTS_MAX_PAGES``)
      so events beyond the first 50 are not silently dropped.  A warning is
      logged if the safety cap is reached.
    """
    token = await get_valid_token(user_id)

    request_headers = {
        "Authorization": f"Bearer {token}",
        # Force Graph to return datetimes in UTC regardless of the mailbox
        # default timezone — otherwise times are mailbox-local and inconsistent
        # with what create_event sends and what the frontend expects.
        "Prefer": 'outlook.timezone="UTC"',
    }

    events: list[dict] = []
    pages_fetched = 0

    try:
        async with httpx.AsyncClient() as client:
            # First request uses structured params; subsequent nextLink requests
            # use the full absolute URL returned by Graph (never re-append params).
            next_url: Optional[str] = None
            first_request = True

            while True:
                if first_request:
                    resp = await client.get(
                        f"{_GRAPH_BASE}/me/calendarView",
                        params={
                            "startDateTime": start_iso,
                            "endDateTime": end_iso,
                            "$top": "50",
                        },
                        headers=request_headers,
                        timeout=15.0,
                    )
                    first_request = False
                else:
                    # nextLink is an absolute URL — GET it directly with no extra params.
                    resp = await client.get(next_url, headers=request_headers, timeout=15.0)

                resp.raise_for_status()
                data = resp.json()
                events.extend(data.get("value", []))
                pages_fetched += 1

                next_url = data.get("@odata.nextLink")
                if not next_url:
                    break

                if pages_fetched >= _LIST_EVENTS_MAX_PAGES:
                    logger.warning(
                        "list_events: reached %d-page safety cap (%d events) for user %r; "
                        "additional events truncated",
                        _LIST_EVENTS_MAX_PAGES,
                        len(events),
                        user_id,
                    )
                    break

    except httpx.HTTPStatusError as exc:
        logger.error("Graph calendarView failed: %s", exc.response.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"Microsoft Graph calendar failed: {exc.response.status_code}",
        )
    except httpx.RequestError as exc:
        logger.error("Graph calendarView network error: %s", exc)
        raise HTTPException(status_code=502, detail="Microsoft Graph unreachable")

    return events


async def create_event(
    user_id: str,
    *,
    subject: str,
    start_iso: str,
    end_iso: str,
    attendees: list[str],
    body: Optional[str] = None,
    online_meeting: bool = True,
) -> dict:
    """POST /me/events to create a calendar event."""
    token = await get_valid_token(user_id)

    payload: dict = {
        "subject": subject,
        "start": {"dateTime": start_iso, "timeZone": "UTC"},
        "end": {"dateTime": end_iso, "timeZone": "UTC"},
        "attendees": [
            {"emailAddress": {"address": addr}, "type": "required"}
            for addr in attendees
        ],
        "isOnlineMeeting": online_meeting,
        "onlineMeetingProvider": "teamsForBusiness" if online_meeting else "unknown",
    }
    if body:
        payload["body"] = {"contentType": "HTML", "content": body}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{_GRAPH_BASE}/me/events",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=15.0,
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error("Graph create event failed: %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail=f"Microsoft Graph event creation failed: {exc.response.status_code}")
    except httpx.RequestError as exc:
        logger.error("Graph create event network error: %s", exc)
        raise HTTPException(status_code=502, detail="Microsoft Graph unreachable")

    return resp.json()


async def update_event(
    user_id: str,
    event_id: str,
    *,
    subject: Optional[str] = None,
    start_iso: Optional[str] = None,
    end_iso: Optional[str] = None,
    attendees: Optional[list[str]] = None,
    body: Optional[str] = None,
) -> dict:
    """PATCH /me/events/{event_id} to update a calendar event. Only provided fields are sent."""
    token = await get_valid_token(user_id)

    payload: dict = {}
    if subject is not None:
        payload["subject"] = subject
    if start_iso is not None:
        payload["start"] = {"dateTime": start_iso, "timeZone": "UTC"}
    if end_iso is not None:
        payload["end"] = {"dateTime": end_iso, "timeZone": "UTC"}
    if attendees is not None:
        payload["attendees"] = [
            {"emailAddress": {"address": addr}, "type": "required"}
            for addr in attendees
        ]
    if body is not None:
        payload["body"] = {"contentType": "HTML", "content": body}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.patch(
                f"{_GRAPH_BASE}/me/events/{event_id}",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=15.0,
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error("Graph update event failed: %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail=f"Microsoft Graph event update failed: {exc.response.status_code}")
    except httpx.RequestError as exc:
        logger.error("Graph update event network error: %s", exc)
        raise HTTPException(status_code=502, detail="Microsoft Graph unreachable")

    return resp.json()


async def delete_event(user_id: str, event_id: str) -> None:
    """DELETE /me/events/{event_id} to delete a calendar event."""
    token = await get_valid_token(user_id)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                f"{_GRAPH_BASE}/me/events/{event_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0,
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            # Event already gone (e.g. deleted from another client) — deletion is idempotent.
            return
        logger.error("Graph delete event failed: %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail=f"Microsoft Graph event deletion failed: {exc.response.status_code}")
    except httpx.RequestError as exc:
        logger.error("Graph delete event network error: %s", exc)
        raise HTTPException(status_code=502, detail="Microsoft Graph unreachable")
