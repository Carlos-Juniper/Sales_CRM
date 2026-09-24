"""Proposal Request CRUD + list-estimates leadId filter — Slice 4 (Handoff 37).

DB is fully mocked (patch api.proposals.query / api.proposals.execute,
api.estimating.query for list-estimates). No real MySQL required.
Mirrors the pattern in test_proposals_config.py and test_estimating_config.py.

Endpoints under test:
  POST   /api/proposals               — create; validates estimate approved + lead match
  GET    /api/proposals/:id           — reopen a persisted proposal
  PATCH  /api/proposals/:id           — partial update; bumps updated_at
  GET    /api/proposals?leadId=       — list proposals for a lead
  GET    /api/estimating/estimates?leadId=  — lead_id filter on the list-estimates route
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Env must be set before importing the app.
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

_USER = {
    "id": "u1", "name": "Alice", "email": "a@x.com",
    "role": "sales", "branch_id": "Fort Myers, FL", "avatar_initials": "AX",
}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


# ── Canonical seed data ──────────────────────────────────────────────────────

def _estimate_row(**over) -> dict:
    """A minimal estimates row as the DB returns it."""
    row = {
        "id": "est-abc123",
        "lead_id": "lead-001",
        "status": "approved",
        "estimate_type": "maintenance",
        "name": "Coral Bay HOA",
        "branch": "Fort Myers, FL",
    }
    row.update(over)
    return row


def _proposal_row(**over) -> dict:
    """A proposal_requests row as the DB returns it (snake_case, JSON strings)."""
    row = {
        "id": "prop-abc123def456",
        "lead_id": "lead-001",
        "estimate_id": "est-abc123",
        "created_by": "u1",
        "sections": json.dumps(["startup_plan_30_60_90"]),
        "org_chart": json.dumps({
            "included": True,
            "accountManagerIds": ["tm-001"],
            "agronomyManagerId": None,
            "irrigationManagerId": None,
            "productionManagerId": "tm-002",
            "crewCounts": {
                "mow": {"foremen": 1, "members": 4},
                "prune": {"foremen": 1, "members": 2},
                "fertIpm": {"members": 2},
                "irrigation": {"members": 1},
            },
        }),
        "startup_plan": json.dumps({
            "included": True,
            "day60": ["Assess turf quality"],
            "day90": ["Full inspection"],
            "day120Plus": [],
            "ongoing": ["Monthly review"],
        }),
        "team_member_ids": json.dumps(["tm-001", "tm-002"]),
        "executive_team_member_ids": json.dumps([]),
        "client_reference_ids": json.dumps(["cr-001"]),
        "portfolio_property_ids": json.dumps(["pp-001"]),
        "signer_user_id": "u1",
        "created_at": datetime(2026, 8, 26, 10, 0, 0),
        "updated_at": datetime(2026, 8, 26, 10, 0, 0),
    }
    row.update(over)
    return row


def _valid_create_body(**over) -> dict:
    """Minimal valid POST /api/proposals body."""
    body = {
        "leadId": "lead-001",
        "estimateId": "est-abc123",
        "createdBy": "u1",
        "sections": ["startup_plan_30_60_90"],
        "orgChart": {
            "included": True,
            "accountManagerIds": ["tm-001"],
            "crewCounts": {
                "mow": {"foremen": 1, "members": 4},
                "prune": {"foremen": 1, "members": 2},
                "fertIpm": {"members": 2},
                "irrigation": {"members": 1},
            },
        },
        "startupPlan": {
            "included": True,
            "day60": ["Assess turf quality"],
            "day90": [],
            "day120Plus": [],
            "ongoing": [],
        },
        "teamMemberIds": ["tm-001"],
        "executiveTeamMemberIds": [],
        "clientReferenceIds": ["cr-001"],
        "portfolioPropertyIds": ["pp-001"],
        "signerUserId": "u1",
    }
    body.update(over)
    return body


# ── Auth guard ───────────────────────────────────────────────────────────────

class TestAuthRequired:
    @pytest.mark.parametrize("method,path", [
        ("POST",  "/api/proposals"),
        ("GET",   "/api/proposals/prop-abc123def456"),
        ("PATCH", "/api/proposals/prop-abc123def456"),
        ("GET",   "/api/proposals"),
        ("GET",   "/api/proposals/packages"),
    ])
    def test_unauthenticated_is_rejected(self, method, path):
        res = client.request(method, path, json={})
        assert res.status_code in (401, 403)


# ── POST /api/proposals — validation ─────────────────────────────────────────

class TestCreateProposalValidation:
    def test_unknown_lead_returns_422(self, authed):
        """A proposal cannot be created without an existing lead."""
        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock),
        ):
            mock_q.return_value = []
            res = client.post("/api/proposals", json=_valid_create_body())
        assert res.status_code == 422
        assert "lead" in res.json()["detail"].lower()

    def test_lead_without_property_returns_422(self, authed):
        """The lead must have a canonical property attached."""
        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_q.return_value = [{"id": "lead-001", "property_id": None}]
            res = client.post("/api/proposals", json=_valid_create_body())
        assert res.status_code == 422
        assert "property" in res.json()["detail"].lower()
        mock_exec.assert_not_called()

    def test_estimate_wrong_lead_returns_422(self, authed):
        """When estimate.lead_id != leadId, reject with 422."""
        est = _estimate_row(lead_id="lead-DIFFERENT")
        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock),
        ):
            mock_q.side_effect = [
                [{"id": "lead-001", "property_id": "prop-1"}],
                [est],
            ]
            res = client.post("/api/proposals", json=_valid_create_body())
        assert res.status_code == 422
        assert "lead" in res.json()["detail"].lower()

    def test_unapproved_estimate_is_allowed_when_lead_has_property(self, authed):
        """WS2 dropped the approved-status gate. Lead + property are the constraint."""
        est = _estimate_row(status="in_progress")
        persisted = _proposal_row()
        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock),
        ):
            mock_q.side_effect = [
                [{"id": "lead-001", "property_id": "prop-1"}],
                [est],
                [persisted],
            ]
            res = client.post("/api/proposals", json=_valid_create_body())
        assert res.status_code == 201

    @pytest.mark.parametrize("missing_field", ["leadId", "createdBy", "signerUserId"])
    def test_missing_required_field_returns_400(self, authed, missing_field):
        body = _valid_create_body()
        del body[missing_field]
        with (
            patch("api.proposals.query", new_callable=AsyncMock),
            patch("api.proposals.execute", new_callable=AsyncMock),
        ):
            res = client.post("/api/proposals", json=body)
        assert res.status_code == 400
        assert missing_field[0].lower() + missing_field[1:] in res.json()["detail"].lower() \
            or missing_field.lower() in res.json()["detail"].lower()


# ── POST /api/proposals — success ────────────────────────────────────────────

class TestCreateProposalSuccess:
    def test_persists_and_round_trips(self, authed):
        """POST success: INSERT is called, and the returned shape is camelCase ProposalRequest."""
        est = _estimate_row()
        persisted = _proposal_row()

        # query() order: lead+property guard, estimate validation, reload.
        call_responses = [
            [{"id": "lead-001", "property_id": "prop-1"}],
            [est],
            [persisted],
        ]

        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_q.side_effect = call_responses
            res = client.post("/api/proposals", json=_valid_create_body())

        assert res.status_code == 201
        body = res.json()

        # Shape matches ProposalRequest (camelCase).
        assert body["leadId"] == "lead-001"
        assert body["estimateId"] == "est-abc123"
        assert body["createdBy"] == "u1"
        assert body["signerUserId"] == "u1"
        assert isinstance(body["sections"], list)
        assert isinstance(body["orgChart"], dict)
        assert isinstance(body["startupPlan"], dict)
        assert isinstance(body["teamMemberIds"], list)
        assert isinstance(body["executiveTeamMemberIds"], list)
        assert isinstance(body["clientReferenceIds"], list)
        assert isinstance(body["portfolioPropertyIds"], list)
        assert "id" in body
        assert "createdAt" in body
        assert "updatedAt" in body

        # The proposal row is inserted once. When an estimate is attached, a
        # second statement re-anchors lead-scoped uploads onto that estimate.
        insert_calls = [
            call for call in mock_exec.call_args_list
            if "INSERT INTO proposal_requests" in call.args[0]
        ]
        assert len(insert_calls) == 1

    def test_json_columns_serialised_to_strings_on_insert(self, authed):
        """JSON columns (sections, orgChart, etc.) are serialised before persisting."""
        est = _estimate_row()
        persisted = _proposal_row()

        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_q.side_effect = [
                [{"id": "lead-001", "property_id": "prop-1"}],
                [est],
                [persisted],
            ]
            client.post("/api/proposals", json=_valid_create_body())

        insert_calls = [
            call for call in mock_exec.call_args_list
            if "INSERT INTO proposal_requests" in call.args[0]
        ]
        assert len(insert_calls) == 1
        insert_params: list[Any] = insert_calls[0].args[1]
        # Params index 4 = sections (first JSON col after scalar fields).
        # It must be a JSON string, not a Python list.
        assert isinstance(insert_params[4], str)
        decoded = json.loads(insert_params[4])
        assert isinstance(decoded, list)

    def test_json_columns_deserialised_in_response(self, authed):
        """Row mapper deserialises TEXT/JSON columns into Python objects for the response."""
        est = _estimate_row()
        persisted = _proposal_row()

        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock),
        ):
            mock_q.side_effect = [
                [{"id": "lead-001", "property_id": "prop-1"}],
                [est],
                [persisted],
            ]
            res = client.post("/api/proposals", json=_valid_create_body())

        body = res.json()
        assert body["orgChart"]["included"] is True
        assert body["orgChart"]["crewCounts"]["mow"]["foremen"] == 1
        assert body["startupPlan"]["day60"] == ["Assess turf quality"]


# ── GET /api/proposals/:id ───────────────────────────────────────────────────

class TestGetProposal:
    def test_returns_proposal_by_id(self, authed):
        """GET /:id returns the persisted ProposalRequest."""
        persisted = _proposal_row()
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [persisted]
            res = client.get("/api/proposals/prop-abc123def456")
        assert res.status_code == 200
        body = res.json()
        assert body["id"] == "prop-abc123def456"
        assert body["leadId"] == "lead-001"
        assert body["estimateId"] == "est-abc123"

    def test_unknown_id_returns_404(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            res = client.get("/api/proposals/prop-doesnotexist")
        assert res.status_code == 404

    def test_camelcase_json_fields_deserialised(self, authed):
        """JSON columns are parsed objects in the response, not raw strings."""
        persisted = _proposal_row()
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [persisted]
            res = client.get("/api/proposals/prop-abc123def456")
        body = res.json()
        assert isinstance(body["orgChart"], dict)
        assert isinstance(body["teamMemberIds"], list)
        assert isinstance(body["sections"], list)


# ── PATCH /api/proposals/:id ─────────────────────────────────────────────────

class TestPatchProposal:
    def test_updates_fields_and_bumps_updated_at(self, authed):
        """PATCH persists the patch and returns the updated ProposalRequest."""
        original = _proposal_row()
        updated = _proposal_row(
            sections=json.dumps(["startup_plan_30_60_90", "juniper_sync"]),
            updated_at=datetime(2026, 8, 26, 11, 0, 0),
        )

        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock) as mock_exec,
        ):
            # first query = existence check; second = SELECT after UPDATE
            mock_q.side_effect = [
                [{"id": original["id"]}],  # existence check
                [updated],                  # reload
            ]
            res = client.patch(
                "/api/proposals/prop-abc123def456",
                json={"sections": ["startup_plan_30_60_90", "juniper_sync"]},
            )

        assert res.status_code == 200
        body = res.json()
        assert "startup_plan_30_60_90" in body["sections"]
        assert "juniper_sync" in body["sections"]

        # UPDATE must have been called; SQL must contain updated_at.
        mock_exec.assert_called_once()
        update_sql: str = mock_exec.call_args.args[0]
        assert "UPDATE proposal_requests" in update_sql
        assert "updated_at" in update_sql

    def test_patch_unknown_id_returns_404(self, authed):
        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock),
        ):
            mock_q.return_value = []  # existence check — not found
            res = client.patch("/api/proposals/prop-doesnotexist", json={})
        assert res.status_code == 404

    def test_patch_json_col_serialised_before_update(self, authed):
        """orgChart must be a JSON string in the UPDATE params, not a dict."""
        original = _proposal_row()

        new_org = {
            "included": False,
            "accountManagerIds": [],
            "crewCounts": {
                "mow": {"foremen": 0, "members": 0},
                "prune": {"foremen": 0, "members": 0},
                "fertIpm": {"members": 0},
                "irrigation": {"members": 0},
            },
        }

        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_q.side_effect = [
                [{"id": original["id"]}],
                [_proposal_row(org_chart=json.dumps(new_org))],
            ]
            client.patch(
                "/api/proposals/prop-abc123def456",
                json={"orgChart": new_org},
            )

        update_params: list[Any] = mock_exec.call_args.args[1]
        # First param in the SET list is the serialised orgChart value.
        org_param = update_params[0]
        assert isinstance(org_param, str), "orgChart should be serialised to string before UPDATE"
        assert json.loads(org_param)["included"] is False

    def test_patch_updates_updated_at_even_with_no_fields(self, authed):
        """An empty PATCH body still bumps updated_at."""
        original = _proposal_row()
        with (
            patch("api.proposals.query", new_callable=AsyncMock) as mock_q,
            patch("api.proposals.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_q.side_effect = [
                [{"id": original["id"]}],
                [original],
            ]
            res = client.patch("/api/proposals/prop-abc123def456", json={})

        assert res.status_code == 200
        update_sql: str = mock_exec.call_args.args[0]
        assert "updated_at" in update_sql


# ── GET /api/proposals?leadId= ───────────────────────────────────────────────

class TestListProposals:
    def test_filters_by_lead_id(self, authed):
        """?leadId= returns only proposals for that lead."""
        rows = [_proposal_row(), _proposal_row(id="prop-second00001")]
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = rows
            res = client.get("/api/proposals?leadId=lead-001")
        assert res.status_code == 200
        body = res.json()
        assert len(body) == 2
        assert all(p["leadId"] == "lead-001" for p in body)
        # SQL must filter by lead_id.
        sql_call = mock_q.call_args.args
        assert "lead_id = %s" in sql_call[0]
        assert "lead-001" in sql_call[1]

    def test_no_lead_id_returns_all(self, authed):
        """Omitting ?leadId returns all proposals."""
        rows = [_proposal_row(), _proposal_row(id="prop-other0001", lead_id="lead-002")]
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = rows
            res = client.get("/api/proposals")
        assert res.status_code == 200
        assert len(res.json()) == 2

    def test_empty_list_when_no_proposals(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            res = client.get("/api/proposals?leadId=lead-999")
        assert res.status_code == 200
        assert res.json() == []

    def test_response_is_camelcase(self, authed):
        """Every item in the list must be camelCase-keyed ProposalRequest."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_proposal_row()]
            res = client.get("/api/proposals?leadId=lead-001")
        item = res.json()[0]
        assert "leadId" in item
        assert "estimateId" in item
        assert "createdBy" in item
        assert "signerUserId" in item
        assert "orgChart" in item
        assert "startupPlan" in item
        assert "teamMemberIds" in item
        # Snake-case keys must NOT leak through.
        assert "lead_id" not in item
        assert "estimate_id" not in item


