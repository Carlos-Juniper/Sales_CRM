"""RED tests for Handoff 54 §4 — Branch kit pricing + rate history.

Covers:
  - resolve_kit_rate: three-step fallback (branch override -> company-wide -> baseline)
  - PATCH /api/settings/branch/{id}/kit-rates/{kit_id}: insert row, no-op guard
  - PATCH /api/settings/branch/{id} crew_rate: appends branch_crew_rate_history
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch


# ── helpers ────────────────────────────────────────────────────────────────────

def _fake_query(table_data: dict):
    """Return an async query function backed by the provided table data dict.

    table_data maps table_name -> list[dict].
    """
    async def _q(sql, params=None):
        params = list(params or [])
        sql_norm = " ".join(sql.split())

        # Route by table name
        if "service_kit_rates" in sql_norm:
            rows = table_data.get("service_kit_rates", [])
            # Two-step: branch-specific query (aspire_branch_id = %s)
            if "aspire_branch_id = %s" in sql_norm:
                kit_id = params[0]
                branch_id = params[1] if len(params) > 1 else None
                rows = [r for r in rows
                        if r.get("service_kit_id") == kit_id
                        and r.get("aspire_branch_id") == branch_id]
                rows = sorted(rows, key=lambda r: r.get("effective_from", ""), reverse=True)
                return rows[:1]
            # Company-wide query (aspire_branch_id IS NULL) — we use a separate query
            if "aspire_branch_id IS NULL" in sql_norm:
                kit_id = params[0]
                rows = [r for r in rows
                        if r.get("service_kit_id") == kit_id
                        and r.get("aspire_branch_id") is None]
                rows = sorted(rows, key=lambda r: r.get("effective_from", ""), reverse=True)
                return rows[:1]
            return []

        if "service_kits" in sql_norm:
            rows = table_data.get("service_kits", [])
            if params:
                rows = [r for r in rows if r.get("id") == params[0]]
            return rows

        if "branch_settings" in sql_norm:
            rows = table_data.get("branch_settings", [])
            if params:
                rows = [r for r in rows if r.get("aspire_branch_id") == params[0]]
            return rows

        if "branch_crew_rate_history" in sql_norm:
            return table_data.get("branch_crew_rate_history", [])

        return []

    return _q


def _fake_execute(captured: list):
    """Return an async execute function that captures (sql, params) calls."""
    async def _e(sql, params=None):
        captured.append({"sql": " ".join(sql.split()), "params": list(params or [])})
    return _e


# ── resolve_kit_rate tests ─────────────────────────────────────────────────────

class TestResolveKitRate:
    """Unit tests for api.maintenance_catalog.resolve_kit_rate."""

    @pytest.mark.asyncio
    async def test_resolve_kit_rate_branch_override(self):
        """A branch-specific rate row overrides the service_kits baseline."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [
                {
                    "id": "rate-001",
                    "service_kit_id": "kit-maint-100",
                    "aspire_branch_id": 42,
                    "production_rate": 1.5,
                    "unit_cost_cents": 5000,
                    "target_gm": 0.45,
                    "effective_from": "2026-01-01 00:00:00",
                },
            ],
            "service_kits": [
                {
                    "id": "kit-maint-100",
                    "production_rate": 1.0,
                    "unit_cost_cents": 3000,
                    "target_gm": 0.35,
                },
            ],
        }
        q = _fake_query(table_data)
        with patch("api.maintenance_catalog.query", new=q):
            result = await resolve_kit_rate("kit-maint-100", 42)

        assert result["productionRate"] == 1.5
        assert result["unitCostCents"] == 5000
        assert result["targetGm"] == pytest.approx(0.45)

    @pytest.mark.asyncio
    async def test_resolve_kit_rate_company_wide_fallback(self):
        """No branch row -> falls back to company-wide (aspire_branch_id IS NULL) row."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [
                {
                    "id": "rate-002",
                    "service_kit_id": "kit-maint-100",
                    "aspire_branch_id": None,
                    "production_rate": 1.2,
                    "unit_cost_cents": 4000,
                    "target_gm": 0.40,
                    "effective_from": "2026-01-01 00:00:00",
                },
            ],
            "service_kits": [
                {
                    "id": "kit-maint-100",
                    "production_rate": 1.0,
                    "unit_cost_cents": 3000,
                    "target_gm": 0.35,
                },
            ],
        }
        q = _fake_query(table_data)
        with patch("api.maintenance_catalog.query", new=q):
            result = await resolve_kit_rate("kit-maint-100", 99)

        assert result["productionRate"] == 1.2
        assert result["unitCostCents"] == 4000
        assert result["targetGm"] == pytest.approx(0.40)

    @pytest.mark.asyncio
    async def test_resolve_kit_rate_baseline_fallback(self):
        """No rate rows at all -> reads from service_kits baseline."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [],
            "service_kits": [
                {
                    "id": "kit-maint-100",
                    "production_rate": 0.9,
                    "unit_cost_cents": 2500,
                    "target_gm": 0.30,
                },
            ],
        }
        q = _fake_query(table_data)
        with patch("api.maintenance_catalog.query", new=q):
            result = await resolve_kit_rate("kit-maint-100", 55)

        assert result["productionRate"] == 0.9
        assert result["unitCostCents"] == 2500
        assert result["targetGm"] == pytest.approx(0.30)


