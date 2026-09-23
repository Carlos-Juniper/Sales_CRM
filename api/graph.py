"""
Microsoft Graph API helpers — token management + mail + calendar.

Token lifecycle:
  1. Frontend exchanges the PKCE auth code with Graph scopes and POSTs the
     resulting access_token + refresh_token to POST /api/auth/ms-graph-token.
  2. Backend stores them in user_graph_tokens (MySQL).
  3. Every outbound Graph call goes through get_valid_token(), which refreshes
     via MSAL when the stored token is within 5 min of expiry (or already
     expired). Uses ConfidentialClientApplication when ENTRA_CLIENT_SECRET is
     set, PublicClientApplication otherwise.

Env vars required:
  ENTRA_CLIENT_ID   — Azure app registration client ID (shared with SSO)
  ENTRA_TENANT_ID   — Azure tenant ID
"""
from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import msal
from fastapi import HTTPException
from google.cloud import kms

from db import execute, query

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_REFRESH_BUFFER = timedelta(minutes=5)
_KMS_KEY_NAME = os.environ.get("KMS_GRAPH_TOKEN_KEY", "")

# Maximum pages to follow via @odata.nextLink in list_events to avoid infinite loops.
_LIST_EVENTS_MAX_PAGES = 10


# ── KMS envelope encryption helpers ──────────────────────────────────────────

# Version prefix written before the base64 ciphertext.
# Lets _decrypt distinguish encrypted rows from pre-migration plaintext rows,
# and lets the migration script skip rows that are already encrypted.
_CIPHERTEXT_PREFIX = "v1:"


def _encrypt(plaintext: str) -> str:
    """KMS-encrypt a plaintext string; returns 'v1:<base64-ciphertext>' for DB storage."""
    client = kms.KeyManagementServiceClient()
    response = client.encrypt(
        request={"name": _KMS_KEY_NAME, "plaintext": plaintext.encode()}
    )
    return _CIPHERTEXT_PREFIX + base64.b64encode(response.ciphertext).decode()


def _decrypt(value: str) -> str:
    """KMS-decrypt a 'v1:<base64-ciphertext>' DB value back to plaintext.

    If the value lacks the 'v1:' prefix it is a pre-migration plaintext row.
    In that case a warning is logged and the value is returned as-is so the
    service stays operational until migrate_encrypt_tokens.py is run.
    """
    if not value.startswith(_CIPHERTEXT_PREFIX):
        logger.warning(
            "Token value is not KMS-encrypted (missing %r prefix) — "
            "run scripts/migrate_encrypt_tokens.py before deploying",
            _CIPHERTEXT_PREFIX,
        )
        return value
    ciphertext_b64 = value[len(_CIPHERTEXT_PREFIX):]
    client = kms.KeyManagementServiceClient()
    ciphertext = base64.b64decode(ciphertext_b64.encode())
    response = client.decrypt(
        request={"name": _KMS_KEY_NAME, "ciphertext": ciphertext}
    )
    return response.plaintext.decode()


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

# OIDC scopes are requested at login but must not be sent to MSAL refresh.
# Passing offline_access here is a common cause of AADSTS refresh failures;
# MSAL adds it itself when a refresh token is used.
_OIDC_SCOPES = frozenset({"openid", "profile", "email", "offline_access"})
_DEFAULT_GRAPH_SCOPES = ["Mail.Send", "Mail.Read", "Calendars.ReadWrite"]


def _refresh_scopes(stored_scope: str) -> list[str]:
    """Graph resource scopes for MSAL refresh (never OIDC / offline_access)."""
    stored = {s for s in (stored_scope or "").split() if s and s not in _OIDC_SCOPES}
    return list(stored | set(_DEFAULT_GRAPH_SCOPES))


def _client_secret() -> str:
    """ENTRA_CLIENT_SECRET, or a 503 naming the missing config.

    Shared by every confidential-client flow (code exchange, user token refresh,
    app-only directory reads) so a missing secret surfaces the same actionable
    error instead of a KeyError 500 in one place and a silent fallback in another.
    """
    secret = os.environ.get("ENTRA_CLIENT_SECRET")
    if not secret:
        raise HTTPException(
            status_code=503,
            detail="Microsoft integration is not configured — ENTRA_CLIENT_SECRET is not set on the server.",
        )
    return secret


def _confidential_app() -> msal.ConfidentialClientApplication:
    """MSAL confidential client for this app registration."""
    tenant_id = os.environ["ENTRA_TENANT_ID"]
    return msal.ConfidentialClientApplication(
        client_id=os.environ["ENTRA_CLIENT_ID"],
        authority=f"https://login.microsoftonline.com/{tenant_id}",
        client_credential=_client_secret(),
    )


def _msal_app() -> msal.ConfidentialClientApplication:
    """Return the MSAL client used to refresh user-delegated tokens.

    Must be the same client type that redeemed the authorization code, because
    Azure binds a grant to the client type that obtained it. exchange_code()
    redeems server-side as a confidential client, so refreshing here as the same
    confidential client is what keeps both mismatch errors from firing:

      AADSTS700025  — public-client grant redeemed with a client secret
      AADSTS9002327 — SPA-issued token redeemed outside the browser

    Tokens stored before the server-side exchange shipped were redeemed by
    browser JavaScript and are permanently SPA-bound. They fail with
    AADSTS9002327 no matter what client refreshes them; get_valid_token maps
    that to GraphNotConnected so the user is prompted to reconnect once.
    """
    return _confidential_app()


