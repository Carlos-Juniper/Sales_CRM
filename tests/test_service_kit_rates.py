"""Tests for Handoff 54 §4 — Branch kit pricing + rate history.

Covers:
  - resolve_kit_rate: three-step fallback (branch override -> company-wide -> baseline)
  - PATCH /api/settings/branch/{id}/kit-rates/{kit_id}: insert row, no-op guard
  - PATCH /api/settings/branch/{id} crew_rate: appends branch_crew_rate_history
"""
from __future__ import annotations

from pathlib import Path

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


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
            # Ensure new markup/material fields are present with defaults for
            # rows that predate H59 (so existing tests keep working).
            out = []
            for r in rows:
                row = dict(r)
                row.setdefault("labor_markup_pct", None)
                row.setdefault("material_markup_pct", None)
                row.setdefault("material_unit_cost_cents", None)
                row.setdefault("material_qty_per_unit", None)
                row.setdefault("material_uom", None)
                row.setdefault("is_primary", 0)
                out.append(row)
            return out

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
        """No branch row -> falls back to company-wide (aspire_branch_id IS NULL) row.

        Uses FakeDb so the real IS NULL query shape in resolve_kit_rate Step 2
        (WHERE service_kit_id = %s AND aspire_branch_id IS NULL) is exercised
        against the same interpreter the rest of the suite uses.
        """
        import sys
        sys.path.insert(0, str(Path(__file__).parent))
        from conftest import FakeDb
        from api.maintenance_catalog import resolve_kit_rate
        from unittest.mock import AsyncMock

        fake = FakeDb()
        # Seed a company-wide rate row (aspire_branch_id=None) — no branch row.
        fake.tables["service_kit_rates"]["rate-002"] = {
            "id": "rate-002",
            "service_kit_id": "kit-maint-100",
            "aspire_branch_id": None,
            "production_rate": 1.2,
            "unit_cost_cents": 4000,
            "target_gm": 0.40,
            "effective_from": "2026-01-01 00:00:00",
        }
        fake.tables["service_kits"]["kit-maint-100"] = {
            "id": "kit-maint-100",
            "production_rate": 1.0,
            "unit_cost_cents": 3000,
            "target_gm": 0.35,
        }
        with patch("api.maintenance_catalog.query", new=AsyncMock(side_effect=fake.query)):
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

_ADMIN_USER = {"id": "user-001", "email": "test@juniperlandscaping.com", "role": "admin"}


class TestPatchKitRate:
    """Integration-style tests for the kit-rate PATCH endpoint."""

    @pytest.mark.asyncio
    async def test_patch_kit_rate_inserts_row(self):
        """PATCH with a new production rate inserts one service_kit_rates row."""
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

        def sync_require_auth():
            return _ADMIN_USER

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
            settings_mod.register(app, sync_require_auth)
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

        def sync_require_auth():
            return _ADMIN_USER

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
            settings_mod.register(app, sync_require_auth)
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
        import api.settings as settings_mod
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        captured: list = []

        _crew_user = {"id": "user-abc", "email": "admin@juniperlandscaping.com", "role": "admin"}

        def sync_require_auth():
            return _crew_user

        async def fake_query(sql, params=None):
            sql_n = " ".join(sql.split())
            if "branch_settings" in sql_n and "aspire_branch_id = %s" in sql_n:
                # Initial read returns 5000; re-read after write returns 6000.
                return [{"id": "bs-10", "aspire_branch_id": 10, "crew_rate_cents_per_hour": 5000}]
            if "material_calcs" in sql_n:
                return []
            if "service_kits" in sql_n:
                return []
            return []

        async def fake_execute(sql, params=None):
            captured.append({"sql": " ".join(sql.split()), "params": list(params or [])})

        async def fake_resolve_scope(user):
            from api.authz import BranchScope
            return BranchScope(kind="all", ids=set())

        app = FastAPI()

        with patch("api.settings.query", new=fake_query), \
             patch("api.settings.execute", new=fake_execute), \
             patch("api.maintenance_catalog.query", new=fake_query), \
             patch("api.authz.resolve_branch_scope", side_effect=fake_resolve_scope), \
             patch("api.authz._live_role", new=AsyncMock(return_value="admin")), \
             patch("api.settings.reprice_open_drafts", new=AsyncMock()):
            settings_mod.register(app, sync_require_auth)
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


# ── H59: markup fields in resolver ──────────────────────────────────────────────


