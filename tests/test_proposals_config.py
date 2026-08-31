"""Proposal Config Read APIs — GET endpoints under /api/proposals/config/*.

DB is fully mocked (patch api.proposals.query) — no real MySQL required.
Mirrors the pattern in test_estimating_config.py.

Endpoints under test (all authenticated, all read-only):
  GET /api/proposals/config/branches
      → BranchProfile[] projected from crm.branches; operating-roster filter;
        only rows with lat/lng; ordered by branch_name
  GET /api/proposals/config/team-members?aspire_branch_id=&team_type=
      → TeamMember[]; null-branch rows included alongside branch matches (A.6)
  GET /api/proposals/config/client-references?aspire_branch_id=
      → ClientReference[]; company-wide (null) rows included (A.6)
  GET /api/proposals/config/portfolio?region_id=
      → PortfolioProperty[]; optional region_id filter
  GET /api/proposals/config/insurance
      → current cert dict or null

JSON shapes must match studio/src/types/proposal.ts exactly (Amendment A).
"""
from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

# Env must be set before importing app
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


# ── Canonical seed rows as the DB returns them (snake_case) ──────────────────

def _branch_row(**over) -> dict:
    """A crm.branches row as returned by the JOIN query."""
    row = {
        "aspire_branch_id": 1403,
        "branch_name": "Fort Myers Install",
        "address1": "5880 Staley Road",
        "city": "Fort Myers",
        "state": "FL",
        "zip": "33905",
        "lat": Decimal("26.651900"),
        "lng": Decimal("-81.771800"),
        "region_id": "west-coast",
    }
    row.update(over)
    return row


def _team_member_row(**over) -> dict:
    row = {
        "id": "tm-bm-fti-001",
        "name": "Anthony Genca",
        "title": "manager",
        "team_type": "branch",
        "aspire_branch_id": 1403,
        "user_id": None,
        "location": "Fort Myers, FL",
        "bio": "Anthony manages the Fort Myers Install branch.",
        "headshot_object_key": None,
        "active": 1,
        "sort_order": 0,
    }
    row.update(over)
    return row


def _client_reference_row(**over) -> dict:
    row = {
        "id": "cr-001",
        "aspire_branch_id": None,   # company-wide
        "property_name": "Coral Bay HOA",
        "services_provided": "Landscape Maintenance, Irrigation",
        "contact_name": "Michelle Cady",
        "contact_title": "Property Manager",
        "phone": "(561) 555-0100",
        "email": "mcady@coralbay.com",
        "address": "100 Coral Bay Dr, Jupiter, FL 33458",
        "client_since_year": 2021,
        "active": 1,
    }
    row.update(over)
    return row


def _portfolio_row(**over) -> dict:
    row = {
        "id": "pp-001",
        "name": "Pointe Jupiter Yacht Club",
        "city_state": "Jupiter, FL",
        "region_id": "east-coast",
        "photo_object_keys": "[]",
        "before_after_object_keys": None,
        "sort_order": 0,
    }
    row.update(over)
    return row


def _insurance_row(**over) -> dict:
    row = {
        "id": "ins-cert-001",
        "object_key": "proposal/insurance/juniper-certificate-of-liability-2026.pdf",
        "expiry_date": "2027-03-31",
        "label": "General Liability",
        "uploaded_at": "2026-08-26 00:00:00",
    }
    row.update(over)
    return row


# ── Auth guard: every endpoint requires authentication ───────────────────────

class TestAuthRequired:
    @pytest.mark.parametrize("path", [
        "/api/proposals/config/branches",
        "/api/proposals/config/team-members",
        "/api/proposals/config/client-references",
        "/api/proposals/config/portfolio",
        "/api/proposals/config/insurance",
    ])
    def test_unauthenticated_is_rejected(self, path):
        res = client.get(path)
        assert res.status_code in (401, 403)


# ── GET /api/proposals/config/branches ───────────────────────────────────────

