"""Maintenance Estimating Tracker — tracking_status + tracker_comment (§8).

Backend tests for:
  - _estimate_out serializes trackingStatus and trackerComment
  - PATCH tracking_status with valid value succeeds
  - PATCH tracking_status with invalid value → 422
  - PATCH trackerComment updates the field
  - GET /api/estimating/estimates?trackingStatus=<value> filters correctly
  - Migration 078 detector keys on tracking_status column
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from fastapi.testclient import TestClient

from api.server import app, require_auth
import api.estimating as est
import scripts.migrate as migrate

client = TestClient(app)

_ESTIMATOR = {
    "id": "u1", "name": "Carlos", "email": "c@x.com",
    "role": "maintenance_estimating",
    "branch_id": "Orlando, FL", "avatar_initials": "CH",
}

_MANAGER = {
    "id": "u2", "name": "Manager", "email": "m@x.com",
    "role": "maintenance_estimating_manager",
    "branch_id": "Orlando, FL", "avatar_initials": "MM",
}


@pytest.fixture
def authed_estimator():
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def authed_manager():
    app.dependency_overrides[require_auth] = lambda: _MANAGER
    yield
    app.dependency_overrides.clear()


def _full_row(**over) -> dict:
    """Minimal estimates row dict — mirrors conftest / test_maintenance_occurrence_counts."""
    row = {
        "id": "est-1",
        "estimate_type": "maintenance",
        "name": "Sunny HOA",
        "aspire_number": None,
        "estimate_number": None,
        "client_name": "HOA",
        "customer_type": "hoa",
        "aspire_branch_id": 3668,
        "branch_city": "Orlando, FL",
        "crew_rate_cents_per_hour": None,
        "prior_crew_rate_cents_per_hour": None,
        "homes_budget": None,
        "common_area_budget": None,
        "acreage": None,
        "contract_value_cents": 0,
        "target_margin": 0.22,
        "status": "in_progress",
        "lifecycle": "bidding",
        "aspire_owner": "estimating",
        "priority": "medium",
        "win_probability": 0.2,
        "site_walk_date": None,
        "due_back_date": None,
        "anticipated_close_date": None,
        "service_start_date": None,
        "assigned_ls_estimator": None,
        "assigned_irr_estimator": None,
        "crm_rep": None,
        "notify_bm_rd_on_return": None,
        "notes": None,
        "property_id": None,
        "lead_id": None,
        "aspire_opportunity_id": None,
        "aspire_sync_status": None,
        "rfi_status": None,
        "turf_area_acres": None,
        "curb_miles": None,
        "takeoff_changed_at": None,
        "mowing_occurrences": None,
        "pruning_occurrences": None,
        "turf_fert_occurrences": None,
        "shrub_fert_occurrences": None,
        "ipm_occurrences": None,
        "irrigation_occurrences": None,
        "tracking_status": None,
        "tracker_comment": None,
        "created_at": None,
        "updated_at": None,
    }
    row.update(over)
    return row


# ── Serializer ────────────────────────────────────────────────────────────────

class TestEstimateOutTrackerFields:
    def test_tracking_status_in_estimate_out(self):
        """_estimate_out includes trackingStatus from the DB row."""
        out = est._estimate_out(_full_row(tracking_status="in_progress"), sections=[])
        assert out["trackingStatus"] == "in_progress"

    def test_tracker_comment_in_estimate_out(self):
        """_estimate_out includes trackerComment from the DB row."""
        out = est._estimate_out(_full_row(tracker_comment="Waiting on site walk"), sections=[])
        assert out["trackerComment"] == "Waiting on site walk"

    def test_both_null_when_not_set(self):
        """Pre-migration rows (without the columns) return null for both fields."""
        row = _full_row()
        row.pop("tracking_status")
        row.pop("tracker_comment")
        out = est._estimate_out(row, sections=[])
        assert out["trackingStatus"] is None
        assert out["trackerComment"] is None

    def test_all_tracking_status_values_round_trip(self):
        """Every value in _TRACKING_STATUS_ENUM can be serialized."""
        for value in est._TRACKING_STATUS_ENUM:
            out = est._estimate_out(_full_row(tracking_status=value), sections=[])
            assert out["trackingStatus"] == value


# ── PATCH — valid tracking_status ─────────────────────────────────────────────

class TestPatchTrackingStatusValid:
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_tracking_status_valid(
        self, mock_query, mock_exec, mock_load, authed_estimator
    ):
        """PATCH with a valid trackingStatus writes the column and returns 200."""
        mock_query.return_value = [{
            "estimate_type": "maintenance",
            "status": "in_progress",
            "aspire_opportunity_id": None,
            "lead_id": None,
            "aspire_branch_id": 3668,
            "crew_rate_cents_per_hour": None,
        }]
        mock_load.return_value = {"id": "est-1", "trackingStatus": "drafted"}
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"trackingStatus": "drafted"},
        )
        assert resp.status_code == 200
        sql, params = mock_exec.call_args.args
        assert "tracking_status = %s" in sql
        assert "drafted" in params

    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_tracking_status_null_clears(
        self, mock_query, mock_exec, mock_load, authed_estimator
    ):
        """PATCH with null trackingStatus clears the column."""
        mock_query.return_value = [{
            "estimate_type": "maintenance",
            "status": "in_progress",
            "aspire_opportunity_id": None,
            "lead_id": None,
            "aspire_branch_id": 3668,
            "crew_rate_cents_per_hour": None,
        }]
        mock_load.return_value = {"id": "est-1", "trackingStatus": None}
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"trackingStatus": None},
        )
        assert resp.status_code == 200
        sql, params = mock_exec.call_args.args
        assert "tracking_status = %s" in sql
        assert params[0] is None


# ── PATCH — invalid tracking_status → 422 ────────────────────────────────────

class TestPatchTrackingStatusInvalid422:
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_patch_tracking_status_invalid_422(
        self, mock_query, mock_exec, authed_estimator
    ):
        """PATCH with an unrecognized trackingStatus value → 422."""
        mock_query.return_value = [{
            "estimate_type": "maintenance",
            "status": "in_progress",
            "aspire_opportunity_id": None,
            "lead_id": None,
            "aspire_branch_id": 3668,
            "crew_rate_cents_per_hour": None,
        }]
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"trackingStatus": "flying"},
        )
        assert resp.status_code == 422
        assert "trackingStatus" in resp.json()["detail"]
        mock_exec.assert_not_called()

    @pytest.mark.parametrize("bad", ["DRAFTED", "Done", "in progress", "", 0, True])
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_various_invalid_values_422(
        self, mock_query, mock_exec, bad, authed_estimator
    ):
        """Multiple bad values for trackingStatus all → 422."""
        mock_query.return_value = [{
            "estimate_type": "maintenance",
            "status": "in_progress",
            "aspire_opportunity_id": None,
            "lead_id": None,
            "aspire_branch_id": 3668,
            "crew_rate_cents_per_hour": None,
        }]
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"trackingStatus": bad},
        )
        assert resp.status_code == 422
        mock_exec.assert_not_called()


# ── PATCH — tracker_comment ───────────────────────────────────────────────────

class TestTrackerCommentPatchable:
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_tracker_comment_patchable(
        self, mock_query, mock_exec, mock_load, authed_estimator
    ):
        """PATCH trackerComment writes tracker_comment column."""
        mock_query.return_value = [{
            "estimate_type": "maintenance",
            "status": "in_progress",
            "aspire_opportunity_id": None,
            "lead_id": None,
            "aspire_branch_id": 3668,
            "crew_rate_cents_per_hour": None,
        }]
        mock_load.return_value = {"id": "est-1", "trackerComment": "Site walk booked"}
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"trackerComment": "Site walk booked"},
        )
        assert resp.status_code == 200
        sql, params = mock_exec.call_args.args
        assert "tracker_comment = %s" in sql
        assert "Site walk booked" in params

    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_tracker_comment_null_clears(
        self, mock_query, mock_exec, mock_load, authed_estimator
    ):
        """PATCH trackerComment=null clears tracker_comment."""
        mock_query.return_value = [{
            "estimate_type": "maintenance",
            "status": "in_progress",
            "aspire_opportunity_id": None,
            "lead_id": None,
            "aspire_branch_id": 3668,
            "crew_rate_cents_per_hour": None,
        }]
        mock_load.return_value = {"id": "est-1", "trackerComment": None}
        resp = client.patch(
            "/api/estimating/estimates/est-1",
            json={"trackerComment": None},
        )
        assert resp.status_code == 200
        sql, params = mock_exec.call_args.args
        assert "tracker_comment = %s" in sql
        assert params[0] is None


# ── LIST filter — trackingStatus ──────────────────────────────────────────────

class TestTrackingStatusFilter:
    @patch("api.estimating._sla_return_window_days", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.resolve_branch_scope", new_callable=AsyncMock)
    def test_tracking_status_filter(
        self, mock_scope, mock_query, mock_load, mock_window, authed_estimator
    ):
        """GET /estimates?trackingStatus=in_progress adds a WHERE clause."""
        from api.authz import BranchScope
        mock_scope.return_value = BranchScope(kind="all", ids=set())
        mock_window.return_value = 14
        mock_query.return_value = [{"id": "est-1"}]
        mock_load.return_value = {"id": "est-1", "trackingStatus": "in_progress"}
        resp = client.get(
            "/api/estimating/estimates",
            params={"trackingStatus": "in_progress"},
        )
        assert resp.status_code == 200
        sql, params = mock_query.call_args.args
        assert "tracking_status = %s" in sql
        assert "in_progress" in params

    @patch("api.estimating._sla_return_window_days", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    @patch("api.authz.resolve_branch_scope", new_callable=AsyncMock)
    def test_no_tracking_status_filter_omits_clause(
        self, mock_scope, mock_query, mock_load, mock_window, authed_estimator
    ):
        """GET /estimates without trackingStatus does not add the WHERE clause."""
        from api.authz import BranchScope
        mock_scope.return_value = BranchScope(kind="all", ids=set())
        mock_window.return_value = 14
        mock_query.return_value = []
        resp = client.get("/api/estimating/estimates")
        assert resp.status_code == 200
        sql, _params = mock_query.call_args.args
        assert "tracking_status" not in sql


# ── _TRACKING_STATUS_ENUM constant ───────────────────────────────────────────

class TestTrackingStatusEnum:
    def test_enum_contains_all_required_values(self):
        """_TRACKING_STATUS_ENUM must include all nine status codes."""
        required = {
            "not_started", "in_progress", "drafted", "ai_scanning",
            "takeoff_comp", "on_hold", "passed", "delivered", "completed",
        }
        assert required == est._TRACKING_STATUS_ENUM

    def test_updatable_map_includes_tracking_fields(self):
        """_UPDATABLE must map both camelCase keys to their column names."""
        assert est._UPDATABLE["trackingStatus"] == "tracking_status"
        assert est._UPDATABLE["trackerComment"] == "tracker_comment"

    def test_estimator_or_approver_fields_includes_tracking(self):
        """trackingStatus and trackerComment are in _ESTIMATOR_OR_APPROVER_FIELDS."""
        assert "trackingStatus" in est._ESTIMATOR_OR_APPROVER_FIELDS
        assert "trackerComment" in est._ESTIMATOR_OR_APPROVER_FIELDS


# ── Migration 078 detector ────────────────────────────────────────────────────

class TestMigration078:
    def test_detector_keys_on_tracking_status(self, monkeypatch):
        """detect_078 returns True iff tracking_status column exists on estimates."""
        monkeypatch.setattr(
            migrate, "column_exists",
            lambda conn, table, column: (
                table == "estimates" and column == "tracking_status"
            ),
        )
        assert migrate.detect_078(None) is True

    def test_detector_false_when_column_absent(self, monkeypatch):
        monkeypatch.setattr(migrate, "column_exists", lambda conn, table, column: False)
        assert migrate.detect_078(None) is False

    def test_detector_in_dispatch_table(self):
        assert migrate._DETECT.get("078_estimate_tracking_status") is migrate.detect_078

    def test_sql_adds_both_columns_with_guards(self):
        sql = (
            migrate.MIGRATIONS_DIR / "078_estimate_tracking_status.sql"
        ).read_text()
        assert "tracking_status" in sql
        assert "tracker_comment" in sql
        stmts = migrate.split_statements(sql)
        alters = [s for s in stmts if "ADD COLUMN" in s.upper()]
        assert len(alters) == 2
        assert all(s.lstrip().upper().startswith("SET") for s in alters)
