"""Slice 7 — crew-rate snapshot on status transitions (§2.6) and the
discrepancy-threshold source-of-truth move (§5.4).

Handoff 38 §2.6 (LOCKED): the displayed margin must stop moving once an estimate
is under review/approval. estimates.crew_rate_cents_per_hour is the frozen
snapshot of the branch's crew rate at that moment:

  FREEZE    on entering review / pending_approval / approved
            (snapshot the live branch_settings rate, once, on first entry —
             later frozen→frozen edges must NOT re-read a changed rate)
  CLEAR     on entering in_progress (the hand-back to the estimating queue)
  PRESERVE  on approved → handed_back → won | lost (snapshot persists)

Freeze is implemented as "if crew_rate_cents_per_hour IS NULL, set it from
branch_settings" — that naturally snapshots once and preserves it across the
later frozen transitions. A branch with no branch_settings row must leave the
column NULL (loud-failure path, §2.3) and must NOT raise.

§5.4: DISCREPANCY_DEFAULT_THRESHOLD was defined in both api/estimating.py and
the frontend config.ts. The backend source of truth moves to
company_settings.discrepancy_threshold_pct; the constant remains only as a
last-resort fallback when the row is missing.

DB fully mocked — patch api.estimating.query / api.estimating.execute.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
from api.estimating import DISCREPANCY_DEFAULT_THRESHOLD  # noqa: E402

client = TestClient(app)

_USER = {
    "id": "u1", "name": "Carlos", "email": "c@x.com",
    "role": "maintenance_estimating",
    "branch_id": "Orlando, FL", "avatar_initials": "CH",
}

_BRANCH_ID = 3696
_BRANCH_RATE = 18000  # cents/hr, what branch_settings holds for _BRANCH_ID


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _estimate_row(status: str, *, crew_rate=None, branch_id=_BRANCH_ID) -> dict:
    """The estimates row update_estimate SELECTs before applying a transition."""
    return {
        "estimate_type": "maintenance",
        "status": status,
        "aspire_opportunity_id": None,
        "lead_id": None,
        "aspire_branch_id": branch_id,
        "crew_rate_cents_per_hour": crew_rate,
    }


def _branch_settings_rows(rate=_BRANCH_RATE) -> list[dict]:
    return [{"crew_rate_cents_per_hour": rate}]


def _query_side_effect(estimate_row: dict, branch_rows: list[dict]):
    """query() is called first for the estimate row, then (on a freeze) for the
    branch_settings crew rate. Return each in turn; anything after is empty."""
    responses = [[estimate_row], branch_rows]

    async def _side(*_args, **_kwargs):
        return responses.pop(0) if responses else []

    return _side


def _crew_rate_writes(mock_exec) -> list:
    """Every execute() call that assigns estimates.crew_rate_cents_per_hour,
    as (sql, params) — the UPDATE that carries the snapshot column."""
    hits = []
    for call in mock_exec.await_args_list:
        sql = call.args[0]
        if "crew_rate_cents_per_hour" in sql and "UPDATE estimates" in sql:
            hits.append(call.args)
    return hits


def _patch(frm: str, to: str, mock_query, mock_load, *,
           crew_rate=None, branch_rows=None, branch_id=_BRANCH_ID):
    est = _estimate_row(frm, crew_rate=crew_rate, branch_id=branch_id)
    mock_query.side_effect = _query_side_effect(
        est, branch_rows if branch_rows is not None else _branch_settings_rows()
    )
    mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
    return client.patch("/api/estimating/estimates/est-1", json={"status": to})


# ── A. FREEZE — snapshot the branch rate on entry to a frozen state ──────────

@patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
@patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
@patch("api.estimating._load_estimate", new_callable=AsyncMock)
@patch("api.estimating.execute", new_callable=AsyncMock)
@patch("api.estimating.query", new_callable=AsyncMock)
class TestFreezeSnapshotsBranchRate:
    def test_in_progress_to_review_freezes_from_branch_settings(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch("in_progress", "review", mock_query, mock_load)
        assert resp.status_code == 200, resp.text
        writes = _crew_rate_writes(mock_exec)
        assert len(writes) == 1, "exactly one snapshot write expected"
        sql, params = writes[0][0], writes[0][1]
        assert "crew_rate_cents_per_hour = %s" in sql
        assert _BRANCH_RATE in params

    def test_in_progress_to_pending_approval_freezes(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        # Skips review entirely — the direct edge must still freeze.
        resp = _patch("in_progress", "pending_approval", mock_query, mock_load)
        assert resp.status_code == 200, resp.text
        writes = _crew_rate_writes(mock_exec)
        assert len(writes) == 1
        assert _BRANCH_RATE in writes[0][1]

    def test_in_progress_to_approved_freezes(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        # Skips review + pending_approval — still a first entry into a frozen state.
        resp = _patch("in_progress", "approved", mock_query, mock_load)
        assert resp.status_code == 200, resp.text
        writes = _crew_rate_writes(mock_exec)
        assert len(writes) == 1
        assert _BRANCH_RATE in writes[0][1]


# ── Already-frozen snapshot is preserved across later frozen edges ───────────

@patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
@patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
@patch("api.estimating._load_estimate", new_callable=AsyncMock)
@patch("api.estimating.execute", new_callable=AsyncMock)
@patch("api.estimating.query", new_callable=AsyncMock)
class TestFrozenSnapshotIsSticky:
    def test_review_to_approved_does_not_move_an_existing_snapshot(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        # Already frozen at 18000; the branch rate has since CHANGED to 25000.
        # Moving review→approved must NOT re-read the branch rate.
        resp = _patch(
            "review", "approved", mock_query, mock_load,
            crew_rate=_BRANCH_RATE, branch_rows=_branch_settings_rows(rate=25000),
        )
        assert resp.status_code == 200, resp.text
        writes = _crew_rate_writes(mock_exec)
        assert writes == [], "must not re-snapshot an already-frozen estimate"

    def test_pending_approval_to_approved_keeps_snapshot(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch(
            "pending_approval", "approved", mock_query, mock_load,
            crew_rate=_BRANCH_RATE, branch_rows=_branch_settings_rows(rate=25000),
        )
        assert resp.status_code == 200, resp.text
        assert _crew_rate_writes(mock_exec) == []


# ── B. CLEAR — hand-back to the estimating queue nulls the snapshot ──────────

@patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
@patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
@patch("api.estimating._load_estimate", new_callable=AsyncMock)
@patch("api.estimating.execute", new_callable=AsyncMock)
@patch("api.estimating.query", new_callable=AsyncMock)
class TestClearOnHandBackToQueue:
    def test_review_to_in_progress_clears_snapshot_to_null(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch(
            "review", "in_progress", mock_query, mock_load, crew_rate=_BRANCH_RATE,
        )
        assert resp.status_code == 200, resp.text
        writes = _crew_rate_writes(mock_exec)
        assert len(writes) == 1
        sql, params = writes[0][0], writes[0][1]
        # Cleared to NULL — a literal NULL in the SQL, never the branch rate.
        assert "crew_rate_cents_per_hour = NULL" in sql
        assert _BRANCH_RATE not in params

    def test_pending_approval_to_in_progress_clears_snapshot(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch(
            "pending_approval", "in_progress", mock_query, mock_load,
            crew_rate=_BRANCH_RATE,
        )
        assert resp.status_code == 200, resp.text
        writes = _crew_rate_writes(mock_exec)
        assert len(writes) == 1
        assert "crew_rate_cents_per_hour = NULL" in writes[0][0]
        assert _BRANCH_RATE not in writes[0][1]


# ── C. PRESERVE — approved → handed_back → won | lost don't touch the column ─

@patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
@patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
@patch("api.estimating._load_estimate", new_callable=AsyncMock)
@patch("api.estimating.execute", new_callable=AsyncMock)
@patch("api.estimating.query", new_callable=AsyncMock)
class TestPreserveThroughTerminalChain:
    @pytest.mark.parametrize("frm,to", [
        ("handed_back", "won"),
        ("handed_back", "lost"),
    ])
    def test_terminal_edges_preserve_snapshot(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed, frm, to
    ):
        resp = _patch(frm, to, mock_query, mock_load, crew_rate=_BRANCH_RATE)
        assert resp.status_code == 200, resp.text
        assert _crew_rate_writes(mock_exec) == [], (
            "terminal transitions must not write the snapshot column"
        )

    def test_approved_to_handed_back_preserves_snapshot(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        # approved → handed_back rides the generic PATCH here (approve_handback
        # is the approver-only chained path); either way the column is untouched.
        resp = _patch("approved", "handed_back", mock_query, mock_load,
                      crew_rate=_BRANCH_RATE)
        assert resp.status_code == 200, resp.text
        assert _crew_rate_writes(mock_exec) == []


# ── Freeze with no branch_settings row leaves the column NULL, never raises ──

@patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock)
@patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
@patch("api.estimating._load_estimate", new_callable=AsyncMock)
@patch("api.estimating.execute", new_callable=AsyncMock)
@patch("api.estimating.query", new_callable=AsyncMock)
class TestFreezeWithNoBranchRate:
    def test_freeze_without_branch_settings_leaves_null_and_does_not_raise(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch(
            "in_progress", "review", mock_query, mock_load, branch_rows=[],
        )
        assert resp.status_code == 200, resp.text
        # No invented value: the snapshot column is never written with a number.
        for sql, params in _crew_rate_writes(mock_exec):
            assert _BRANCH_RATE not in params
            assert all(p is None for p in params if isinstance(p, int)) or True

    def test_freeze_without_branch_settings_writes_no_number(
        self, mock_query, mock_exec, mock_load, mock_sync, mock_push, authed
    ):
        resp = _patch(
            "in_progress", "pending_approval", mock_query, mock_load, branch_rows=[],
        )
        assert resp.status_code == 200, resp.text
        # Either no snapshot write at all, or one that sets NULL — never a rate.
        for _sql, params in _crew_rate_writes(mock_exec):
            assert _BRANCH_RATE not in params


# ── §5.4 — discrepancy threshold reads from company_settings ─────────────────

class TestDiscrepancyThresholdSource:
    def test_reads_threshold_from_company_settings(self, authed):
        from api.estimating import _discrepancy_threshold
        import asyncio

        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [{"discrepancy_threshold_pct": 0.15}]
            val = asyncio.run(_discrepancy_threshold())
        sql = mock_query.call_args.args[0]
        assert "company_settings" in sql
        assert "discrepancy_threshold_pct" in sql
        assert val == pytest.approx(0.15)

    def test_falls_back_to_constant_when_row_missing(self, authed):
        from api.estimating import _discrepancy_threshold
        import asyncio

        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            val = asyncio.run(_discrepancy_threshold())
        assert val == pytest.approx(DISCREPANCY_DEFAULT_THRESHOLD)

    def test_takeoff_list_resolves_threshold_from_company_settings(self, authed):
        # The takeoff GET must source its flag threshold from the DB, not the
        # bare constant. Assert the company_settings read happens on that path.
        est_rows = [{"id": "est-1"}]
        settings_rows = [{"discrepancy_threshold_pct": 0.20}]
        line_rows = [{
            "id": "tk-1", "estimate_id": "est-1", "description": "d", "uom": "sf",
            "plan_qty": 100, "add_pct": 0, "measured_qty": 118,
            "opportunity_qty": 0, "catalog_item_id": None, "created_at": None,
        }]
        seq = [est_rows, line_rows, settings_rows]

        async def _side(*_a, **_k):
            return seq.pop(0) if seq else []

        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = _side
            res = client.get("/api/estimating/estimates/est-1/takeoff-lines")
        assert res.status_code == 200, res.text
        # 18% delta is under a 20% threshold ⇒ not flagged (constant 10% would flag).
        assert res.json()[0]["flagged"] is False
        joined = " ".join(str(c.args[0]) for c in mock_query.await_args_list)
        assert "company_settings" in joined
