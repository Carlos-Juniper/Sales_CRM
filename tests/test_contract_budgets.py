"""Contract-structure budgets (homes + common area) are optional.

Null is unknown, not zero. Omitted, null, and blank store NULL. A sent 0
stays 0. Priced totals (contract value, ITB split) do not absorb these
figures, so an unknown budget cannot crash or zero-out those paths.
"""
from __future__ import annotations

import json
import os
import re
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
import api.estimating as est  # noqa: E402
from api.aspire_sync import build_opportunity_payload  # noqa: E402

client = TestClient(app)

_USER = {
    "id": "u1", "name": "Carlos", "email": "c@x.com", "role": "maintenance_estimating",
    "branch_id": "Orlando, FL", "avatar_initials": "CH",
}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _estimates_insert(mock_exec):
    call = next(c for c in mock_exec.call_args_list if "INSERT INTO estimates" in c.args[0])
    sql, params = call.args
    match = re.search(r"INSERT INTO estimates\s*\((.*?)\)\s*VALUES", sql, re.S | re.I)
    cols = [c.strip() for c in match.group(1).split(",")]
    assert sql.count("%s") == len(cols) == len(params)
    return dict(zip(cols, params))


def _itb_insert(mock_exec):
    call = next(c for c in mock_exec.call_args_list if "INSERT INTO itb_projects" in c.args[0])
    sql, params = call.args
    match = re.search(r"INSERT INTO itb_projects\s*\((.*?)\)\s*VALUES", sql, re.S | re.I)
    cols = [c.strip() for c in match.group(1).split(",")]
    return dict(zip(cols, params))


def _intake_payload(mock_exec) -> dict:
    call = next(c for c in mock_exec.call_args_list if "INSERT INTO intake_submissions" in c.args[0])
    raw = next(p for p in call.args[1] if isinstance(p, str) and p.startswith("{"))
    return json.loads(raw)


def _post(body: dict):
    return client.post("/api/estimating/estimates", json=body)


def _base(**over) -> dict:
    body = {
        "estimateType": "maintenance",
        "name": "Sunny HOA",
        "clientName": "Sunny HOA",
        "aspireBranchId": 3668,
        "branchCity": "Orlando, FL",
    }
    body.update(over)
    return body


# ── null is unknown, not zero ────────────────────────────────────────────────

class TestCombineContractBudgets:
    def test_unknown_side_makes_the_total_unknown(self):
        assert est.combine_contract_budgets(None, 0) is None
        assert est.combine_contract_budgets(0, None) is None
        assert est.combine_contract_budgets(None, None) is None
        assert est.combine_contract_budgets(120_000, None) is None

    def test_known_zero_still_sums(self):
        assert est.combine_contract_budgets(0, 0) == Decimal("0")
        assert est.combine_contract_budgets(120_000, 0) == Decimal("120000")
        assert est.combine_contract_budgets(120_000, 80_000) == Decimal("200000")


class TestBudgetParsing:
    def test_blank_and_null_are_unknown(self):
        assert est.parse_optional_budget(None, "homesBudget") is None
        assert est.parse_optional_budget("", "homesBudget") is None
        assert est.parse_optional_budget("   ", "homesBudget") is None

    def test_zero_stays_zero(self):
        assert est._budget_db_value(est.parse_optional_budget(0, "homesBudget")) == 0
        assert est._budget_db_value(est.parse_optional_budget(0.0, "homesBudget")) == 0
        assert est._budget_db_value(est.parse_optional_budget("0", "homesBudget")) == 0
        assert est._budget_db_value(est.parse_optional_budget("0.00", "homesBudget")) == 0

    def test_numeric_string_and_fraction_round_half_up(self):
        assert est._budget_db_value(est.parse_optional_budget("120000", "homesBudget")) == 120000
        assert est._budget_db_value(est.parse_optional_budget("120000.50", "homesBudget")) == 120000.5
        assert est._budget_db_value(est.parse_optional_budget("10.005", "commonAreaBudget")) == 10.01

    @pytest.mark.parametrize("bad", ["abc", "12 dollars", True, False, [], {}])
    def test_non_numeric_rejected(self, bad):
        with pytest.raises(Exception) as exc:
            est.parse_optional_budget(bad, "homesBudget")
        assert exc.value.status_code == 400

    def test_negative_rejected(self):
        with pytest.raises(Exception) as exc:
            est.parse_optional_budget(-1, "commonAreaBudget")
        assert exc.value.status_code == 400
        assert "negative" in exc.value.detail


