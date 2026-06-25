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
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import msal
from fastapi import HTTPException

from db import P, T, execute, query

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_REFRESH_BUFFER = timedelta(minutes=5)


# ── Token management ─────────────────────────────────────────────────────────

async def get_valid_token(user_id: str) -> str:
    """Return a non-expired access token, refreshing + persisting when needed."""
    rows = await query(
        f"SELECT * FROM {T('user_graph_tokens')} WHERE user_id = @user_id LIMIT 1",
        [P("user_id", "STRING", user_id)],
    )
    if not rows:
        raise ValueError(f"no Graph token stored for user {user_id!r} — user must grant Microsoft permissions")

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
        raise ValueError(f"token refresh failed: {result.get('error_description', result.get('error'))}")

    new_access = result["access_token"]
    new_refresh = result.get("refresh_token", row["refresh_token"])
    new_expires = datetime.now(tz=timezone.utc) + timedelta(seconds=result.get("expires_in", 3600))

    await execute(
        f"""
        MERGE {T('user_graph_tokens')} AS t
        USING (SELECT @user_id AS user_id) AS s ON t.user_id = s.user_id
        WHEN MATCHED THEN
          UPDATE SET
            access_token  = @access_token,
            refresh_token = @refresh_token,
            expires_at    = @expires_at,
            updated_at    = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN
          INSERT (user_id, access_token, refresh_token, scope, expires_at, updated_at)
          VALUES (@user_id, @access_token, @refresh_token, @scope, @expires_at, CURRENT_TIMESTAMP())
        """,
        [
            P("user_id", "STRING", user_id),
            P("access_token", "STRING", new_access),
            P("refresh_token", "STRING", new_refresh),
            P("scope", "STRING", row.get("scope") or ""),
            P("expires_at", "TIMESTAMP", new_expires),
        ],
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


# ── Mail ─────────────────────────────────────────────────────────────────────

async def send_mail(
    user_id: str,
    *,
    to: list[str],
    subject: str,
    body_html: str,
    cc: Optional[list[str]] = None,
) -> str:
    """POST to Graph sendMail on behalf of the user. Returns a request-id string."""
    token = await get_valid_token(user_id)

    payload: dict = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body_html},
            "toRecipients": [{"emailAddress": {"address": addr}} for addr in to],
        },
        "saveToSentItems": True,
    }
    if cc:
        payload["message"]["ccRecipients"] = [
            {"emailAddress": {"address": addr}} for addr in cc
        ]

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{_GRAPH_BASE}/me/sendMail",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=15.0,
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error("Graph sendMail failed: %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail=f"Microsoft Graph send failed: {exc.response.status_code}")
    except httpx.RequestError as exc:
        logger.error("Graph sendMail network error: %s", exc)
        raise HTTPException(status_code=502, detail="Microsoft Graph unreachable")

    return resp.headers.get("x-ms-request-id") or f"graph_{uuid.uuid4().hex[:12]}"


# ── Calendar ─────────────────────────────────────────────────────────────────

async def list_events(user_id: str, start_iso: str, end_iso: str) -> list[dict]:
    """GET /me/calendarView for the given time window."""
    token = await get_valid_token(user_id)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{_GRAPH_BASE}/me/calendarView",
                params={"startDateTime": start_iso, "endDateTime": end_iso, "$top": "50"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0,
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error("Graph calendarView failed: %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail=f"Microsoft Graph calendar failed: {exc.response.status_code}")
    except httpx.RequestError as exc:
        logger.error("Graph calendarView network error: %s", exc)
        raise HTTPException(status_code=502, detail="Microsoft Graph unreachable")

    return resp.json().get("value", [])


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
