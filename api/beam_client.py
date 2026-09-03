"""Attentive AI ("Beam") takeoff REST API client — transport only.

Mirrors api/aspire_client.py: credentials resolved from the environment at call
time and never stored on ``self``, typed errors rather than FastAPI exceptions
(api.beam_sync is best-effort and must mark a row failed instead of surfacing a
502), and an injectable httpx client so tests can pass a mock.

Divergence from the Aspire client: auth is a static bearer token, so there is no
token fetch and no 401-refresh retry — a 401 is terminal.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

_PROD_BASE_URL = "https://falcon-back.attentive.ai/api"
_STAGE_BASE_URL = "https://aerial-stage.falcon-back.attentive.ai/api"


def beam_env() -> str:
    """Which Attentive environment to talk to: ``stage`` or ``prod`` (default)."""
    return os.environ.get("BEAM_ENV", "prod").strip().lower()


def _resolve_base_url(env: str) -> str:
    if env == "stage":
        return os.environ.get("ATTENTIVE_STAGE_BASE_URL", _STAGE_BASE_URL)
    return os.environ.get("ATTENTIVE_BASE_URL", _PROD_BASE_URL)


def _resolve_api_key(env: str) -> str:
    """The server-side bearer token. This token spends money — never ship it to a browser."""
    return os.environ["ATTENTIVE_STAGE_API_KEY" if env == "stage" else "ATTENTIVE_API_KEY"]


# ── Typed errors ─────────────────────────────────────────────────────────────

class BeamError(Exception):
    """Base for all Attentive transport failures."""


class BeamAuthError(BeamError):
    """Missing API key, or a 401/403 from Attentive."""


class BeamHTTPError(BeamError):
    """A non-2xx response from an Attentive API call."""

    def __init__(self, status_code: int, detail: str = "") -> None:
        self.status_code = status_code
        super().__init__(f"Attentive returned {status_code}: {detail}")


class BeamUnreachable(BeamError):
    """A network-level failure reaching Attentive."""


# ── Client ───────────────────────────────────────────────────────────────────

class BeamClient:
    def __init__(self, client: Optional[httpx.AsyncClient] = None) -> None:
        self._client = client if client is not None else httpx.AsyncClient(timeout=60.0)
        self._env = beam_env()
        self._base_url = _resolve_base_url(self._env)

    def _auth_headers(self) -> dict:
        try:
            api_key = _resolve_api_key(self._env)
        except KeyError as exc:
            raise BeamAuthError(f"missing Attentive credential env var: {exc}") from exc
        return {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def _request(
        self, verb: str, path: str, *, params: Optional[dict] = None, body: Optional[dict] = None
    ) -> Any:
        headers = self._auth_headers()
        url = f"{self._base_url}{path}"
        try:
            method = getattr(self._client, verb)
            if verb == "get":
                response = await method(url, headers=headers, params=params or {})
            else:
                response = await method(url, headers=headers, json=body or {})
        except httpx.RequestError as exc:
            raise BeamUnreachable(f"{verb.upper()} {path} unreachable: {exc}") from exc

        if response.status_code in (401, 403):
            raise BeamAuthError(f"{response.status_code} from {verb.upper()} {path}")
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise BeamHTTPError(exc.response.status_code, response.text[:500]) from exc
        return _json_or_empty(response)

    # ── Endpoints ────────────────────────────────────────────────────────────

    async def create_request(
        self, *, name: str, address: str, downstream_id: str, is_manual: bool = False
    ) -> dict:
        """Create a DRAFT takeoff request. Does not order or bill — see the generate gate."""
        return await self._request(
            "post",
            "/enterprise/requests/",
            body={
                "name": name,
                "input": {"address": address},
                "is_manual": is_manual,
                "downstream_metadata": {"id": downstream_id},
            },
        )

    async def generate_request(self, request_id: str, *, address: str, report_id: str) -> dict:
        """Order the takeoff. THE ONLY BILLABLE CALL IN THE CODEBASE.

        Note the path is outside the ``/enterprise/`` namespace the rest of this
        client uses — this is the same route the Beam portal's own Generate
        button calls, and it is what raises the ``request_generate`` callback.
        ``execution_start_time`` is required by the serializer but Attentive
        schedules the work itself, so the value we send is not honoured.
        """
        return await self._request(
            "post",
            f"/requests/{request_id}/generate/",
            body={
                "input": {"address": address},
                "execution_start_time": datetime.now(timezone.utc).isoformat(),
                "feature_report": {"id": report_id},
            },
        )

    async def get_report_types(self) -> Any:
        """The report types this account is provisioned for. Supplies generate's report_id."""
        return await self._request("get", "/requests/reports/")

    async def get_quoted_cost(self, *, report_id: str, acreage: float, sites: int = 1) -> Any:
        """What ordering will cost, without ordering. Free, and the input to the spend gate."""
        return await self._request(
            "get",
            "/bulk_takeoff/pricing/",
            params={"report_id": report_id, "sites": sites, "acreage": acreage},
        )

    async def get_request(self, request_id: str) -> dict:
        """Status, cost (cents), eta (seconds), queue order, parcel area, downstream_metadata."""
        return await self._request("get", f"/enterprise/requests/{request_id}/")

    async def get_outputs(self, request_id: str) -> Any:
        """Per-feature measurements. Authoritative source — callbacks are notifications only."""
        return await self._request("get", f"/enterprise/requests/{request_id}/outputs/")

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "BeamClient":
        return self

    async def __aexit__(self, *_) -> None:
        await self.close()


def _json_or_empty(response) -> Any:
    try:
        return response.json()
    except ValueError:
        return {}
