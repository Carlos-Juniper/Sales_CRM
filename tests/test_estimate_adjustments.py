"""estimate_adjustments persistence (approver lever audit).

Acceptance criteria under test:
  * POST /api/estimating/estimates/{id}/adjustments persists a row to
    estimate_adjustments with the actor taken from the JWT, never the client.
  * GET /api/estimating/estimates/{id}/adjustments returns the audit trail
    (camelCase, ordered by created_at) — reload shows persisted adjustments.
  * The POST is approver-only: estimator roles get 403.
  * field is restricted to complexity|margin; anything else is rejected.
  * The adjustment write never touches the estimate row itself (status /
    margin PATCH stays a separate call), so "Save adjustment & approve" can
    write BOTH an adjustment row and a status transition without either
    suppressing the other.

DB fully mocked — patch api.estimating.query/execute; no real MySQL.
"""
from __future__ import annotations

import os
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402

client = TestClient(app)


def _user(role: str, **over) -> dict:
    u = {
        "id": "u1",
        "name": "Jane Manager",
        "email": "jane.manager@juniperlandscaping.com",
        "role": role,
        "branch_id": "b1",
        "avatar_initials": "JM",
    }
    u.update(over)
    return u


@pytest.fixture
def as_role():
    def _set(role: str, **over):
        app.dependency_overrides[require_auth] = lambda: _user(role, **over)
    yield _set
    app.dependency_overrides.clear()


BODY = {"field": "margin", "fromValue": 0.22, "toValue": 0.30}


# ── POST /adjustments ────────────────────────────────────────────────────────

class TestCreateAdjustment:
    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_persists_row_with_jwt_actor(self, mock_query, mock_exec, as_role):
        as_role("manager")
        mock_query.return_value = [{"id": "est-1"}]
        resp = client.post(
            "/api/estimating/estimates/est-1/adjustments",
            json={**BODY, "actor": "Spoofed Actor"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["estimateId"] == "est-1"
        assert body["field"] == "margin"
        assert body["fromValue"] == 0.22
        assert body["toValue"] == 0.30
        # actor comes from the JWT, never the client body
        assert body["actor"] == "Jane Manager"
        assert body["id"]
        assert body["createdAt"]

        inserts = [c.args for c in mock_exec.await_args_list
                   if "INSERT INTO estimate_adjustments" in c.args[0]]
        assert len(inserts) == 1
        _, params = inserts[0]
        assert "est-1" in params
        assert "Jane Manager" in params
        assert "Spoofed Actor" not in params
        assert "margin" in params

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_complexity_field_accepted(self, mock_query, mock_exec, as_role):
        as_role("regional_director")
        mock_query.return_value = [{"id": "est-1"}]
        resp = client.post(
            "/api/estimating/estimates/est-1/adjustments",
            json={"field": "complexity", "fromValue": 0.10, "toValue": 0.14},
        )
        assert resp.status_code == 201
        assert resp.json()["field"] == "complexity"

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_estimator_role_403(self, mock_query, mock_exec, as_role):
        for role in ("maintenance_estimating", "install_estimating", "sales"):
            as_role(role)
            resp = client.post(
                "/api/estimating/estimates/est-1/adjustments", json=BODY
            )
            assert resp.status_code == 403, role
        mock_exec.assert_not_awaited()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_every_approver_role_allowed(self, mock_query, mock_exec, as_role):
        mock_query.return_value = [{"id": "est-1"}]
        for role in ("manager", "regional_director", "vice_president", "ceo", "admin"):
            as_role(role)
            resp = client.post(
                "/api/estimating/estimates/est-1/adjustments", json=BODY
            )
            assert resp.status_code == 201, role

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_rejects_bogus_field(self, mock_query, mock_exec, as_role):
        as_role("manager")
        mock_query.return_value = [{"id": "est-1"}]
        resp = client.post(
            "/api/estimating/estimates/est-1/adjustments",
            json={"field": "lineItems", "fromValue": 1, "toValue": 2},
        )
        assert resp.status_code == 400
        mock_exec.assert_not_awaited()

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_404_when_estimate_missing(self, mock_query, mock_exec, as_role):
        as_role("manager")
        mock_query.return_value = []
        resp = client.post(
            "/api/estimating/estimates/est-nope/adjustments", json=BODY
        )
        assert resp.status_code == 404

    @patch("api.estimating.execute", new_callable=AsyncMock)
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_never_mutates_the_estimate_row(self, mock_query, mock_exec, as_role):
        """The audit write must not suppress/replace the status-transition or
        PATCH path — it only ever inserts into estimate_adjustments."""
        as_role("manager")
        mock_query.return_value = [{"id": "est-1"}]
        client.post("/api/estimating/estimates/est-1/adjustments", json=BODY)
        for c in mock_exec.await_args_list:
            assert "UPDATE estimates" not in c.args[0]
            assert "estimate_status_transitions" not in c.args[0]


# ── GET /adjustments ─────────────────────────────────────────────────────────

class TestListAdjustments:
    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_returns_trail_camel_case(self, mock_query, as_role):
        as_role("manager")
        mock_query.side_effect = [
            [{"id": "est-1"}],
            [
                {
                    "id": "adj-1", "estimate_id": "est-1", "actor": "Jane Manager",
                    "field": "margin", "from_value": 0.22, "to_value": 0.30,
                    "created_at": datetime(2026, 8, 4, 12, 0, 0),
                },
                {
                    "id": "adj-2", "estimate_id": "est-1", "actor": "Jane Manager",
                    "field": "margin", "from_value": 0.30, "to_value": 0.22,
                    "created_at": datetime(2026, 8, 4, 12, 5, 0),
                },
            ],
        ]
        resp = client.get("/api/estimating/estimates/est-1/adjustments")
        assert resp.status_code == 200
        body = resp.json()
        assert body == [
            {
                "id": "adj-1", "estimateId": "est-1", "actor": "Jane Manager",
                "field": "margin", "fromValue": 0.22, "toValue": 0.30,
                "createdAt": "2026-08-04T12:00:00",
            },
            {
                "id": "adj-2", "estimateId": "est-1", "actor": "Jane Manager",
                "field": "margin", "fromValue": 0.30, "toValue": 0.22,
                "createdAt": "2026-08-04T12:05:00",
            },
        ]
        sql = mock_query.await_args_list[1].args[0]
        assert "estimate_adjustments" in sql
        assert "ORDER BY created_at" in sql

    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_404_when_estimate_missing(self, mock_query, as_role):
        as_role("manager")
        mock_query.return_value = []
        resp = client.get("/api/estimating/estimates/est-nope/adjustments")
        assert resp.status_code == 404

    @patch("api.estimating.query", new_callable=AsyncMock)
    def test_read_is_open_to_any_authenticated_role(self, mock_query, as_role):
        # The trail is an audit read (estimators see why their number moved).
        as_role("maintenance_estimating")
        mock_query.side_effect = [[{"id": "est-1"}], []]
        resp = client.get("/api/estimating/estimates/est-1/adjustments")
        assert resp.status_code == 200
        assert resp.json() == []