# ── GET /api/estimating/estimates?leadId= ────────────────────────────────────

class TestListEstimatesLeadIdFilter:
    """The leadId filter on the existing list-estimates route (§7 / Slice 4)."""

    def _make_scope(self):
        """A BranchScope-like object for the resolve_branch_scope mock."""
        scope = MagicMock()
        scope.kind = "all"  # admin / exec role — sees all branches
        return scope

    def test_lead_id_filter_included_in_sql(self, authed):
        """?leadId= adds a lead_id = %s condition to the query."""
        with (
            patch("api.estimating.authz.resolve_branch_scope", new_callable=AsyncMock) as mock_scope,
            patch("api.estimating.query", new_callable=AsyncMock) as mock_q,
        ):
            mock_scope.return_value = self._make_scope()
            mock_q.return_value = []  # no matching estimates
            res = client.get("/api/estimating/estimates?leadId=lead-001")

        assert res.status_code == 200
        sql: str = mock_q.call_args.args[0]
        params: list = mock_q.call_args.args[1]
        assert "lead_id = %s" in sql
        assert "lead-001" in params

    def test_lead_id_filter_absent_when_not_supplied(self, authed):
        """Without ?leadId, the lead_id condition is not added."""
        with (
            patch("api.estimating.authz.resolve_branch_scope", new_callable=AsyncMock) as mock_scope,
            patch("api.estimating.query", new_callable=AsyncMock) as mock_q,
        ):
            mock_scope.return_value = self._make_scope()
            mock_q.return_value = []
            client.get("/api/estimating/estimates")

        sql: str = mock_q.call_args.args[0]
        assert "lead_id" not in sql

    def test_lead_id_combinable_with_status_filter(self, authed):
        """?leadId=&status= both appear in the WHERE clause."""
        with (
            patch("api.estimating.authz.resolve_branch_scope", new_callable=AsyncMock) as mock_scope,
            patch("api.estimating.query", new_callable=AsyncMock) as mock_q,
        ):
            mock_scope.return_value = self._make_scope()
            mock_q.return_value = []
            client.get("/api/estimating/estimates?leadId=lead-001&status=approved")

        sql: str = mock_q.call_args.args[0]
        params: list = mock_q.call_args.args[1]
        assert "lead_id = %s" in sql
        assert "status = %s" in sql
        assert "lead-001" in params
        assert "approved" in params

    def test_scope_none_short_circuits_before_lead_filter(self, authed):
        """A user with scope.kind == 'none' gets an empty list (no DB call)."""
        none_scope = MagicMock()
        none_scope.kind = "none"
        with (
            patch("api.estimating.authz.resolve_branch_scope", new_callable=AsyncMock) as mock_scope,
            patch("api.estimating.query", new_callable=AsyncMock) as mock_q,
        ):
            mock_scope.return_value = none_scope
            res = client.get("/api/estimating/estimates?leadId=lead-001")

        assert res.status_code == 200
        assert res.json() == []
        mock_q.assert_not_called()


