"""
Microsoft Graph API helpers — token management + mail + calendar.

Token lifecycle:
  1. Frontend exchanges the PKCE auth code with Graph scopes and POSTs the
     resulting access_token + refresh_token to POST /api/auth/ms-graph-token.
  2. Backend stores them in user_graph_tokens (BigQuery).
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

from db import P, T, execute, query

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
    """MERGE-upsert a user's Graph token row (updates all fields incl. scope)."""
    await execute(
        f"""
        MERGE {T('user_graph_tokens')} AS t
        USING (SELECT @user_id AS user_id) AS s ON t.user_id = s.user_id
        WHEN MATCHED THEN
          UPDATE SET
            access_token  = @access_token,
            refresh_token = @refresh_token,
            scope         = @scope,
            expires_at    = @expires_at,
            updated_at    = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN
          INSERT (user_id, access_token, refresh_token, scope, expires_at, updated_at)
          VALUES (@user_id, @access_token, @refresh_token, @scope, @expires_at, CURRENT_TIMESTAMP())
        """,
        [
            P("user_id", "STRING", user_id),
            P("access_token", "STRING", access_token),
            P("refresh_token", "STRING", refresh_token),
            P("scope", "STRING", scope),
            P("expires_at", "TIMESTAMP", expires_at),
        ],
    )


async def get_valid_token(user_id: str) -> str:
    """Return a non-expired access token, refreshing + persisting when needed."""
    rows = await query(
        f"SELECT * FROM {T('user_graph_tokens')} WHERE user_id = @user_id LIMIT 1",
        [P("user_id", "STRING", user_id)],
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
        scopes=["Mail.Send", "Mail.Read", "Calendars.ReadWrite", "offline_access"],
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


# ── Mail ─────────────────────────────────────────────────────────────────────

async def send_mail(
    user_id: str,
    *,
    to: list[str],
    subject: str,
    body_html: str,
    cc: Optional[list[str]] = None,
) -> str:
    """Create a mail draft then send it, returning the durable Graph message id.

    Uses the two-step create-draft / send flow instead of ``/me/sendMail``
    because ``POST /me/sendMail`` returns 202 with no body and no durable
    message id — only a transient ``x-ms-request-id`` that cannot be used to
    re-fetch the message later.

    Flow:
      1. ``POST /me/messages`` — creates the draft; Graph returns the full
         message object including its durable ``id``.
      2. ``POST /me/messages/{id}/send`` — sends the draft (202, empty body).
    """
    token = await get_valid_token(user_id)

    message_body: dict = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "toRecipients": [{"emailAddress": {"address": addr}} for addr in to],
    }
    if cc:
        message_body["ccRecipients"] = [
            {"emailAddress": {"address": addr}} for addr in cc
        ]

    auth_headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    # Request immutable IDs so the id returned for the draft stays valid after the
    # message moves from Drafts to Sent Items on send. Without this, Exchange
    # reassigns the id on that folder move and the stored external_message_id
    # would no longer resolve via GET /me/messages/{id}.
    draft_headers = {**auth_headers, "Prefer": 'IdType="ImmutableId"'}

    try:
        async with httpx.AsyncClient() as client:
            # Step 1: create the draft — response contains the durable message id.
            draft_resp = await client.post(
                f"{_GRAPH_BASE}/me/messages",
                json=message_body,
                headers=draft_headers,
                timeout=15.0,
            )
            draft_resp.raise_for_status()
            message_id = draft_resp.json().get("id")
            if not message_id:
                logger.error("Graph draft creation returned no message id")
                raise HTTPException(
                    status_code=502,
                    detail="Microsoft Graph returned no message id",
                )

            # Step 2: send the draft — returns 202 with no body.
            send_resp = await client.post(
                f"{_GRAPH_BASE}/me/messages/{message_id}/send",
                headers=auth_headers,
                timeout=15.0,
            )
            send_resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error("Graph send_mail failed: %s", exc.response.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"Microsoft Graph send failed: {exc.response.status_code}",
        )
    except httpx.RequestError as exc:
        logger.error("Graph send_mail network error: %s", exc)
        raise HTTPException(status_code=502, detail="Microsoft Graph unreachable")

    return message_id


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
