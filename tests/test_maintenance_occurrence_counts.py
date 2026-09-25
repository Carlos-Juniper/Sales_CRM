"""Yearly maintenance service occurrence counts (migration 061).

Six nullable integers on the estimate — mowing, pruning, turf fert, shrub fert,
IPM, and irrigation — accepted on maintenance create and on PATCH, returned by
the estimate serializer that both the detail and list routes use.

scopeOfWork stays optional free text inside intake.payload. Older rows keep
whatever scope text was already stored there; create does not require it.
"""
from __future__ import annotations

import json
import os
import re
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
import api.estimating as est  # noqa: E402
import scripts.migrate as migrate  # noqa: E402

client = TestClient(app)

_USER = {
    "id": "u1", "name": "Carlos", "email": "c@x.com", "role": "maintenance_estimating",
    "branch_id": "Orlando, FL", "avatar_initials": "CH",
}

_COUNTS = {
    "mowingOccurrences": 42,
    "pruningOccurrences": 12,
    "turfFertOccurrences": 6,
    "shrubFertOccurrences": 4,
    "ipmOccurrences": 8,
    "irrigationOccurrences": 52,
}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _estimates_insert(mock_exec) -> dict:
    sql, params = mock_exec.call_args_list[0].args
    match = re.search(r"INSERT INTO estimates\s*\((.*?)\)\s*VALUES", sql, re.S | re.I)
    assert match, sql
    cols = [c.strip() for c in match.group(1).split(",")]
    assert len(cols) == len(params), (cols, params)
    return dict(zip(cols, params))


def _base_create(**over) -> dict:
    body = {
        "estimateType": "maintenance",
        "name": "Sunny HOA",
        "clientName": "HOA",
        "aspireBranchId": 3668,
        "branchCity": "Orlando, FL",
    }
    body.update(over)
    return body


def _full_row(**over) -> dict:
    row = {
        "id": "est-1", "estimate_type": "maintenance", "name": "Sunny HOA",
        "aspire_number": None, "client_name": "HOA", "customer_type": "hoa",
        "acreage": None, "contract_value_cents": 0, "target_margin": 0.22,
        "status": "new_from_sales", "lifecycle": "bidding",
        "aspire_owner": "estimating", "priority": "medium", "win_probability": 0.2,
        "site_walk_date": None, "due_back_date": None, "anticipated_close_date": None,
        "service_start_date": None, "assigned_ls_estimator": None,
        "assigned_irr_estimator": None, "crm_rep": None, "notify_bm_rd_on_return": None,
        "created_at": None, "updated_at": None,
        "aspire_branch_id": 3668, "branch_city": "Orlando, FL",
        "mowing_occurrences": 42, "pruning_occurrences": 12,
        "turf_fert_occurrences": 6, "shrub_fert_occurrences": 4,
        "ipm_occurrences": 8, "irrigation_occurrences": 52,
    }
    row.update(over)
    return row


# ── create ────────────────────────────────────────────────────────────────────

