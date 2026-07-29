"""Aspire REST API client — transport only.

Ported from the sibling deployable crm-pipeline-bids/api/aspire_client.py (async
httpx, /Authorization token fetch, single 401-refresh retry) and extended with
``patch``/``put`` for opportunity status write-back.

Design notes:
  * Credentials are read from the environment at token-fetch time and never
    stored on ``self`` (matches the sibling and api/graph.py).
  * Transport failures are raised as typed ``AspireError`` subclasses rather
    than FastAPI ``HTTPException`` — the caller (api.aspire_sync) is best-effort
    and must catch these to mark a row ``failed`` WITHOUT surfacing a 502 to the
    estimator. This is the one deliberate divergence from graph.py's pattern.
  * ``client`` is injectable purely so tests can pass a mocked httpx client;
    production callers use the default.
"""
from __future__ import annotations

import os
from typing import Optional

import httpx

_PROD_BASE_URL = "https://cloud-api.youraspire.com"


def _resolve_env() -> str:
    """Which Aspire environment to talk to: ``sandbox`` or ``prod`` (default)."""
    return os.environ.get("ASPIRE_ENV", "prod").strip().lower()


def _resolve_base_url(env: str) -> str:
    """Ternary on ASPIRE_ENV: the sandbox host in sandbox, else the prod host."""
    return (
        os.environ.get("ASPIRE_SANDBOX_BASE_URL", "")
        if env == "sandbox"
        else os.environ.get("ASPIRE_BASE_URL", _PROD_BASE_URL)
    )


def _resolve_credentials(env: str) -> tuple[str, str]:
    """The (ClientId, Secret) pair for the selected environment."""
    if env == "sandbox":
        return os.environ["ASPIRE_SANDBOX_CLIENT_ID"], os.environ["ASPIRE_SANDBOX_SECRET"]
    return os.environ["ASPIRE_CLIENT_ID"], os.environ["ASPIRE_SECRET"]


# ── Typed errors ─────────────────────────────────────────────────────────────

class AspireError(Exception):
    """Base for all Aspire transport failures."""


class AspireAuthError(AspireError):
    """Missing credentials, or a 401 that survived a token refresh."""


class AspireHTTPError(AspireError):
    """A non-2xx response from an Aspire API call."""

    def __init__(self, status_code: int, detail: str = "") -> None:
        self.status_code = status_code
        super().__init__(f"Aspire returned {status_code}: {detail}")


class AspireUnreachable(AspireError):
    """A network-level failure reaching Aspire."""


# ── Client ───────────────────────────────────────────────────────────────────

class AspireClient:
    def __init__(self, client: Optional[httpx.AsyncClient] = None) -> None:
        self._token: Optional[str] = None
        self._client = client if client is not None else httpx.AsyncClient(timeout=30.0)
        # ASPIRE_ENV is read once per client; the base URL is chosen from it via a
        # ternary (sandbox host vs prod host) so a single service always talks to
        # exactly one Aspire environment. Credentials are still fetched lazily.
        self._env = _resolve_env()
        self._base_url = _resolve_base_url(self._env)

    async def _fetch_token(self) -> str:
        try:
            client_id, secret = _resolve_credentials(self._env)
        except KeyError as exc:
            raise AspireAuthError(f"missing Aspire credential env var: {exc}") from exc
        try:
            response = await self._client.post(
                f"{self._base_url}/Authorization",
                json={"ClientId": client_id, "Secret": secret},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise AspireAuthError(f"token fetch failed: {exc.response.status_code}") from exc
        except httpx.RequestError as exc:
            raise AspireUnreachable(f"token fetch unreachable: {exc}") from exc
        return response.json()["Token"]

    async def _auth_headers(self) -> dict:
        if not self._token:
            self._token = await self._fetch_token()
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
        }

    async def _request(
        self, verb: str, path: str, *, params: Optional[dict] = None, body: Optional[dict] = None
    ) -> dict:
        """Issue a request with a single 401-refresh-retry, mapping errors to AspireError."""
        response = await self._call(verb, path, params=params, body=body)
        if response.status_code == 401:
            # Token likely expired — drop it, refresh, retry exactly once.
            self._token = None
            response = await self._call(verb, path, params=params, body=body)
            if response.status_code == 401:
                raise AspireAuthError("401 after token refresh")
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise AspireHTTPError(exc.response.status_code, str(exc)) from exc
        return _json_or_empty(response)

    async def _call(self, verb: str, path: str, *, params, body):
        headers = await self._auth_headers()
        url = f"{self._base_url}{path}"
        try:
            method = getattr(self._client, verb)
            if verb == "get":
                return await method(url, headers=headers, params=params or {})
            return await method(url, headers=headers, json=body or {})
        except httpx.RequestError as exc:
            raise AspireUnreachable(f"{verb.upper()} {path} unreachable: {exc}") from exc

    async def get(self, path: str, params: Optional[dict] = None) -> dict:
        return await self._request("get", path, params=params)

    async def post(self, path: str, body: dict) -> dict:
        return await self._request("post", path, body=body)

    async def patch(self, path: str, body: dict) -> dict:
        return await self._request("patch", path, body=body)

    async def put(self, path: str, body: dict) -> dict:
        return await self._request("put", path, body=body)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AspireClient":
        return self

    async def __aexit__(self, *_) -> None:
        await self.close()


def _json_or_empty(response) -> dict:
    """Aspire write-backs can return an empty body; treat that as ``{}``."""
    try:
        return response.json()
    except ValueError:
        return {}
