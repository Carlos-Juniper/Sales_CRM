"""
Tests for api/server.py.
DB is fully mocked — no real MySQL instance required.

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

# ── Mock infrastructure ───────────────────────────────────────────────────────


def _make_cursor(
    *,
    fetchone_side: list | None = None,
    fetchall_value: list | None = None,
    rowcount: int = 1,
) -> AsyncMock:
    """Return a mock cursor that acts as an async context manager."""
    cur = AsyncMock()
    cur.rowcount = rowcount
    cur.fetchone = AsyncMock(side_effect=fetchone_side or [None])
    cur.fetchall = AsyncMock(return_value=fetchall_value or [])
    cur.__aenter__ = AsyncMock(return_value=cur)
    cur.__aexit__ = AsyncMock(return_value=False)
    return cur


def _make_pool(cursor: AsyncMock) -> AsyncMock:
    """Wrap cursor in a mock connection / pool hierarchy."""
    conn = AsyncMock()
    conn.cursor = MagicMock(return_value=cursor)
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=False)

    acquire_cm = AsyncMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=False)

    pool = AsyncMock()
    pool.acquire = MagicMock(return_value=acquire_cm)
    return pool


# Sample DB rows
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
    "created_at": datetime(2026, 5, 1, 10, 0, 0),
    "updated_at": datetime(2026, 5, 1, 10, 0, 0),
}

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


# ── GET /api/leads ────────────────────────────────────────────────────────────


def test_list_leads_returns_paginated_structure():
    cur = _make_cursor(
        fetchone_side=[{"cnt": 1}],
        fetchall_value=[_LEAD_ROW],
    )
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/leads?page=1&page_size=5")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 5
    assert body["total_pages"] == 1
    assert len(body["data"]) == 1
    assert body["data"][0]["property_name"] == "Silverleaf HOA"


def test_list_leads_score_factors_parsed_from_json_string():
    cur = _make_cursor(
        fetchone_side=[{"cnt": 1}],
        fetchall_value=[_LEAD_ROW],
    )
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/leads")

    factors = resp.json()["data"][0]["score_factors"]
    assert isinstance(factors, list)
    assert factors[0]["name"] == "size"


def test_list_leads_empty_results():
    cur = _make_cursor(fetchone_side=[{"cnt": 0}], fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/leads?status=won")

    body = resp.json()
    assert body["total"] == 0
    assert body["data"] == []
    assert body["total_pages"] == 0


def test_list_leads_rejects_invalid_sort_by_silently():
    # Unknown sort_by falls back to 'score' — should not 500
    cur = _make_cursor(fetchone_side=[{"cnt": 0}], fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/leads?sort_by=evil_col")

    assert resp.status_code == 200


def test_list_leads_page_size_capped_at_100():
    cur = _make_cursor(fetchone_side=[{"cnt": 0}], fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/leads?page_size=999")

    assert resp.status_code == 422  # FastAPI Query(le=100) validation


# ── GET /api/leads/:id ────────────────────────────────────────────────────────


def test_get_lead_returns_lead():
    cur = _make_cursor(fetchone_side=[_LEAD_ROW])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/leads/lead-uuid-1")

    assert resp.status_code == 200
    assert resp.json()["id"] == "lead-uuid-1"


def test_get_lead_404_when_not_found():
    cur = _make_cursor(fetchone_side=[None])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/leads/nonexistent-id")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Lead not found"


# ── POST /api/leads ───────────────────────────────────────────────────────────


def test_create_lead_returns_201_with_new_lead():
    # First pool call: INSERT (no fetchone needed)
    # Second pool call: _fetch_lead SELECT
    insert_cur = _make_cursor()
    fetch_cur = _make_cursor(fetchone_side=[_LEAD_ROW])

    pool_call_count = 0
    pools = [_make_pool(insert_cur), _make_pool(fetch_cur)]

    async def _get_pool_side_effect():
        nonlocal pool_call_count
        p = pools[min(pool_call_count, len(pools) - 1)]
        pool_call_count += 1
        return p

    with patch("api.server.get_pool", side_effect=_get_pool_side_effect):
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


def test_create_lead_requires_property_name_city_state_lead_type():
    resp = client.post("/api/leads", json={"property_name": "Test"})
    assert resp.status_code == 422


# ── PATCH /api/leads/:id ──────────────────────────────────────────────────────


def test_patch_lead_returns_updated_lead():
    updated_row = {**_LEAD_ROW, "status": "contacted"}
    # Call order: _fetch_lead (initial), UPDATE cur, _fetch_lead (return)
    cur_1 = _make_cursor(fetchone_side=[_LEAD_ROW])   # initial fetch
    cur_2 = _make_cursor()                             # UPDATE
    cur_3 = _make_cursor(fetchone_side=[updated_row])  # final fetch

    call_count = 0
    pools = [_make_pool(cur_1), _make_pool(cur_2), _make_pool(cur_3)]

    async def _side(*_):
        nonlocal call_count
        p = pools[min(call_count, len(pools) - 1)]
        call_count += 1
        return p

    with patch("api.server.get_pool", side_effect=_side):
        resp = client.patch(
            "/api/leads/lead-uuid-1",
            json={"status": "contacted"},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "contacted"


def test_patch_lead_status_change_logs_action():
    updated_row = {**_LEAD_ROW, "status": "qualified"}
    cur_1 = _make_cursor(fetchone_side=[_LEAD_ROW])
    cur_2 = _make_cursor()
    cur_3 = _make_cursor(fetchone_side=[updated_row])

    call_count = 0
    pools = [_make_pool(cur_1), _make_pool(cur_2), _make_pool(cur_3)]

    async def _side(*_):
        nonlocal call_count
        p = pools[min(call_count, len(pools) - 1)]
        call_count += 1
        return p

    with patch("api.server.get_pool", side_effect=_side):
        resp = client.patch(
            "/api/leads/lead-uuid-1",
            json={"status": "qualified", "performed_by": "u1"},
        )

    assert resp.status_code == 200
    # Verify INSERT INTO lead_actions was called (cur_2 had two execute calls)
    assert cur_2.execute.call_count == 2
    action_call_args = cur_2.execute.call_args_list[1][0]
    assert "lead_actions" in action_call_args[0]
    assert "status_change" in action_call_args[0]  # hardcoded in SQL, not in params


def test_patch_lead_no_patchable_fields_returns_current():
    cur = _make_cursor(fetchone_side=[_LEAD_ROW])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.patch(
            "/api/leads/lead-uuid-1",
            json={"performed_by": "u1"},  # performed_by is stripped; no patchable fields
        )

    assert resp.status_code == 200
    assert resp.json()["id"] == "lead-uuid-1"


# ── GET /api/outreach/:leadId ─────────────────────────────────────────────────


def test_get_outreach_maps_action_type_to_channel():
    action_row = {
        "id": 1,
        "lead_id": "lead-uuid-1",
        "action_type": "email_sent",
        "detail": "Hi Jennifer, reaching out about your HOA.",
        "performed_by": "u1",
        "performed_at": datetime(2026, 5, 1, 14, 0, 0),
        "prev_status": None,
        "new_status": None,
    }
    cur = _make_cursor(fetchall_value=[action_row])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/outreach/lead-uuid-1")

    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["channel"] == "email"
    assert items[0]["message"] == "Hi Jennifer, reaching out about your HOA."
    assert items[0]["lead_id"] == "lead-uuid-1"


def test_get_outreach_empty_for_new_lead():
    cur = _make_cursor(fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/outreach/new-lead-id")

    assert resp.status_code == 200
    assert resp.json() == []


def test_get_outreach_call_logged_maps_to_phone():
    action_row = {
        "id": 2,
        "lead_id": "lead-uuid-1",
        "action_type": "call_logged",
        "detail": "Left voicemail.",
        "performed_by": None,
        "performed_at": datetime(2026, 5, 2, 9, 0, 0),
        "prev_status": None,
        "new_status": None,
    }
    cur = _make_cursor(fetchall_value=[action_row])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/outreach/lead-uuid-1")

    assert resp.json()[0]["channel"] == "phone"


# ── POST /api/outreach/send ───────────────────────────────────────────────────


def test_send_outreach_returns_success_and_message_id():
    cur = _make_cursor()
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.post(
            "/api/outreach/send",
            json={"lead_id": "lead-uuid-1", "channel": "email", "message": "Hello"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["message_id"].startswith("msg_")


def test_send_outreach_promotes_new_lead_to_contacted():
    cur = _make_cursor()
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        client.post(
            "/api/outreach/send",
            json={"lead_id": "lead-uuid-1", "channel": "phone", "message": "Called."},
        )

    # Second execute call should be the UPDATE ... WHERE status = 'new'
    assert cur.execute.call_count == 2
    update_sql = cur.execute.call_args_list[1][0][0]
    assert "contacted" in update_sql
    assert "status = 'new'" in update_sql


def test_send_outreach_phone_channel_uses_call_logged():
    cur = _make_cursor()
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        client.post(
            "/api/outreach/send",
            json={"lead_id": "lead-uuid-1", "channel": "phone", "message": "Spoke briefly."},
        )

    insert_args = cur.execute.call_args_list[0][0][1]
    assert insert_args[1] == "call_logged"


# ── GET /api/bids ─────────────────────────────────────────────────────────────


def test_list_bids_returns_all_bids():
    cur = _make_cursor(fetchall_value=[_BID_ROW])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/bids")

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["id"] == "bid-uuid-1"


def test_list_bids_filters_by_lead_id():
    cur = _make_cursor(fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/bids?lead_id=other-lead-id")

    assert resp.status_code == 200
    assert resp.json() == []
    # Confirm WHERE clause was applied
    executed_sql = cur.execute.call_args[0][0]
    assert "lead_id" in executed_sql


def test_list_bids_filters_by_status():
    cur = _make_cursor(fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/bids?status=submitted")

    assert resp.status_code == 200
    executed_sql = cur.execute.call_args[0][0]
    assert "status" in executed_sql


# ── POST /api/bids ────────────────────────────────────────────────────────────


def test_create_bid_returns_201():
    cur = _make_cursor(fetchone_side=[_BID_ROW])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.post(
            "/api/bids",
            json={"lead_id": "lead-uuid-1", "estimated_value": 50000},
        )

    assert resp.status_code == 201
    assert resp.json()["lead_id"] == "lead-uuid-1"


def test_create_bid_requires_lead_id_and_estimated_value():
    resp = client.post("/api/bids", json={"lead_id": "lead-uuid-1"})
    assert resp.status_code == 422


# ── PATCH /api/bids/:id ───────────────────────────────────────────────────────


def test_patch_bid_returns_updated_bid():
    updated_bid = {**_BID_ROW, "status": "submitted"}
    cur = _make_cursor(fetchone_side=[updated_bid], rowcount=1)
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.patch(
            "/api/bids/bid-uuid-1",
            json={"status": "submitted"},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "submitted"


def test_patch_bid_returns_404_when_not_found():
    cur = _make_cursor(rowcount=0)
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.patch(
            "/api/bids/nonexistent-bid",
            json={"status": "submitted"},
        )

    assert resp.status_code == 404


def test_patch_bid_returns_400_with_no_fields():
    resp = client.patch("/api/bids/bid-uuid-1", json={})
    assert resp.status_code == 400


# ── GET /api/users ────────────────────────────────────────────────────────────


def test_list_users_returns_users():
    cur = _make_cursor(fetchall_value=[_USER_ROW])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/users")

    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "u1"
    assert resp.json()[0]["role"] == "inside_sales"


def test_list_users_filters_by_role():
    cur = _make_cursor(fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/users?role=outside_sales")

    assert resp.status_code == 200
    executed_sql = cur.execute.call_args[0][0]
    assert "role" in executed_sql


def test_list_users_filters_by_branch_id():
    cur = _make_cursor(fetchall_value=[_USER_ROW])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/users?branch_id=b1")

    assert resp.status_code == 200
    executed_sql = cur.execute.call_args[0][0]
    assert "branch_id" in executed_sql


# ── GET /api/dashboard/inside-sales ──────────────────────────────────────────


def test_dashboard_inside_sales_returns_expected_shape():
    # fetchone is called exactly 3 times: total_leads, new_leads, avg_score
    # leads_by_status and leads_by_state use fetchall (separate mock)
    cur = _make_cursor(
        fetchone_side=[
            {"cnt": 42},
            {"cnt": 10},
            {"avg_score": 75.3},
        ],
    )
    cur.fetchall = AsyncMock(side_effect=[
        [{"status": "new", "cnt": 10}, {"status": "contacted", "cnt": 5}],
        [{"state": "AZ", "cnt": 35}, {"state": "TX", "cnt": 7}],
    ])

    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/dashboard/inside-sales")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_leads"] == 42
    assert body["new_leads"] == 10
    assert body["leads_by_status"]["new"] == 10
    assert body["avg_score"] == 75.3
    assert body["leads_by_state"]["AZ"] == 35


def test_dashboard_avg_score_zero_when_no_scored_leads():
    cur = _make_cursor(
        fetchone_side=[
            {"cnt": 0},
            {"cnt": 0},
            {"avg_score": None},
        ],
    )
    cur.fetchall = AsyncMock(side_effect=[[], []])

    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.get("/api/dashboard/inside-sales")

    assert resp.json()["avg_score"] == 0.0


# ── Auth is SSO-only (manual login removed) ───────────────────────────────────
# The manual email/password path (POST /api/auth/login, bcrypt, crm_logins) has
# been removed. Microsoft Entra SSO is the only entry point. On first login, users
# are auto-provisioned with role=inside_sales and branch_id=NULL (admin can update
# later). Returning users are looked up in crm_users.


def _entra_patches(claims: dict):
    """Patch Entra token verification so entra_callback trusts `claims`.

    Returns a context-manager-friendly tuple of patches for jwt.PyJWKClient
    (network JWKS fetch) and jwt.decode (signature/audience validation).
    """
    jwks_client = MagicMock()
    jwks_client.get_signing_key_from_jwt.return_value = MagicMock(key="signing-key")
    return (
        patch("api.server.jwt.PyJWKClient", return_value=jwks_client),
        patch("api.server.jwt.decode", return_value=claims),
    )


def test_manual_login_endpoint_is_removed():
    # The manual login path no longer exists — the route should not be registered.
    resp = client.post(
        "/api/auth/login",
        json={"email": "carlos.hernandez@juniperlandscaping.com", "password": "demo"},
    )
    assert resp.status_code == 404


def test_server_has_no_password_login_machinery():
    import api.server as server

    # bcrypt import and LoginBody model are gone; no credential store lookups remain.
    assert not hasattr(server, "bcrypt"), "bcrypt import should be removed"
    assert not hasattr(server, "LoginBody"), "LoginBody model should be removed"


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
    # Session is minted as an httponly cookie, not returned in the body.
    assert "token" not in body
    assert "session" in resp.cookies


def test_entra_callback_auto_provisions_first_time_user():
    # On first login (no existing crm_users row), user is auto-provisioned with
    # role=inside_sales and branch_id=NULL (can be updated later by admin).
    claims = {"email": "newuser@juniperlandscaping.com", "name": "New User"}
    jwk_patch, decode_patch = _entra_patches(claims)
    query_mock = AsyncMock(return_value=[])  # No existing user
    execute_mock = AsyncMock(return_value=1)  # INSERT succeeded
    with jwk_patch, decode_patch, patch(
        "api.server.query", query_mock
    ), patch("api.server.execute", execute_mock):
        resp = client.post("/api/auth/entra-callback", json={"id_token": "valid.jwt.token"})

    assert resp.status_code == 200
    body = resp.json()
    # Verify auto-provisioned user has inside_sales role and no branch.
    assert body["email"] == "newuser@juniperlandscaping.com"
    assert body["name"] == "New User"
    assert body["role"] == "inside_sales"
    assert body["branch_id"] is None
    # Session cookie should be set.
    assert "session" in resp.cookies

    # Verify execute was called to INSERT the new user.
    assert execute_mock.await_count == 1
    insert_sql = execute_mock.await_args[0][0]
    assert "INSERT" in insert_sql.upper()
    insert_params = [p.value for p in execute_mock.await_args[0][1]]
    assert "newuser@juniperlandscaping.com" in insert_params
    assert "New User" in insert_params
    assert "inside_sales" in insert_params
    assert None in insert_params  # branch_id is NULL


def test_entra_callback_auto_provision_lowercases_email():
    # Auto-provisioned user's email should be lowercased in the DB.
    claims = {"email": "Jane.Doe@Juniperlandscaping.com", "name": "Jane Doe"}
    jwk_patch, decode_patch = _entra_patches(claims)
    query_mock = AsyncMock(return_value=[])
    execute_mock = AsyncMock(return_value=1)
    with jwk_patch, decode_patch, patch(
        "api.server.query", query_mock
    ), patch("api.server.execute", execute_mock):
        resp = client.post("/api/auth/entra-callback", json={"id_token": "valid.jwt.token"})

    assert resp.status_code == 200
    # Email in response is lowercased.
    assert resp.json()["email"] == "jane.doe@juniperlandscaping.com"
    # Email in INSERT params is lowercased.
    insert_params = [p.value for p in execute_mock.await_args[0][1]]
    assert "jane.doe@juniperlandscaping.com" in insert_params


def test_entra_callback_matches_email_case_insensitively():
    # Entra token casing isn't under our control; the lookup must normalize it
    # so a mixed-case claim still resolves the (lowercased) crm_users row.
    claims = {"email": "Carlos.Hernandez@Juniperlandscaping.com"}
    jwk_patch, decode_patch = _entra_patches(claims)
    query_mock = AsyncMock(return_value=[_USER_ROW])
    with jwk_patch, decode_patch, patch("api.server.query", query_mock):
        resp = client.post("/api/auth/entra-callback", json={"id_token": "valid.jwt.token"})

    assert resp.status_code == 200
    # The email bound into the lookup is lowercased.
    bound_email = query_mock.await_args[0][1][0].value
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


# ── Fixtures for auth-gated endpoint tests ────────────────────────────────────
# The endpoints below use Depends(require_auth). We override the dependency
# so tests don't need a real session cookie or DB session lookup.

from api.server import require_auth  # noqa: E402

_AUTHED_USER = {
    "id": "u1",
    "name": "Carlos Hernandez",
    "email": "carlos.hernandez@juniperlandscaping.com",
    "role": "inside_sales",
    "branch_id": "Tampa North, FL",
    "avatar_initials": "CH",
}

_LEAD_ROW_WITH_ASPIRE = {
    **_LEAD_ROW,
    "division_id": None,
    "deleted_at": None,
    "aspire_opportunity_id": None,
}


@pytest.fixture
def authed():
    """Override require_auth so tests don't need a real session."""
    app.dependency_overrides[require_auth] = lambda: _AUTHED_USER
    yield
    app.dependency_overrides.clear()