class TestCreateOccurrenceCounts:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_maintenance_create_persists_counts(
        self, mock_query, mock_exec, mock_load, _bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json=_base_create(**_COUNTS))
        assert resp.status_code == 201
        written = _estimates_insert(mock_exec)
        for camel, column in est._OCCURRENCE_COUNT_FIELDS.items():
            assert written[column] == _COUNTS[camel]

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_omitted_counts_store_null(
        self, mock_query, mock_exec, mock_load, _bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = client.post("/api/estimating/estimates", json=_base_create())
        assert resp.status_code == 201
        written = _estimates_insert(mock_exec)
        for column in est._OCCURRENCE_COUNT_FIELDS.values():
            assert written[column] is None

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_explicit_null_and_zero(
        self, mock_query, mock_exec, mock_load, _bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = client.post("/api/estimating/estimates", json=_base_create(
            mowingOccurrences=0,
            pruningOccurrences=None,
            irrigationOccurrences=est.MAX_YEARLY_OCCURRENCES,
        ))
        assert resp.status_code == 201
        written = _estimates_insert(mock_exec)
        assert written["mowing_occurrences"] == 0
        assert written["pruning_occurrences"] is None
        assert written["irrigation_occurrences"] == 366

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_install_create_unchanged_when_counts_omitted(
        self, mock_query, mock_exec, mock_load, _bg, authed
    ):
        """Install intake does not send the counts and does not require scope text."""
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "install", "name": "Planting", "clientName": "LLC",
            "aspireBranchId": 1403, "branchCity": "Fort Myers, FL",
        })
        assert resp.status_code == 201
        written = _estimates_insert(mock_exec)
        for column in est._OCCURRENCE_COUNT_FIELDS.values():
            assert written[column] is None
        assert not any("intake_submissions" in c.args[0] for c in mock_exec.call_args_list)

    @pytest.mark.parametrize("bad", [-1, 367, 1.5, "42", True, False, "0"])
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_bad_count_is_422_and_persists_nothing(self, mock_query, mock_exec, bad, authed):
        resp = client.post("/api/estimating/estimates", json=_base_create(mowingOccurrences=bad))
        assert resp.status_code == 422
        assert "mowingOccurrences" in resp.json()["detail"]
        mock_exec.assert_not_called()
        mock_query.assert_not_called()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    def test_each_field_names_itself_in_the_422(self, mock_exec, authed):
        resp = client.post("/api/estimating/estimates", json=_base_create(ipmOccurrences=-3))
        assert resp.status_code == 422
        assert resp.json()["detail"].startswith("ipmOccurrences")
        mock_exec.assert_not_called()


# ── scope of work stays optional, and existing payload text is kept ──────────

class TestScopeOfWorkOptional:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_maintenance_create_without_scope_of_work(
        self, mock_query, mock_exec, mock_load, _bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = client.post("/api/estimating/estimates", json=_base_create(
            intake={"payload": {"contactName": "Ada", "homeCount": "142"}},
            **_COUNTS,
        ))
        assert resp.status_code == 201
        intake_sql, intake_params = next(
            c.args for c in mock_exec.call_args_list if "intake_submissions" in c.args[0]
        )
        assert "INSERT INTO intake_submissions" in intake_sql
        stored = json.loads(intake_params[3])
        assert "scopeOfWork" not in stored
        assert stored["homeCount"] == "142"
        assert stored["contactName"] == "Ada"

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_existing_scope_text_is_still_stored(
        self, mock_query, mock_exec, mock_load, _bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = client.post("/api/estimating/estimates", json=_base_create(
            intake={"payload": {"scopeOfWork": "Weekly mow, monthly IPM"}},
        ))
        assert resp.status_code == 201
        _, intake_params = next(
            c.args for c in mock_exec.call_args_list if "intake_submissions" in c.args[0]
        )
        stored = json.loads(intake_params[3])
        assert stored["scopeOfWork"] == "Weekly mow, monthly IPM"

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_blank_scope_of_work_is_accepted(
        self, mock_query, mock_exec, mock_load, _bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1"}
        resp = client.post("/api/estimating/estimates", json=_base_create(
            intake={"payload": {"scopeOfWork": ""}},
        ))
        assert resp.status_code == 201


# ── update ────────────────────────────────────────────────────────────────────

class TestUpdateOccurrenceCounts:
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_writes_each_count(self, mock_query, mock_exec, mock_load, authed):
        mock_query.return_value = [{
            "estimate_type": "maintenance", "status": "in_progress",
            "aspire_opportunity_id": None,
        }]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json=_COUNTS)
        assert resp.status_code == 200
        sql, params = mock_exec.call_args.args
        for camel, column in est._OCCURRENCE_COUNT_FIELDS.items():
            assert f"{column} = %s" in sql
            assert _COUNTS[camel] in params

    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_null_clears_a_count(self, mock_query, mock_exec, mock_load, authed):
        mock_query.return_value = [{
            "estimate_type": "maintenance", "status": "in_progress",
            "aspire_opportunity_id": None,
        }]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={"pruningOccurrences": None})
        assert resp.status_code == 200
        sql, params = mock_exec.call_args.args
        assert "pruning_occurrences = %s" in sql
        assert params[0] is None
        assert "mowing_occurrences" not in sql

    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_omitted_count_is_left_alone(self, mock_query, mock_exec, mock_load, authed):
        mock_query.return_value = [{
            "estimate_type": "install", "status": "in_progress",
            "aspire_opportunity_id": None,
        }]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={"notes": "walk done"})
        assert resp.status_code == 200
        sql, _params = mock_exec.call_args.args
        assert "notes = %s" in sql
        for column in est._OCCURRENCE_COUNT_FIELDS.values():
            assert column not in sql

    @pytest.mark.parametrize("bad", [-1, 367, 2.0, "12", True])
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_bad_count_is_422(self, mock_query, mock_exec, bad, authed):
        mock_query.return_value = [{
            "estimate_type": "maintenance", "status": "in_progress",
            "aspire_opportunity_id": None,
        }]
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"turfFertOccurrences": bad},
        )
        assert resp.status_code == 422
        assert "turfFertOccurrences" in resp.json()["detail"]
        mock_exec.assert_not_called()

    def test_updatable_map_includes_every_count(self):
        for camel, column in est._OCCURRENCE_COUNT_FIELDS.items():
            assert est._UPDATABLE[camel] == column


