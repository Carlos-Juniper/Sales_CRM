"""Tests for estimate transition side-effects: crew-rate snapshot/clear logic (§2.6).

DB and Aspire are fully mocked — no MySQL, no HTTP. The domain must:
  1. When entering in_progress (the CLEAR path), copy crew_rate_cents_per_hour
     into prior_crew_rate_cents_per_hour in ONE UPDATE before nulling the current.
  2. On a FREEZE transition (review/pending_approval/approved), leave
     prior_crew_rate_cents_per_hour untouched.
  3. _estimate_out must expose priorCrewRateCentsPerHour.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, call, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
import api.estimating as est  # noqa: E402

client = TestClient(app)

_ESTIMATOR = {
    "id": "u1", "name": "Alice", "email": "a@x.com",
    "role": "maintenance_estimating",
    "branch_id": "Orlando, FL", "avatar_initials": "AE",
}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    yield
    app.dependency_overrides.clear()


def _est_row(**over) -> dict:
    """Minimal estimates row for mocking query responses."""
    row = {
        "id": "est-1",
        "estimate_type": "maintenance",
        "status": "handed_back",
        "aspire_opportunity_id": None,
        "lead_id": None,
        # Crew rate fields — simulates a previously frozen snapshot
        "crew_rate_cents_per_hour": 18_000,
        "prior_crew_rate_cents_per_hour": None,
    }
    row.update(over)
    return row


def _full_estimate_row(**over) -> dict:
    """A more complete row for _estimate_out tests."""
    base = {
        "id": "est-1",
        "estimate_type": "maintenance",
        "name": "Test HOA",
        "aspire_number": None,
        "client_name": "Test Client",
        "branch": "Orlando, FL",
        "customer_type": "hoa",
        "acreage": None,
        "contract_value_cents": 100000,
        "target_margin": 0.22,
        "status": "in_progress",
        "lifecycle": "bidding",
        "aspire_owner": "estimating",
        "priority": "medium",
        "win_probability": 0.20,
        "site_walk_date": None,
        "due_back_date": "2026-09-15",
        "anticipated_close_date": None,
        "service_start_date": None,
        "assigned_ls_estimator": None,
        "assigned_irr_estimator": None,
        "crm_rep": None,
        "notify_bm_rd_on_return": True,
        "notes": None,
        "property_id": None,
        "lead_id": None,
        "aspire_opportunity_id": None,
        "aspire_sync_status": None,
        "rfi_status": None,
        "turf_area_acres": None,
        "curb_miles": None,
        "takeoff_changed_at": None,
        "created_at": "2026-09-01T00:00:00",
        "updated_at": "2026-09-01T00:00:00",
        # The two crew-rate columns (024)
        "crew_rate_cents_per_hour": None,
        "prior_crew_rate_cents_per_hour": 18_000,
    }
    base.update(over)
    return base


# ── _estimate_out includes priorCrewRateCentsPerHour ─────────────────────────

class TestEstimateOutIncludesPriorCrewRate:
    def test_prior_crew_rate_exposed_when_set(self):
        row = _full_estimate_row(prior_crew_rate_cents_per_hour=18_000)
        out = est._estimate_out(row, [])
        assert "priorCrewRateCentsPerHour" in out
        assert out["priorCrewRateCentsPerHour"] == 18_000

    def test_prior_crew_rate_exposed_as_none_when_null(self):
        row = _full_estimate_row(prior_crew_rate_cents_per_hour=None)
        out = est._estimate_out(row, [])
        assert "priorCrewRateCentsPerHour" in out
        assert out["priorCrewRateCentsPerHour"] is None

    def test_prior_crew_rate_zero_is_not_null(self):
        """Zero is a valid (if unusual) rate — must not be treated as absent."""
        row = _full_estimate_row(prior_crew_rate_cents_per_hour=0)
        out = est._estimate_out(row, [])
        assert out["priorCrewRateCentsPerHour"] == 0


# ── Clear path: handed_back → in_progress moves snapshot to prior, nulls current ─

class TestClearPathPreservesPrior:
    """
    PATCH status=in_progress from review or pending_approval triggers the CLEAR
    path (Slice 7). The domain must:
      - issue exactly ONE UPDATE that sets BOTH prior_crew_rate=crew_rate AND
        crew_rate=NULL in a single statement (atomically — no two-step write).

    The from-state must be one that (a) is in STATUS_TRANSITIONS → in_progress
    AND (b) carries a frozen crew_rate snapshot: review and pending_approval both
    satisfy this (they are the FREEZE destinations).
    """

    @patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_in_progress_transition_copies_rate_into_prior_in_one_update(
        self, mock_query, mock_execute, mock_load, mock_push, authed
    ):
        # review → in_progress is the canonical "hand-back" path; the estimate
        # carries a crew_rate snapshot (18_000 cents/hr = $180.00/hr).
        mock_query.return_value = [_est_row(status="review", crew_rate_cents_per_hour=18_000)]
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}

        resp = client.patch("/api/estimating/estimates/est-1", json={"status": "in_progress"})
        assert resp.status_code == 200

        # Find the UPDATE call that clears/preserves crew rate
        crew_rate_update = None
        for c in mock_execute.call_args_list:
            sql = c.args[0] if c.args else ""
            if "prior_crew_rate_cents_per_hour" in sql:
                crew_rate_update = c
                break

        assert crew_rate_update is not None, (
            "Expected an UPDATE setting prior_crew_rate_cents_per_hour, but none was found"
        )
        sql = crew_rate_update.args[0]
        # Must set BOTH prior and current in the same statement (one write)
        assert "crew_rate_cents_per_hour = NULL" in sql.replace("prior_crew_rate_cents_per_hour", "")
        assert "prior_crew_rate_cents_per_hour = crew_rate_cents_per_hour" in sql

    @patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_in_progress_transition_when_no_existing_snapshot(
        self, mock_query, mock_execute, mock_load, mock_push, authed
    ):
        """NULL crew_rate is preserved as NULL prior — no error, just NULL→NULL."""
        mock_query.return_value = [_est_row(status="review", crew_rate_cents_per_hour=None)]
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}

        resp = client.patch("/api/estimating/estimates/est-1", json={"status": "in_progress"})
        assert resp.status_code == 200

        # Still must issue the prior_crew_rate UPDATE (prior=NULL is valid state)
        crew_rate_update = any(
            "prior_crew_rate_cents_per_hour" in (c.args[0] if c.args else "")
            for c in mock_execute.call_args_list
        )
        assert crew_rate_update, (
            "Expected UPDATE with prior_crew_rate_cents_per_hour even when source is NULL"
        )


# ── Freeze path: leaving in_progress to review/pending_approval must NOT touch prior

class TestFreezePathDoesNotTouchPrior:
    """
    On a FREEZE transition (in_progress → review / pending_approval) the domain
    snapshots crew_rate_cents_per_hour from the live branch setting (Slice 7).
    It must NOT overwrite prior_crew_rate_cents_per_hour — that column is only
    written on the CLEAR path (entering in_progress).

    The test verifies that no UPDATE touching prior_crew_rate_cents_per_hour is
    issued during a review transition (the FREEZE SQL touches crew_rate only).
    """

    @patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_review_transition_does_not_set_prior_crew_rate(
        self, mock_query, mock_execute, mock_load, mock_push, authed
    ):
        mock_query.return_value = [_est_row(status="in_progress", crew_rate_cents_per_hour=None)]
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}

        resp = client.patch("/api/estimating/estimates/est-1", json={"status": "review"})
        assert resp.status_code == 200

        # No UPDATE should reference prior_crew_rate_cents_per_hour
        for c in mock_execute.call_args_list:
            sql = c.args[0] if c.args else ""
            assert "prior_crew_rate_cents_per_hour" not in sql, (
                f"Freeze transition must not touch prior_crew_rate_cents_per_hour, "
                f"but found it in: {sql}"
            )