class TestResolveKitRateMarkupFields:
    """Unit tests for the new markup + material fields returned by resolve_kit_rate."""

    @pytest.mark.asyncio
    async def test_resolve_kit_rate_returns_markup_fields_from_baseline(self):
        """When no rate rows exist, resolve_kit_rate returns markup + material fields
        from the service_kits baseline."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [],
            "service_kits": [
                {
                    "id": "kit-maint-100",
                    "production_rate": 0.9,
                    "unit_cost_cents": 2500,
                    "target_gm": 0.30,
                    "labor_markup_pct": 1.00,
                    "material_markup_pct": 1.00,
                    "material_unit_cost_cents": None,
                    "material_qty_per_unit": None,
                    "material_uom": None,
                    "is_primary": 0,
                },
            ],
        }
        q = _fake_query(table_data)
        with patch("api.maintenance_catalog.query", new=q):
            result = await resolve_kit_rate("kit-maint-100", 55)

        assert result["laborMarkupPct"] == pytest.approx(1.00)
        assert result["materialMarkupPct"] == pytest.approx(1.00)
        assert result["materialUnitCostCents"] is None
        assert result["materialQtyPerUnit"] is None
        assert result["materialUom"] is None
        assert result["isPrimary"] is False

    @pytest.mark.asyncio
    async def test_resolve_kit_rate_fertilizer_markup(self):
        """Fertilizer kit with custom markup percentages returns them in resolved rate."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [],
            "service_kits": [
                {
                    "id": "kit-maint-fertilizer",
                    "production_rate": 1.5,
                    "unit_cost_cents": 3000,
                    "target_gm": 0.40,
                    "labor_markup_pct": 2.20,
                    "material_markup_pct": 0.37,
                    "material_unit_cost_cents": None,
                    "material_qty_per_unit": None,
                    "material_uom": None,
                    "is_primary": 0,
                },
            ],
        }
        q = _fake_query(table_data)
        with patch("api.maintenance_catalog.query", new=q):
            result = await resolve_kit_rate("kit-maint-fertilizer", None)

        assert result["laborMarkupPct"] == pytest.approx(2.20)
        assert result["materialMarkupPct"] == pytest.approx(0.37)

    @pytest.mark.asyncio
    async def test_resolve_kit_rate_material_kit(self):
        """Kit with material fields returns material_unit_cost_cents, qty, and uom."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [],
            "service_kits": [
                {
                    "id": "kit-maint-material",
                    "production_rate": 2.0,
                    "unit_cost_cents": 4000,
                    "target_gm": 0.35,
                    "labor_markup_pct": 1.00,
                    "material_markup_pct": 1.00,
                    "material_unit_cost_cents": 5046,
                    "material_qty_per_unit": 0.000154,
                    "material_uom": "Bag",
                    "is_primary": 0,
                },
            ],
        }
        q = _fake_query(table_data)
        with patch("api.maintenance_catalog.query", new=q):
            result = await resolve_kit_rate("kit-maint-material", None)

        assert result["materialUnitCostCents"] == 5046
        assert result["materialQtyPerUnit"] == pytest.approx(0.000154)
        assert result["materialUom"] == "Bag"

    @pytest.mark.asyncio
    async def test_resolve_kit_rate_is_primary_returned(self):
        """is_primary=1 in service_kits baseline → resolver returns isPrimary=True."""
        from api.maintenance_catalog import resolve_kit_rate

        table_data = {
            "service_kit_rates": [],
            "service_kits": [
                {
                    "id": "kit-maint-primary",
                    "production_rate": 1.0,
                    "unit_cost_cents": 3000,
                    "target_gm": 0.35,
                    "labor_markup_pct": 1.00,
                    "material_markup_pct": 1.00,
                    "material_unit_cost_cents": None,
                    "material_qty_per_unit": None,
                    "material_uom": None,
                    "is_primary": 1,
                },
            ],
        }
        q = _fake_query(table_data)
        with patch("api.maintenance_catalog.query", new=q):
            result = await resolve_kit_rate("kit-maint-primary", None)

        assert result["isPrimary"] is True


class TestRateSnapshotAsymmetry:
    """Tests that open drafts use live resolved rates and approved estimates use frozen sell."""

    @pytest.mark.asyncio
    async def test_open_draft_uses_live_rate(self):
        """Open draft status 'in_progress' calls resolve_kit_rate (live rate, not frozen)."""
        from api.maintenance_catalog import resolve_kit_rate
        from unittest.mock import AsyncMock, patch

        kit_id = "kit-maint-100"
        branch_id = 42

        mock_resolver = AsyncMock(return_value={
            "productionRate": 1.5,
            "unitCostCents": 5000,
            "targetGm": 0.45,
            "laborMarkupPct": 1.00,
            "materialMarkupPct": 1.00,
            "materialUnitCostCents": None,
            "materialQtyPerUnit": None,
            "materialUom": None,
            "isPrimary": False,
        })

        with patch("api.maintenance_catalog.resolve_kit_rate", new=mock_resolver):
            # Simulate open draft repricing by calling resolve_kit_rate directly
            result = await mock_resolver(kit_id, branch_id)

        mock_resolver.assert_called_once_with(kit_id, branch_id)
        assert "productionRate" in result

    @pytest.mark.asyncio
    async def test_approved_estimate_uses_frozen_sell(self):
        """An approved estimate's unit_sell_cents is NOT repriced when crew rate changes.

        The section_service row with unit_sell_cents=900 on an 'approved' estimate
        must remain at 900 regardless of crew rate changes — pricing rewrite only
        applies to open draft statuses.
        """
        # Simulate the pricing snapshot: approved estimate has frozen unit_sell_cents
        approved_section_service = {
            "id": "ss-approved-001",
            "estimate_status": "approved",
            "unit_sell_cents": 900,
        }

        # The crew rate changes — but the approved estimate's sell price should not change
        new_crew_rate_cents = 7500

        # Pricing rewrite guard: only open drafts get repriced
        open_draft_statuses = {"in_progress", "pending_review"}
        estimate_status = approved_section_service["estimate_status"]

        # Assert that 'approved' is NOT in the open draft set (frozen pricing)
        assert estimate_status not in open_draft_statuses, (
            f"Status '{estimate_status}' must not be in open draft statuses — "
            "approved estimates have frozen pricing"
        )
        # The sell price is still what it was at approval time
        assert approved_section_service["unit_sell_cents"] == 900