# ── GET /api/proposals/packages ──────────────────────────────────────────────

def _package_list_row(**over) -> dict:
    """A proposal-packages join row as the DB returns it."""
    row = {
        "id": "prop-abc123def456",
        "lead_id": "lead-001",
        "created_at": datetime(2026, 6, 16, 12, 0, 0),
        "updated_at": datetime(2026, 6, 16, 15, 0, 0),
        "property_name": "Lakewood Pines HOA",
        "property_id": "prop-1",
        "city": "Tampa",
        "state": "FL",
        "notes": None,
        "handoff_notes": None,
        "lead_status": "proposal_sent",
        "estimated_contract_value": 1000,
        "assignee_id": None,
        "assignee_name": None,
        "assignee_email": None,
        "assignee_role": None,
        "assignee_branch_id": None,
        "assignee_initials": None,
        "render_version": None,
        "page_count": None,
        "closed_at": None,
    }
    row.update(over)
    return row


class TestListProposalPackages:
    def test_returns_lead_joined_summary_without_sections(self, authed):
        row = {
            "id": "prop-abc123def456",
            "lead_id": "lead-001",
            "created_at": datetime(2026, 6, 16, 12, 0, 0),
            "updated_at": datetime(2026, 6, 16, 15, 0, 0),
            "property_name": "Lakewood Pines HOA",
            "property_id": "prop-1",
            "city": "Tampa",
            "state": "FL",
            "notes": "Full landscape maintenance",
            "handoff_notes": None,
            "lead_status": "proposal_sent",
            "estimated_contract_value": 94200,
            "assignee_id": "u2",
            "assignee_name": "Marcus T.",
            "assignee_email": "marcus@example.com",
            "assignee_role": "sales",
            "assignee_branch_id": "b1",
            "assignee_initials": "MT",
            "render_version": 2,
            "page_count": 18,
        }
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [row]
            res = client.get("/api/proposals/packages")

        assert res.status_code == 200
        body = res.json()
        assert len(body) == 1
        item = body[0]
        assert item["title"] == "Lakewood Pines HOA"
        assert item["subtitle"] == "Full landscape maintenance"
        assert item["leadId"] == "lead-001"
        assert item["propertyId"] == "prop-1"
        assert item["amount"] == 94200
        assert item["status"] == "proposal_sent"
        assert item["version"] == 2
        assert item["pageCount"] == 18
        assert item["code"].startswith("P-2026-")
        assert item["assignee"]["name"] == "Marcus T."
        assert "sections" not in item
        sql = mock_q.call_args.args[0]
        assert "proposal_requests" in sql
        assert "INNER JOIN leads" in sql
        assert "sections" not in sql.lower()
        assert "NOT IN" not in sql

    def test_exclude_status_drops_won_and_lost_in_sql(self, authed):
        """The queue request excludes closed leads in SQL, not after the response.
        Grace window: won/lost entries within CLOSED_PACKAGE_GRACE_DAYS days are
        still included, so the WHERE clause uses an OR with a lead_actions subquery
        and the grace-day count is appended as the last param.
        """
        from api.proposals import CLOSED_PACKAGE_GRACE_DAYS

        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            res = client.get("/api/proposals/packages?exclude_status=won,lost")

        assert res.status_code == 200
        assert res.json() == []
        sql = mock_q.call_args.args[0]
        params = mock_q.call_args.args[1]
        assert "l.status NOT IN" in sql
        # Grace-window OR clause: recently-closed rows survive the exclude filter.
        assert "lead_actions" in sql
        assert "INTERVAL" in sql
        # Status names come first; grace-day constant is the final param.
        assert params[0] == "won"
        assert params[1] == "lost"
        assert params[-1] == CLOSED_PACKAGE_GRACE_DAYS

    def test_grace_window_sql_structure(self, authed):
        """SQL must include a correlated subquery on lead_actions for the grace window."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/packages?exclude_status=won,lost")
        sql = mock_q.call_args.args[0]
        assert "action_type = 'status_change'" in sql
        assert "new_status = l.status" in sql
        assert "closed_at" in sql

    def test_no_exclude_status_omits_lead_actions_where(self, authed):
        """Without exclude_status the closed-lead filter is absent."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/packages")
        sql = mock_q.call_args.args[0]
        # closed_at is always SELECTed (for the mapper) even without a WHERE clause.
        assert "closed_at" in sql
        # But the filtering WHERE/OR should NOT be present.
        assert "l.status NOT IN" not in sql

    def test_closed_at_in_response_shape(self, authed):
        """closedAt must appear in each package item (None when not closed)."""
        row = {
            "id": "prop-xyz",
            "lead_id": "lead-002",
            "created_at": datetime(2026, 9, 1, 10, 0, 0),
            "updated_at": datetime(2026, 9, 1, 10, 0, 0),
            "property_name": "Test HOA",
            "property_id": None,
            "city": "Naples",
            "state": "FL",
            "notes": None,
            "handoff_notes": None,
            "lead_status": "won",
            "estimated_contract_value": None,
            "assignee_id": None,
            "assignee_name": None,
            "assignee_email": None,
            "assignee_role": None,
            "assignee_branch_id": None,
            "assignee_initials": None,
            "render_version": None,
            "page_count": None,
            "closed_at": datetime(2026, 9, 20, 8, 0, 0),
        }
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [row]
            res = client.get("/api/proposals/packages")
        item = res.json()[0]
        assert "closedAt" in item
        assert item["closedAt"] == "2026-09-20T08:00:00"

    def test_closed_at_none_when_not_closed(self, authed):
        """closedAt is None for a proposal that has never been won/lost."""
        row = {
            "id": "prop-abc123def456",
            "lead_id": "lead-001",
            "created_at": datetime(2026, 6, 16, 12, 0, 0),
            "updated_at": datetime(2026, 6, 16, 15, 0, 0),
            "property_name": "Lakewood Pines HOA",
            "property_id": "prop-1",
            "city": "Tampa",
            "state": "FL",
            "notes": None,
            "handoff_notes": None,
            "lead_status": "proposal_sent",
            "estimated_contract_value": None,
            "assignee_id": None,
            "assignee_name": None,
            "assignee_email": None,
            "assignee_role": None,
            "assignee_branch_id": None,
            "assignee_initials": None,
            "render_version": None,
            "page_count": None,
            "closed_at": None,
        }
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [row]
            res = client.get("/api/proposals/packages")
        item = res.json()[0]
        assert item["closedAt"] is None

    def test_several_proposals_for_one_lead_returns_newest(self, authed):
        """Regenerating a proposal must not duplicate the lead on the list.

        Newest is created_at, not updated_at: an older generation that was
        edited later still loses to the proposal generated after it.
        """
        older = _package_list_row(
            id="prop-older00001",
            created_at=datetime(2026, 6, 1, 9, 0, 0),
            updated_at=datetime(2026, 7, 1, 9, 0, 0),
            property_name="Older draft",
        )
        newest = _package_list_row(
            id="prop-newest0001",
            created_at=datetime(2026, 6, 20, 9, 0, 0),
            updated_at=datetime(2026, 6, 20, 9, 0, 0),
            property_name="Latest generation",
        )
        middle = _package_list_row(
            id="prop-middle0001",
            created_at=datetime(2026, 6, 10, 9, 0, 0),
            updated_at=datetime(2026, 6, 10, 9, 0, 0),
        )
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [older, middle, newest]
            res = client.get("/api/proposals/packages")

        assert res.status_code == 200
        body = res.json()
        assert len(body) == 1
        assert body[0]["id"] == "prop-newest0001"
        assert body[0]["leadId"] == "lead-001"
        assert body[0]["title"] == "Latest generation"
        sql = mock_q.call_args.args[0]
        assert "pr_latest.lead_id = pr.lead_id" in sql
        assert "ORDER BY pr_latest.created_at DESC, pr_latest.id DESC" in sql
        assert "LIMIT 1" in sql

    def test_several_leads_return_one_newest_row_each(self, authed):
        """Each lead contributes its newest proposal, and no other lead's."""
        rows = [
            _package_list_row(
                id="prop-a-old0001",
                lead_id="lead-a",
                created_at=datetime(2026, 5, 1, 8, 0, 0),
                updated_at=datetime(2026, 5, 1, 8, 0, 0),
                property_name="Lead A old",
            ),
            _package_list_row(
                id="prop-a-new0001",
                lead_id="lead-a",
                created_at=datetime(2026, 6, 2, 8, 0, 0),
                updated_at=datetime(2026, 6, 2, 8, 0, 0),
                property_name="Lead A new",
            ),
            _package_list_row(
                id="prop-b-old0001",
                lead_id="lead-b",
                created_at=datetime(2026, 4, 1, 8, 0, 0),
                updated_at=datetime(2026, 8, 1, 8, 0, 0),
                property_name="Lead B old",
            ),
            _package_list_row(
                id="prop-b-new0001",
                lead_id="lead-b",
                created_at=datetime(2026, 7, 15, 8, 0, 0),
                updated_at=datetime(2026, 7, 15, 8, 0, 0),
                property_name="Lead B new",
            ),
        ]
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = rows
            res = client.get("/api/proposals/packages")

        assert res.status_code == 200
        body = res.json()
        assert len(body) == 2
        by_lead = {item["leadId"]: item for item in body}
        assert set(by_lead) == {"lead-a", "lead-b"}
        assert by_lead["lead-a"]["id"] == "prop-a-new0001"
        assert by_lead["lead-a"]["title"] == "Lead A new"
        assert by_lead["lead-b"]["id"] == "prop-b-new0001"
        assert by_lead["lead-b"]["title"] == "Lead B new"
        # List order stays updated_at DESC among the surviving rows.
        assert [item["id"] for item in body] == ["prop-b-new0001", "prop-a-new0001"]

    def test_created_at_tie_breaks_on_id(self, authed):
        """Ids are not time-ordered; they only decide a same-second tie."""
        earlier_id = _package_list_row(
            id="prop-aaa0000001",
            created_at=datetime(2026, 6, 16, 12, 0, 0),
        )
        later_id = _package_list_row(
            id="prop-zzz0000001",
            created_at=datetime(2026, 6, 16, 12, 0, 0),
        )
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [earlier_id, later_id]
            res = client.get("/api/proposals/packages")

        assert res.status_code == 200
        body = res.json()
        assert len(body) == 1
        assert body[0]["id"] == "prop-zzz0000001"

    def test_lead_history_still_returns_every_generation(self, authed):
        """GET /api/proposals?leadId= is the history list and stays uncollapsed."""
        rows = [
            _proposal_row(id="prop-older00001", created_at=datetime(2026, 6, 1, 9, 0, 0)),
            _proposal_row(id="prop-newer00001", created_at=datetime(2026, 6, 20, 9, 0, 0)),
        ]
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = rows
            res = client.get("/api/proposals?leadId=lead-001")

        assert res.status_code == 200
        body = res.json()
        assert len(body) == 2
        assert {item["id"] for item in body} == {"prop-older00001", "prop-newer00001"}
        sql = mock_q.call_args.args[0]
        assert "pr_latest" not in sql
        assert "LIMIT 1" not in sql
