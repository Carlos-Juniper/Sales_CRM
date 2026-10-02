"""Handoff 54 §9 (D5): branch-scoped rep views.

visible_rep_ids intersects the rep list with the caller's user_branches:
CROSS_BRANCH_ROLES see every rep, other REP_VIEWER_ROLES the reps sharing at
least one branch, everyone else only themselves. Applied to
/api/sales-performance/* and /api/commissions/*.

The DB is an in-memory users + user_branches model; the fake answers the
visible-reps SQL by actually intersecting branches, so the assertions are on
behaviour, not on a canned row list.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-secret")

from api import authz  # noqa: E402
from api import commissions as commissions_mod  # noqa: E402
from api import sales_performance as sales_performance_mod  # noqa: E402

USERS = {
    "mgr-a": "manager",
    "mgr-b": "manager",
    "rd-1": "regional_director",
    "rep-1": "maintenance_sales",
    "rep-2": "install_sales",
    "rep-3": "inside_sales",
    "rep-4": "maintenance_sales",
    "rep-shared": "maintenance_sales",
    "est-1": "maintenance_estimating",
    "lonely-mgr": "manager",
    "admin-1": "admin",
}
# (user_id, aspire_branch_id)
USER_BRANCHES = [
    ("mgr-a", 3697), ("mgr-a", 3696),
    ("mgr-b", 3668),
    ("rd-1", 3697), ("rd-1", 3668),
    ("rep-1", 3697),
    ("rep-2", 3696),
    ("rep-3", 3668),
    ("rep-4", 3684),            # nobody's branch below
    ("rep-shared", 3696), ("rep-shared", 3668),
    ("est-1", 3697),            # not a sales role: never a visible rep
]


def _branches(uid: str) -> set[int]:
    return {b for u, b in USER_BRANCHES if u == uid}


async def fake_db(sql, params=None):
    params = list(params or [])
    if "FROM user_branches ub" in sql:
        me, roles = params[0], set(params[1:])
        mine = _branches(me)
        return [
            {"id": uid} for uid, role in USERS.items()
            if role in roles and _branches(uid) & mine
        ]
    if "FROM users" in sql and "SELECT id, name, email" in sql:
        n_roles = len(authz.SALES_REP_DB_ROLES)
        roles, ids = set(params[:n_roles]), params[n_roles:]
        return [
            {"id": uid, "name": uid, "email": f"{uid}@example.com"}
            for uid, role in sorted(USERS.items())
            if role in roles and (not ids or uid in ids)
        ]
    return []


def _user(role: str, uid: str) -> dict:
    return {"id": uid, "role": role, "email": f"{uid}@example.com"}


async def _visible(role: str, uid: str):
    return await authz.visible_rep_ids(_user(role, uid), AsyncMock(side_effect=fake_db))


# ── visible_rep_ids ──────────────────────────────────────────────────────────

async def test_manager_with_two_branches_sees_exactly_those_reps():
    assert await _visible("manager", "mgr-a") == {"mgr-a", "rep-1", "rep-2", "rep-shared"}


async def test_a_rep_in_two_managers_branches_appears_for_both():
    a = await _visible("manager", "mgr-a")
    b = await _visible("manager", "mgr-b")
    assert "rep-shared" in a and "rep-shared" in b
    assert b == {"mgr-b", "rep-3", "rep-shared"}


async def test_regional_director_is_branch_scoped_not_company_wide():
    assert await _visible("regional_director", "rd-1") == {
        "rd-1", "rep-1", "rep-3", "rep-shared",
    }


@pytest.mark.parametrize("role", sorted(authz.REP_VIEWER_ROLES - authz.CROSS_BRANCH_ROLES))
async def test_every_branch_scoped_viewer_role_is_intersected(role):
    # Includes sales_manager and the estimating managers once Handoff 54 §5
    # adds them to REP_VIEWER_ROLES.
    assert await _visible(role, "mgr-a") == {"mgr-a", "rep-1", "rep-2", "rep-shared"}


@pytest.mark.skipif(
    "sales_manager" not in authz.CANONICAL_ROLES, reason="Handoff 54 §5 adds sales_manager"
)
async def test_sales_manager_with_two_branches_sees_exactly_those_reps():
    assert await _visible("sales_manager", "mgr-a") == {
        "mgr-a", "rep-1", "rep-2", "rep-shared",
    }


async def test_viewer_with_no_branches_sees_only_themselves():
    assert await _visible("manager", "lonely-mgr") == {"lonely-mgr"}


@pytest.mark.parametrize("role", sorted(authz.CROSS_BRANCH_ROLES))
async def test_cross_branch_roles_see_everyone_without_a_query(role):
    q = AsyncMock(side_effect=fake_db)
    assert await authz.visible_rep_ids(_user(role, "x"), q) is None
    q.assert_not_awaited()


@pytest.mark.parametrize("role", [
    "maintenance_sales", "install_sales", "inside_sales", "sales", "outside_sales",
    "maintenance_estimating", "install_estimating", "procurement", "marketing",
])
async def test_non_viewers_see_only_themselves_without_a_query(role):
    q = AsyncMock(side_effect=fake_db)
    assert await authz.visible_rep_ids(_user(role, "rep-1"), q) == {"rep-1"}
    q.assert_not_awaited()


async def test_visible_reps_sql_uses_the_post_067_rep_roles():
    q = AsyncMock(side_effect=fake_db)
    await authz.visible_rep_ids(_user("manager", "mgr-a"), q)
    sql, params = q.await_args.args
    assert params[0] == "mgr-a"
    assert tuple(params[1:]) == authz.SALES_REP_DB_ROLES
    for role in ("maintenance_sales", "install_sales", "inside_sales", "vp_sales"):
        assert role in authz.SALES_REP_DB_ROLES


def test_rep_id_clause():
    assert authz.rep_id_clause("c.user_id", None) == ("", [])
    assert authz.rep_id_clause("c.user_id", frozenset()) == ("AND 1 = 0", [])
    assert authz.rep_id_clause("c.user_id", {"b", "a"}) == ("AND c.user_id IN (%s, %s)", ["a", "b"])


def test_endpoints_hardcode_no_role_lists():
    """Role lists come from authz (post-067 SALES_REP_DB_ROLES), never literals."""
    root = Path(__file__).resolve().parents[1] / "api"
    for name in ("sales_performance.py", "commissions.py"):
        src = (root / name).read_text()
        assert not re.search(r"""['"](outside_sales|maintenance_sales|install_sales)['"]""", src), name
        assert "_can_view_all" not in src, name


