"""Handoff 16 — Config-Table Read APIs (read-only GET endpoints).

DB fully mocked — patch api.estimating.query; no real MySQL.

Contract under test (all authenticated, all read-only):
  GET /api/estimating/config/approval-tiers?estimate_type=  → approval_tiers rows, ORDER BY tier_order
  GET /api/estimating/config/margin-bands                   → margin_bands rows
  GET /api/estimating/config/material-calcs                 → material_calcs rows (factors jsonb parsed)
  GET /api/estimating/config/itb-scopes                     → itb_scopes rows, ordered group then order
  GET /api/estimating/catalog-items?branch=&kit_type=&active= → catalog_items rows w/ filters

JSON is shaped to the existing TS types (camelCase) so the frontend swap is a
drop-in. NO write/admin endpoints exist for these tables (locked decision).
"""
from __future__ import annotations

import os
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

_USER = {
    "id": "u1", "name": "Alice", "email": "a@x.com", "role": "estimator",
    "branch_id": "Orlando, FL", "avatar_initials": "AX",
}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


# ── Canonical seed rows as the DB returns them (snake_case) ──────────────────

def _tier_row(**over) -> dict:
    row = {
        "id": "tier-maint-mgr",
        "role_key": "manager",
        "label": "Manager",
        "min_value_cents": 0,
        "max_value_cents": 10000000,
        "tier_order": 1,
        "estimate_type": "maintenance",
    }
    row.update(over)
    return row


def _band_row(**over) -> dict:
    row = {"id": "mb-default", "name": "default", "good_min": Decimal("0.2000"), "ok_min": Decimal("0.1200")}
    row.update(over)
    return row


def _calc_row(**over) -> dict:
    row = {
        "id": "mc-edging",
        "material_key": "edging",
        "label": "Steel Edging",
        "compute_type": "divPiece",
        "factors": '{"pieceLengthFt": 16}',
        "unit_sell_cents": 3200,
        "unit_cost_cents": 1900,
        "uom": "pcs",
        "volume_quote_threshold_sf": None,
    }
    row.update(over)
    return row


def _scope_row(**over) -> dict:
    row = {
        "id": "scope-landscape",
        "scope_key": "landscape",
        "label": "Landscape",
        "scope_group": "estimating",
        "sort_order": 1,
    }
    row.update(over)
    return row


def _kit_row(**over) -> dict:
    row = {
        "id": "kit-1",
        "description": "Mahogany 10'-12' — Installed",
        "uom": "ea",
        "unit_cost_cents": 42000,
        "unit_sell_cents": 68000,
        "target_gm": Decimal("0.3800"),
        "kit_type": "install_quantity",
        "production_rate": None,
        "branch": "Orlando, FL",
        "active": 1,
        "service_type": "Trees",
    }
    row.update(over)
    return row


# ── Auth: every endpoint requires it ─────────────────────────────────────────

class TestAuthRequired:
    @pytest.mark.parametrize("path", [
        "/api/estimating/config/approval-tiers",
        "/api/estimating/config/margin-bands",
        "/api/estimating/config/material-calcs",
        "/api/estimating/config/itb-scopes",
        "/api/estimating/catalog-items",
    ])
    def test_unauthenticated_is_rejected(self, path):
        res = client.get(path)
        assert res.status_code in (401, 403)


# ── GET /api/estimating/config/approval-tiers ────────────────────────────────

