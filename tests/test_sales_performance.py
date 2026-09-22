"""Regression tests for /api/sales-performance lost-deal SQL.

estimates has no user_id column. The salesperson is estimates.crm_rep
(users.id). Queries that filter or join on e.user_id raise MySQL 1054
(Unknown column 'e.user_id') and 500 the Sales Performance page.

DB is fully mocked — these tests assert the SQL that would be sent.
The routes are mounted on a tiny app so the test does not import the
rest of the API.

Run with:  PYTHONPATH=. pytest tests/test_sales_performance.py -v
"""
from __future__ import annotations

import os
from datetime import datetime
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_PORT", "3306")
os.environ.setdefault("MYSQL_USER", "crm_user")
os.environ.setdefault("MYSQL_PASSWORD", "secret")
os.environ.setdefault("MYSQL_DB", "crm")
os.environ.setdefault("JWT_SECRET", "test-secret")

from api.sales_performance import register  # noqa: E402

_ADMIN = {
    "id": "admin-1",
    "name": "Alex Admin",
    "email": "alex.admin@juniperlandscaping.com",
    "role": "admin",
    "branch_id": "b1",
    "avatar_initials": "AA",
}

_SALES = {
    "id": "rep-1",
    "name": "Riley Rep",
    "email": "riley.rep@juniperlandscaping.com",
    "role": "sales",
    "branch_id": "b1",
    "avatar_initials": "RR",
}

_LOST_ROW = {
    "id": "est-1",
    "contract_value_cents": Decimal("250000"),
    "estimate_type": "maintenance",
    "notes": "Price",
    "aspire_number": "A-100",
    "aspire_lost_reason_id": 13,
    "property_name": "Silverleaf HOA",
    "rep_name": "Riley Rep",
    "rep_email": "riley.rep@juniperlandscaping.com",
    "lost_at": datetime(2026, 3, 15, 12, 0, 0),
}


def _require_auth():
    raise RuntimeError("auth override missing")


app = FastAPI()
register(app, _require_auth)
client = TestClient(app)


def _assert_no_estimate_user_id(sql: str) -> None:
    assert "e.user_id" not in sql, sql
    assert "e.crm_rep" in sql, sql


@pytest.fixture
def as_user():
    def _set(user: dict):
        app.dependency_overrides[_require_auth] = lambda: user

    yield _set
    app.dependency_overrides.clear()


def test_lost_deals_joins_users_on_crm_rep(as_user):
    """Unfiltered lost-deals (the staging 500) must not reference e.user_id."""
    as_user(_ADMIN)
    captured: list[tuple[str, list]] = []

    async def fake_query(sql, params=None):
        captured.append((sql, list(params or [])))
        return [_LOST_ROW]

    with patch("api.sales_performance.query", new=AsyncMock(side_effect=fake_query)):
        resp = client.get(
            "/api/sales-performance/lost-deals",
            params={"start_date": "2026-01-01", "end_date": "2026-09-22"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body[0]["id"] == "est-1"
    assert body[0]["property_name"] == "Silverleaf HOA"
    assert body[0]["contract_value_cents"] == 250000.0
    assert body[0]["lost_at"].startswith("2026-03-15")

    assert len(captured) == 1
    sql, params = captured[0]
    _assert_no_estimate_user_id(sql)
    assert "LEFT JOIN users u ON e.crm_rep = u.id" in sql
    assert params == ["2026-01-01", "2026-09-22"]


def test_lost_deals_scopes_a_rep_to_their_crm_rep(as_user):
    """A sales user is self-scoped via estimates.crm_rep, not e.user_id."""
    as_user(_SALES)
    captured: list[tuple[str, list]] = []

    async def fake_query(sql, params=None):
        captured.append((sql, list(params or [])))
        return []

    with patch("api.sales_performance.query", new=AsyncMock(side_effect=fake_query)):
        resp = client.get("/api/sales-performance/lost-deals")

    assert resp.status_code == 200
    assert resp.json() == []
    sql, params = captured[0]
    _assert_no_estimate_user_id(sql)
    assert "AND e.crm_rep = %s" in sql
    assert params[-1] == "rep-1"


def test_summary_lost_filter_uses_crm_rep(as_user):
    """The summary lost aggregate has the same column; a scoped request must not 500."""
    as_user(_SALES)
    captured: list[str] = []

    async def fake_query(sql, params=None):
        captured.append(sql)
        if "won_count" in sql:
            return [{"won_count": 1, "won_total_cents": 100}]
        if "lost_count" in sql:
            return [{"lost_count": 2, "lost_total_cents": 200}]
        return []

    with patch("api.sales_performance.query", new=AsyncMock(side_effect=fake_query)):
        resp = client.get(
            "/api/sales-performance/summary",
            params={"start_date": "2026-01-01", "end_date": "2026-09-22"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["won_count"] == 1
    assert body["lost_count"] == 2

    lost_sqls = [sql for sql in captured if "estimates e" in sql]
    assert lost_sqls, captured
    for sql in lost_sqls:
        _assert_no_estimate_user_id(sql)