# ── detail and list share _estimate_out ──────────────────────────────────────

class TestSerializeOccurrenceCounts:
    def test_detail_shape_includes_counts(self):
        out = est._estimate_out(_full_row(), sections=[])
        assert out["mowingOccurrences"] == 42
        assert out["pruningOccurrences"] == 12
        assert out["turfFertOccurrences"] == 6
        assert out["shrubFertOccurrences"] == 4
        assert out["ipmOccurrences"] == 8
        assert out["irrigationOccurrences"] == 52

    def test_nulls_and_zero_round_trip(self):
        out = est._estimate_out(_full_row(
            mowing_occurrences=0, pruning_occurrences=None,
        ), sections=[])
        assert out["mowingOccurrences"] == 0
        assert out["pruningOccurrences"] is None

    def test_pre_migration_row_serializes_null(self):
        row = _full_row()
        for column in est._OCCURRENCE_COUNT_FIELDS.values():
            row.pop(column)
        out = est._estimate_out(row, sections=[])
        for camel in est._OCCURRENCE_COUNT_FIELDS:
            assert out[camel] is None

    def test_list_and_detail_both_load_through_estimate_out(self):
        """GET /estimates and GET /estimates/{id} both return _load_estimate,
        which is the only caller of _estimate_out. A count on that serializer
        is on both responses."""
        import inspect
        load_src = inspect.getsource(est._load_estimate)
        assert "_estimate_out" in load_src
        list_src = inspect.getsource(est.register)
        # Rush SLA loads each row through _load_estimate (with the window) and
        # returns those estimates. Detail still returns the loaded estimate.
        assert 'await _load_estimate(r["id"], sla_window_days=window)' in list_src
        assert "return [est for est in loaded if est is not None]" in list_src
        assert "return est" in list_src


# ── migration 061 ─────────────────────────────────────────────────────────────

class TestMigration061:
    def test_detector_keys_on_last_column(self, monkeypatch):
        monkeypatch.setattr(
            migrate, "column_exists",
            lambda conn, table, column: table == "estimates" and column == "irrigation_occurrences",
        )
        assert migrate.detect_061(None) is True
        monkeypatch.setattr(migrate, "column_exists", lambda conn, table, column: False)
        assert migrate.detect_061(None) is False
        assert migrate._DETECT["061_estimate_maintenance_occurrence_counts"] is migrate.detect_061

    def test_sql_adds_each_count_with_a_guard(self):
        sql = (
            migrate.MIGRATIONS_DIR / "061_estimate_maintenance_occurrence_counts.sql"
        ).read_text()
        for column in est._OCCURRENCE_COUNT_FIELDS.values():
            assert column in sql
        stmts = migrate.split_statements(sql)
        alters = [s for s in stmts if "ADD COLUMN" in s]
        assert len(alters) == 6
        assert all(s.lstrip().upper().startswith("SET") for s in alters)
        assert stmts[-1].upper().startswith("DEALLOCATE")
