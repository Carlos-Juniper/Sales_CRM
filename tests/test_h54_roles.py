"""Handoff 54 §5: estimating managers and sales manager.

The pre-existing roles are pinned by tests/test_role_matrix.py; this file pins
the three new roles. No migration: users.role is VARCHAR(50) and adding a role
is a code deploy (004_users_and_branches.sql).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import authz

NEW_ROLES = ("maintenance_estimating_manager", "install_estimating_manager", "sales_manager")
ESTIMATING_MANAGERS = ("maintenance_estimating_manager", "install_estimating_manager")


def _user(role: str) -> dict:
    return {"id": "u1", "role": role}


def _passes(fn, *args) -> bool:
    try:
        fn(*args)
        return True
    except HTTPException:
        return False


@pytest.mark.parametrize("role", NEW_ROLES)
def test_new_roles_are_canonical_and_assignable(role):
    assert role in authz.CANONICAL_ROLES
    assert role in authz.ASSIGNABLE_ROLES
    assert authz.ensure_assignable_role(role) == role
    assert authz.normalize_role(role) == role
    assert len(role) <= 50  # users.role VARCHAR(50)


def test_estimating_manager_roles_set():
    assert authz.ESTIMATING_MANAGER_ROLES == frozenset(ESTIMATING_MANAGERS)


@pytest.mark.parametrize("role", ESTIMATING_MANAGERS)
def test_estimating_managers_edit_lines_and_view_reps(role):
    assert authz.is_estimating_manager(role)
    for set_name in ("ESTIMATOR_ROLES", "LINE_ITEM_EDIT_ROLES", "REP_VIEWER_ROLES"):
        assert role in getattr(authz, set_name), set_name
    assert authz.is_estimator(role)
    assert _passes(authz.require_estimator, _user(role))
    assert _passes(authz.require_estimate_viewer, _user(role))


@pytest.mark.parametrize("role", NEW_ROLES)
def test_new_roles_stay_out_of_wider_sets(role):
    # Managers see their user_branches, nothing wider; none approves.
    for set_name in (
        "CROSS_BRANCH_ROLES", "APPROVER_ROLES", "ADMIN_EQUIVALENT_ROLES",
        "MANAGEMENT_ROLES", "FULL_ACCESS_ROLES", "FIELD_SALES_ROLES",
        "SALES_REP_DB_ROLES", "ROSTER_REP_ROLES", "MARKETING_ROLES",
        "ESTIMATING_ONLY_ROLES", "RETIRED_SALES_ROLES",
    ):
        assert role not in getattr(authz, set_name), set_name
    assert not authz.sees_all_branches(role)
    assert not authz.is_approver(role)
    assert not authz.is_sales_rep(role)
    assert authz.own_lead_filter(_user(role)) == ("", [])
    assert authz.allowed_intake_types(role) == ["maintenance", "install"]
    assert not authz.requires_aspire_sales_rep(role)


def test_sales_manager_views_reps_but_does_not_estimate():
    role = "sales_manager"
    assert role in authz.REP_VIEWER_ROLES
    assert not authz.is_estimator(role)
    assert not authz.is_estimating_manager(role)
    assert role not in authz.LINE_ITEM_EDIT_ROLES
    assert not _passes(authz.require_estimator, _user(role))
    assert not _passes(authz.require_estimate_viewer, _user(role))
    assert _passes(authz.require_sales_performance_access, _user(role))


@pytest.mark.parametrize("role", NEW_ROLES)
async def test_new_roles_resolve_branch_scope_from_user_branches(role, monkeypatch):
    async def fake_query(sql, params=None):
        assert "user_branches" in sql
        return [{"aspire_branch_id": 3697}, {"aspire_branch_id": 3696}]

    monkeypatch.setattr(authz, "query", fake_query)
    scope = await authz.resolve_branch_scope(_user(role))
    assert scope == authz.BranchScope(kind="branch", ids=[3697, 3696])


@pytest.mark.parametrize("role", NEW_ROLES)
async def test_new_roles_have_no_approval_ceiling_without_tier_rows(role, monkeypatch):
    async def fake_query(sql, params=None):
        return []

    monkeypatch.setattr(authz, "query", fake_query)
    assert await authz.approval_ceiling_cents(role) == 0
