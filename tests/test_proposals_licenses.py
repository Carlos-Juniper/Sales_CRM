"""Licenses & certifications read API — GET /api/proposals/config/licenses.

DB is fully mocked (patch api.proposals.query) — no real MySQL required.
Mirrors the pattern in test_proposals_config.py.

The response is split into two arrays by `kind` because the proposal page renders
them as two labelled table sections. is_expired is computed in SQL against
CURDATE(), never in Python, so a skewed server or client clock cannot resurrect an
expired credential into a client-facing document.
"""
from __future__ import annotations

import os
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

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


def _lc_row(**over) -> dict:
    """A licenses_certifications row as the SELECT returns it (is_expired from SQL)."""
    row = {
        "id": "lc-001",
        "kind": "license",
        "name": "Certified Pest Control Operator",
        "issuing_body": "Florida Dept. of Agriculture",
        "identifier": "JB1234",
        "holder_name": "Jane Bell",
        "aspire_branch_id": None,
        "issued_date": date(2025, 1, 15),
        "expiry_date": date(2027, 1, 14),
        "object_key": "proposal/licenses/cpco-jb1234.pdf",
        "active": 1,
        "sort_order": 0,
        "is_expired": 0,
    }
    row.update(over)
    return row


class TestLicensesShape:
    def test_splits_by_kind(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [
                _lc_row(),
                _lc_row(id="lc-002", kind="certification", name="ISA Certified Arborist"),
            ]
            res = client.get("/api/proposals/config/licenses")
        assert res.status_code == 200
        body = res.json()
        assert [x["id"] for x in body["licenses"]] == ["lc-001"]
        assert [x["id"] for x in body["certifications"]] == ["lc-002"]

    def test_camel_case_fields_and_iso_dates(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_lc_row()]
            res = client.get("/api/proposals/config/licenses")
        item = res.json()["licenses"][0]
        assert item["issuingBody"] == "Florida Dept. of Agriculture"
        assert item["holderName"] == "Jane Bell"
        assert item["identifier"] == "JB1234"
        assert item["issuedDate"] == "2025-01-15"
        assert item["expiryDate"] == "2027-01-14"
        assert item["objectKey"] == "proposal/licenses/cpco-jb1234.pdf"
        assert item["isExpired"] is False
        assert item["active"] is True

    def test_empty_when_nothing_seeded(self, authed):
        """Every credential on file is currently expired — the page must survive this."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            res = client.get("/api/proposals/config/licenses")
        assert res.status_code == 200
        assert res.json() == {"licenses": [], "certifications": []}


class TestLicensesFiltering:
    def test_excludes_expired_by_default(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/licenses")
        sql = mock_q.call_args[0][0]
        assert "expiry_date IS NULL OR expiry_date >= CURDATE()" in sql

    def test_include_expired_drops_the_date_condition(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/licenses?include_expired=true")
        sql = mock_q.call_args[0][0]
        assert "CURDATE()" in sql              # still computed for is_expired
        assert ">= CURDATE()" not in sql       # but no longer filtered on

    def test_is_expired_computed_in_sql_not_python(self, authed):
        """A row flagged expired by the DB stays expired regardless of clock skew."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_lc_row(expiry_date=date(2020, 1, 1), is_expired=1)]
            res = client.get("/api/proposals/config/licenses?include_expired=true")
        assert res.json()["licenses"][0]["isExpired"] is True

    def test_null_expiry_is_never_expired(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = [_lc_row(expiry_date=None, is_expired=0)]
            res = client.get("/api/proposals/config/licenses")
        item = res.json()["licenses"][0]
        assert item["expiryDate"] is None
        assert item["isExpired"] is False

    def test_branch_scope_includes_company_wide(self, authed):
        """A.6: company-wide rows come back alongside branch matches, never instead."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/licenses?aspire_branch_id=1403")
        sql, params = mock_q.call_args[0][0], mock_q.call_args[0][1]
        assert "aspire_branch_id IS NULL OR aspire_branch_id = %s" in sql
        assert params == [1403]

    def test_omitting_branch_returns_company_wide_only(self, authed):
        """Without a branch, another state's license must not leak into the proposal."""
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/licenses")
        sql = mock_q.call_args[0][0]
        assert "aspire_branch_id IS NULL" in sql
        assert "aspire_branch_id = %s" not in sql

    def test_inactive_rows_excluded(self, authed):
        with patch("api.proposals.query", new_callable=AsyncMock) as mock_q:
            mock_q.return_value = []
            client.get("/api/proposals/config/licenses")
        assert "active = 1" in mock_q.call_args[0][0]


class TestLicensesAuth:
    def test_requires_auth(self):
        res = client.get("/api/proposals/config/licenses")
        assert res.status_code in (401, 403)
