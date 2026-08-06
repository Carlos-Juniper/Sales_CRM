"""
Tests for api/server.py.
DB is fully mocked — no real MySQL instance required.

Mocking strategy: patch `api.server.query` and `api.server.execute` directly.
These are the functions imported into server.py from db; patching them at the
server module level intercepts every SQL call without needing the pool/cursor
hierarchy that the old BigQuery layer required.

Run with:  pytest tests/test_server.py -v
"""
from __future__ import annotations

import os
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_PORT", "3306")
os.environ.setdefault("MYSQL_USER", "crm_user")
os.environ.setdefault("MYSQL_PASSWORD", "secret")
os.environ.setdefault("MYSQL_DB", "crm")
os.environ.setdefault("ENTRA_CLIENT_ID", "test-client-id")
os.environ.setdefault("ENTRA_TENANT_ID", "test-tenant-id")
os.environ.setdefault("JWT_SECRET", "test-secret")

from api.server import app  # noqa: E402 — env must be set first

client = TestClient(app)

# ── Sample DB rows ────────────────────────────────────────────────────────────

_LEAD_ROW = {
    "id": "lead-uuid-1",
    "property_name": "Silverleaf HOA",
    "address": "1234 Desert Ridge Blvd",
    "city": "Phoenix",
    "state": "AZ",
    "zip": "85050",
    "lat": 33.69,
    "lng": -111.97,
    "lead_type": "HOA",
    "score": 88,
    "score_factors": '[{"name":"size","score":30,"max":35,"description":"Acreage"}]',
    "estimated_acreage": 45.0,
    "estimated_contract_value": 185000.00,
    "contact_name": "Jennifer Walsh",
    "contact_email": "jwalsh@silverleafhoa.org",
    "source": "hoa_usa",
    "source_url": None,
    "bid_deadline": None,
    "status": "new",
    "assigned_to": None,
    "handoff_notes": None,
    "notes": None,
    "priority": 0,
    "branch_id": "b1",
    "distance_miles": 8.4,
    "property_id": None,
    "division_id": None,
    "aspire_opportunity_id": None,
    "deleted_at": None,
    "created_at": datetime(2026, 5, 1, 10, 0, 0),
    "updated_at": datetime(2026, 5, 1, 10, 0, 0),
}

_LEAD_ROW_WITH_ASPIRE = {**_LEAD_ROW}

_BID_ROW = {
    "id": "bid-uuid-1",
    "lead_id": "lead-uuid-1",
    "status": "pending",
    "estimated_value": 50000.00,
    "submitted_at": None,
    "notes": None,
    "title": "HOA Maintenance Bid",
    "agency": None,
    "branch_id": "b1",
    "created_at": datetime(2026, 5, 1, 10, 0, 0),
    "updated_at": datetime(2026, 5, 1, 10, 0, 0),
}

_USER_ROW = {
    "id": "u1",
    "name": "Carlos Hernandez",
    "email": "carlos.hernandez@juniperlandscaping.com",
    "role": "inside_sales",
    "branch_id": "b1",
    "avatar_initials": "CH",
}

_AUTHED_USER = {
    "id": "u1",
    "name": "Carlos Hernandez",
    "email": "carlos.hernandez@juniperlandscaping.com",
    "role": "inside_sales",
    "branch_id": "Tampa North, FL",
    "avatar_initials": "CH",
}


# ── Auth fixture ──────────────────────────────────────────────────────────────

from api.server import require_auth  # noqa: E402


@pytest.fixture
def authed():
    """Override require_auth so tests don't need a real session cookie."""
    app.dependency_overrides[require_auth] = lambda: _AUTHED_USER
    yield
    app.dependency_overrides.clear()


# ── GET /api/leads ────────────────────────────────────────────────────────────


def test_list_leads_returns_paginated_structure(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[{"cnt": 1}], [_LEAD_ROW]]
        resp = client.get("/api/leads?page=1&page_size=5")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 5
    assert body["total_pages"] == 1
    assert len(body["data"]) == 1
    assert body["data"][0]["property_name"] == "Silverleaf HOA"


def test_list_leads_filters_by_property_id(authed):
    """Handoff 23 — leads are queryable by canonical property_id so the
    property engagement UI can gate "Request estimate" on a lead existing
    and source real CRM lead context for the intake."""
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[{"cnt": 1}], [_LEAD_ROW]]
        resp = client.get("/api/leads?property_id=prop-1")

    assert resp.status_code == 200
    count_sql, count_params = mock_query.call_args_list[0].args
    assert "property_id = %s" in count_sql
    assert "prop-1" in count_params
    data_sql, data_params = mock_query.call_args_list[1].args
    assert "property_id = %s" in data_sql
    assert "prop-1" in data_params


