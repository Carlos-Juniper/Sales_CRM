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
        # PATCH /branch/{id} makes these queries in order:
        #   (1) read current crew rate (from_value), (2-5) get_branch_settings_payload
        #   payload queries: branch_settings, material_calcs branch, material_calcs company, catalog_items
        mock_query.side_effect = [
            [{"crew_rate_cents_per_hour": 18000}],  # (1) from_value read in PATCH
            [{"crew_rate_cents_per_hour": 20000}],  # (2) payload: branch_settings
            [],                                      # (3) payload: material_calcs branch
            [],                                      # (4) payload: material_calcs company
            [],                                      # (5) payload: catalog_items
        ]
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
        mock_query.side_effect = [
            [{"crew_rate_cents_per_hour": 18000}],  # (1) from_value read in PATCH
            [{"crew_rate_cents_per_hour": 21000}],  # (2) payload: branch_settings
            [],                                      # (3) payload: material_calcs branch
            [],                                      # (4) payload: material_calcs company
            [],                                      # (5) payload: catalog_items
        ]
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
    The operating-roster filter (active=1 AND branch_name NOT LIKE a bound
    '%DO NOT USE%' parameter) lives in the SQL so the 21-of-56 non-office
    rows never reach the UI.
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
        # The LIKE pattern is a bound parameter: an inlined '%DO NOT USE%' is a
        # Python format specifier once any other param is present.
        sql, params = mock_query.await_args_list[0].args
        assert "active = 1" in sql
        assert "NOT LIKE %s" in sql
        assert "%DO NOT USE%" not in sql
        assert params == ["%DO NOT USE%"]
        sql % tuple(params)

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
        # This is the path that 500'd: non-empty params make aiomysql %-format
        # the SQL, and an inlined '%DO NOT USE%' raises
        # ValueError: unsupported format character 'D'.
        call = mock_query.await_args_list[0]
        sql, params = call.args[0], call.args[1]
        assert "aspire_branch_id IN" in sql
        assert "%DO NOT USE%" not in sql
        assert params[0] == "%DO NOT USE%"
        assert 1403 in params
        formatted = sql % tuple(params)
        assert "DO NOT USE" in formatted
        assert "1403" in formatted

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


# ── Task #18: soft-delete parity — portfolio_properties + insurance_certificates


