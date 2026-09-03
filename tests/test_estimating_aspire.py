"""Tests for the Aspire wiring in api/estimating.py.

DB and the aspire_sync port are fully mocked — no MySQL, no HTTP. The domain must
never block on Aspire: create/patch always succeed locally and the push is a
best-effort background task whose result is persisted to the estimate's own
sync-status columns.
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
import api.estimating as est  # noqa: E402
from api.aspire_sync import OpportunityInput, SyncResult  # noqa: E402

client = TestClient(app)

_USER = {"id": "u1", "name": "Carlos", "email": "c@x.com", "role": "maintenance_estimating",
         "branch_id": "Orlando, FL", "avatar_initials": "CH"}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _est_row(**over):
    row = {
        "id": "est-1", "estimate_type": "maintenance", "name": "Sunny HOA",
        "property_id": "prop-1", "crm_rep": "u9", "customer_type": "hoa",
        "branch": "Florida", "status": "handed_back", "aspire_opportunity_id": None,
    }
    row.update(over)
    return row


# ── enrichment: domain row → neutral OpportunityInput ────────────────────────

class TestBuildOpportunityInput:
    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_pulls_property_and_rep_refs(self, mock_query):
        # first call → property row, second → crm_user row
        mock_query.side_effect = [
            [{"aspire_property_id": 238431, "branch_city": "Orlando, FL"}],
            [{"aspire_rep_id": 278690}],
        ]
        inp = await est._build_opportunity_input(_est_row())
        assert isinstance(inp, OpportunityInput)
        assert inp.aspire_property_id == 238431
        assert inp.branch_city == "Orlando, FL"
        assert inp.aspire_rep_contact_id == 278690
        assert inp.is_install is False
        assert inp.service_line == "Maintenance: Contract"   # default per type
        assert inp.sales_type == "HOA"

    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_install_defaults_and_flag(self, mock_query):
        mock_query.side_effect = [
            [{"aspire_property_id": 1, "branch_city": "Orlando, FL"}],
            [{"aspire_rep_id": None}],
        ]
        inp = await est._build_opportunity_input(_est_row(estimate_type="install"))
        assert inp.is_install is True
        assert inp.service_line == "Install: Landscape"

    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_property_not_synced_yields_none(self, mock_query):
        mock_query.side_effect = [[{"aspire_property_id": None, "branch_city": "X"}], [{"aspire_rep_id": 1}]]
        inp = await est._build_opportunity_input(_est_row())
        assert inp.aspire_property_id is None

    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_rep_lookup_targets_users_not_legacy_crm_users(self, mock_query):
        # §5.2: migration 004 renamed crm_users → users. The rep lookup must
        # read the renamed table or it throws on any DB that took the rename.
        mock_query.side_effect = [
            [{"aspire_property_id": 1, "branch_city": "Orlando, FL"}],
            [{"aspire_rep_id": 278690}],
        ]
        await est._build_opportunity_input(_est_row())
        # second query call is the rep lookup
        rep_sql = mock_query.call_args_list[1].args[0]
        assert "FROM users" in rep_sql
        assert "crm_users" not in rep_sql


# ── persistence of a SyncResult back onto the estimate ───────────────────────

class TestPersistSyncResult:
    @patch("api.estimating.execute", new_callable=AsyncMock)
    async def test_synced_writes_ids_and_status(self, mock_exec):
        await est._persist_sync_result("est-1", SyncResult(
            status="synced", aspire_opportunity_id=99, aspire_number="8"))
        sql, params = mock_exec.call_args.args
        assert "aspire_sync_status" in sql
        assert 99 in params and "8" in params and "synced" in params

    @patch("api.estimating.execute", new_callable=AsyncMock)
    async def test_failed_writes_error_and_status(self, mock_exec):
        await est._persist_sync_result("est-1", SyncResult(status="failed", error="boom"))
        _, params = mock_exec.call_args.args
        assert "failed" in params and "boom" in params

    @patch("api.estimating.execute", new_callable=AsyncMock)
    async def test_disabled_leaves_pending(self, mock_exec):
        await est._persist_sync_result("est-1", SyncResult(status="disabled"))
        _, params = mock_exec.call_args.args
        assert "pending" in params
        assert "disabled" not in params        # never write the non-enum value


# ── background push orchestration ────────────────────────────────────────────

class TestSyncNewOpportunityBg:
    @patch("api.estimating._persist_sync_result", new_callable=AsyncMock)
    @patch("api.estimating.aspire_sync")
    @patch("api.estimating._build_opportunity_input", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_pushes_and_persists(self, mock_query, mock_build, mock_sync, mock_persist):
        mock_query.return_value = [_est_row()]
        mock_build.return_value = OpportunityInput(
            name="x", service_line="Maintenance: Contract", branch_city="Orlando, FL",
            is_install=False, aspire_property_id=1)
        mock_sync.push_new_opportunity = AsyncMock(
            return_value=SyncResult(status="synced", aspire_opportunity_id=7, aspire_number="8"))
        await est._sync_new_opportunity_bg("est-1")
        mock_sync.push_new_opportunity.assert_awaited_once()
        mock_persist.assert_awaited_once()


# ── HTTP: create schedules the push, never blocks ────────────────────────────

class TestCreateSchedulesSync:
    @patch("api.properties.sync_property_if_needed", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_create_persists_property_link_and_schedules(self, mock_query, mock_exec, mock_load, mock_bg, mock_prop_sync, authed):
        mock_query.return_value = []  # itb_scopes read (auto-gen)
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "aspireBranchId": 3668, "branchCity": "Orlando, FL", "propertyId": "prop-1"})
        assert resp.status_code == 201
        # background task ran (TestClient executes background tasks)
        mock_bg.assert_awaited_once()
        # property link persisted in the INSERT
        insert_params = mock_exec.call_args_list[0].args[1]
        assert "prop-1" in insert_params


# ── Slice 8: intake submits aspire_branch_id; estimate carries it ────────────

class TestCreateBranchIdentityContract:
    """Branch identity rides on the Aspire BranchID (int). The legacy `branch`
    city column stays NOT NULL, so create resolves a display city from the id
    (or accepts branchCity) and persists both."""

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_persists_aspire_branch_id_and_non_null_branch(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.return_value = []  # itb_scopes read (auto-gen)
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "aspireBranchId": 3668, "branchCity": "Orlando, FL"})
        assert resp.status_code == 201, resp.text
        # The estimates INSERT is the first execute() call.
        insert_sql, insert_params = mock_exec.call_args_list[0].args
        assert "aspire_branch_id" in insert_sql
        # aspire_branch_id (int identity) is persisted …
        assert 3668 in insert_params
        # … and the legacy branch city column is populated, never NULL/empty.
        assert "Orlando, FL" in insert_params

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_resolves_branch_city_from_id_when_client_omits_it(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        mock_query.return_value = []
        mock_load.return_value = {"id": "est-1", "estimateType": "install"}
        # Client sends only the id — the backend reverse-resolves the city so
        # the NOT NULL branch column is still populated. Install Bradenton = 1374.
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "install", "name": "GF", "clientName": "LLC",
            "aspireBranchId": 1374})
        assert resp.status_code == 201, resp.text
        insert_params = mock_exec.call_args_list[0].args[1]
        assert 1374 in insert_params
        assert "Bradenton, FL" in insert_params

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_rejects_missing_aspire_branch_id(self, mock_query, mock_exec, authed):
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA"})
        assert resp.status_code == 400
        assert "aspireBranchId" in resp.json()["detail"]
        # Reject persists nothing.
        mock_exec.assert_not_awaited()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_rejects_unresolvable_aspire_branch_id(self, mock_query, mock_exec, authed):
        # A syntactically valid int that maps to no branch and carries no city.
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "aspireBranchId": 999999})
        assert resp.status_code == 400
        mock_exec.assert_not_awaited()

    def test_estimate_out_exposes_aspire_branch_id_and_branch_city(self):
        # Slice 14: branchCity now sourced from the branches JOIN alias `branch_city`,
        # not from the legacy estimates.branch column.
        out = est._estimate_out(
            {**_est_row(aspire_branch_id=3668),
             "aspire_number": None, "client_name": "HOA", "acreage": None,
             "contract_value_cents": 0, "target_margin": 0.22, "lifecycle": "bidding",
             "aspire_owner": "estimating", "priority": "medium", "win_probability": 0.2,
             "site_walk_date": None, "due_back_date": None, "anticipated_close_date": None,
             "service_start_date": None, "assigned_ls_estimator": None,
             "assigned_irr_estimator": None, "crm_rep": None, "notify_bm_rd_on_return": None,
             "created_at": None, "updated_at": None,
             # The JOIN result supplies branchCity now (not estimates.branch)
             "branch_city": "Orlando, FL"},
            sections=[],
        )
        assert out["aspireBranchId"] == 3668
        assert out["branchCity"] == "Orlando, FL"

    def test_estimate_out_exposes_frozen_crew_rate_snapshot(self):
        # Slice 11b: the frozen crew-rate snapshot (estimates.crew_rate_cents_per_hour)
        # must reach the client so the Margin Analysis panel prices maintenance
        # margin off the value frozen at submission — never a live re-read.
        base = {**_est_row(aspire_branch_id=3668),
                "aspire_number": None, "client_name": "HOA", "acreage": None,
                "contract_value_cents": 0, "target_margin": 0.22, "lifecycle": "bidding",
                "aspire_owner": "estimating", "priority": "medium", "win_probability": 0.2,
                "site_walk_date": None, "due_back_date": None, "anticipated_close_date": None,
                "service_start_date": None, "assigned_ls_estimator": None,
                "assigned_irr_estimator": None, "crm_rep": None, "notify_bm_rd_on_return": None,
                "created_at": None, "updated_at": None, "branch_city": "Orlando, FL"}
        frozen = est._estimate_out({**base, "crew_rate_cents_per_hour": 19500}, sections=[])
        assert frozen["crewRateCentsPerHour"] == 19500
        # An estimate with no snapshot (in_progress / pre-migration) hands back null,
        # never an invented number (the §2.3 no-fallback contract).
        cleared = est._estimate_out({**base, "crew_rate_cents_per_hour": None}, sections=[])
        assert cleared["crewRateCentsPerHour"] is None
        missing = est._estimate_out(base, sections=[])
        assert missing["crewRateCentsPerHour"] is None


# ── HTTP: create is THE property-sync trigger ────────────────────────────────

class TestCreateTriggersPropertySync:
    """A property pushes to Aspire ONLY on estimate submission: unsynced/failed
    rows are pushed exactly once (pending → synced); synced rows are left alone."""

    @patch("api.properties._persist_property_result", new_callable=AsyncMock)
    @patch("api.properties.aspire_sync")
    @patch("api.properties.execute", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_submission_pushes_unsynced_property_exactly_once(
        self, mock_query, mock_exec, mock_load, mock_opp_bg, mock_pquery, mock_pexec, mock_sync, mock_persist, authed
    ):
        from api.aspire_sync import PropertySyncResult
        mock_query.return_value = []  # itb_scopes read (auto-gen)
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        mock_pquery.side_effect = [
            [{"aspire_sync_status": "unsynced"}],   # guard read
            [{"id": "prop-1", "name": "Sunny HOA", "address1": "123 Palm St",
              "city": "Orlando", "state": "FL", "zip": "32807",
              "branch_city": "Orlando, FL", "address2": None}],  # push read
        ]
        mock_sync.push_property = AsyncMock(
            return_value=PropertySyncResult(status="synced", aspire_property_id=715389))

        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "aspireBranchId": 3668, "branchCity": "Orlando, FL", "propertyId": "prop-1"})
        assert resp.status_code == 201

        # exactly one push, and the row was flipped to pending at trigger time
        mock_sync.push_property.assert_awaited_once()
        pending_sql, pending_params = mock_pexec.call_args_list[0].args
        assert "pending" in pending_sql or "pending" in pending_params
        assert "prop-1" in pending_params
        # the synced result was persisted back
        mock_persist.assert_awaited_once()
        assert mock_persist.call_args.args[0] == "prop-1"
        assert mock_persist.call_args.args[1].status == "synced"

    @patch("api.properties._sync_property_bg", new_callable=AsyncMock)
    @patch("api.properties.query", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_submission_skips_already_synced_property(
        self, mock_query, mock_exec, mock_load, mock_opp_bg, mock_pquery, mock_push, authed
    ):
        mock_query.return_value = []  # itb_scopes read (auto-gen)
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        mock_pquery.return_value = [{"aspire_sync_status": "synced"}]

        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "aspireBranchId": 3668, "branchCity": "Orlando, FL", "propertyId": "prop-1"})
        assert resp.status_code == 201
        mock_push.assert_not_awaited()

    @patch("api.properties.sync_property_if_needed", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_submission_without_property_does_not_touch_property_sync(
        self, mock_query, mock_exec, mock_load, mock_opp_bg, mock_needed, authed
    ):
        mock_query.return_value = []  # itb_scopes read (auto-gen)
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Sunny", "clientName": "HOA",
            "aspireBranchId": 3668, "branchCity": "Orlando, FL"})
        assert resp.status_code == 201
        mock_needed.assert_not_awaited()


# ── HTTP: won/lost schedule the write-back ───────────────────────────────────

class TestWonLostWriteBack:
    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_won_applies_side_effects_and_schedules(self, mock_query, mock_exec, mock_load, mock_bg, authed):
        mock_query.return_value = [{"estimate_type": "maintenance", "status": "handed_back",
                                    "aspire_opportunity_id": 7}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={"status": "won"})
        assert resp.status_code == 200
        mock_bg.assert_awaited_once()
        assert mock_bg.call_args.args[1] == "won"
        # WON side effects folded into the UPDATE
        update_sql = mock_exec.call_args.args[0]
        assert "aspire_owner" in update_sql and "lifecycle" in update_sql

    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_illegal_jump_to_won_does_not_write_back(self, mock_query, mock_exec, mock_load, mock_bg, authed):
        # in_progress → won is NOT a legal terminal transition, so
        # the PATCH itself is rejected (409) and no Aspire write-back fires.
        mock_query.return_value = [{"estimate_type": "maintenance", "status": "in_progress",
                                    "aspire_opportunity_id": 7}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1", json={"status": "won"})
        assert resp.status_code == 409
        mock_bg.assert_not_awaited()

    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_lost_forwards_reason(self, mock_query, mock_exec, mock_load, mock_bg, authed):
        mock_query.return_value = [{"estimate_type": "maintenance", "status": "handed_back",
                                    "aspire_opportunity_id": 7}]
        mock_load.return_value = {"id": "est-1"}
        resp = client.patch("/api/estimating/estimates/est-1",
                             json={"status": "lost", "lostReasonId": 13})
        assert resp.status_code == 200
        assert mock_bg.call_args.args[1] == "lost"
        assert mock_bg.call_args.args[2] == 13


# ── HTTP: manual retry endpoint ──────────────────────────────────────────────

class TestRetryEndpoint:
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_retry_reschedules_opportunity_when_unsynced(self, mock_query, mock_bg, authed):
        mock_query.return_value = [_est_row(aspire_opportunity_id=None, status="handed_back")]
        resp = client.post("/api/estimating/estimates/est-1/retry-aspire-sync")
        assert resp.status_code in (200, 202)
        mock_bg.assert_awaited_once()

    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_retry_404_when_missing(self, mock_query, authed):
        mock_query.return_value = []
        resp = client.post("/api/estimating/estimates/nope/retry-aspire-sync")
        assert resp.status_code == 404

    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_retry_reports_no_op_when_nothing_to_push(
        self, mock_query, mock_new_bg, mock_status_bg, authed
    ):
        # §5.3: already synced + non-terminal status ⇒ nothing to queue.
        # The endpoint must not lie with 202 "queued"; it reports 200 not_needed.
        mock_query.return_value = [
            _est_row(aspire_opportunity_id=8123, status="in_progress")
        ]
        resp = client.post("/api/estimating/estimates/est-1/retry-aspire-sync")
        assert resp.status_code == 200
        assert resp.json()["status"] == "not_needed"
        mock_new_bg.assert_not_awaited()
        mock_status_bg.assert_not_awaited()

    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_retry_queues_status_push_for_won(
        self, mock_query, mock_new_bg, mock_status_bg, authed
    ):
        # Terminal status on a synced estimate still queues a status push (202).
        mock_query.return_value = [
            _est_row(aspire_opportunity_id=8123, status="won")
        ]
        resp = client.post("/api/estimating/estimates/est-1/retry-aspire-sync")
        assert resp.status_code == 202
        assert resp.json()["status"] == "queued"
        mock_status_bg.assert_awaited_once()
        mock_new_bg.assert_not_awaited()


# ── background sweep over pending/failed rows ────────────────────────────────

class TestSweep:
    @patch("api.estimating._sync_status_bg", new_callable=AsyncMock)
    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    async def test_sweep_repushes_unsynced_and_terminal(self, mock_query, mock_new, mock_status):
        mock_query.return_value = [
            {"id": "est-1", "status": "handed_back", "aspire_opportunity_id": None},
            {"id": "est-2", "status": "won", "aspire_opportunity_id": 7},
        ]
        await est.sweep_once()
        mock_new.assert_awaited_once()          # est-1 not yet synced
        mock_status.assert_awaited_once()       # est-2 terminal, already has opp id


# ── Slice 14: cut readers off legacy branch columns ───────────────────────────

def _est_row_full(**over) -> dict:
    """Full estimate DB row for _estimate_out tests (all columns present).

    Mirrors the shape returned by _load_estimate's SELECT e.*, b.city AS branch_city
    query after Slice 14: no `branch` key, `branch_city` from the branches JOIN.
    """
    base = {
        "id": "est-1", "estimate_type": "maintenance", "name": "Sunny HOA",
        "aspire_number": None, "client_name": "HOA", "customer_type": "hoa",
        "acreage": None, "contract_value_cents": 0, "target_margin": 0.22,
        "status": "new_from_sales", "lifecycle": "bidding",
        "aspire_owner": "estimating", "priority": "medium", "win_probability": 0.2,
        "site_walk_date": None, "due_back_date": None, "anticipated_close_date": None,
        "service_start_date": None, "assigned_ls_estimator": None,
        "assigned_irr_estimator": None, "crm_rep": None, "notify_bm_rd_on_return": None,
        "created_at": None, "updated_at": None,
        # Slice 8 identity columns
        "aspire_branch_id": 3668,
        # Slice 14: the branches JOIN result supplies city; `branch` column absent
        "branch_city": "Orlando, FL",
    }
    base.update(over)
    return base


class TestSlice14BranchCutover:
    """Slice 14: _estimate_out / _catalog_item_out no longer read estimates.branch
    or catalog_items.branch; branchCity comes from the branches JOIN alias."""

    # ── _estimate_out: branchCity from JOIN, not estimates.branch ────────────

    def test_estimate_out_branch_city_from_join_alias(self):
        """branchCity is sourced from 'branch_city' (branches JOIN alias), not 'branch'."""
        row = _est_row_full(branch_city="Fort Myers, FL")
        out = est._estimate_out(row, sections=[])
        assert out["branchCity"] == "Fort Myers, FL"

    def test_estimate_out_branch_city_null_when_no_join_match(self):
        """When the branches JOIN yields no row (NULL aspire_branch_id), branchCity is null."""
        row = _est_row_full(branch_city=None, aspire_branch_id=None)
        out = est._estimate_out(row, sections=[])
        assert out["branchCity"] is None

    def test_estimate_out_does_not_raise_if_branch_column_absent(self):
        """_estimate_out must not KeyError if the legacy 'branch' column is missing
        (i.e. after migration 022 drops it from estimates)."""
        row = _est_row_full()
        # Explicitly confirm 'branch' key is NOT in the row
        assert "branch" not in row
        # Must not raise
        out = est._estimate_out(row, sections=[])
        assert "branchCity" in out

    def test_estimate_out_aspire_branch_id_still_present(self):
        """aspireBranchId is still sourced from estimates.aspire_branch_id (unchanged)."""
        row = _est_row_full(aspire_branch_id=3668)
        out = est._estimate_out(row, sections=[])
        assert out["aspireBranchId"] == 3668

    # ── _catalog_item_out: branch field dropped ───────────────────────────────

    def test_catalog_item_out_no_longer_exposes_branch_string(self):
        """After Slice 14, _catalog_item_out does not include the legacy 'branch' city string.
        Identity is carried by aspire_branch_id (NULL = company-wide per §2.3)."""
        row = {
            "id": "kit-1", "description": "Tree Trimming", "uom": "EA",
            "unit_cost_cents": 5000, "unit_sell_cents": 8000,
            "target_gm": 0.37, "kit_type": "install_quantity",
            "production_rate": None, "active": 1, "service_type": "Install",
            "aspire_branch_id": 3668,
            # 'branch' intentionally absent — post-022 schema
        }
        out = est._catalog_item_out(row)
        assert "branch" not in out
        assert out["aspireBranchId"] == 3668

    def test_catalog_item_out_null_aspire_branch_id_is_company_wide(self):
        """aspire_branch_id=NULL in the output means company-wide (§2.3 convention)."""
        row = {
            "id": "kit-2", "description": "Mow Trim", "uom": "SQ",
            "unit_cost_cents": 100, "unit_sell_cents": 200,
            "target_gm": 0.50, "kit_type": "maintenance_hours",
            "production_rate": 0.5, "active": 1, "service_type": "Maintenance",
            "aspire_branch_id": None,
        }
        out = est._catalog_item_out(row)
        assert out["aspireBranchId"] is None

    # ── create_estimate: branch write preserved (NOT NULL until 022 applied) ──

    @patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock)
    @patch("api.estimating._load_estimate", new_callable=AsyncMock)
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_create_estimate_still_writes_branch_column(
        self, mock_query, mock_exec, mock_load, mock_bg, authed
    ):
        """create_estimate must keep writing estimates.branch until Carlos applies 022
        (the column is still NOT NULL on live). The write should be present in the INSERT."""
        mock_query.return_value = []  # itb_scopes
        mock_load.return_value = {"id": "est-1", "estimateType": "maintenance"}
        resp = client.post("/api/estimating/estimates", json={
            "estimateType": "maintenance", "name": "Test", "clientName": "HOA",
            "aspireBranchId": 3668, "branchCity": "Orlando, FL",
        })
        assert resp.status_code == 201, resp.text
        insert_sql, insert_params = mock_exec.call_args_list[0].args
        # `branch` column still in INSERT to satisfy the live NOT NULL constraint
        assert "branch" in insert_sql
        # and the resolved city value is non-empty
        city_val = next((p for p in insert_params if p == "Orlando, FL"), None)
        assert city_val is not None, "branch city must be written to the INSERT params"
