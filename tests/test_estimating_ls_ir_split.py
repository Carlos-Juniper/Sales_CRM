"""Handoff 29 — ITB EST LS $ / EST IR $ Auto-Split by Discipline.

DB fully mocked — patch api.estimating.query/execute, matching the pattern in
tests/test_estimating_itb.py. Covers the acceptance criteria in
handoffs/29-itb-ls-ir-discipline-split.md.

The split is derived from PERSISTED section_services (not the create body —
both intake forms POST sections: [] and add lines afterward via the
section/service endpoints), so these tests drive `query()`'s mocked return
values directly rather than the POST body's `sections` key.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest  # noqa: F401  (asyncio_mode=auto)
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
import api.estimating as est  # noqa: E402
from tests.test_estimating_line_items import FakeDb, db, estimator  # noqa: E402,F401

client = TestClient(app)

_ESTIMATOR = {"id": "u1", "name": "Carlos", "email": "c@x.com",
              "role": "maintenance_estimating", "branch_id": "Orlando, FL",
              "avatar_initials": "CH"}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    yield
    app.dependency_overrides.clear()


def _scope_id_rows() -> list[dict]:
    return [{"id": "scope-landscape"}, {"id": "scope-irrigation"}]


def _itb_insert_params(mock_exec) -> tuple:
    insert = next(c for c in mock_exec.call_args_list
                  if "INSERT INTO itb_projects" in c.args[0])
    return insert.args[1]


def _create_body(**over) -> dict:
    body = {
        "estimateType": "install", "name": "X", "clientName": "Y",
        "branch": "Orlando", "contractValueCents": 100000,
    }
    body.update(over)
    return body


# ── Unit tests for the pure classifier ────────────────────────────────────────

class TestLineDiscipline:
    def test_override_wins_over_service_type(self):
        assert est._line_discipline("landscape", "Irrigation") == "landscape"
        assert est._line_discipline("irrigation", "Turf Area") == "irrigation"

    def test_derives_from_irrigation_service_type(self):
        assert est._line_discipline(None, "Irrigation") == "irrigation"

    def test_derives_landscape_for_other_service_types(self):
        assert est._line_discipline(None, "Turf Area") == "landscape"

    def test_manual_line_with_no_service_type_defaults_landscape(self):
        assert est._line_discipline(None, None) == "landscape"

    def test_config_set_drives_classification(self, monkeypatch):
        monkeypatch.setattr(est, "IRRIGATION_SERVICE_TYPES", frozenset({"Irrigation", "Drainage"}))
        assert est._line_discipline(None, "Drainage") == "irrigation"


# ── Integration tests through POST /api/estimating/estimates ────────────────

class TestAutoSplitOnCreate:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_all_landscape_lines_produce_zero_ir(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.side_effect = [
            [{"id": "sec-1", "square_feet": 1000}],
            [{"section_id": "sec-1", "qty": 10, "unit_sell_cents": 10000,
              "complexity_pct": 0, "discipline": None, "catalog_item_id": "cat-turf"}],
            [{"id": "cat-turf", "service_type": "Turf Area"}],
            _scope_id_rows(),
        ]
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json=_create_body(contractValueCents=100000))
        assert resp.status_code == 201
        params = _itb_insert_params(mock_exec)
        assert 100000 in params  # est_ls_cents
        assert 0 in params       # est_ir_cents

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_mixed_lines_split_reconciles_exactly_to_total(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.side_effect = [
            [{"id": "sec-1", "square_feet": 1000}],
            [
                {"section_id": "sec-1", "qty": 10, "unit_sell_cents": 10000,
                 "complexity_pct": 0, "discipline": None, "catalog_item_id": "cat-turf"},
                {"section_id": "sec-1", "qty": 5, "unit_sell_cents": 6000,
                 "complexity_pct": 0, "discipline": None, "catalog_item_id": "cat-irr"},
            ],
            [
                {"id": "cat-turf", "service_type": "Turf Area"},
                {"id": "cat-irr", "service_type": "Irrigation"},
            ],
            _scope_id_rows(),
        ]
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json=_create_body(contractValueCents=130000))
        assert resp.status_code == 201
        params = _itb_insert_params(mock_exec)
        # IR = 5 * 6000 = 30000; LS = total(130000) - IR = 100000
        assert 30000 in params
        assert 100000 in params

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_per_line_override_wins_over_catalog_service_type(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.side_effect = [
            [{"id": "sec-1", "square_feet": 1000}],
            [{"section_id": "sec-1", "qty": 5, "unit_sell_cents": 10000, "complexity_pct": 0,
              "discipline": "landscape", "catalog_item_id": "cat-irr"}],
            _scope_id_rows(),
        ]
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json=_create_body(contractValueCents=50000))
        assert resp.status_code == 201
        params = _itb_insert_params(mock_exec)
        # override forces this irrigation-catalog line to LS -> full total, IR=0
        assert 50000 in params
        assert 0 in params
        # override present -> no catalog_items lookup needed
        assert not any("catalog_items" in c.args[0] for c in mock_query.call_args_list)

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_manual_line_defaults_landscape_override_moves_to_ir(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.side_effect = [
            [{"id": "sec-1", "square_feet": 1000}],
            [{"section_id": "sec-1", "qty": 2, "unit_sell_cents": 10000, "complexity_pct": 0,
              "discipline": "irrigation", "catalog_item_id": None}],
            _scope_id_rows(),
        ]
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json=_create_body(contractValueCents=20000))
        assert resp.status_code == 201
        params = _itb_insert_params(mock_exec)
        assert 0 in params       # est_ls_cents (all moved to IR)
        assert 20000 in params  # est_ir_cents

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_explicit_body_values_still_take_precedence(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.return_value = _scope_id_rows()
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json=_create_body(
            contractValueCents=100000, estLsCents=40000, estIrCents=60000,
        ))
        assert resp.status_code == 201
        params = _itb_insert_params(mock_exec)
        assert 40000 in params
        assert 60000 in params
        # explicit values short-circuit the split -- only the itb_scopes lookup runs
        mock_query.assert_called_once()

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_maintenance_estimate_uses_maintenance_formula(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.side_effect = [
            [{"id": "sec-1", "square_feet": 2000}],
            [{"section_id": "sec-1", "qty": 1, "unit_sell_cents": 2000, "complexity_pct": 0.1,
              "discipline": None, "catalog_item_id": "cat-irr"}],
            [{"id": "cat-irr", "service_type": "Irrigation"}],
            _scope_id_rows(),
        ]
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json=_create_body(
            estimateType="maintenance", contractValueCents=4400,
        ))
        assert resp.status_code == 201
        params = _itb_insert_params(mock_exec)
        # sell = (2000/1000) * 2000 * 1 * 1.1 = 4400 -> all irrigation
        assert 4400 in params
        assert 0 in params

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_no_persisted_lines_falls_back_to_all_landscape(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.side_effect = [[], _scope_id_rows()]
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json=_create_body(contractValueCents=5000))
        assert resp.status_code == 201
        params = _itb_insert_params(mock_exec)
        assert 5000 in params
        assert 0 in params
        assert mock_query.call_count == 2  # estimate_sections lookup (empty) + itb_scopes


# ── Recompute on line-item edit (Handoff 29 §4.3 — LOCKED default) ──────────

class TestRecomputeOnEdit:
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_adding_a_service_recomputes_the_split(
        self, mock_query, mock_exec, authed
    ):
        mock_query.side_effect = [
            [{"id": "sec-1"}],                                            # section ownership
            [{"estimate_type": "install"}],                               # estimate_type (maintenance guard)
            [{"c": 0}],                                                   # sort-order count
            [{"est_total_cents": 20000}],                                 # _recompute: itb_projects lookup
            [{"estimate_type": "install"}],                               # _recompute: estimate_type
            [{"id": "sec-1", "square_feet": 1000}],                       # _recompute: estimate_sections
            [{"section_id": "sec-1", "qty": 4, "unit_sell_cents": 5000,
              "complexity_pct": 0, "discipline": "irrigation",
              "catalog_item_id": None}],                                  # _recompute: section_services (batched)
            [{"id": "svc-1", "section_id": "sec-1", "catalog_item_id": None,
              "discipline": "irrigation", "label": "Drip", "qty": 4, "uom": "ea",
              "complexity_pct": 0, "unit_sell_cents": 5000, "embedded_cost_cents": None,
              "target_gm": None, "hours": None, "sort_order": 0}],        # reload the new service row
            [],                                                            # components
        ]
        resp = client.post(
            "/api/estimating/estimates/est-1/sections/sec-1/services",
            json={"label": "Drip", "qty": 4, "unitSellCents": 5000, "discipline": "irrigation"},
        )
        assert resp.status_code == 201
        update = next(c for c in mock_exec.call_args_list
                      if "UPDATE itb_projects" in c.args[0])
        sql, params = update.args
        # sell = 4 * 5000 = 20000, all irrigation -> total is now the live
        # line sum (20000), not the stale creation-time est_total_cents.
        assert params == [20000, 0, 20000, "est-1"]


# ── End-to-end round trip against a real (in-memory) DB, not a canned mock ──
#
# The tests above pin the exact query() call sequence — useful for locking
# down the contract, but they'd pass even if the split silently used stale
# data. This uses tests/test_estimating_line_items.py's FakeDb (interprets
# real SQL against in-memory tables) to prove the split actually reflects
# what's persisted after real intake (sections: []) + a later line-item add.

class TestRecomputeEndToEnd:
    def test_split_updates_as_lines_are_added_after_real_intake(self, estimator, db):
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "install", "name": "Greenfield", "clientName": "LLC",
            "branch": "Orlando, FL", "contractValueCents": 100000,
            "dueBackDate": "2026-09-30", "sections": [],  # real intake shape
        })
        assert resp.status_code == 201
        estimate_id = resp.json()["id"]
        itb_row = next(r for r in db.tables["itb_projects"].values()
                        if r["estimate_id"] == estimate_id)
        assert itb_row["est_ls_cents"] == 100000
        assert itb_row["est_ir_cents"] == 0

        section_resp = client.post(
            f"/api/estimating/estimates/{estimate_id}/sections",
            json={"name": "Zone 1", "squareFeet": 0},
        )
        assert section_resp.status_code == 201
        section_id = section_resp.json()["id"]

        service_resp = client.post(
            f"/api/estimating/estimates/{estimate_id}/sections/{section_id}/services",
            json={"label": "Drip line", "qty": 2, "uom": "ea",
                  "unitSellCents": 30000, "discipline": "irrigation"},
        )
        assert service_resp.status_code == 201

        itb_row = next(r for r in db.tables["itb_projects"].values()
                        if r["estimate_id"] == estimate_id)
        # The only line is irrigation, so LS is 0 -- not negative, and not the
        # stale creation-time total minus IR (a prior bug: total_cents(100000)
        # - ir_cents(60000) would have left a nonsensical est_ls_cents=40000
        # even though there's no landscape line at all). The total itself is
        # now the live sum of persisted lines, not the frozen intake value.
        assert itb_row["est_ir_cents"] == 60000
        assert itb_row["est_ls_cents"] == 0
        assert itb_row["est_total_cents"] == 60000

    def test_ir_exceeding_the_stale_intake_total_never_goes_negative(self, estimator, db):
        """Regression: adding irrigation lines that sum past the frozen
        creation-time contractValueCents used to compute est_ls_cents as
        total_cents - ir_cents, going negative. LS is now the sum of
        landscape-classified lines directly, so it can never be negative."""
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "install", "name": "Greenfield", "clientName": "LLC",
            "branch": "Orlando, FL", "contractValueCents": 100000,
            "dueBackDate": "2026-09-30", "sections": [],
        })
        estimate_id = resp.json()["id"]

        section_resp = client.post(
            f"/api/estimating/estimates/{estimate_id}/sections",
            json={"name": "Zone 1", "squareFeet": 0},
        )
        section_id = section_resp.json()["id"]

        # Irrigation lines totalling far more than the original $1,000 intake.
        for _ in range(2):
            resp = client.post(
                f"/api/estimating/estimates/{estimate_id}/sections/{section_id}/services",
                json={"label": "Drip line", "qty": 1, "uom": "ea",
                      "unitSellCents": 150000, "discipline": "irrigation"},
            )
            assert resp.status_code == 201

        itb_row = next(r for r in db.tables["itb_projects"].values()
                        if r["estimate_id"] == estimate_id)
        assert itb_row["est_ir_cents"] == 300000
        assert itb_row["est_ls_cents"] == 0
        assert itb_row["est_ls_cents"] >= 0