class TestApprovalTiers:
    def test_returns_rows_shaped_to_ts_type(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [
                _tier_row(),
                _tier_row(id="tier-maint-ceo", role_key="ceo", label="CEO",
                          min_value_cents=100000000, max_value_cents=None,
                          tier_order=4),
            ]
            res = client.get("/api/estimating/config/approval-tiers")
        assert res.status_code == 200
        body = res.json()
        assert body[0] == {
            "id": "tier-maint-mgr",
            "roleKey": "manager",
            "label": "Manager",
            "minValueCents": 0,
            "maxValueCents": 10000000,
            "order": 1,
            "estimateType": "maintenance",
        }
        # NULL max = unbounded top tier survives serialization as None
        assert body[1]["maxValueCents"] is None

    def test_orders_by_tier_order(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            client.get("/api/estimating/config/approval-tiers")
        sql = mock_query.call_args.args[0]
        assert "ORDER BY tier_order" in sql

    def test_filters_by_estimate_type(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            res = client.get("/api/estimating/config/approval-tiers?estimate_type=maintenance")
        assert res.status_code == 200
        sql, params = mock_query.call_args.args[0], mock_query.call_args.args[1]
        assert "estimate_type = %s" in sql
        assert params == ["maintenance"]

    def test_rejects_bogus_estimate_type(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock):
            res = client.get("/api/estimating/config/approval-tiers?estimate_type=bogus")
        assert res.status_code == 400

    def test_config_driven_through_the_db(self, authed):
        """Handoff 00 §6 AC: a NEW row inserted in the DB comes straight back
        through the API — no code edit, no hardcoded ladder."""
        new_install_tier = _tier_row(
            id="tier-inst-mgr2", role_key="manager", label="Install Manager",
            min_value_cents=0, max_value_cents=5000000, tier_order=1,
            estimate_type="install",
        )
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [new_install_tier]
            res = client.get("/api/estimating/config/approval-tiers?estimate_type=install")
        assert res.status_code == 200
        assert res.json() == [{
            "id": "tier-inst-mgr2",
            "roleKey": "manager",
            "label": "Install Manager",
            "minValueCents": 0,
            "maxValueCents": 5000000,
            "order": 1,
            "estimateType": "install",
        }]


# ── GET /api/estimating/config/margin-bands ──────────────────────────────────

class TestMarginBands:
    def test_returns_canonical_band_set(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [_band_row()]
            res = client.get("/api/estimating/config/margin-bands")
        assert res.status_code == 200
        assert res.json() == [
            {"id": "mb-default", "name": "default", "goodMin": 0.2, "okMin": 0.12}
        ]

    def test_db_row_edit_flows_through(self, authed):
        """Editing good_min/ok_min in the DB changes the API response with no
        frontend/backend code edit."""
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [_band_row(good_min=Decimal("0.3400"), ok_min=Decimal("0.2800"))]
            res = client.get("/api/estimating/config/margin-bands")
        assert res.json()[0]["goodMin"] == 0.34
        assert res.json()[0]["okMin"] == 0.28


# ── GET /api/estimating/config/material-calcs ────────────────────────────────

class TestMaterialCalcs:
    def test_returns_rows_with_parsed_factors(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [
                _calc_row(),
                _calc_row(
                    id="mc-aggregate", material_key="aggregate",
                    label="Decorative Rock / Aggregate", compute_type="aggregate",
                    factors='{"sfPerTonAtDepthIn": {"2": 120, "3": 80}, "defaultDepthIn": 2}',
                    unit_sell_cents=9800, unit_cost_cents=6200, uom="tons",
                    volume_quote_threshold_sf=44000,
                ),
            ]
            res = client.get("/api/estimating/config/material-calcs")
        assert res.status_code == 200
        body = res.json()
        assert body[0] == {
            "id": "mc-edging",
            "materialKey": "edging",
            "label": "Steel Edging",
            "computeType": "divPiece",
            "factors": {"pieceLengthFt": 16},
            "unitSellCents": 3200,
            "unitCostCents": 1900,
            "uom": "pcs",
            "volumeQuoteThresholdSf": None,
        }
        # factors jsonb is parsed to an object, never a string
        assert body[1]["factors"] == {"sfPerTonAtDepthIn": {"2": 120, "3": 80}, "defaultDepthIn": 2}
        assert body[1]["volumeQuoteThresholdSf"] == 44000

    def test_handles_pre_parsed_json_factors(self, authed):
        # Some MySQL drivers return JSON columns already deserialized.
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [_calc_row(factors={"pieceLengthFt": 16})]
            res = client.get("/api/estimating/config/material-calcs")
        assert res.json()[0]["factors"] == {"pieceLengthFt": 16}


# ── GET /api/estimating/config/itb-scopes ────────────────────────────────────

class TestItbScopes:
    def test_returns_rows_shaped_to_ts_type(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [_scope_row()]
            res = client.get("/api/estimating/config/itb-scopes")
        assert res.status_code == 200
        assert res.json() == [{
            "id": "scope-landscape",
            "key": "landscape",
            "label": "Landscape",
            "group": "estimating",
            "order": 1,
        }]

    def test_orders_by_group_then_order(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            client.get("/api/estimating/config/itb-scopes")
        sql = mock_query.call_args.args[0]
        assert "ORDER BY scope_group, sort_order" in sql


# ── GET /api/estimating/catalog-items ────────────────────────────────────────

class TestCatalogItems:
    def test_returns_rows_shaped_to_ts_type(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [_kit_row()]
            res = client.get("/api/estimating/catalog-items")
        assert res.status_code == 200
        assert res.json() == [{
            "id": "kit-1",
            "description": "Mahogany 10'-12' — Installed",
            "uom": "ea",
            "unitCostCents": 42000,
            "unitSellCents": 68000,
            "targetGm": 0.38,
            "kitType": "install_quantity",
            "productionRate": None,
            "branch": "Orlando, FL",
            "active": True,
            "serviceType": "Trees",
        }]

    def test_empty_until_handoff_22_populates(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            res = client.get("/api/estimating/catalog-items")
        assert res.status_code == 200
        assert res.json() == []

    def test_filters_branch_kit_type_active(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            res = client.get(
                "/api/estimating/catalog-items?branch=Orlando%2C%20FL&kit_type=install_quantity&active=true"
            )
        assert res.status_code == 200
        sql, params = mock_query.call_args.args[0], mock_query.call_args.args[1]
        assert "branch = %s" in sql
        assert "kit_type = %s" in sql
        assert "active = %s" in sql
        assert params == ["Orlando, FL", "install_quantity", 1]

    def test_active_false_filter(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            res = client.get("/api/estimating/catalog-items?active=false")
        assert res.status_code == 200
        assert mock_query.call_args.args[1] == [0]

    def test_rejects_bogus_active_value(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock):
            res = client.get("/api/estimating/catalog-items?active=maybe")
        assert res.status_code == 400

    def test_rejects_bogus_kit_type(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock):
            res = client.get("/api/estimating/catalog-items?kit_type=bogus")
        assert res.status_code == 400


# ── Locked decision: read-only — no write/admin endpoints ────────────────────

class TestReadOnly:
    def test_no_write_methods_registered_for_config_paths(self):
        config_paths = [
            "/api/estimating/config/approval-tiers",
            "/api/estimating/config/margin-bands",
            "/api/estimating/config/material-calcs",
            "/api/estimating/config/itb-scopes",
            "/api/estimating/catalog-items",
        ]
        for route in app.routes:
            path = getattr(route, "path", "")
            if path in config_paths or path.startswith("/api/estimating/config/"):
                methods = getattr(route, "methods", set()) or set()
                assert not (methods & {"POST", "PATCH", "PUT", "DELETE"}), (
                    f"Write method registered for read-only config path {path}"
                )