def exchange_code(
    code: str, code_verifier: str, redirect_uri: str, scopes: Optional[list[str]] = None
) -> dict:
    """Redeem an authorization code server-side; returns the raw MSAL result.

    Runs as a confidential client (secret + PKCE verifier — Azure accepts and
    prefers both together), so the refresh token Azure returns is redeemable by
    this server on a 90-day sliding window. Redeeming the same code in the
    browser instead yields a SPA-bound token that no server can refresh, which
    is the failure this function exists to avoid.

    ``scopes`` are Graph resource scopes only. MSAL adds openid/profile/
    offline_access itself; passing them explicitly is a common cause of
    AADSTS errors on redemption.

    The verifier goes inside ``data=`` deliberately. MSAL's
    acquire_token_by_authorization_code() accepts **kwargs but only its ``data``
    dict is merged into the token request body — a bare ``code_verifier=``
    argument is silently dropped, and Azure then rejects the redemption with
    AADSTS501481 (code_verifier does not match code_challenge) with nothing in
    the traceback to say why.
    """
    result = _confidential_app().acquire_token_by_authorization_code(
        code,
        scopes=list(scopes) if scopes else list(_DEFAULT_GRAPH_SCOPES),
        redirect_uri=redirect_uri,
        data={"code_verifier": code_verifier},
    )
    if "error" in result or "access_token" not in result:
        desc = result.get("error_description", "") or result.get("error", "")
        logger.error("MSAL code exchange failed: %s — %s", result.get("error"), desc)
        raise HTTPException(status_code=401, detail=f"Microsoft sign-in failed: {desc[:200]}")
    return result


async def find_token_row(user_id: str, email: Optional[str] = None) -> Optional[dict]:
    """Return the user's ``user_graph_tokens`` row, if any.

    Looks up by JWT ``id`` first, then email. Older rows may be keyed by email
    (or a prior users.id) while Settings / Calendar receive a UUID in the JWT.
    Using the same helper for both surfaces keeps "connected" in sync.
    """
    keys: list[str] = []
    for key in (user_id, email):
        if key and key not in keys:
            keys.append(key)
    if not keys:
        return None
    placeholders = ", ".join(["%s"] * len(keys))
    rows = await query(
        f"SELECT * FROM user_graph_tokens WHERE user_id IN ({placeholders})",
        keys,
    )
    if not rows:
        return None
    if user_id:
        for row in rows:
            if str(row.get("user_id")) == str(user_id):
                return row
    if email:
        for row in rows:
            if str(row.get("user_id")) == email:
                return row
    return None


async def has_graph_connection(user_id: str, email: Optional[str] = None) -> bool:
    """True when a Graph token row exists for this user (id or email)."""
    return await find_token_row(user_id, email) is not None


async def _upsert_tokens(
    user_id: str,
    *,
    access_token: str,
    refresh_token: str,
    expires_at: datetime,
    scope: str,
) -> None:
    """Upsert a user's Graph token row (updates all fields incl. scope).

    Callers pass plaintext tokens; this function KMS-encrypts them before writing.
    """
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
        [user_id, _encrypt(access_token), _encrypt(refresh_token), scope, expires_at],
    )