def test_list_leads_score_factors_parsed_from_json_string(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[{"cnt": 1}], [_LEAD_ROW]]
        resp = client.get("/api/leads")

    factors = resp.json()["data"][0]["score_factors"]
    assert isinstance(factors, list)
    assert factors[0]["name"] == "size"


def test_list_leads_empty_results(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[{"cnt": 0}], []]
        resp = client.get("/api/leads?status=won")

    body = resp.json()
    assert body["total"] == 0
    assert body["data"] == []
    assert body["total_pages"] == 0


def test_list_leads_rejects_invalid_sort_by_silently(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[{"cnt": 0}], []]
        resp = client.get("/api/leads?sort_by=evil_col")

    assert resp.status_code == 200


def test_list_leads_page_size_capped_at_100(authed):
    resp = client.get("/api/leads?page_size=999")
    assert resp.status_code == 422  # FastAPI Query(le=100) validation


# ── GET /api/leads/:id ────────────────────────────────────────────────────────


def test_get_lead_returns_lead(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_LEAD_ROW]):
        resp = client.get("/api/leads/lead-uuid-1")

    assert resp.status_code == 200
    assert resp.json()["id"] == "lead-uuid-1"


def test_get_lead_404_when_not_found(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[]):
        resp = client.get("/api/leads/nonexistent-id")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Lead not found"


# ── POST /api/leads ───────────────────────────────────────────────────────────


def test_create_lead_returns_201_with_new_lead(authed):
    with patch("api.server.execute", new_callable=AsyncMock, return_value=1), \
         patch("api.server.query", new_callable=AsyncMock, return_value=[_LEAD_ROW]):
        resp = client.post(
            "/api/leads",
            json={
                "property_name": "Test HOA",
                "city": "Tempe",
                "state": "AZ",
                "lead_type": "HOA",
            },
        )

    assert resp.status_code == 201
    assert resp.json()["property_name"] == "Silverleaf HOA"  # from mock _LEAD_ROW


def test_create_lead_requires_property_name_city_state_lead_type(authed):
    resp = client.post("/api/leads", json={"property_name": "Test"})
    assert resp.status_code == 422


# ── PATCH /api/leads/:id ──────────────────────────────────────────────────────


def test_patch_lead_returns_updated_lead(authed):
    updated_row = {**_LEAD_ROW, "status": "contacted"}
    with patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1):
        mock_query.side_effect = [[_LEAD_ROW], [updated_row]]
        resp = client.patch("/api/leads/lead-uuid-1", json={"status": "contacted"})

    assert resp.status_code == 200
    assert resp.json()["status"] == "contacted"


def test_patch_lead_status_change_logs_action(authed):
    updated_row = {**_LEAD_ROW, "status": "qualified"}
    with patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1) as mock_execute:
        mock_query.side_effect = [[_LEAD_ROW], [updated_row]]
        resp = client.patch(
            "/api/leads/lead-uuid-1",
            json={"status": "qualified", "performed_by": "u1"},
        )

    assert resp.status_code == 200
    # UPDATE leads + INSERT lead_actions = 2 execute calls
    assert mock_execute.await_count == 2
    action_sql = mock_execute.await_args_list[1][0][0]
    assert "lead_actions" in action_sql
    assert "status_change" in action_sql  # hardcoded literal in SQL


def test_patch_lead_won_updates_hoa_source_property_via_reverse_lookup(authed):
    """Handoff 15: lead → properties.source_type/source_id → hoa_properties."""
    lead_row = {**_LEAD_ROW, "status": "qualified", "property_id": "prop-1"}
    updated_row = {**lead_row, "status": "won"}
    with patch("api.server.set_hoa_property_status", new_callable=AsyncMock) as mock_set, \
         patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1):
        mock_query.side_effect = [
            [lead_row],                                          # _fetch_lead
            [{"source_type": "hoa", "source_id": "hoa-9"}],      # property reverse-lookup
            [updated_row],                                       # reload
        ]
        resp = client.patch("/api/leads/lead-uuid-1", json={"status": "won"})

    assert resp.status_code == 200
    mock_set.assert_awaited_once_with("hoa-9", "won")


def test_patch_lead_won_skips_non_hoa_source(authed):
    lead_row = {**_LEAD_ROW, "status": "qualified", "property_id": "prop-1"}
    updated_row = {**lead_row, "status": "won"}
    with patch("api.server.set_hoa_property_status", new_callable=AsyncMock) as mock_set, \
         patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1):
        mock_query.side_effect = [
            [lead_row],
            [{"source_type": "manual", "source_id": None}],
            [updated_row],
        ]
        resp = client.patch("/api/leads/lead-uuid-1", json={"status": "won"})

    assert resp.status_code == 200
    mock_set.assert_not_awaited()


