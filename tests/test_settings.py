"""Settings API — company + branch config writes with audit (Handoff 38, Slices 4–5).

Acceptance criteria under test (§6):

  Slice 4 (company):
    * A non-admin (manager) PATCH /api/settings/company → 403, even holding a
      token whose claim says admin: the WRITE path re-reads live role from the
      users table (Amendment B.2), so a stale/forged claim cannot widen scope.
    * An admin PATCH updates company_settings AND writes exactly ONE config_audit
      row with scope_type='company', scope_id NULL, correct from/to/actor.
    * Editing an approval tier emits the UPDATE against approval_tiers and audits.

  Slice 5 (branch):
    * A manager scoped to branch [1403] PATCHing branch 3696 → 403; PATCHing
      1403 → 200 + audit. A branch id supplied in the body/path cannot widen
      scope beyond the caller's user_branches (scope comes from
      resolve_branch_scope, never the request).
    * admin (kind='all') may PATCH any branch → 200.
    * A crew-rate update writes branch_settings and audits from→to.

  Bug #3 (Decimal/datetime coercion):
    * GET /api/settings/company with a row containing Decimal and datetime values
      must return a fully JSON-serialisable response (Decimal → float,
      datetime → ISO string). json.dumps() must not raise.
    * PATCH /api/settings/company (the return path) has the same guarantee.
    * PATCH /api/settings/company/approval-tiers/{id} return path also coerced.
    * PATCH /api/settings/company/margin-bands/{id} return path also coerced.

  Bug #1 (ENTRA_CLIENT_SECRET missing):
    * GET /api/settings/users/directory when ENTRA_CLIENT_SECRET is absent from
      the environment returns 503 with an actionable detail string — NOT a 500
      KeyError.

DB fully mocked — patch api.settings.query / api.settings.execute, and
api.authz.query (the live role/scope re-reads live in authz).
"""
from __future__ import annotations

import json as _json
import os
from datetime import datetime
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402

client = TestClient(app)


def _user(role: str, **over) -> dict:
    u = {
        "id": "u1",
        "name": "Test User",
        "email": "test.user@juniperlandscaping.com",
        "role": role,
        "branch_id": "b1",
        "avatar_initials": "TU",
    }
    u.update(over)
    return u


@pytest.fixture
def as_role():
    """Override require_auth with an arbitrary token claim; auto-clears."""
    def _set(role: str, **over):
        app.dependency_overrides[require_auth] = lambda: _user(role, **over)
    yield _set
    app.dependency_overrides.clear()


def _live(role: str, active: int = 1) -> list[dict]:
    return [{"role": role, "active": active}]


# ── Slice 4: company settings ────────────────────────────────────────────────