async def get_valid_token(user_id: str, email: Optional[str] = None) -> str:
    """Return a non-expired access token, refreshing + persisting when needed."""
    row = await find_token_row(user_id, email)
    if not row:
        raise GraphNotConnected(
            f"no Graph token stored for user {user_id!r} — user must grant Microsoft permissions"
        )

    access_token = _decrypt(row["access_token"])
    refresh_token = _decrypt(row["refresh_token"])
    stored_user_id = str(row.get("user_id") or user_id)

    expires_at: datetime = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at - _REFRESH_BUFFER > datetime.now(tz=timezone.utc):
        return access_token

    # Token is expired or close to expiry — refresh via MSAL
    result = _msal_app().acquire_token_by_refresh_token(
        refresh_token,
        scopes=_refresh_scopes(row.get("scope") or ""),
    )

    if "error" in result:
        desc = result.get("error_description", "") or ""
        logger.error("MSAL refresh failed: %s — %s", result.get("error"), desc)
        # SPA-restricted refresh tokens (AADSTS9002327) can never be redeemed
        # server-side — the redirect URI is registered as "Single-page application"
        # in Azure AD, which binds refresh tokens to browser cross-origin requests.
        # Treat as NotConnected so the frontend shows reconnect instead of retry.
        if "AADSTS9002327" in desc:
            raise GraphNotConnected(
                "Microsoft account must be reconnected — please disconnect and reconnect "
                "in Settings to resolve a token compatibility issue."
            )
        raise GraphTokenRefreshFailed(
            f"token refresh failed: {result.get('error_description', result.get('error'))}"
        )

    new_access = result["access_token"]
    new_refresh = result.get("refresh_token", refresh_token)
    new_expires = datetime.now(tz=timezone.utc) + timedelta(seconds=result.get("expires_in", 3600))

    await _upsert_tokens(
        stored_user_id,
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



# ── Directory (people picker) ────────────────────────────────────────────────

# Cap the directory search page so the picker stays snappy and never pulls the
# whole tenant. Graph's own default is 100; 25 candidates is plenty for a
# name/email autocomplete.
_DIRECTORY_SEARCH_TOP = 25


async def search_directory(q: str) -> list[dict]:
    """Search the M365 directory by name or email, returning ``{name, email}``.

    Backs the Settings > Users "authorize a person" picker (§2.8): an admin
    PICKS a real directory person instead of typing a raw email, which makes the
    lowercased-email match Entra SSO relies on typo-proof. Wraps Graph
    ``GET /users`` with ``$search`` on displayName/mail (the documented people
    search); ``ConsistencyLevel: eventual`` is required by Graph for ``$search``.

    An app-level token is used (``get_app_token``) rather than a user delegated
    token: reading the directory is an admin/tenant operation, not the signed-in
    admin's own mailbox. A blank/short query returns [] without calling Graph.
    """
    q = (q or "").strip()
    if len(q) < 2:
        return []

    token = await get_app_token()
    # $search wants the term quoted; escape embedded quotes so a stray '"' in the
    # query can't break out of the search expression.
    safe = q.replace('"', '\\"')
    search_expr = f'"displayName:{safe}" OR "mail:{safe}"'

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{_GRAPH_BASE}/users",
                params={
                    "$search": search_expr,
                    "$select": "displayName,mail,userPrincipalName",
                    "$top": str(_DIRECTORY_SEARCH_TOP),
                },
                headers={
                    "Authorization": f"Bearer {token}",
                    # Required by Graph for $search on the directory.
                    "ConsistencyLevel": "eventual",
                },
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error("Graph directory search failed: %s", exc.response.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"Microsoft Graph directory search failed: {exc.response.status_code}",
        )
    except httpx.RequestError as exc:
        logger.error("Graph directory search network error: %s", exc)
        raise HTTPException(status_code=502, detail="Microsoft Graph unreachable")

    people: list[dict] = []
    for row in data.get("value", []):
        # Prefer `mail`; fall back to userPrincipalName (some accounts have no
        # mail attribute but the UPN is their sign-in address). Skip rows with
        # neither — an entry with no email is unusable for SSO matching.
        email = row.get("mail") or row.get("userPrincipalName")
        if not email:
            continue
        people.append({"name": row.get("displayName") or email, "email": email})
    return people


async def get_app_token() -> str:
    """Acquire an app-only Graph token via MSAL client-credentials.

    Directory reads are a tenant operation, not a per-user mailbox call, so they
    use application permissions (``User.Read.All``) rather than a stored user
    delegated token. Requires ``ENTRA_CLIENT_SECRET`` alongside the client/tenant
    ids the SSO app registration already carries.

    Requires ``User.Read.All`` as an *Application* permission with tenant admin
    consent — ``.default`` on a client-credentials call resolves only to app
    roles and ignores delegated permissions, so a delegated-only grant yields a
    token with no roles and Graph answers 403 Authorization_RequestDenied.

    Raises ``HTTPException(503)`` via ``_client_secret()`` when
    ``ENTRA_CLIENT_SECRET`` is absent, rather than a generic 500.
    """
    result = _confidential_app().acquire_token_for_client(
        scopes=["https://graph.microsoft.com/.default"]
    )
    if "access_token" not in result:
        logger.error(
            "MSAL app-token failed: %s — %s",
            result.get("error"),
            result.get("error_description"),
        )
        raise HTTPException(
            status_code=502, detail="Microsoft Graph directory auth failed"
        )
    return result["access_token"]


# ── Calendar ─────────────────────────────────────────────────────────────────

async def list_events(
    user_id: str, start_iso: str, end_iso: str, email: Optional[str] = None
) -> list[dict]:
    """GET /me/calendarView for the given time window, following pagination.

    Fixes applied:
    - ``Prefer: outlook.timezone="UTC"`` header ensures Graph returns
      event start/end times in UTC regardless of the mailbox default timezone.
    - Follows ``@odata.nextLink`` across pages (up to ``_LIST_EVENTS_MAX_PAGES``)
      so events beyond the first 50 are not silently dropped.  A warning is
      logged if the safety cap is reached.
    """
    token = await get_valid_token(user_id, email)

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
    email: Optional[str] = None,
) -> dict:
    """POST /me/events to create a calendar event."""
    token = await get_valid_token(user_id, email)

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
    email: Optional[str] = None,
) -> dict:
    """PATCH /me/events/{event_id} to update a calendar event. Only provided fields are sent."""
    token = await get_valid_token(user_id, email)

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


async def delete_event(user_id: str, event_id: str, email: Optional[str] = None) -> None:
    """DELETE /me/events/{event_id} to delete a calendar event."""
    token = await get_valid_token(user_id, email)

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