class TestPortfolioSoftDelete:
    """DELETE /api/settings/portfolio/{id} must UPDATE active=0, never hard DELETE.

    After migration 023, portfolio_properties gains an `active` column and the
    DELETE handler is converted from a hard DELETE to a soft-delete (active=0).
    The list endpoint filters active=1 by default; include_inactive=true returns
    all rows.
    """

    _EXISTING_ROW = {
        "id": "pp-001",
        "name": "Bonita Springs Estate",
        "city_state": "Bonita Springs, FL",
        "region_id": "east-coast",
        "photo_object_keys": "[]",
        "sort_order": 0,
        "active": 1,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_delete_emits_update_active_zero_never_hard_delete(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Core AC: DELETE /api/settings/portfolio/{id} must UPDATE active=0, NOT DELETE."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.delete("/api/settings/portfolio/pp-001")
        assert r.status_code == 200

        # Must emit UPDATE active=0 — never a hard DELETE on portfolio_properties.
        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "portfolio_properties" in c.args[0]
        ]
        hard_deletes = [
            c for c in mock_exec.await_args_list
            if "DELETE" in c.args[0].upper() and "portfolio_properties" in c.args[0]
        ]
        assert len(updates) == 1, "Expected exactly one UPDATE on portfolio_properties"
        assert len(hard_deletes) == 0, "Hard DELETE must never be issued for portfolio_properties"

        # The UPDATE params must include 0 (the active=0 value).
        update_params = updates[0].args[1]
        assert 0 in update_params

        # One config_audit row must be written.
        audits = [c for c in mock_exec.await_args_list if "config_audit" in c.args[0]]
        assert len(audits) == 1
        flat = " ".join(str(p) for p in audits[0].args[1])
        assert "company" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_list_portfolio_default_excludes_inactive(
        self, mock_query, mock_authz_query, as_role
    ):
        """Default GET /api/settings/portfolio must filter active=1."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = []
        r = client.get("/api/settings/portfolio")
        assert r.status_code == 200
        # Verify the SQL carries the active filter.
        sql = mock_query.call_args[0][0]
        assert "active = 1" in sql

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_list_portfolio_include_inactive_returns_all(
        self, mock_query, mock_authz_query, as_role
    ):
        """include_inactive=true must omit the active=1 filter."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        inactive_row = {**self._EXISTING_ROW, "active": 0}
        mock_query.return_value = [inactive_row]
        r = client.get("/api/settings/portfolio?include_inactive=true")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        # The inactive row is included.
        assert items[0]["name"] == "Bonita Springs Estate"


class TestInsuranceSoftDelete:
    """Handoff 42: Insurance soft-delete via unified /api/settings/licenses endpoint.

    After migration 033, insurance_certificates is dropped. Insurance documents
    live in licenses_certifications (kind='insurance') and use the same
    soft-delete path as licenses. The old /api/settings/insurance endpoints
    are removed.
    """

    # An insurance-kind row in licenses_certifications (post migration 033).
    _EXISTING_ROW = {
        "id": "ins-001",
        "kind": "insurance",
        "name": "General Liability",
        "issuing_body": None,
        "identifier": None,
        "holder_name": None,
        "aspire_branch_id": None,  # company-wide
        "issued_date": None,
        "expiry_date": "2027-06-30",
        "object_key": "credentials/insurance/ins-001.pdf",
        "active": 1,
        "sort_order": 0,
        "updated_at": "2026-06-01T12:00:00",
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_delete_emits_update_active_zero_never_hard_delete(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Core AC: DELETE /api/settings/licenses/{id} for insurance kind must
        UPDATE active=0 on licenses_certifications, never hard DELETE."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.delete("/api/settings/licenses/ins-001")
        assert r.status_code == 200

        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        hard_deletes = [
            c for c in mock_exec.await_args_list
            if "DELETE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        assert len(updates) == 1, "Expected exactly one UPDATE on licenses_certifications"
        assert len(hard_deletes) == 0, "Hard DELETE must never be issued for licenses_certifications"

        update_params = updates[0].args[1]
        assert 0 in update_params

        audits = [c for c in mock_exec.await_args_list if "config_audit" in c.args[0]]
        assert len(audits) == 1
        flat = " ".join(str(p) for p in audits[0].args[1])
        assert "company" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_list_insurance_default_excludes_inactive(
        self, mock_query, mock_authz_query, as_role
    ):
        """Default GET /api/settings/licenses must filter active=1 (covers insurance rows)."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = []
        r = client.get("/api/settings/licenses")
        assert r.status_code == 200
        sql = mock_query.call_args[0][0]
        assert "active = 1" in sql

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_list_include_expired_returns_inactive_insurance(
        self, mock_query, mock_authz_query, as_role
    ):
        """include_expired=true must return inactive/expired rows including insurance kind."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        inactive_row = {**self._EXISTING_ROW, "active": 0}
        mock_query.return_value = [inactive_row]
        r = client.get("/api/settings/licenses?include_expired=true")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        # name carries the display label for insurance rows
        assert items[0]["name"] == "General Liability"
        assert items[0]["kind"] == "insurance"
        assert items[0]["active"] is False

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_old_insurance_list_endpoint_gone_404(
        self, mock_query, mock_authz_query, as_role
    ):
        """The old /api/settings/insurance endpoint must return 404 (removed)."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        r = client.get("/api/settings/insurance")
        assert r.status_code == 404


# ── Task #16: enrich GET /api/settings/branch/{id} ────────────────────────────


class TestBranchSettingsEnriched:
    """GET /api/settings/branch/{id} must return materialFactors and productionRates
    in addition to crewRateCentsPerHour, with source flags (override/inherited).

    Rules:
      - A branch with a material_calcs row where aspire_branch_id = X → source='override'.
      - A branch with no override row → returns the company-wide (NULL branch) row
        flagged source='inherited'.
      - productionRates: returns catalog_items.production_rate for items with a
        branch-level override or (if none) the base company value.
      - crewRateCentsPerHour is unchanged.
    """

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_branch_with_override_returns_override_flag(
        self, mock_query, mock_authz_query, as_role
    ):
        """A branch override row must come back flagged source='override'."""
        as_role("admin")
        mock_authz_query.return_value = []  # admin → kind='all'

        # 4 sequential query calls in get_branch_settings:
        #   (1) branch_settings, (2) material_calcs branch overrides,
        #   (3) material_calcs company-wide, (4) catalog_items
        branch_row = {"crew_rate_cents_per_hour": 20000}
        override_factor_row = {
            "material_key": "mulch", "factors": '{"depth_in": 3}',
            "aspire_branch_id": 1403,
        }
        catalog_row = {
            "id": "ci-001", "description": "Mulch Install", "production_rate": 1200.0,
        }
        mock_query.side_effect = [
            [branch_row],           # (1) branch_settings
            [override_factor_row],  # (2) material_calcs branch overrides
            [],                     # (3) material_calcs company-wide (mulch overridden, nothing extra)
            [catalog_row],          # (4) catalog_items
        ]
        r = client.get("/api/settings/branch/1403")
        assert r.status_code == 200
        body = r.json()

        assert body["crewRateCentsPerHour"] == 20000
        assert "materialFactors" in body
        assert "productionRates" in body

        # The override row must be flagged source='override'.
        factors = body["materialFactors"]
        assert len(factors) >= 1
        override_factor = next((f for f in factors if f["materialKey"] == "mulch"), None)
        assert override_factor is not None, "mulch factor row must be present"
        assert override_factor["source"] == "override"

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_branch_without_override_returns_inherited_flag(
        self, mock_query, mock_authz_query, as_role
    ):
        """When a branch has no material_calcs override, the company-wide row
        must be returned flagged source='inherited'."""
        as_role("admin")
        mock_authz_query.return_value = []

        branch_row = {"crew_rate_cents_per_hour": 18000}
        company_wide_row = {
            "material_key": "mulch", "factors": '{"depth_in": 3}',
            "aspire_branch_id": None,  # company-wide
        }
        catalog_row = {
            "id": "ci-001", "description": "Mulch Install", "production_rate": 900.0,
        }
        mock_query.side_effect = [
            [branch_row],           # (1) branch_settings
            [],                     # (2) material_calcs branch overrides — none
            [company_wide_row],     # (3) material_calcs company-wide row
            [catalog_row],          # (4) catalog_items
        ]
        r = client.get("/api/settings/branch/3696")
        assert r.status_code == 200
        body = r.json()

        factors = body["materialFactors"]
        assert len(factors) >= 1
        company_factor = next((f for f in factors if f["materialKey"] == "mulch"), None)
        assert company_factor is not None
        assert company_factor["source"] == "inherited"

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_crew_rate_unchanged_in_enriched_response(
        self, mock_query, mock_authz_query, as_role
    ):
        """crewRateCentsPerHour must survive enrichment unchanged."""
        as_role("admin")
        mock_authz_query.return_value = []
        mock_query.side_effect = [
            [{"crew_rate_cents_per_hour": 22500}],  # (1) branch_settings
            [],   # (2) material_calcs branch overrides
            [],   # (3) material_calcs company-wide
            [],   # (4) catalog_items
        ]
        r = client.get("/api/settings/branch/1403")
        assert r.status_code == 200
        assert r.json()["crewRateCentsPerHour"] == 22500


# ── Handoff 50 §3: the Marketing role — company-wide proposal-asset management ─
#
# Scope decision (Carlos, 2026-09-08): portfolio_properties, client_references
# and team_members are COMPANY-WIDE resources gated on the `marketing` role
# (plus admin). Marketing edits them across ALL branches. A branch manager's
# existing branch-scoped access to team_members/client_references is unchanged.


class TestMarketingPortfolioManagement:
    """portfolio_properties is company-wide, gated on marketing + admin."""

    _ROW = {
        "id": "pp-001",
        "name": "Bonita Springs Estate",
        "city_state": "Bonita Springs, FL",
        "region_id": "east-coast",
        "photo_object_keys": "[]",
        "sort_order": 0,
        "active": 1,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_can_list_portfolio(
        self, mock_query, mock_authz_query, as_role
    ):
        as_role("marketing")
        mock_authz_query.return_value = _live("marketing")
        mock_query.return_value = [self._ROW]
        r = client.get("/api/settings/portfolio")
        assert r.status_code == 200
        assert r.json()[0]["name"] == "Bonita Springs Estate"

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_can_create_portfolio(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("marketing")
        mock_authz_query.return_value = _live("marketing")
        r = client.post(
            "/api/settings/portfolio",
            json={"name": "New Estate", "cityState": "Naples, FL", "regionId": "east-coast"},
        )
        assert r.status_code == 201

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_can_soft_delete_portfolio(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("marketing")
        mock_authz_query.return_value = _live("marketing")
        mock_query.return_value = [self._ROW]
        r = client.delete("/api/settings/portfolio/pp-001")
        assert r.status_code == 200

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_sales_cannot_manage_portfolio(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales")
        mock_authz_query.return_value = _live("sales")
        r = client.post(
            "/api/settings/portfolio",
            json={"name": "X", "cityState": "Y", "regionId": "z"},
        )
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_manager_cannot_manage_company_portfolio(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # Portfolio is company-wide: a branch manager (non-marketing) is refused.
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        r = client.post(
            "/api/settings/portfolio",
            json={"name": "X", "cityState": "Y", "regionId": "z"},
        )
        assert r.status_code == 403


class TestMarketingTeamMembers:
    """team_members: marketing edits any branch; managers keep their own branch."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_can_create_company_wide_member(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("marketing")
        mock_authz_query.return_value = _live("marketing")
        r = client.post(
            "/api/settings/team-members",
            json={"name": "Caitlyn F.", "title": "Marketing", "teamType": "leadership"},
        )
        assert r.status_code == 201

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_can_create_any_branch_member(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # Marketing is cross-branch: it may create a team member for a branch it
        # holds no user_branches row for. Branch scope is tried first (empty →
        # out of scope), then the marketing fallback live-role read allows it.
        as_role("marketing")
        mock_authz_query.side_effect = [[], _live("marketing")]
        r = client.post(
            "/api/settings/team-members",
            json={"name": "Field Lead", "title": "PM", "teamType": "branch", "aspireBranchId": 9999},
        )
        assert r.status_code == 201

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_sales_cannot_create_team_member(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales")
        mock_authz_query.return_value = _live("sales")
        r = client.post(
            "/api/settings/team-members",
            json={"name": "X", "title": "Y", "teamType": "leadership"},
        )
        assert r.status_code == 403


def _ref_body(**over) -> dict:
    """A complete ClientReferenceCreate body (all required fields present)."""
    body = {
        "propertyName": "Coral Bay HOA",
        "servicesProvided": "Maintenance",
        "contactName": "Jane Doe",
        "phone": "555-1212",
        "email": "jane@example.com",
        "address": "1 Palm Way",
        "clientSinceYear": 2019,
    }
    body.update(over)
    return body


class TestMarketingClientReferences:
    """client_references: marketing edits any branch; company-wide gated on role."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_can_create_company_wide_reference(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("marketing")
        mock_authz_query.return_value = _live("marketing")
        r = client.post("/api/settings/client-references", json=_ref_body())
        assert r.status_code == 201

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_marketing_can_create_any_branch_reference(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        # Branch scope tried first (empty → out of scope), then the marketing
        # fallback live-role read allows the cross-branch write.
        as_role("marketing")
        mock_authz_query.side_effect = [[], _live("marketing")]
        r = client.post(
            "/api/settings/client-references", json=_ref_body(aspireBranchId=9999)
        )
        assert r.status_code == 201

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_sales_cannot_create_client_reference(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("sales")
        mock_authz_query.return_value = _live("sales")
        r = client.post("/api/settings/client-references", json=_ref_body())
        assert r.status_code == 403


class TestManagerBranchScopeUnchanged:
    """A branch manager's existing branch-scoped access is unchanged (§3 AC)."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_manager_can_still_create_member_for_own_branch(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        # Branch scope is tried FIRST (unchanged BM path): resolve_branch_scope
        # reads user_branches → manager owns 1403, so no live-role read happens.
        mock_authz_query.return_value = [{"aspire_branch_id": 1403}]
        r = client.post(
            "/api/settings/team-members",
            json={"name": "Local PM", "title": "PM", "teamType": "branch", "aspireBranchId": 1403},
        )
        assert r.status_code == 201

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_manager_cannot_create_member_for_foreign_branch(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        # (1) branch scope read → owns only 1403, so 3696 is out of scope; then
        # (2) the marketing fallback live-role read → manager, so 403 stands.
        mock_authz_query.side_effect = [[{"aspire_branch_id": 1403}], _live("manager")]
        r = client.post(
            "/api/settings/team-members",
            json={"name": "Elsewhere", "title": "PM", "teamType": "branch", "aspireBranchId": 3696},
        )
        assert r.status_code == 403
