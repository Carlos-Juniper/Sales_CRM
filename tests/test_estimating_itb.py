"""ITB Tracker Backend & Auto-Generation.

DB fully mocked — patch api.estimating.query/execute and api.authz.query.

Contract under test:

  Auto-generation (LOCKED decision): creating an estimate from EITHER intake
  form (maintenance or install) auto-creates exactly ONE linked itb_projects
  row (itb_projects.estimate_id FK, 1:1) plus one itb_scope_status row per
  itb_scopes row, each initialized to the default status code 'P' (Pending —
  pending final legend confirmation with Carlos).

  GET   /api/estimating/itb/projects
        → all ACTIVE estimates' projects. "Active" = estimates.status NOT IN
          ('won','lost') (default; include handed_back/approved).
          Branch-scoped (scope from the JWT, never the client).
          Each project embeds its scope statuses.

  PATCH /api/estimating/itb/projects/{id}/scopes/{scope_id}
        → update one scope's status code; body {"statusCode": "X"}; upserts so
          scopes added AFTER a project was created still accept status.

  Scopes themselves come from GET /config/itb-scopes — NOT
  re-exposed here.
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

client = TestClient(app)

_ESTIMATOR = {"id": "u1", "name": "Carlos", "email": "c@x.com",
              "role": "maintenance_estimating", "branch_id": "Orlando, FL",
              "avatar_initials": "CH"}
_ADMIN = {"id": "u2", "name": "Ada", "email": "a@x.com", "role": "admin",
          "branch_id": None, "avatar_initials": "AD"}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def authed_admin():
    app.dependency_overrides[require_auth] = lambda: _ADMIN
    yield
    app.dependency_overrides.clear()


def _scope_id_rows() -> list[dict]:
    return [{"id": "scope-landscape"}, {"id": "scope-irrigation"}, {"id": "scope-trees"}]


def _project_row(**over) -> dict:
    row = {
        "id": "itb-1",
        "estimate_id": "est-1",
        "name": "Desert Ridge Phase 2",
        "aspire_number": "ASP-48211",
        "branch": "Orlando, FL",
        "sales_rep": "Amanda Torres",
        "ls_estimator": "Carlos H",
        "irr_estimator": "Maria R",
        "irr_designer": None,
        "bid_number": None,
        "itb_date": "2026-08-04",
        "due_date": "2026-09-30",
        "rebid": 0,
        "est_total_cents": 4500000,
        "est_ls_cents": 4500000,
        "est_ir_cents": 0,
        "client": "Desert Ridge LLC",
        "quarter": "Q3",
        "notes": None,
        "created_at": "2026-08-04 10:00:00",
        "updated_at": "2026-08-04 10:00:00",
    }
    row.update(over)
    return row


# ── Auto-generation on estimate create (both intake types) ───────────────────

class TestAutoGeneration:
    @pytest.mark.parametrize("est_type", ["maintenance", "install"])
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_create_estimate_creates_exactly_one_itb_project(
        self, mock_query, mock_exec, mock_load, mock_bg, authed, est_type
    ):
        # [] → estimate_sections (no lines → fallback total,0); _scope_id_rows → itb_scopes
        mock_query.side_effect = [[], _scope_id_rows()]
        mock_load.return_value = {"id": "est-1", "estimateType": est_type}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": est_type, "name": "Greenfield", "clientName": "LLC",
            "branch": "Orlando, FL", "contractValueCents": 4500000,
            "dueBackDate": "2026-09-30",
        })
        assert resp.status_code == 201
        itb_inserts = [c for c in mock_exec.call_args_list
                       if "INSERT INTO itb_projects" in c.args[0]]
        assert len(itb_inserts) == 1

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_itb_project_row_links_estimate_and_carries_intake_fields(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        # [] → estimate_sections (no lines → fallback total,0); _scope_id_rows → itb_scopes
        mock_query.side_effect = [[], _scope_id_rows()]
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "install", "name": "Greenfield Estate",
            "aspireNumber": "ASP-9", "clientName": "Greenfield LLC",
            "branch": "Orlando, FL", "contractValueCents": 12000000,
            "crmRep": "Amanda Torres", "assignedLsEstimator": "Carlos H",
            "assignedIrrEstimator": "Maria R", "dueBackDate": "2026-11-15",
        })
        assert resp.status_code == 201
        insert = next(c for c in mock_exec.call_args_list
                      if "INSERT INTO itb_projects" in c.args[0])
        sql, params = insert.args
        assert "estimate_id" in sql
        # the new estimate's id is linked into the ITB row
        est_insert_params = mock_exec.call_args_list[0].args[1]
        estimate_id = est_insert_params[0]
        assert estimate_id in params
        for expected in ["Greenfield Estate", "ASP-9", "Greenfield LLC",
                         "Orlando, FL", "Amanda Torres", "Carlos H", "Maria R",
                         12000000, "2026-11-15"]:
            assert expected in params, expected
        # quarter derived from the due date (Nov → Q4)
        assert "Q4" in params

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_scope_status_rows_initialized_for_every_scope_with_default_code(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        # [] → estimate_sections (no lines → fallback total,0); _scope_id_rows → itb_scopes
        mock_query.side_effect = [[], _scope_id_rows()]
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "HOA", "clientName": "HOA LLC",
            "branch": "Orlando",
        })
        assert resp.status_code == 201
        status_inserts = [c for c in mock_exec.call_args_list
                          if "INSERT INTO itb_scope_status" in c.args[0]]
        assert len(status_inserts) == len(_scope_id_rows())
        inserted_scope_ids = {c.args[1][1] for c in status_inserts}
        assert inserted_scope_ids == {"scope-landscape", "scope-irrigation", "scope-trees"}
        # default initial status code — 'P' Pending (confirmed with Carlos)
        assert all(c.args[1][2] == est.DEFAULT_ITB_STATUS for c in status_inserts)
        assert est.DEFAULT_ITB_STATUS == "P"

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_config_driven_scope_add_no_code_change(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        """Adding a row to itb_scopes yields one more status row at creation
        with NO code edit (BRD §2.1)."""
        # [] → estimate_sections (no lines → fallback total,0); extended list → itb_scopes
        mock_query.side_effect = [[], _scope_id_rows() + [{"id": "scope-brand-new"}]]
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        client.post("/api/estimating/estimates", json={
            "estimateType": "install", "name": "X", "clientName": "Y",
            "branch": "Orlando",
        })
        status_inserts = [c for c in mock_exec.call_args_list
                          if "INSERT INTO itb_scope_status" in c.args[0]]
        assert len(status_inserts) == 4
        assert "scope-brand-new" in {c.args[1][1] for c in status_inserts}


# ── GET /api/estimating/itb/projects ─────────────────────────────────────────

class TestListItbProjects:
    def test_requires_auth(self):
        assert client.get("/api/estimating/itb/projects").status_code in (401, 403)

    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_returns_projects_shaped_to_ts_type_with_embedded_statuses(
        self, mock_query, authed_admin
    ):
        mock_query.side_effect = [
            [_project_row()],
            [{"project_id": "itb-1", "scope_id": "scope-landscape", "status_code": "X"},
             {"project_id": "itb-1", "scope_id": "scope-irrigation", "status_code": "P"}],
        ]
        resp = client.get("/api/estimating/itb/projects")
        assert resp.status_code == 200
        body = resp.json()
        assert body == [{
            "id": "itb-1",
            "estimateId": "est-1",
            "name": "Desert Ridge Phase 2",
            "aspireNumber": "ASP-48211",
            "branch": "Orlando, FL",
            "salesRep": "Amanda Torres",
            "lsEstimator": "Carlos H",
            "irrEstimator": "Maria R",
            "irrDesigner": None,
            "bidNumber": None,
            "itbDate": "2026-08-04",
            "dueDate": "2026-09-30",
            "rebid": False,
            "estTotalCents": 4500000,
            "estLsCents": 4500000,
            "estIrCents": 0,
            "client": "Desert Ridge LLC",
            "quarter": "Q3",
            "notes": None,
            "statuses": [
                {"projectId": "itb-1", "scopeId": "scope-landscape", "statusCode": "X"},
                {"projectId": "itb-1", "scopeId": "scope-irrigation", "statusCode": "P"},
            ],
        }]

    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_active_filter_excludes_won_and_lost(self, mock_query, authed_admin):
        mock_query.side_effect = [[], []]
        resp = client.get("/api/estimating/itb/projects")
        assert resp.status_code == 200
        sql = mock_query.call_args_list[0].args[0]
        assert "NOT IN ('won', 'lost')" in sql

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_branch_scoped_for_branch_roles(self, mock_query, mock_authz_query, authed):
        # Amendment B.1: scope comes from user_branches (aspire_branch_id ints),
        # filtered on the linked estimate's aspire_branch_id.
        mock_authz_query.return_value = [
            {"aspire_branch_id": 1403}, {"aspire_branch_id": 3696}
        ]
        mock_query.side_effect = [[], []]
        resp = client.get("/api/estimating/itb/projects")
        assert resp.status_code == 200
        sql, params = mock_query.call_args_list[0].args
        assert "e.aspire_branch_id IN (%s, %s)" in sql
        assert 1403 in params and 3696 in params

    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_cross_branch_role_sees_all(self, mock_query, authed_admin):
        mock_query.side_effect = [[], []]
        resp = client.get("/api/estimating/itb/projects")
        assert resp.status_code == 200
        sql = mock_query.call_args_list[0].args[0]
        assert "branch = %s" not in sql

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_no_branch_assignment_sees_no_rows(self, mock_query, mock_authz_query):
        # Zero user_branches rows → kind='none' → empty, no estimates query.
        mock_authz_query.return_value = []
        app.dependency_overrides[require_auth] = lambda: {**_ESTIMATOR, "branch_id": None}
        try:
            resp = client.get("/api/estimating/itb/projects")
        finally:
            app.dependency_overrides.clear()
        assert resp.status_code == 200
        assert resp.json() == []
        mock_query.assert_not_called()


# ── PATCH /api/estimating/itb/projects/{id}/scopes/{scope_id} ────────────────

class TestUpdateScopeStatus:
    def test_requires_auth(self):
        resp = client.patch(
            "/api/estimating/itb/projects/itb-1/scopes/scope-landscape",
            json={"statusCode": "X"},
        )
        assert resp.status_code in (401, 403)

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_upserts_status_and_returns_it(self, mock_query, mock_exec, authed):
        mock_query.side_effect = [[{"id": "itb-1"}], [{"id": "scope-landscape"}]]
        resp = client.patch(
            "/api/estimating/itb/projects/itb-1/scopes/scope-landscape",
            json={"statusCode": "X"},
        )
        assert resp.status_code == 200
        assert resp.json() == {
            "projectId": "itb-1", "scopeId": "scope-landscape", "statusCode": "X",
        }
        sql, params = mock_exec.call_args.args
        assert "itb_scope_status" in sql
        assert "ON DUPLICATE KEY UPDATE" in sql
        assert params[:3] == ["itb-1", "scope-landscape", "X"]

    @pytest.mark.parametrize("bad", ["Z", "", "PP", None, "E", "I"])
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_rejects_invalid_status_code(self, mock_query, mock_exec, authed, bad):
        resp = client.patch(
            "/api/estimating/itb/projects/itb-1/scopes/scope-landscape",
            json={"statusCode": bad},
        )
        assert resp.status_code == 400
        mock_exec.assert_not_called()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_404_when_project_missing(self, mock_query, mock_exec, authed):
        mock_query.side_effect = [[]]
        resp = client.patch(
            "/api/estimating/itb/projects/nope/scopes/scope-landscape",
            json={"statusCode": "X"},
        )
        assert resp.status_code == 404
        mock_exec.assert_not_called()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_404_when_scope_missing(self, mock_query, mock_exec, authed):
        mock_query.side_effect = [[{"id": "itb-1"}], []]
        resp = client.patch(
            "/api/estimating/itb/projects/itb-1/scopes/nope",
            json={"statusCode": "X"},
        )
        assert resp.status_code == 404
        mock_exec.assert_not_called()

    @pytest.mark.parametrize("code", ["P", "C", "S", "R", "U", "X", "-"])
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_accepts_every_legend_code(self, mock_query, mock_exec, authed, code):
        mock_query.side_effect = [[{"id": "itb-1"}], [{"id": "scope-landscape"}]]
        resp = client.patch(
            "/api/estimating/itb/projects/itb-1/scopes/scope-landscape",
            json={"statusCode": code},
        )
        assert resp.status_code == 200
        assert resp.json()["statusCode"] == code


# ── Quarter derivation helper ─────────────────────────────────────────────────

class TestQuarterHelper:
    @pytest.mark.parametrize("d,q", [
        ("2026-01-15", "Q1"), ("2026-03-31", "Q1"), ("2026-04-01", "Q2"),
        ("2026-06-30", "Q2"), ("2026-07-01", "Q3"), ("2026-09-30", "Q3"),
        ("2026-10-01", "Q4"), ("2026-12-31", "Q4"),
    ])
    def test_quarter_from_iso_date(self, d, q):
        assert est._quarter_for(d) == q