class TestEstimateOut:
    def _row(self, **over) -> dict:
        row = {
            "id": "est-1", "estimate_type": "maintenance", "name": "Sunny",
            "aspire_number": None, "client_name": "HOA", "customer_type": "hoa",
            "acreage": None, "contract_value_cents": 0, "target_margin": 0.22,
            "status": "new_from_sales", "lifecycle": "bidding", "aspire_owner": "estimating",
            "priority": "medium", "win_probability": 0.2, "site_walk_date": None,
            "due_back_date": None, "anticipated_close_date": None, "service_start_date": None,
            "assigned_ls_estimator": None, "assigned_irr_estimator": None, "crm_rep": None,
            "notify_bm_rd_on_return": None, "created_at": None, "updated_at": None,
            "aspire_branch_id": 3668, "branch_city": "Orlando, FL",
        }
        row.update(over)
        return row

    def test_null_stays_null_and_zero_stays_zero(self):
        unknown = est._estimate_out(self._row(homes_budget=None, common_area_budget=Decimal("0.00")), [])
        assert unknown["homesBudget"] is None
        assert unknown["commonAreaBudget"] == 0

    def test_pre_migration_row_without_columns_is_null_not_zero(self):
        out = est._estimate_out(self._row(), [])
        assert out["homesBudget"] is None
        assert out["commonAreaBudget"] is None

    def test_decimal_dollars_serialize_without_collapsing_zero(self):
        out = est._estimate_out(
            self._row(homes_budget=Decimal("120000.50"), common_area_budget=Decimal("0")),
            [],
        )
        assert out["homesBudget"] == 120000.5
        assert out["commonAreaBudget"] == 0


# ── create_estimate insert + intake payload ──────────────────────────────────