class TestBranches:
    def test_returns_branch_profiles_camel_case(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_branch_row()]
            res = client.get("/api/proposals/config/branches")
        assert res.status_code == 200
        body = res.json()
        assert len(body) == 1
        b = body[0]
        assert b["aspireBranchId"] == 1403
        assert b["branchName"] == "Fort Myers Install"
        assert b["city"] == "Fort Myers"
        assert b["regionId"] == "west-coast"
        assert b["address"] == "5880 Staley Road, Fort Myers, FL 33905"
        assert b["lat"] == pytest.approx(26.6519)
        assert b["lng"] == pytest.approx(-81.7718)

    def test_operating_roster_filter_in_sql(self, authed):
        """SQL must exclude inactive and 'DO NOT USE' branches."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/branches")
        sql = mock_q.call_args.args[0]
        assert "active = 1" in sql
        assert "DO NOT USE" in sql

    def test_only_rows_with_lat_lng_are_returned(self, authed):
        """Rows without lat/lng are excluded (proximity footer requires coords)."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/branches")
        sql = mock_q.call_args.args[0]
        assert "lat IS NOT NULL" in sql
        assert "lng IS NOT NULL" in sql

    def test_decimal_lat_lng_converted_to_float(self, authed):
        """Decimal values from aiomysql must become JSON-serializable floats."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_branch_row(lat=Decimal("26.651900"), lng=Decimal("-81.771800"))]
            res = client.get("/api/proposals/config/branches")
        body = res.json()
        assert isinstance(body[0]["lat"], float)
        assert isinstance(body[0]["lng"], float)

    def test_two_branches_same_address_both_returned(self, authed):
        """Fort Myers Install (1403) and Maintenance (3696) share an address.
        Both are valid rows and both should be returned — the frontend's proximity
        calc dedupes by address, not the backend (per Amendment A.1)."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [
                _branch_row(aspire_branch_id=1403, branch_name="Fort Myers Install"),
                _branch_row(aspire_branch_id=3696, branch_name="Fort Myers Maintenance"),
            ]
            res = client.get("/api/proposals/config/branches")
        body = res.json()
        assert len(body) == 2
        ids = {b["aspireBranchId"] for b in body}
        assert ids == {1403, 3696}

    def test_empty_response_when_no_branches_have_coordinates(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            res = client.get("/api/proposals/config/branches")
        assert res.status_code == 200
        assert res.json() == []


# ── GET /api/proposals/config/team-members ───────────────────────────────────

class TestTeamMembers:
    def test_returns_team_member_shape(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_team_member_row()]
            res = client.get("/api/proposals/config/team-members")
        assert res.status_code == 200
        body = res.json()
        assert body[0] == {
            "id": "tm-bm-fti-001",
            "name": "Anthony Genca",
            "title": "manager",
            "teamType": "branch",
            "aspireBranchId": 1403,
            "userId": None,
            "location": "Fort Myers, FL",
            "bio": "Anthony manages the Fort Myers Install branch.",
            "headshotObjectKey": None,
            "active": True,
            "sortOrder": 0,
        }

    def test_branch_filter_includes_null_branch_rows(self, authed):
        """Amendment A.6: when aspire_branch_id is given, null-branch rows
        are returned IN ADDITION to branch matches — not filtered out."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/team-members?aspire_branch_id=1403")
        sql, params = mock_q.call_args.args[0], mock_q.call_args.args[1]
        # The OR clause must include IS NULL to surface company-wide rows
        assert "aspire_branch_id IS NULL" in sql
        assert 1403 in params

    def test_no_branch_filter_returns_all_active(self, authed):
        """Omitting aspire_branch_id returns all active rows."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/team-members")
        sql = mock_q.call_args.args[0]
        assert "active = 1" in sql
        # No branch filter — should NOT have the aspire_branch_id condition
        assert "aspire_branch_id = %s" not in sql

    def test_team_type_filter(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/team-members?team_type=executive")
        sql, params = mock_q.call_args.args[0], mock_q.call_args.args[1]
        assert "team_type = %s" in sql
        assert "executive" in params

    def test_both_filters_combined(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/team-members?aspire_branch_id=3696&team_type=branch")
        sql, params = mock_q.call_args.args[0], mock_q.call_args.args[1]
        assert "aspire_branch_id = %s OR aspire_branch_id IS NULL" in sql
        assert 3696 in params
        assert "team_type = %s" in sql
        assert "branch" in params

    def test_null_user_id_surfaced(self, authed):
        """Non-CRM persons (null userId) must appear in the list."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_team_member_row(user_id=None)]
            res = client.get("/api/proposals/config/team-members")
        assert res.json()[0]["userId"] is None

    def test_user_id_linked_row(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_team_member_row(user_id="usr-abc123")]
            res = client.get("/api/proposals/config/team-members")
        assert res.json()[0]["userId"] == "usr-abc123"

    def test_inactive_rows_excluded(self, authed):
        """active = 1 filter must be in the query."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/team-members")
        sql = mock_q.call_args.args[0]
        assert "active = 1" in sql


# ── GET /api/proposals/config/client-references ──────────────────────────────

class TestClientReferences:
    def test_returns_client_reference_shape(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_client_reference_row()]
            res = client.get("/api/proposals/config/client-references")
        assert res.status_code == 200
        body = res.json()
        assert body[0] == {
            "id": "cr-001",
            "aspireBranchId": None,
            "propertyName": "Coral Bay HOA",
            "servicesProvided": "Landscape Maintenance, Irrigation",
            "contactName": "Michelle Cady",
            "contactTitle": "Property Manager",
            "phone": "(561) 555-0100",
            "email": "mcady@coralbay.com",
            "address": "100 Coral Bay Dr, Jupiter, FL 33458",
            "clientSinceYear": 2021,
            "active": True,
        }

    def test_branch_filter_includes_company_wide_rows(self, authed):
        """Amendment A.6: aspire_branch_id filter must include null-branch rows."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/client-references?aspire_branch_id=3696")
        sql, params = mock_q.call_args.args[0], mock_q.call_args.args[1]
        assert "aspire_branch_id IS NULL" in sql
        assert 3696 in params

    def test_no_filter_returns_all_active(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/client-references")
        sql = mock_q.call_args.args[0]
        assert "active = 1" in sql
        assert "aspire_branch_id = %s" not in sql

    def test_mixed_branch_and_company_wide_rows_returned_together(self, authed):
        """When querying by branch, both the branch row and the company-wide
        row (aspireBranchId=null) must be present in the response."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [
                _client_reference_row(id="cr-001", aspire_branch_id=None),
                _client_reference_row(id="cr-002", aspire_branch_id=3696,
                                      property_name="Pointe Jupiter Yacht Club"),
            ]
            res = client.get("/api/proposals/config/client-references?aspire_branch_id=3696")
        body = res.json()
        assert len(body) == 2
        branch_ids = {b["aspireBranchId"] for b in body}
        assert None in branch_ids
        assert 3696 in branch_ids