def test_create_lead_accepts_property_id(authed):
    created = {**_LEAD_ROW, "property_id": "prop-1"}
    with patch("api.server.query", new_callable=AsyncMock, return_value=[created]), \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1) as mock_execute:
        resp = client.post("/api/leads", json={
            "property_name": "Silverleaf HOA", "city": "Phoenix", "state": "AZ",
            "lead_type": "HOA", "property_id": "prop-1",
        })

    assert resp.status_code == 201
    insert_sql, insert_params = mock_execute.await_args_list[0][0]
    assert "property_id" in insert_sql
    assert "prop-1" in insert_params


def test_patch_lead_no_patchable_fields_returns_current(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_LEAD_ROW]):
        resp = client.patch(
            "/api/leads/lead-uuid-1",
            json={"performed_by": "u1"},  # performed_by is stripped; no patchable fields
        )

    assert resp.status_code == 200
    assert resp.json()["id"] == "lead-uuid-1"


# ── GET /api/bids ─────────────────────────────────────────────────────────────


def test_list_bids_returns_all_bids(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_BID_ROW]):
        resp = client.get("/api/bids")

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["id"] == "bid-uuid-1"


def test_list_bids_filters_by_lead_id(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[]) as mock_query:
        resp = client.get("/api/bids?lead_id=other-lead-id")

    assert resp.status_code == 200
    assert resp.json() == []
    executed_sql = mock_query.await_args[0][0]
    assert "lead_id" in executed_sql


def test_list_bids_filters_by_status(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[]) as mock_query:
        resp = client.get("/api/bids?status=submitted")

    assert resp.status_code == 200
    executed_sql = mock_query.await_args[0][0]
    assert "status" in executed_sql


# ── POST /api/bids ────────────────────────────────────────────────────────────


def test_create_bid_returns_201(authed):
    with patch("api.server.execute", new_callable=AsyncMock, return_value=1), \
         patch("api.server.query", new_callable=AsyncMock, return_value=[_BID_ROW]):
        resp = client.post(
            "/api/bids",
            json={"lead_id": "lead-uuid-1", "estimated_value": 50000},
        )

    assert resp.status_code == 201
    assert resp.json()["lead_id"] == "lead-uuid-1"


def test_create_bid_requires_lead_id_and_estimated_value(authed):
    resp = client.post("/api/bids", json={"lead_id": "lead-uuid-1"})
    assert resp.status_code == 422


# ── PATCH /api/bids/:id ───────────────────────────────────────────────────────


def test_patch_bid_returns_updated_bid(authed):
    updated_bid = {**_BID_ROW, "status": "submitted"}
    with patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1):
        mock_query.side_effect = [[_BID_ROW], [updated_bid]]
        resp = client.patch("/api/bids/bid-uuid-1", json={"status": "submitted"})

    assert resp.status_code == 200
    assert resp.json()["status"] == "submitted"


def test_patch_bid_pursuing_marks_hoa_contacted_via_reverse_lookup(authed):
    """Handoff 15: bid → lead.property_id → properties.source_id → hoa_properties."""
    updated_bid = {**_BID_ROW, "status": "pursuing"}
    with patch("api.pipeline.set_property_contacted", new_callable=AsyncMock) as mock_contacted, \
         patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1):
        mock_query.side_effect = [
            [_BID_ROW],                                         # existence check
            [{"lead_id": "lead-uuid-1"}],                       # bid → lead
            [{"property_id": "prop-1"}],                        # lead → property
            [{"source_type": "hoa", "source_id": "hoa-9"}],     # property → source
            [updated_bid],                                      # reload
        ]
        resp = client.patch("/api/bids/bid-uuid-1", json={"status": "pursuing"})

    assert resp.status_code == 200
    mock_contacted.assert_awaited_once_with("hoa-9")


def test_patch_bid_pursuing_skips_manual_source(authed):
    updated_bid = {**_BID_ROW, "status": "pursuing"}
    with patch("api.pipeline.set_property_contacted", new_callable=AsyncMock) as mock_contacted, \
         patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1):
        mock_query.side_effect = [
            [_BID_ROW],
            [{"lead_id": "lead-uuid-1"}],
            [{"property_id": "prop-1"}],
            [{"source_type": "manual", "source_id": None}],
            [updated_bid],
        ]
        resp = client.patch("/api/bids/bid-uuid-1", json={"status": "pursuing"})

    assert resp.status_code == 200
    mock_contacted.assert_not_awaited()