# ── endpoints ────────────────────────────────────────────────────────────────

def _require_auth():
    raise RuntimeError("auth override missing")


app = FastAPI()
sales_performance_mod.register(app, _require_auth)
commissions_mod.register(app, _require_auth)
client = TestClient(app)


@pytest.fixture
def as_user():
    def _set(role: str, uid: str):
        app.dependency_overrides[_require_auth] = lambda: _user(role, uid)

    yield _set
    app.dependency_overrides.clear()


@pytest.fixture
def db():
    sp = AsyncMock(side_effect=fake_db)
    cm = AsyncMock(side_effect=fake_db)
    with patch("api.sales_performance.query", new=sp), patch("api.commissions.query", new=cm):
        yield sp, cm


def test_sales_performance_reps_lists_only_branch_reps(as_user, db):
    as_user("manager", "mgr-a")
    resp = client.get("/api/sales-performance/reps")
    assert resp.status_code == 200
    assert {r["id"] for r in resp.json()} == {"rep-1", "rep-2", "rep-shared"}


def test_sales_performance_reps_lists_everyone_for_admin(as_user, db):
    as_user("admin", "admin-1")
    resp = client.get("/api/sales-performance/reps")
    assert {r["id"] for r in resp.json()} == {
        uid for uid, role in USERS.items() if role in authz.SALES_REP_DB_ROLES
    }


def test_plain_rep_cannot_list_reps(as_user, db):
    as_user("maintenance_sales", "rep-1")
    assert client.get("/api/sales-performance/reps").status_code == 403
    assert client.get("/api/commissions/reps").status_code == 403


def test_summary_rejects_a_rep_outside_the_managers_branches(as_user, db):
    as_user("manager", "mgr-a")
    resp = client.get("/api/sales-performance/summary?user_id=rep-3")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "That rep is outside your branches"


def test_summary_without_user_id_aggregates_only_visible_reps(as_user, db):
    sp, _ = db
    as_user("manager", "mgr-a")
    assert client.get("/api/sales-performance/summary").status_code == 200
    won_sql, won_params = next(
        c.args for c in sp.await_args_list if "won_count" in c.args[0]
    )
    assert "AND user_id IN (%s, %s, %s, %s)" in won_sql
    assert set(won_params[2:]) == {"mgr-a", "rep-1", "rep-2", "rep-shared"}


def test_won_and_lost_deals_honor_scope(as_user, db):
    sp, _ = db
    as_user("manager", "mgr-b")
    assert client.get("/api/sales-performance/won-deals?user_id=rep-1").status_code == 403
    assert client.get("/api/sales-performance/lost-deals?user_id=rep-1").status_code == 403
    assert client.get("/api/sales-performance/lost-deals?user_id=rep-shared").status_code == 200
    sql, params = sp.await_args_list[-1].args
    assert "AND e.crm_rep IN (%s)" in sql and params[-1] == "rep-shared"


def test_admin_still_sees_everyone_on_summary(as_user, db):
    sp, _ = db
    as_user("admin", "admin-1")
    assert client.get("/api/sales-performance/summary?user_id=rep-4").status_code == 200
    assert client.get("/api/sales-performance/summary").status_code == 200
    won_sql, _ = next(c.args for c in reversed(sp.await_args_list) if "won_count" in c.args[0])
    assert "user_id IN" not in won_sql


def test_plain_rep_still_sees_only_themselves(as_user, db):
    sp, _ = db
    as_user("maintenance_sales", "rep-1")
    assert client.get("/api/sales-performance/summary?user_id=rep-2").status_code == 403
    assert client.get("/api/sales-performance/summary").status_code == 200
    won_sql, won_params = next(
        c.args for c in reversed(sp.await_args_list) if "won_count" in c.args[0]
    )
    assert won_params[-1] == "rep-1" and "AND user_id IN (%s)" in won_sql
    assert client.get("/api/commissions/list?user_id=rep-2").status_code == 403


def test_commission_reads_are_branch_scoped(as_user, db):
    as_user("manager", "mgr-a")
    assert client.get("/api/commissions/summary?user_id=rep-2").status_code == 200
    assert client.get("/api/commissions/list?user_id=rep-3").status_code == 403
    assert client.get("/api/commissions/payout-schedule?user_id=rep-4").status_code == 403


def test_commission_reps_query_is_limited_to_visible_reps(as_user, db):
    _, cm = db
    as_user("manager", "mgr-a")
    assert client.get("/api/commissions/reps").status_code == 200
    sql, params = cm.await_args_list[-1].args
    assert "AND u2.id IN (%s, %s, %s, %s)" in sql
    assert set(params[len(authz.SALES_REP_DB_ROLES):]) == {"mgr-a", "rep-1", "rep-2", "rep-shared"}