class TestCompanySettingsAuth:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_manager_patch_company_403_even_with_admin_claim(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # Token CLAIMS admin, but the live users row says manager → must 403.
        as_role("admin")
        mock_authz_query.return_value = _live("manager")
        r = client.patch("/api/settings/company", json={"sla_return_window_days": 21})
        assert r.status_code == 403
        # No write may have happened.
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_patch_company_updates_and_audits_once(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # First query = read the current row (from_value source); return the
        # existing value for the key being changed.
        mock_query.return_value = [
            {
                "id": 1,
                "sla_return_window_days": 14,
                "sla_at_risk_threshold_days": 4,
                "discrepancy_threshold_pct": 0.10,
                "default_target_margin": 0.22,
                "default_win_probability": 0.20,
                "default_priority": "medium",
                "default_notify_bm_rd_on_return": 1,
            }
        ]
        r = client.patch(
            "/api/settings/company", json={"sla_return_window_days": 21}
        )
        assert r.status_code == 200

        # Two executes: the company_settings UPDATE and exactly ONE audit INSERT.
        update_sqls = [
            c.args[0] for c in mock_exec.await_args_list if "company_settings" in c.args[0]
        ]
        audit_sqls = [
            c for c in mock_exec.await_args_list if "config_audit" in c.args[0]
        ]
        assert len(update_sqls) == 1
        assert "UPDATE" in update_sqls[0].upper()
        assert len(audit_sqls) == 1, "exactly one config_audit row per write"

        audit_params = audit_sqls[0].args[1]
        flat = " ".join(str(p) for p in audit_params)
        assert "company" in flat
        assert "sla_return_window_days" in flat
        assert "14" in flat  # from_value (before)
        assert "21" in flat  # to_value (after)
        assert "test.user@juniperlandscaping.com" in flat  # actor

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_edit_approval_tier_writes_table_and_audits(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Read of the tier being edited (from_value source).
        mock_query.return_value = [
            {"id": "tier-1", "max_value_cents": 10_000_000}
        ]
        r = client.patch(
            "/api/settings/company/approval-tiers/tier-1",
            json={"max_value_cents": 25_000_000},
        )
        assert r.status_code == 200

        tier_updates = [
            c.args[0]
            for c in mock_exec.await_args_list
            if "approval_tiers" in c.args[0] and "UPDATE" in c.args[0].upper()
        ]
        audit_sqls = [
            c for c in mock_exec.await_args_list if "config_audit" in c.args[0]
        ]
        assert len(tier_updates) == 1
        assert len(audit_sqls) == 1
        flat = " ".join(str(p) for p in audit_sqls[0].args[1])
        assert "10000000" in flat and "25000000" in flat


# ── Slice 5: branch settings + scope guard ───────────────────────────────────


class TestBranchSettingsScope:
    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_manager_out_of_scope_branch_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        # resolve_branch_scope reads user_branches via authz.query → only 1403.
        mock_authz_query.return_value = [{"aspire_branch_id": 1403}]
        r = client.patch(
            "/api/settings/branch/3696",
            json={"crew_rate_cents_per_hour": 20000},
        )
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_manager_in_scope_branch_200_and_audits(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = [{"aspire_branch_id": 1403}]
        # Read the current crew rate (from_value source).
        mock_query.return_value = [{"crew_rate_cents_per_hour": 18000}]
        r = client.patch(
            "/api/settings/branch/1403",
            json={"crew_rate_cents_per_hour": 20000},
        )
        assert r.status_code == 200

        bs_updates = [
            c for c in mock_exec.await_args_list if "branch_settings" in c.args[0]
        ]
        audit_sqls = [
            c for c in mock_exec.await_args_list if "config_audit" in c.args[0]
        ]
        assert len(bs_updates) == 1
        assert len(audit_sqls) == 1
        flat = " ".join(str(p) for p in audit_sqls[0].args[1])
        assert "branch" in flat
        assert "1403" in flat  # scope_id
        assert "18000" in flat and "20000" in flat  # from → to

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_body_supplied_branch_cannot_widen_scope(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # Manager scoped to 1403 hits /branch/3696 — the path/body naming another
        # branch must not grant access. Scope comes from user_branches only.
        as_role("manager")
        mock_authz_query.return_value = [{"aspire_branch_id": 1403}]
        r = client.patch(
            "/api/settings/branch/3696",
            json={"crew_rate_cents_per_hour": 99999, "aspire_branch_id": 1403},
        )
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_patches_any_branch_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        # admin → resolve_branch_scope returns kind='all' without touching
        # user_branches; still, keep authz.query benign.
        mock_authz_query.return_value = []
        mock_query.return_value = [{"crew_rate_cents_per_hour": 18000}]
        r = client.patch(
            "/api/settings/branch/3696",
            json={"crew_rate_cents_per_hour": 21000},
        )
        assert r.status_code == 200
        bs_updates = [
            c for c in mock_exec.await_args_list if "branch_settings" in c.args[0]
        ]
        assert len(bs_updates) == 1


# ── Slice 9: manageable-branches list (GET /api/settings/branches) ────────────


class TestManageableBranchesList:
    """The section-nav branch picker's data source.

    Returns the operating branches the caller may MANAGE:
      * admin (scope kind='all') → every operating branch,
      * BM/RD (scope kind='branch') → only their user_branches operating
        branches,
      * a user with zero branches (kind='none') → [].
    The operating-roster filter (active=1 AND branch_name NOT LIKE '%DO NOT
    USE%') lives in the SQL so the 21-of-56 non-office rows never reach the UI.
    """

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_gets_all_operating_branches_filtered_in_sql(
        self, mock_query, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = []  # admin → kind='all', not consulted
        mock_query.return_value = [
            {"aspire_branch_id": 1403, "branch_name": "Bonita Springs", "city": "Bonita Springs"},
            {"aspire_branch_id": 3696, "branch_name": "Fort Myers", "city": "Fort Myers"},
        ]
        r = client.get("/api/settings/branches")
        assert r.status_code == 200
        body = r.json()
        assert [b["aspireBranchId"] for b in body] == [1403, 3696]
        assert body[0]["branchName"] == "Bonita Springs"

        # The operating-roster filter is in the WHERE clause (server-side).
        sql = mock_query.await_args_list[0].args[0]
        assert "active = 1" in sql
        assert "NOT LIKE" in sql and "DO NOT USE" in sql

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_manager_gets_only_their_user_branches(
        self, mock_query, mock_authz_query, as_role
    ):
        as_role("manager")
        # resolve_branch_scope reads user_branches (via authz.query) → [1403].
        mock_authz_query.return_value = [{"aspire_branch_id": 1403}]
        mock_query.return_value = [
            {"aspire_branch_id": 1403, "branch_name": "Bonita Springs", "city": "Bonita Springs"},
        ]
        r = client.get("/api/settings/branches")
        assert r.status_code == 200
        assert [b["aspireBranchId"] for b in r.json()] == [1403]

        # The scoped branch id is a parameterized filter, not interpolated.
        call = mock_query.await_args_list[0]
        sql, params = call.args[0], call.args[1]
        assert "aspire_branch_id IN" in sql
        assert 1403 in params

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_user_with_no_branches_gets_empty_list(
        self, mock_query, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = []  # zero user_branches → kind='none'
        r = client.get("/api/settings/branches")
        assert r.status_code == 200
        assert r.json() == []
        # Short-circuits before hitting the branches table.
        mock_query.assert_not_awaited()


# ── Bug #3: Decimal/datetime coercion in company settings responses ───────────


# A realistic DB row with the Decimal and datetime types that aiomysql returns
# for DECIMAL/DATETIME columns.  json.dumps() raises on these without coercion.
_COMPANY_ROW_WITH_TYPED_COLS = {
    "id": 1,
    "sla_return_window_days": 14,
    "sla_at_risk_threshold_days": 4,
    "discrepancy_threshold_pct": Decimal("0.1000"),
    "default_target_margin": Decimal("0.2200"),
    "default_win_probability": Decimal("0.2000"),
    "default_priority": "medium",
    "default_notify_bm_rd_on_return": 1,
    "updated_at": datetime(2026, 8, 15, 12, 0, 0),
}


class TestCompanySettingsCoercion:
    """Bug #3: GET and PATCH /api/settings/company must JSON-serialize Decimal/datetime."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_get_company_settings_is_json_serializable(
        self, mock_query, mock_authz_query, as_role
    ):
        """Decimal and datetime columns must be coerced before the response is built.

        Without coercion FastAPI will raise a 500 when it tries to serialise
        the Decimal/datetime objects.  This test asserts both that the HTTP
        status is 200 and that the raw dict is json.dumps()-safe.
        """
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_COMPANY_ROW_WITH_TYPED_COLS]

        r = client.get("/api/settings/company")
        assert r.status_code == 200, r.text

        body = r.json()
        # Must not raise — i.e. the body was already serialised successfully.
        _json.dumps(body)

        # Decimal → float round-trip check.
        assert body["discrepancy_threshold_pct"] == pytest.approx(0.1, rel=1e-3)
        assert body["default_target_margin"] == pytest.approx(0.22, rel=1e-3)
        # datetime → ISO string.
        assert isinstance(body["updated_at"], str)
        assert "2026-08-15" in body["updated_at"]

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_patch_company_settings_return_is_json_serializable(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """The PATCH return path (refreshed[0]) must also be Decimal/datetime-safe."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Both the pre-read (from_value) and the post-write re-read return the
        # same typed row — simulates a real DB round-trip.
        mock_query.return_value = [_COMPANY_ROW_WITH_TYPED_COLS]

        r = client.patch(
            "/api/settings/company", json={"sla_return_window_days": 21}
        )
        assert r.status_code == 200, r.text

        body = r.json()
        _json.dumps(body)  # must not raise

        assert isinstance(body.get("discrepancy_threshold_pct"), float)
        assert isinstance(body.get("updated_at"), str)

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_patch_approval_tier_return_is_json_serializable(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """PATCH approval-tier response must coerce Decimal/datetime columns."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [
            {
                "id": "tier-1",
                "label": "Tier 1",
                "min_value_cents": 0,
                "max_value_cents": 10_000_000,
                "tier_order": 1,
                "updated_at": datetime(2026, 8, 1, 9, 30, 0),
            }
        ]

        r = client.patch(
            "/api/settings/company/approval-tiers/tier-1",
            json={"max_value_cents": 25_000_000},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        _json.dumps(body)  # must not raise
        assert isinstance(body.get("updated_at"), str)

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_patch_margin_band_return_is_json_serializable(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """PATCH margin-band response must coerce Decimal/datetime columns."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [
            {
                "id": "band-1",
                "good_min": Decimal("0.3000"),
                "ok_min": Decimal("0.2000"),
                "updated_at": datetime(2026, 7, 20, 14, 0, 0),
            }
        ]

        r = client.patch(
            "/api/settings/company/margin-bands/band-1",
            json={"good_min": 0.32},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        _json.dumps(body)  # must not raise
        assert isinstance(body.get("good_min"), float)
        assert isinstance(body.get("updated_at"), str)


# ── Bug #1: graceful 503 when ENTRA_CLIENT_SECRET is absent ──────────────────


class TestDirectorySearchMissingSecret:
    """Bug #1: /api/settings/users/directory must return 503 (not 500 KeyError)
    when ENTRA_CLIENT_SECRET is not set in the environment.
    """

    @patch("api.authz.query", new_callable=AsyncMock)
    async def test_directory_search_503_when_secret_unset(
        self, mock_authz_query, as_role, monkeypatch
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")

        # Remove the secret from the environment to simulate a mis-configured server.
        monkeypatch.delenv("ENTRA_CLIENT_SECRET", raising=False)

        r = client.get("/api/settings/users/directory", params={"q": "Carlos"})

        assert r.status_code == 503, (
            f"Expected 503, got {r.status_code}. Body: {r.text}"
        )
        detail = r.json().get("detail", "")
        assert "ENTRA_CLIENT_SECRET" in detail, (
            f"Detail should name the missing var; got: {detail!r}"
        )