class TestCreateBudgets:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_omitted_budgets_store_null_and_do_not_fill_priced_totals(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = _post(_base())
        assert resp.status_code == 201, resp.text
        cols = _estimates_insert(mock_exec)
        assert cols["homes_budget"] is None
        assert cols["common_area_budget"] is None
        # Default priced value stays 0; it is not derived from the budgets.
        assert cols["contract_value_cents"] == 0
        itb = _itb_insert(mock_exec)
        assert itb["est_total_cents"] == 0
        assert itb["est_ls_cents"] == 0
        assert itb["est_ir_cents"] == 0

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_blank_payload_is_null_and_sent_zero_stays_zero(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = _post(_base(intake={"payload": {
            "contractStructure": "split",
            "homesBudget": "",
            "commonAreaBudget": "0",
        }}))
        assert resp.status_code == 201, resp.text
        cols = _estimates_insert(mock_exec)
        assert cols["homes_budget"] is None
        assert cols["common_area_budget"] == 0
        stored = _intake_payload(mock_exec)
        assert stored["homesBudget"] is None
        assert stored["commonAreaBudget"] == 0
        # A known homes budget must not become the ITB total when the other
        # side is unknown and contract value was left at its default.
        assert _itb_insert(mock_exec)["est_total_cents"] == 0

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_explicit_null_and_numeric_dollars(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = _post(_base(
            homesBudget=None,
            commonAreaBudget=80000.5,
            contractValueCents=0,
        ))
        assert resp.status_code == 201, resp.text
        cols = _estimates_insert(mock_exec)
        assert cols["homes_budget"] is None
        assert cols["common_area_budget"] == 80000.5
        assert cols["contract_value_cents"] == 0
        itb = _itb_insert(mock_exec)
        assert itb["est_total_cents"] == 0
        assert 80000.5 not in itb.values()

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_top_level_wins_over_intake_payload(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = _post(_base(
            homesBudget=0,
            intake={"payload": {"homesBudget": "120000", "commonAreaBudget": ""}},
        ))
        assert resp.status_code == 201, resp.text
        cols = _estimates_insert(mock_exec)
        assert cols["homes_budget"] == 0
        assert cols["common_area_budget"] is None
        stored = _intake_payload(mock_exec)
        assert stored["homesBudget"] == 0
        assert stored["commonAreaBudget"] is None

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_invalid_budget_persists_nothing(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        resp = _post(_base(intake={"payload": {"homesBudget": "nope", "commonAreaBudget": 1}}))
        assert resp.status_code == 400
        assert "homesBudget" in resp.json()["detail"]
        mock_exec.assert_not_called()
        mock_query.assert_not_called()

class TestAspireIgnoresBudgets:
    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_null_budget_does_not_crash_or_become_a_zero_field(self, mock_query):
        mock_query.side_effect = [
            [{"aspire_property_id": 1, "branch_city": "Orlando, FL", "property_type": None}],
            [{"aspire_rep_id": None}],
        ]
        row = {
            "id": "est-1", "estimate_type": "maintenance", "name": "Sunny",
            "property_id": "prop-1", "crm_rep": "u9", "customer_type": "hoa",
            "aspire_branch_id": 3668, "homes_budget": None, "common_area_budget": 0,
        }
        inp = await est._build_opportunity_input(row)
        payload = build_opportunity_payload(inp)
        assert not any("budget" in k.lower() for k in payload)
        assert inp.name == "Sunny"


# ── PATCH + drafts ───────────────────────────────────────────────────────────

class TestPatchAndDraft:
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_null_clears_and_zero_is_kept(self, mock_query, mock_exec, mock_load, authed):
        mock_query.return_value = [{
            "estimate_type": "maintenance", "status": "in_progress",
            "aspire_opportunity_id": None,
        }]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={
            "homesBudget": None,
            "commonAreaBudget": 0,
        })
        assert resp.status_code == 200, resp.text
        sql, params = mock_exec.call_args.args
        assert "homes_budget = %s" in sql
        assert "common_area_budget = %s" in sql
        # updated_at is not a bound param; the two budgets are the bound values.
        assert params[0] is None
        assert params[1] == 0

    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_blank_string_stores_null(self, mock_query, mock_exec, mock_load, authed):
        mock_query.return_value = [{
            "estimate_type": "maintenance", "status": "in_progress",
            "aspire_opportunity_id": None,
        }]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={"homesBudget": "  "})
        assert resp.status_code == 200, resp.text
        _sql, params = mock_exec.call_args.args
        assert params[0] is None

    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_omitted_budget_is_left_alone(self, mock_query, mock_exec, mock_load, authed):
        mock_query.return_value = [{
            "estimate_type": "maintenance", "status": "in_progress",
            "aspire_opportunity_id": None,
        }]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={"notes": "walk done"})
        assert resp.status_code == 200, resp.text
        sql, _params = mock_exec.call_args.args
        assert "homes_budget" not in sql
        assert "common_area_budget" not in sql

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_draft_blank_becomes_null_and_zero_stays_zero(self, mock_query, mock_exec, authed):
        resp = client.post("/api/estimating/intake/drafts", json={
            "estimateType": "maintenance",
            "payload": {"homesBudget": "", "commonAreaBudget": "0", "contractStructure": "split"},
        })
        assert resp.status_code == 201, resp.text
        assert resp.json()["payload"]["homesBudget"] is None
        assert resp.json()["payload"]["commonAreaBudget"] == 0
        stored = json.loads(mock_exec.call_args.args[1][2])
        assert stored["homesBudget"] is None
        assert stored["commonAreaBudget"] == 0