# ── DELETE /api/leads/:id ─────────────────────────────────────────────────────


def test_delete_lead_returns_204(authed):
    cur = _make_cursor(rowcount=1)
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.delete("/api/leads/lead-uuid-1")

    assert resp.status_code == 204


def test_delete_lead_sql_uses_soft_delete(authed):
    cur = _make_cursor(rowcount=1)
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        client.delete("/api/leads/lead-uuid-1")

    executed_sql = cur.execute.call_args[0][0]
    assert "deleted_at" in executed_sql.lower()
    assert "NOW()" in executed_sql
    assert "deleted_at IS NULL" in executed_sql  # guard: won't re-delete


def test_delete_lead_returns_404_when_not_found(authed):
    cur = _make_cursor(rowcount=0)
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.delete("/api/leads/nonexistent")

    assert resp.status_code == 404


def test_delete_already_deleted_lead_returns_404(authed):
    # rowcount=0 because WHERE deleted_at IS NULL guard prevents matching
    cur = _make_cursor(rowcount=0)
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        resp = client.delete("/api/leads/already-deleted")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Lead not found"


# ── PATCH division_id ─────────────────────────────────────────────────────────


def test_patch_lead_division_id_is_accepted(authed):
    updated_row = {**_LEAD_ROW_WITH_ASPIRE, "division_id": 1574}
    cur_1 = _make_cursor(fetchone_side=[_LEAD_ROW_WITH_ASPIRE])
    cur_2 = _make_cursor()
    cur_3 = _make_cursor(fetchone_side=[updated_row])

    call_count = 0
    pools = [_make_pool(cur_1), _make_pool(cur_2), _make_pool(cur_3)]

    async def _side(*_):
        nonlocal call_count
        p = pools[min(call_count, len(pools) - 1)]
        call_count += 1
        return p

    with patch("api.server.get_pool", side_effect=_side):
        resp = client.patch("/api/leads/lead-uuid-1", json={"division_id": 1574})

    assert resp.status_code == 200
    assert resp.json()["division_id"] == 1574