# ── PATCH /api/settings/branch/{id}/kit-rates/{kit_id} tests ──────────────────

class TestPatchKitRate:
    """Integration-style tests for the kit-rate PATCH endpoint."""

    def _make_app(self, table_data: dict, captured_executes: list):
        """Build a minimal FastAPI test client wired to fake DB."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import api.settings as settings_mod

        app = FastAPI()

        async def fake_require_auth():
            return {"id": "user-001", "email": "test@juniperlandscaping.com", "role": "admin"}

        q = _fake_query(table_data)
        e = _fake_execute(captured_executes)

        # Patch authz.resolve_branch_scope to allow-all
        async def fake_resolve_scope(user):
            from api.authz import BranchScope
            return BranchScope(kind="all", ids=set())

        with patch("api.settings.query", new=q), \
             patch("api.settings.execute", new=e), \
             patch("api.maintenance_catalog.query", new=q), \
             patch("api.authz.resolve_branch_scope", side_effect=fake_resolve_scope), \
             patch("api.authz._live_role", new=AsyncMock(return_value="admin")):
            settings_mod.register(app, lambda: fake_require_auth())
            client = TestClient(app, raise_server_exceptions=True)
            return client

    @pytest.mark.asyncio
    async def test_patch_kit_rate_inserts_row(self):
        """PATCH with a new production rate inserts one service_kit_rates row."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [],
            "service_kits": [
                {
                    "id": "kit-maint-200",
                    "production_rate": 1.0,
                    "unit_cost_cents": 3000,
                    "target_gm": 0.35,
                },
            ],
            "branch_settings": [],
        }
        captured: list = []

        import api.settings as settings_mod
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        app = FastAPI()

        async def fake_require_auth():
            return {"id": "user-001", "email": "test@juniperlandscaping.com", "role": "admin"}

        q = _fake_query(table_data)
        e = _fake_execute(captured)

        async def fake_resolve_scope(user):
            from api.authz import BranchScope
            return BranchScope(kind="all", ids=set())

        with patch("api.settings.query", new=q), \
             patch("api.settings.execute", new=e), \
             patch("api.maintenance_catalog.query", new=q), \
             patch("api.authz.resolve_branch_scope", side_effect=fake_resolve_scope), \
             patch("api.authz._live_role", new=AsyncMock(return_value="admin")):
            settings_mod.register(app, lambda: fake_require_auth())
            client = TestClient(app, raise_server_exceptions=True)
            resp = client.patch(
                "/api/settings/branch/42/kit-rates/kit-maint-200",
                json={"productionRate": 2.0},
            )

        assert resp.status_code == 204, resp.text

        inserts = [c for c in captured if "INSERT INTO service_kit_rates" in c["sql"]]
        assert len(inserts) == 1, f"Expected 1 INSERT into service_kit_rates, got {len(inserts)}"
        params = inserts[0]["params"]
        # params: id, service_kit_id, aspire_branch_id, production_rate, unit_cost_cents, target_gm,
        #         effective_from, entered_by, note
        assert "kit-maint-200" in params
        assert 42 in params
        assert 2.0 in params

    @pytest.mark.asyncio
    async def test_patch_kit_rate_noop_skips_insert(self):
        """Submitting the same production rate as the current baseline is a no-op."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [],
            "service_kits": [
                {
                    "id": "kit-maint-300",
                    "production_rate": 1.0,
                    "unit_cost_cents": 3000,
                    "target_gm": 0.35,
                },
            ],
            "branch_settings": [],
        }
        captured: list = []

        import api.settings as settings_mod
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        app = FastAPI()

        async def fake_require_auth():
            return {"id": "user-001", "email": "test@juniperlandscaping.com", "role": "admin"}

        q = _fake_query(table_data)
        e = _fake_execute(captured)

        async def fake_resolve_scope(user):
            from api.authz import BranchScope
            return BranchScope(kind="all", ids=set())

        with patch("api.settings.query", new=q), \
             patch("api.settings.execute", new=e), \
             patch("api.maintenance_catalog.query", new=q), \
             patch("api.authz.resolve_branch_scope", side_effect=fake_resolve_scope), \
             patch("api.authz._live_role", new=AsyncMock(return_value="admin")):
            settings_mod.register(app, lambda: fake_require_auth())
            client = TestClient(app, raise_server_exceptions=True)
            resp = client.patch(
                "/api/settings/branch/42/kit-rates/kit-maint-300",
                json={"productionRate": 1.0},  # same as baseline
            )

        assert resp.status_code == 204, resp.text
        inserts = [c for c in captured if "INSERT INTO service_kit_rates" in c["sql"]]
        assert len(inserts) == 0, "No INSERT should happen when values are unchanged"


# ── Crew rate history tests ────────────────────────────────────────────────────

class TestCrewRateHistory:
    """Test that PATCH branch crew_rate appends to branch_crew_rate_history."""

    @pytest.mark.asyncio
    async def test_crew_rate_patch_appends_history(self):
        """Changing crew_rate_cents_per_hour inserts one branch_crew_rate_history row."""
        table_data = {
            "branch_settings": [
                {"aspire_branch_id": 10, "crew_rate_cents_per_hour": 5000},
            ],
            "service_kit_rates": [],
            "service_kits": [],
            "branch_crew_rate_history": [],
        }
        captured: list = []

        import api.settings as settings_mod
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        app = FastAPI()

        async def fake_require_auth():
            return {"id": "user-abc", "email": "admin@juniperlandscaping.com", "role": "admin"}

        q = _fake_query(table_data)
        e = _fake_execute(captured)

        async def fake_resolve_scope(user):
            from api.authz import BranchScope
            return BranchScope(kind="all", ids=set())

        with patch("api.settings.query", new=q), \
             patch("api.settings.execute", new=e), \
             patch("api.maintenance_catalog.query", new=q), \
             patch("api.authz.resolve_branch_scope", side_effect=fake_resolve_scope), \
             patch("api.authz._live_role", new=AsyncMock(return_value="admin")), \
             patch("api.settings.reprice_open_drafts", new=AsyncMock()), \
             patch("api.settings.get_branch_settings_payload", new=AsyncMock(return_value={
                 "aspireBranchId": 10,
                 "crewRateCentsPerHour": 6000,
                 "materialFactors": [],
                 "productionRates": [],
             })):
            settings_mod.register(app, lambda: fake_require_auth())
            client = TestClient(app, raise_server_exceptions=True)
            resp = client.patch(
                "/api/settings/branch/10",
                json={"crew_rate_cents_per_hour": 6000, "crewRateNote": "Annual raise"},
            )

        assert resp.status_code == 200, resp.text

        history_inserts = [
            c for c in captured
            if "INSERT INTO branch_crew_rate_history" in c["sql"]
        ]
        assert len(history_inserts) == 1, (
            f"Expected 1 INSERT into branch_crew_rate_history, got {len(history_inserts)}"
        )
        params = history_inserts[0]["params"]
        assert 10 in params           # aspire_branch_id
        assert 6000 in params         # crew_rate_cents_per_hour
        assert "user-abc" in params   # entered_by
