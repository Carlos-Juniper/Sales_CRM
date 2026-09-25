"""Role-set membership. Behavioral gates stay in test_rbac.py."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import authz


def _user(role: str, **extra) -> dict:
    user = {"id": "u1", "role": role, "email": "u@juniper.example"}
    user.update(extra)
    return user


def test_assignable_roles_are_canonical_minus_retired():
    assert authz.ASSIGNABLE_ROLES == authz.CANONICAL_ROLES - authz.RETIRED_SALES_ROLES
    assert "sales" not in authz.ASSIGNABLE_ROLES
    assert "outside_sales" not in authz.ASSIGNABLE_ROLES
    assert authz.ensure_assignable_role("vp_sales") == "vp_sales"
    assert authz.ensure_assignable_role("maintenance_sales") == "maintenance_sales"
    with pytest.raises(HTTPException) as retired:
        authz.ensure_assignable_role("sales")
    assert retired.value.status_code == 400
    with pytest.raises(HTTPException) as alias:
        authz.ensure_assignable_role("outside_sales")
    assert alias.value.status_code == 400
    with pytest.raises(HTTPException) as unknown:
        authz.ensure_assignable_role("wizard")
    assert unknown.value.status_code == 422
    assert not hasattr(authz, "SALES_TEAM_ROLES")


def test_roster_rep_roles_match_the_sales_rep_picker():
    assert authz.ROSTER_REP_ROLES == frozenset(authz.SALES_REP_DB_ROLES)
    assert "vp_sales" in authz.ROSTER_REP_ROLES
    assert authz.is_roster_rep("vp_sales")
    assert authz.is_roster_rep("outside_sales")
    assert "vp_sales" in authz.ROSTER_REP_ROLE_DETAIL
    for role in sorted(authz.ROSTER_REP_ROLES):
        assert role in authz.ROSTER_REP_ROLE_DETAIL


def test_vp_sales_membership():
    assert authz.ADMIN_EQUIVALENT_ROLES == frozenset({"admin", "vp_sales"})
    role = "vp_sales"
    assert role in authz.CANONICAL_ROLES
    assert role in authz.ADMIN_EQUIVALENT_ROLES
    for set_name in (
        "ESTIMATOR_ROLES",
        "APPROVER_ROLES",
        "LINE_ITEM_EDIT_ROLES",
        "CROSS_BRANCH_ROLES",
        "REP_VIEWER_ROLES",
        "FULL_ACCESS_ROLES",
        "PUBLIC_LEADS_ROLES",
        "ANALYTICS_DASHBOARD_ROLES",
        "MARKETING_ROLES",
        "PORTFOLIO_EDITOR_ROLES",
        "SALES_REP_DB_ROLES",
        "ROSTER_REP_ROLES",
    ):
        assert role in getattr(authz, set_name), set_name
    assert role not in authz.ESTIMATING_ONLY_ROLES
    assert role not in authz.FIELD_SALES_ROLES
    assert role not in authz.MANAGEMENT_ROLES
    assert authz.is_estimator(role)
    assert authz.is_approver(role)
    assert authz.sees_all_branches(role)
    assert authz.is_marketing_manager(role)
    assert authz.is_portfolio_editor(role)
    assert authz.is_roster_rep(role)
    assert not authz.is_estimating_only(role)
    assert not authz.requires_aspire_sales_rep(role)
    assert not authz.is_sales_rep(role)
    assert authz.own_lead_filter(_user(role, id="rep-9")) == ("", [])
    assert authz.allowed_intake_types(role) == ["maintenance", "install"]


def test_regional_director_and_vice_president_are_unchanged():
    assert authz.normalize_role("regional_director") == "regional_director"
    assert authz.normalize_role("vice_president") == "vice_president"
    assert authz.normalize_role("vp_sales") == "vp_sales"
    for role in ("regional_director", "vice_president"):
        assert role not in authz.ADMIN_EQUIVALENT_ROLES
        assert role not in authz.SALES_REP_DB_ROLES
        assert role in authz.APPROVER_ROLES
        assert role in authz.REP_VIEWER_ROLES
        assert role in authz.MANAGEMENT_ROLES
    assert "regional_director" not in authz.CROSS_BRANCH_ROLES
    assert "vice_president" in authz.CROSS_BRANCH_ROLES
    assert "admin" in authz.ADMIN_EQUIVALENT_ROLES
    assert "sales" in authz.CANONICAL_ROLES
    assert "sales" in authz.FIELD_SALES_ROLES
    assert "sales" not in authz.ASSIGNABLE_ROLES
    assert authz.is_sales_rep("sales")
    assert authz.is_sales_rep("outside_sales")
    assert authz.requires_aspire_sales_rep("sales")
    assert authz.normalize_role("outside_sales") == "sales"
    for role in ("inside_sales", "maintenance_sales", "install_sales", "vp_sales"):
        assert role in authz.ASSIGNABLE_ROLES