def test_patch_bid_returns_404_when_not_found(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[]):
        resp = client.patch("/api/bids/nonexistent-bid", json={"status": "submitted"})

    assert resp.status_code == 404


def test_patch_bid_returns_400_with_no_fields(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_BID_ROW]):
        resp = client.patch("/api/bids/bid-uuid-1", json={})
    assert resp.status_code == 400


# ── GET /api/users ────────────────────────────────────────────────────────────


def test_list_users_returns_users(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_USER_ROW]):
        resp = client.get("/api/users")

    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "u1"
    assert resp.json()[0]["role"] == "inside_sales"


def test_list_users_filters_by_role(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[]) as mock_query:
        resp = client.get("/api/users?role=outside_sales")

    assert resp.status_code == 200
    executed_sql = mock_query.await_args[0][0]
    assert "role" in executed_sql


def test_list_users_filters_by_branch_id(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_USER_ROW]) as mock_query:
        resp = client.get("/api/users?branch_id=b1")

    assert resp.status_code == 200
    executed_sql = mock_query.await_args[0][0]
    assert "branch_id" in executed_sql


# ── GET /api/dashboard/inside-sales ──────────────────────────────────────────


def test_dashboard_inside_sales_returns_expected_shape(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [
            [{"cnt": 42}],
            [{"cnt": 10}],
            [{"status": "new", "cnt": 10}, {"status": "contacted", "cnt": 5}],
            [{"avg_score": 75.3}],
            [{"state": "AZ", "cnt": 35}, {"state": "TX", "cnt": 7}],
        ]
        resp = client.get("/api/dashboard/inside-sales")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_leads"] == 42
    assert body["new_leads"] == 10
    assert body["leads_by_status"]["new"] == 10
    assert body["avg_score"] == 75.3
    assert body["leads_by_state"]["AZ"] == 35


def test_dashboard_avg_score_zero_when_no_scored_leads(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [
            [{"cnt": 0}],
            [{"cnt": 0}],
            [],
            [{"avg_score": None}],
            [],
        ]
        resp = client.get("/api/dashboard/inside-sales")

    assert resp.json()["avg_score"] == 0.0


# ── Auth — manual login removed ───────────────────────────────────────────────


def test_manual_login_endpoint_is_removed():
    resp = client.post(
        "/api/auth/login",
        json={"email": "carlos.hernandez@juniperlandscaping.com", "password": "demo"},
    )
    assert resp.status_code == 404


def test_server_has_no_password_login_machinery():
    import api.server as server

    assert not hasattr(server, "bcrypt"), "bcrypt import should be removed"
    assert not hasattr(server, "LoginBody"), "LoginBody model should be removed"


# ── Auth — Entra SSO callback ─────────────────────────────────────────────────


def _entra_patches(claims: dict):
    """Patch Entra token verification so entra_callback trusts `claims`."""
    jwks_client = MagicMock()
    jwks_client.get_signing_key_from_jwt.return_value = MagicMock(key="signing-key")
    return (
        patch("api.server.jwt.PyJWKClient", return_value=jwks_client),
        patch("api.server.jwt.decode", return_value=claims),
    )


def test_entra_callback_valid_token_existing_user_issues_session():
    claims = {"email": "carlos.hernandez@juniperlandscaping.com"}
    jwk_patch, decode_patch = _entra_patches(claims)
    with jwk_patch, decode_patch, patch(
        "api.server.query", new_callable=AsyncMock, return_value=[_USER_ROW]
    ):
        resp = client.post("/api/auth/entra-callback", json={"id_token": "valid.jwt.token"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "u1"
    assert body["role"] == "inside_sales"
    assert body["branch_id"] == "b1"
    assert "token" not in body
    assert "session" in resp.cookies


def test_entra_callback_unprovisioned_user_returns_403():
    """entra_callback must 403 when the email has no row in users — no auto-provision."""
    claims = {"email": "notprovisioned@juniperlandscaping.com"}
    jwk_patch, decode_patch = _entra_patches(claims)
    with jwk_patch, decode_patch, patch(
        "api.server.query", new_callable=AsyncMock, return_value=[]
    ):
        resp = client.post("/api/auth/entra-callback", json={"id_token": "valid.jwt.token"})

    assert resp.status_code == 403
    assert "provisioned" in resp.json()["detail"].lower()


def test_entra_callback_matches_email_case_insensitively():
    claims = {"email": "Carlos.Hernandez@Juniperlandscaping.com"}
    jwk_patch, decode_patch = _entra_patches(claims)
    query_mock = AsyncMock(return_value=[_USER_ROW])
    with jwk_patch, decode_patch, patch("api.server.query", query_mock):
        resp = client.post("/api/auth/entra-callback", json={"id_token": "valid.jwt.token"})

    assert resp.status_code == 200
    # Params are plain Python values; email is lowercased before binding
    bound_email = query_mock.await_args[0][1][0]
    assert bound_email == "carlos.hernandez@juniperlandscaping.com"


def test_entra_callback_invalid_token_returns_401():
    jwks_client = MagicMock()
    jwks_client.get_signing_key_from_jwt.return_value = MagicMock(key="signing-key")
    with patch("api.server.jwt.PyJWKClient", return_value=jwks_client), patch(
        "api.server.jwt.decode", side_effect=Exception("bad signature")
    ):
        resp = client.post("/api/auth/entra-callback", json={"id_token": "tampered"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid SSO token"


# ── DELETE /api/leads/:id ─────────────────────────────────────────────────────


def test_delete_lead_returns_204(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_LEAD_ROW]), \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1):
        resp = client.delete("/api/leads/lead-uuid-1")

    assert resp.status_code == 204


def test_delete_lead_sql_uses_soft_delete(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[_LEAD_ROW]), \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1) as mock_execute:
        client.delete("/api/leads/lead-uuid-1")

    executed_sql = mock_execute.await_args[0][0]
    assert "deleted_at" in executed_sql.lower()
    assert "CURRENT_TIMESTAMP()" in executed_sql
    assert "deleted_at IS NULL" in executed_sql  # guard: won't re-delete


def test_delete_lead_returns_404_when_not_found(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[]):
        resp = client.delete("/api/leads/nonexistent")

    assert resp.status_code == 404


def test_delete_already_deleted_lead_returns_404(authed):
    # _fetch_lead's WHERE deleted_at IS NULL means soft-deleted leads return []
    with patch("api.server.query", new_callable=AsyncMock, return_value=[]):
        resp = client.delete("/api/leads/already-deleted")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Lead not found"


# ── PATCH division_id ─────────────────────────────────────────────────────────


def test_patch_lead_division_id_is_accepted(authed):
    updated_row = {**_LEAD_ROW_WITH_ASPIRE, "division_id": 1574}
    with patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1):
        mock_query.side_effect = [[_LEAD_ROW_WITH_ASPIRE], [updated_row]]
        resp = client.patch("/api/leads/lead-uuid-1", json={"division_id": 1574})

    assert resp.status_code == 200
    assert resp.json()["division_id"] == 1574


def test_patch_lead_division_id_appears_in_update_sql(authed):
    updated_row = {**_LEAD_ROW_WITH_ASPIRE, "division_id": 1569}
    with patch("api.server.query", new_callable=AsyncMock) as mock_query, \
         patch("api.server.execute", new_callable=AsyncMock, return_value=1) as mock_execute:
        mock_query.side_effect = [[_LEAD_ROW_WITH_ASPIRE], [updated_row]]
        client.patch("/api/leads/lead-uuid-1", json={"division_id": 1569})

    update_sql = mock_execute.await_args_list[0][0][0]
    assert "division_id" in update_sql


# ── deleted_at IS NULL filters ─────────────────────────────────────────────────


def test_list_leads_sql_excludes_deleted(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[{"cnt": 0}], []]
        client.get("/api/leads")

    count_sql = mock_query.await_args_list[0][0][0]
    assert "deleted_at IS NULL" in count_sql


def test_list_leads_data_query_excludes_deleted(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [[{"cnt": 0}], []]
        client.get("/api/leads")

    data_sql = mock_query.await_args_list[1][0][0]
    assert "deleted_at IS NULL" in data_sql


def test_get_lead_sql_excludes_deleted(authed):
    with patch("api.server.query", new_callable=AsyncMock, return_value=[]) as mock_query:
        client.get("/api/leads/lead-uuid-1")

    executed_sql = mock_query.await_args[0][0]
    assert "deleted_at IS NULL" in executed_sql


def test_dashboard_sql_excludes_deleted(authed):
    with patch("api.server.query", new_callable=AsyncMock) as mock_query:
        mock_query.side_effect = [
            [{"cnt": 5}],
            [{"cnt": 2}],
            [{"status": "new", "cnt": 2}],
            [{"avg_score": 70.0}],
            [{"state": "FL", "cnt": 5}],
        ]
        client.get("/api/dashboard/inside-sales")

    all_sql = [call[0][0] for call in mock_query.await_args_list]
    assert all("deleted_at IS NULL" in sql for sql in all_sql), (
        f"One or more dashboard queries missing deleted_at filter: {all_sql}"
    )