def test_patch_lead_division_id_appears_in_update_sql(authed):
    updated_row = {**_LEAD_ROW_WITH_ASPIRE, "division_id": 1569}
    cur_1 = _make_cursor(fetchone_side=[_LEAD_ROW_WITH_ASPIRE])
    cur_2 = _make_cursor()
    cur_3 = _make_cursor(fetchone_side=[updated_row])

    call_count = 0
    pools = [_make_pool(cur_1), _make_pool(cur_2), _make_pool(cur_3)]

    async def _side(*_):
        nonlocal call_count
        p = pools[min(call_count, len(pools) - 1)]
        call_count += 1
        return p

    with patch("api.server.get_pool", side_effect=_side):
        client.patch("/api/leads/lead-uuid-1", json={"division_id": 1569})

    update_sql = cur_2.execute.call_args[0][0]
    assert "division_id" in update_sql


# ── deleted_at IS NULL filters ─────────────────────────────────────────────────


def test_list_leads_sql_excludes_deleted(authed):
    cur = _make_cursor(fetchone_side=[{"cnt": 0}], fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        client.get("/api/leads")

    # First execute call is the COUNT query
    count_sql = cur.execute.call_args_list[0][0][0]
    assert "deleted_at IS NULL" in count_sql


def test_list_leads_data_query_excludes_deleted(authed):
    cur = _make_cursor(fetchone_side=[{"cnt": 0}], fetchall_value=[])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        client.get("/api/leads")

    # Second execute call is the SELECT data query
    data_sql = cur.execute.call_args_list[1][0][0]
    assert "deleted_at IS NULL" in data_sql


def test_get_lead_sql_excludes_deleted(authed):
    cur = _make_cursor(fetchone_side=[None])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        client.get("/api/leads/lead-uuid-1")

    executed_sql = cur.execute.call_args[0][0]
    assert "deleted_at IS NULL" in executed_sql


def test_dashboard_sql_excludes_deleted(authed):
    cur = _make_cursor(
        fetchone_side=[{"cnt": 5}, {"cnt": 2}, {"avg_score": 70.0}],
    )
    cur.fetchall = AsyncMock(side_effect=[
        [{"status": "new", "cnt": 2}],
        [{"state": "FL", "cnt": 5}],
    ])
    with patch("api.server.get_pool", new_callable=AsyncMock, return_value=_make_pool(cur)):
        client.get("/api/dashboard/inside-sales")

    all_sql = [call[0][0] for call in cur.execute.call_args_list]
    assert all("deleted_at IS NULL" in sql for sql in all_sql), (
        f"One or more dashboard queries missing deleted_at filter: {all_sql}"
    )
