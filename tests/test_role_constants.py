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


def test_roster_rep_roles_are_sales_rep_roles_minus_the_legacy_alias():
    assert authz.ROSTER_REP_ROLES == (
        frozenset(authz.SALES_REP_DB_ROLES) - frozenset(authz.LEGACY_ROLE_MAP)
    )
    assert "outside_sales" not in authz.ROSTER_REP_ROLES
    assert "sales" in authz.ROSTER_REP_ROLES
    assert "vp_sales" in authz.ROSTER_REP_ROLES
    assert authz.is_roster_rep("vp_sales")
    assert authz.is_roster_rep("sales")
    assert authz.is_roster_rep("outside_sales")
    for raw_key in (
        "outside_sales", "inside_sales", "maintenance_sales", "install_sales", "vp_sales",
    ):
        assert raw_key not in authz.ROSTER_REP_ROLE_DETAIL
    for label in (
        "Inside Sales",
        "Maintenance Sales",
        "Install Sales",
        "VP of Sales",
    ):
        assert label in authz.ROSTER_REP_ROLE_DETAIL


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
        assert role in authz.SALES_REP_DB_ROLES
    assert "outside_sales" in authz.SALES_REP_DB_ROLES
    assert "inside_sales" not in authz.FIELD_SALES_ROLES
    assert "inside_sales" in authz.ROSTER_REP_ROLES
    for role in ("sales", "outside_sales", "inside_sales", "maintenance_sales", "install_sales"):
        assert authz.is_roster_rep(role)


def test_canonical_roles():
    assert authz.CANONICAL_ROLES == frozenset({
        "procurement", "sales", "maintenance_sales", "install_sales",
        "inside_sales", "admin", "vp_sales", "manager",
        "regional_director", "maintenance_estimating", "install_estimating",
        "vice_president", "ceo", "marketing",
    })
    assert "marketing" not in authz.ESTIMATOR_ROLES
    assert "marketing" not in authz.APPROVER_ROLES


def test_estimator_and_approver_membership():
    for role in ("maintenance_estimating", "install_estimating", "admin", "vp_sales"):
        assert authz.is_estimator(role)
    for role in (
        "manager", "regional_director", "vice_president", "ceo",
        "sales", "maintenance_sales", "install_sales", "procurement", "marketing",
    ):
        assert not authz.is_estimator(role)
    for role in (
        "manager", "regional_director", "vice_president", "ceo", "admin", "vp_sales",
    ):
        assert authz.is_approver(role)
    for role in (
        "maintenance_estimating", "install_estimating",
        "sales", "maintenance_sales", "install_sales", "procurement", "marketing",
    ):
        assert not authz.is_approver(role)


def test_rep_viewer_roles():
    assert authz.REP_VIEWER_ROLES == frozenset({
        "admin", "vp_sales",
        "vice_president", "ceo", "manager", "regional_director",
    })
    for role in ("sales", "maintenance_sales", "install_sales"):
        assert role not in authz.REP_VIEWER_ROLES


def test_split_sales_roles_match_sales_on_privileged_sets():
    privileged = (
        "ESTIMATOR_ROLES",
        "APPROVER_ROLES",
        "LINE_ITEM_EDIT_ROLES",
        "CROSS_BRANCH_ROLES",
        "REP_VIEWER_ROLES",
        "MARKETING_ROLES",
    )
    for role in ("maintenance_sales", "install_sales"):
        assert role in authz.CANONICAL_ROLES
        assert role in authz.FIELD_SALES_ROLES
        for set_name in privileged:
            role_set = getattr(authz, set_name)
            assert (role in role_set) == ("sales" in role_set), set_name


def test_field_sales_are_outside_the_public_and_analytics_sets():
    for role in ("maintenance_sales", "install_sales", "sales"):
        assert role not in authz.ESTIMATING_ONLY_ROLES
        assert role not in authz.PUBLIC_LEADS_ROLES
        assert role not in authz.ANALYTICS_DASHBOARD_ROLES
        assert authz.hides_public_lead_queue({"role": role})
        assert not authz.is_estimating_only(role)
    assert "inside_sales" in authz.PUBLIC_LEADS_ROLES
    assert "inside_sales" not in authz.ANALYTICS_DASHBOARD_ROLES
    assert not authz.hides_public_lead_queue({"role": "inside_sales"})