# ── GET /api/proposals/config/portfolio ──────────────────────────────────────

class TestPortfolio:
    def test_returns_portfolio_shape(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_portfolio_row()]
            res = client.get("/api/proposals/config/portfolio")
        assert res.status_code == 200
        body = res.json()
        assert body[0] == {
            "id": "pp-001",
            "name": "Pointe Jupiter Yacht Club",
            "cityState": "Jupiter, FL",
            "regionId": "east-coast",
            "photoObjectKeys": [],
            "beforeAfterObjectKeys": None,
            "sortOrder": 0,
        }

    def test_region_id_filter(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/portfolio?region_id=east-coast")
        sql, params = mock_q.call_args.args[0], mock_q.call_args.args[1]
        assert "region_id = %s" in sql
        assert "east-coast" in params

    def test_no_filter_returns_all(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/portfolio")
        sql = mock_q.call_args.args[0]
        assert "region_id = %s" not in sql

    def test_json_string_photo_keys_parsed(self, authed):
        """photo_object_keys may come back as a JSON string from MySQL TEXT column."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_portfolio_row(
                photo_object_keys='["proposal/portfolio/img1.jpg"]'
            )]
            res = client.get("/api/proposals/config/portfolio")
        body = res.json()
        assert body[0]["photoObjectKeys"] == ["proposal/portfolio/img1.jpg"]

    def test_pre_parsed_photo_keys_list(self, authed):
        """Some drivers may return TEXT JSON already parsed as a list."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_portfolio_row(
                photo_object_keys=["proposal/portfolio/img1.jpg"]
            )]
            res = client.get("/api/proposals/config/portfolio")
        assert res.json()[0]["photoObjectKeys"] == ["proposal/portfolio/img1.jpg"]

    def test_before_after_object_keys_parsed(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_portfolio_row(
                before_after_object_keys='{"before": "ba/before.jpg", "after": "ba/after.jpg"}'
            )]
            res = client.get("/api/proposals/config/portfolio")
        ba = res.json()[0]["beforeAfterObjectKeys"]
        assert ba == {"before": "ba/before.jpg", "after": "ba/after.jpg"}


# ── GET /api/proposals/config/insurance ─────────────────────────────────────

class TestInsurance:
    def test_returns_current_cert(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_insurance_row()]
            res = client.get("/api/proposals/config/insurance")
        assert res.status_code == 200
        body = res.json()
        assert body["id"] == "ins-cert-001"
        assert body["objectKey"] == "proposal/insurance/juniper-certificate-of-liability-2026.pdf"
        assert body["expiryDate"] == "2027-03-31"
        assert body["label"] == "General Liability"

    def test_returns_null_when_no_cert_seeded(self, authed):
        """Frontend must handle null gracefully (shows placeholder on Insurance page)."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            res = client.get("/api/proposals/config/insurance")
        assert res.status_code == 200
        assert res.json() is None

    def test_orders_by_uploaded_at_desc(self, authed):
        """Most recently uploaded cert is the current one."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/insurance")
        sql = mock_q.call_args.args[0]
        assert "ORDER BY uploaded_at DESC LIMIT 1" in sql


# ── Read-only guard: no write methods on config paths ────────────────────────

class TestReadOnly:
    @pytest.mark.parametrize("path", [
        "/api/proposals/config/branches",
        "/api/proposals/config/team-members",
        "/api/proposals/config/client-references",
        "/api/proposals/config/portfolio",
        "/api/proposals/config/insurance",
    ])
    def test_no_write_methods_on_config_paths(self, path):
        for route in app.routes:
            if getattr(route, "path", "") == path:
                methods = getattr(route, "methods", set()) or set()
                assert not (methods & {"POST", "PATCH", "PUT", "DELETE"}), (
                    f"Write method registered on read-only config path {path}"
                )
