"""Tests for api/aspire_client.py — transport only. All HTTP is mocked.

The client is the ONLY Aspire-transport-aware module besides aspire_sync; it
ports the sibling AspireClient (async httpx, /Authorization token, 401-refresh
retry) and adds patch/put for status write-back. Errors are raised as typed
AspireError subclasses so the best-effort port can catch them without surfacing
a 502 to the estimator.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

os.environ.setdefault("ASPIRE_CLIENT_ID", "test-client")
os.environ.setdefault("ASPIRE_SECRET", "test-secret")

import api.aspire_client as ac  # noqa: E402
from api.aspire_client import (  # noqa: E402
    AspireClient,
    AspireError,
    AspireHTTPError,
    AspireUnreachable,
    AspireAuthError,
)


def _resp(*, status=200, json_data=None, raise_exc=None):
    r = MagicMock()
    r.status_code = status
    if raise_exc is not None:
        r.raise_for_status = MagicMock(side_effect=raise_exc)
    else:
        r.raise_for_status = MagicMock()
    r.json = MagicMock(return_value=json_data if json_data is not None else {})
    return r


def _mock_client(**methods) -> MagicMock:
    """A stand-in httpx.AsyncClient whose verb methods are AsyncMocks."""
    client = MagicMock()
    for verb in ("get", "post", "patch", "put"):
        client.__setattr__(verb, methods.get(verb, AsyncMock()))
    client.aclose = AsyncMock()
    return client


class TestTokenFetch:
    async def test_first_call_fetches_token_and_sets_bearer(self):
        http = _mock_client(
            post=AsyncMock(return_value=_resp(json_data={"Token": "abc123"})),
            get=AsyncMock(return_value=_resp(json_data={"ok": True})),
        )
        client = AspireClient(client=http)
        out = await client.get("/Opportunities")

        assert out == {"ok": True}
        # Token fetched via POST /Authorization with env creds
        auth_call = http.post.call_args
        assert auth_call.args[0].endswith("/Authorization")
        assert auth_call.kwargs["json"] == {"ClientId": "test-client", "Secret": "test-secret"}
        # Bearer applied to the GET
        headers = http.get.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer abc123"

    async def test_token_reused_across_calls(self):
        http = _mock_client(
            post=AsyncMock(return_value=_resp(json_data={"Token": "abc123"})),
            get=AsyncMock(return_value=_resp(json_data={})),
        )
        client = AspireClient(client=http)
        await client.get("/A")
        await client.get("/B")
        # Only one token fetch for two calls
        assert http.post.call_count == 1

    async def test_missing_credentials_raises_auth_error(self, monkeypatch):
        monkeypatch.delenv("ASPIRE_CLIENT_ID", raising=False)
        http = _mock_client(post=AsyncMock(return_value=_resp(json_data={"Token": "x"})))
        client = AspireClient(client=http)
        with pytest.raises(AspireAuthError):
            await client.get("/Opportunities")


class TestVerbs:
    async def test_post_sends_body(self):
        http = _mock_client(post=AsyncMock(return_value=_resp(json_data={"OpportunityID": 7})))
        client = AspireClient(client=http)
        client._token = "tok"  # skip token fetch
        out = await client.post("/Opportunity", {"OpportunityName": "X"})
        assert out == {"OpportunityID": 7}
        assert http.post.call_args.kwargs["json"] == {"OpportunityName": "X"}

    async def test_patch_hits_patch_verb(self):
        http = _mock_client(patch=AsyncMock(return_value=_resp(json_data={})))
        client = AspireClient(client=http)
        client._token = "tok"
        await client.patch("/Opportunity/7", {"OpportunityStatusID": 1658})
        assert http.patch.called
        assert http.patch.call_args.kwargs["json"] == {"OpportunityStatusID": 1658}

    async def test_put_hits_put_verb(self):
        http = _mock_client(put=AsyncMock(return_value=_resp(json_data={})))
        client = AspireClient(client=http)
        client._token = "tok"
        await client.put("/Opportunity/7", {"OpportunityStatusID": 1659})
        assert http.put.called

    async def test_empty_body_response_returns_dict(self):
        # Aspire write-backs may return an empty body — json() raising must not crash.
        resp = _resp()
        resp.json = MagicMock(side_effect=ValueError("no json"))
        http = _mock_client(patch=AsyncMock(return_value=resp))
        client = AspireClient(client=http)
        client._token = "tok"
        out = await client.patch("/Opportunity/7", {"x": 1})
        assert out == {}


class TestRetryAndErrors:
    async def test_401_refreshes_token_and_retries_once(self):
        resp401 = _resp(status=401)
        resp200 = _resp(status=200, json_data={"ok": True})
        http = _mock_client(
            get=AsyncMock(side_effect=[resp401, resp200]),
            post=AsyncMock(side_effect=[
                _resp(json_data={"Token": "first"}),
                _resp(json_data={"Token": "second"}),
            ]),
        )
        client = AspireClient(client=http)
        out = await client.get("/Opportunities")
        assert out == {"ok": True}
        assert http.get.call_count == 2          # retried
        assert http.post.call_count == 2          # token re-fetched
        # second attempt used the refreshed token
        assert http.get.call_args_list[1].kwargs["headers"]["Authorization"] == "Bearer second"

    async def test_http_status_error_becomes_aspire_http_error(self):
        err = httpx.HTTPStatusError("boom", request=MagicMock(), response=MagicMock(status_code=500))
        http = _mock_client(
            post=AsyncMock(return_value=_resp(json_data={"Token": "t"})),
            get=AsyncMock(return_value=_resp(status=500, raise_exc=err)),
        )
        client = AspireClient(client=http)
        with pytest.raises(AspireHTTPError) as exc:
            await client.get("/Opportunities")
        assert exc.value.status_code == 500
        assert isinstance(exc.value, AspireError)

    async def test_network_error_becomes_unreachable(self):
        http = _mock_client(
            post=AsyncMock(return_value=_resp(json_data={"Token": "t"})),
            get=AsyncMock(side_effect=httpx.ConnectError("down")),
        )
        client = AspireClient(client=http)
        with pytest.raises(AspireUnreachable) as exc:
            await client.get("/Opportunities")
        assert isinstance(exc.value, AspireError)


class TestLifecycle:
    async def test_close_closes_underlying_client(self):
        http = _mock_client()
        client = AspireClient(client=http)
        await client.close()
        assert http.aclose.called

    async def test_async_context_manager(self):
        http = _mock_client()
        async with AspireClient(client=http) as client:
            assert client is not None
        assert http.aclose.called


class TestEnvironmentSelection:
    """ASPIRE_ENV picks the host and the credential pair.

    These monkeypatch ASPIRE_ENV explicitly rather than leaning on whatever the
    process happens to have. Before tests/conftest.py pinned it, the ambient
    value from a developer's .env decided which branch ran — which is how the
    real ASPIRE_SANDBOX_SECRET ended up in a failure message. Deciding it per
    test means both branches are covered and neither depends on the machine.
    """

    def test_defaults_to_prod_when_unset(self, monkeypatch):
        monkeypatch.delenv("ASPIRE_ENV", raising=False)
        assert ac._resolve_env() == "prod"

    def test_reads_and_normalises_the_env_var(self, monkeypatch):
        monkeypatch.setenv("ASPIRE_ENV", "  SandBox  ")
        assert ac._resolve_env() == "sandbox"

    def test_prod_uses_the_prod_credential_pair(self, monkeypatch):
        monkeypatch.setenv("ASPIRE_CLIENT_ID", "prod-id")
        monkeypatch.setenv("ASPIRE_SECRET", "prod-secret")
        assert ac._resolve_credentials("prod") == ("prod-id", "prod-secret")

    def test_sandbox_uses_the_sandbox_credential_pair(self, monkeypatch):
        monkeypatch.setenv("ASPIRE_SANDBOX_CLIENT_ID", "sbx-id")
        monkeypatch.setenv("ASPIRE_SANDBOX_SECRET", "sbx-secret")
        assert ac._resolve_credentials("sandbox") == ("sbx-id", "sbx-secret")

    def test_sandbox_never_falls_back_to_prod_credentials(self, monkeypatch):
        """A missing sandbox credential must fail, not silently hit production."""
        monkeypatch.delenv("ASPIRE_SANDBOX_CLIENT_ID", raising=False)
        monkeypatch.setenv("ASPIRE_CLIENT_ID", "prod-id")
        with pytest.raises(KeyError):
            ac._resolve_credentials("sandbox")

    def test_base_url_follows_the_environment(self, monkeypatch):
        monkeypatch.setenv("ASPIRE_SANDBOX_BASE_URL", "https://sandbox.example")
        monkeypatch.setenv("ASPIRE_BASE_URL", "https://prod.example")
        assert ac._resolve_base_url("sandbox") == "https://sandbox.example"
        assert ac._resolve_base_url("prod") == "https://prod.example"
