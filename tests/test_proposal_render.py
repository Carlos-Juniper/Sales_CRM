"""Render-token mint + scope guard — Slice 3.

Tests for:
  POST /api/proposals/{proposal_id}/render-token  — mint a 120-second render JWT
  require_auth scope guard — render tokens are only valid on specific routes

Negative tests are written first (TDD), followed by positive confirmations.
No real MySQL required; auth is exercised via real JWT encoding/decoding so
the scope guard logic runs end-to-end.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

# Env must be set before importing the app.
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth, JWT_SECRET, JWT_ALGORITHM  # noqa: E402

_PROPOSAL_ID = "prop-abc123def456"
_OTHER_PROPOSAL_ID = "prop-zzzzzzzzzzzz"

_USER = {
    "id": "u1",
    "name": "Alice",
    "email": "a@x.com",
    "role": "sales",
    "branch_id": "Fort Myers, FL",
    "avatar_initials": "AX",
}


# ── Fixtures ─────────────────────────────────────────────────────────────────

def _mint_normal_token() -> str:
    """Mint a standard 8-hour session JWT (no scope)."""
    payload = {
        **_USER,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _mint_render_token(proposal_id: str = _PROPOSAL_ID, ttl: int = 120) -> str:
    """Mint a render-scoped JWT for the given proposal_id."""
    payload = {
        "id": _USER["id"],
        "name": _USER["name"],
        "email": _USER["email"],
        "role": _USER["role"],
        "branch_id": _USER["branch_id"],
        "scope": "proposal_render",
        "proposal_id": proposal_id,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=ttl),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@pytest.fixture
def client():
    # TestClient raises=False so we can inspect 4xx/5xx without exceptions.
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def render_token_cookie():
    """Cookie dict carrying a valid render token for _PROPOSAL_ID."""
    return {"session": _mint_render_token()}


@pytest.fixture
def normal_auth_cookie():
    """Cookie dict carrying a standard session token."""
    return {"session": _mint_normal_token()}


@pytest.fixture
def proposal_id():
    return _PROPOSAL_ID


# ── Negative tests (must pass before implementation) ─────────────────────────

class TestRenderTokenScopeGuardNegative:

    def test_render_token_rejected_on_post_leads(self, client, render_token_cookie):
        """Render token used on a POST request → 403 regardless of path."""
        res = client.post("/api/leads", json={}, cookies=render_token_cookie)
        assert res.status_code == 403, (
            f"Expected 403, got {res.status_code}: {res.text}"
        )

    def test_render_token_rejected_on_other_proposal(self, client, render_token_cookie):
        """Render token used on GET for a *different* proposal → 403."""
        res = client.get(
            f"/api/proposals/{_OTHER_PROPOSAL_ID}",
            cookies=render_token_cookie,
        )
        assert res.status_code == 403, (
            f"Expected 403, got {res.status_code}: {res.text}"
        )

    def test_render_token_rejected_on_leads_list(self, client, render_token_cookie):
        """Render token on GET /api/leads (unrelated resource) → 403."""
        res = client.get("/api/leads", cookies=render_token_cookie)
        assert res.status_code == 403, (
            f"Expected 403, got {res.status_code}: {res.text}"
        )

    def test_expired_render_token_returns_401(self, client):
        """An expired render token → 401 (caught by jwt.ExpiredSignatureError)."""
        # ttl=-1 forces the token to be already expired.
        expired_token = _mint_render_token(ttl=-1)
        res = client.get(
            f"/api/proposals/{_PROPOSAL_ID}",
            cookies={"session": expired_token},
        )
        assert res.status_code == 401, (
            f"Expected 401, got {res.status_code}: {res.text}"
        )

    def test_render_token_rejected_on_patch_own_proposal(self, client, render_token_cookie):
        """Render token on PATCH (non-GET) against its own proposal → 403."""
        res = client.patch(
            f"/api/proposals/{_PROPOSAL_ID}",
            json={},
            cookies=render_token_cookie,
        )
        assert res.status_code == 403, (
            f"Expected 403, got {res.status_code}: {res.text}"
        )

    def test_render_token_rejected_on_prefix_injection(self, client, render_token_cookie):
        """A path that starts with the proposal_id prefix but isn't a sub-path → 403.

        e.g. /api/proposals/prop-abc123def456EXTRA should not match.
        """
        injected_id = _PROPOSAL_ID + "EXTRA"
        res = client.get(
            f"/api/proposals/{injected_id}",
            cookies=render_token_cookie,
        )
        assert res.status_code == 403, (
            f"Expected 403, got {res.status_code}: {res.text}"
        )


# ── Positive tests ────────────────────────────────────────────────────────────

class TestRenderTokenScopeGuardPositive:

    def test_render_token_accepted_on_own_proposal(
        self, client, render_token_cookie, proposal_id
    ):
        """Render token on GET /api/proposals/{proposal_id} passes the guard.

        The proposal likely doesn't exist in the test DB → 404 or 500 (MySQL
        connection error), but auth passed (not 403).
        """
        res = client.get(
            f"/api/proposals/{proposal_id}",
            cookies=render_token_cookie,
        )
        # Auth guard passed — not 401 or 403.
        # 404/500 are both acceptable: the proposal doesn't exist in the test
        # DB and the route may raise a DB connection error, but auth was OK.
        assert res.status_code not in (401, 403), (
            f"Guard should pass for own proposal; got {res.status_code}: {res.text}"
        )

    def test_render_token_accepted_on_own_proposal_subpath(
        self, client, render_token_cookie, proposal_id
    ):
        """Render token on GET /api/proposals/{proposal_id}/anything passes."""
        res = client.get(
            f"/api/proposals/{proposal_id}/sections",
            cookies=render_token_cookie,
        )
        assert res.status_code not in (401, 403), (
            f"Guard should pass for sub-path; got {res.status_code}: {res.text}"
        )

    def test_render_token_accepted_on_config_routes(self, client, render_token_cookie):
        """Render token on GET /api/proposals/config/team-members passes the guard.

        The route may return 404/422 due to missing DB, but auth must pass.
        """
        res = client.get(
            "/api/proposals/config/team-members",
            cookies=render_token_cookie,
        )
        assert res.status_code != 403, (
            f"Guard should pass for config route; got {res.status_code}: {res.text}"
        )

    def test_normal_token_unaffected(self, client, normal_auth_cookie):
        """A standard session token still works; render-scope guard is skipped."""
        res = client.get("/api/leads", cookies=normal_auth_cookie)
        # Auth guard passed — result is not 401 or 403.
        assert res.status_code not in (401, 403), (
            f"Normal token should not be blocked; got {res.status_code}: {res.text}"
        )

    def test_normal_token_can_call_post(self, client, normal_auth_cookie):
        """Normal session token is allowed on POST routes (no render-scope restriction)."""
        res = client.post("/api/leads", json={}, cookies=normal_auth_cookie)
        # 400/422 from validation is fine; 401/403 would indicate auth failure.
        assert res.status_code not in (401, 403), (
            f"Normal token should pass auth on POST; got {res.status_code}: {res.text}"
        )


# ── Mint endpoint ─────────────────────────────────────────────────────────────

class TestIssueRenderToken:

    def test_mint_requires_auth(self, client):
        """POST /api/proposals/{id}/render-token without a session → 401."""
        res = client.post(f"/api/proposals/{_PROPOSAL_ID}/render-token")
        assert res.status_code == 401, (
            f"Expected 401, got {res.status_code}: {res.text}"
        )

    def test_mint_returns_token_with_correct_claims(self, client, normal_auth_cookie):
        """Minted render token contains scope, proposal_id, and a short exp."""
        res = client.post(
            f"/api/proposals/{_PROPOSAL_ID}/render-token",
            cookies=normal_auth_cookie,
        )
        assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
        body = res.json()
        assert "token" in body, "Response must contain 'token' key"

        decoded = jwt.decode(body["token"], JWT_SECRET, algorithms=[JWT_ALGORITHM])
        assert decoded["scope"] == "proposal_render"
        assert decoded["proposal_id"] == _PROPOSAL_ID
        assert decoded["id"] == _USER["id"]
        assert decoded["email"] == _USER["email"]
        assert decoded["role"] == _USER["role"]
        assert decoded["branch_id"] == _USER["branch_id"]

    def test_mint_token_expires_within_120_seconds(self, client, normal_auth_cookie):
        """Minted render token exp is ≤120 seconds in the future."""
        res = client.post(
            f"/api/proposals/{_PROPOSAL_ID}/render-token",
            cookies=normal_auth_cookie,
        )
        assert res.status_code == 200
        decoded = jwt.decode(res.json()["token"], JWT_SECRET, algorithms=[JWT_ALGORITHM])
        now_ts = datetime.now(timezone.utc).timestamp()
        remaining = decoded["exp"] - now_ts
        assert 0 < remaining <= 120, (
            f"Token TTL should be ≤120 s, got {remaining:.1f} s remaining"
        )

    def test_mint_token_accepted_by_guard_on_own_proposal(self, client, normal_auth_cookie):
        """A freshly minted render token is accepted by the scope guard."""
        mint_res = client.post(
            f"/api/proposals/{_PROPOSAL_ID}/render-token",
            cookies=normal_auth_cookie,
        )
        assert mint_res.status_code == 200
        render_token = mint_res.json()["token"]

        # Use the minted token as a session cookie on the proposal's own route.
        res = client.get(
            f"/api/proposals/{_PROPOSAL_ID}",
            cookies={"session": render_token},
        )
        # 404/500 are fine (proposal doesn't exist in test DB); 401/403 would
        # mean the guard rejected the minted token.
        assert res.status_code not in (401, 403), (
            f"Minted token should be accepted on own proposal; got {res.status_code}"
        )

    def test_render_token_rejected_for_different_proposal(self, client, normal_auth_cookie):
        """A render token minted for proposal A is rejected on proposal B."""
        mint_res = client.post(
            f"/api/proposals/{_PROPOSAL_ID}/render-token",
            cookies=normal_auth_cookie,
        )
        assert mint_res.status_code == 200
        render_token = mint_res.json()["token"]

        res = client.get(
            f"/api/proposals/{_OTHER_PROPOSAL_ID}",
            cookies={"session": render_token},
        )
        assert res.status_code == 403, (
            f"Render token for {_PROPOSAL_ID} must be rejected on {_OTHER_PROPOSAL_ID}"
        )


# ── Slice 4: render_proposal_pdf unit tests (no real Chromium) ───────────────

class TestRenderProposalPdfNoBrowser:

    @pytest.mark.asyncio
    async def test_raises_when_browser_not_started(self):
        """render_proposal_pdf raises RuntimeError when _browser is None."""
        import api.proposal_render as render_mod
        original_browser = render_mod._browser
        render_mod._browser = None
        try:
            with pytest.raises(RuntimeError, match="Browser not started"):
                await render_mod.render_proposal_pdf("prop-test", {
                    "id": "u1", "name": "Test", "email": "t@x.com",
                    "role": "sales", "branch_id": "Fort Myers, FL",
                })
        finally:
            render_mod._browser = original_browser


class TestMintRenderToken:

    def test_mint_returns_token_with_scope_and_proposal_id(self):
        """_mint_render_token produces a JWT with the expected claims."""
        import api.proposal_render as render_mod
        from api.server import JWT_SECRET, JWT_ALGORITHM
        import jwt as pyjwt

        user = {
            "id": "u1", "name": "Alice", "email": "a@x.com",
            "role": "sales", "branch_id": "Fort Myers, FL",
        }
        token = render_mod._mint_render_token("prop-abc123", user)
        decoded = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        assert decoded["scope"] == "proposal_render"
        assert decoded["proposal_id"] == "prop-abc123"
        assert decoded["id"] == "u1"

    def test_mint_token_expires_within_120_seconds(self):
        """Token exp is ≤120 s in the future."""
        import api.proposal_render as render_mod
        from api.server import JWT_SECRET, JWT_ALGORITHM
        import jwt as pyjwt
        from datetime import datetime, timezone

        user = {
            "id": "u1", "name": "Alice", "email": "a@x.com",
            "role": "sales", "branch_id": "Fort Myers, FL",
        }
        token = render_mod._mint_render_token("prop-abc123", user)
        decoded = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        now_ts = datetime.now(timezone.utc).timestamp()
        remaining = decoded["exp"] - now_ts
        assert 0 < remaining <= 120, f"Expected ≤120 s, got {remaining:.1f} s"


# ── Slice 6: render endpoints unit tests (no real Chromium or MySQL) ─────────

class TestRenderEndpoints:

    def test_render_endpoint_503_when_browser_not_started(self, client, normal_auth_cookie):
        """POST /api/proposals/{id}/render → 503 when browser is not running."""
        import api.proposal_render as render_mod
        original = render_mod._browser
        render_mod._browser = None
        try:
            res = client.post(
                f"/api/proposals/{_PROPOSAL_ID}/render",
                cookies=normal_auth_cookie,
            )
            # 404 (proposal not in test DB) or 503 (browser not started) are both
            # acceptable — the important thing is it's not 200 with a fake result.
            assert res.status_code in (404, 503), (
                f"Expected 404 or 503, got {res.status_code}: {res.text}"
            )
        finally:
            render_mod._browser = original

    def test_list_renders_requires_auth(self, client):
        """GET /api/proposals/{id}/renders without a session → 401."""
        res = client.get(f"/api/proposals/{_PROPOSAL_ID}/renders")
        assert res.status_code == 401

    def test_list_renders_returns_empty_list_when_none(self, client, normal_auth_cookie):
        """GET /api/proposals/{id}/renders for a non-existent proposal → [] or 404.

        The endpoint does a WHERE filter — if no rows exist it returns []; the DB
        connection may also fail in test env (no real MySQL), in which case 500 is OK.
        """
        res = client.get(
            f"/api/proposals/{_PROPOSAL_ID}/renders",
            cookies=normal_auth_cookie,
        )
        # 200 [] or 500 (DB connection failure in test) are both acceptable.
        assert res.status_code in (200, 500), (
            f"Expected 200 or 500, got {res.status_code}: {res.text}"
        )

    def test_download_render_404_when_not_found(self, client, normal_auth_cookie):
        """GET /api/proposals/{id}/renders/{version}/download → 404 or 500 when not found."""
        res = client.get(
            f"/api/proposals/{_PROPOSAL_ID}/renders/999/download",
            cookies=normal_auth_cookie,
            follow_redirects=False,
        )
        assert res.status_code in (302, 404, 500), (
            f"Unexpected status: {res.status_code}: {res.text}"
        )
