"""Role matrix captured from origin/staging (ba32e1c) BEFORE Handoff 54 §5.

Handoff 54 §5 acceptance: "The pre-existing role matrix is captured as a test
before any change, and still passes after." Every role that existed before
§5 (the 14 canonical roles plus the stored legacy alias outside_sales) is
pinned here: its membership in every authz role set, every role predicate,
and every request guard that takes only the user. Adding a role must not move
any of these cells. A deliberate change to an existing role's access updates
this table in the same PR, with the reason in the commit message.

Generated from api/authz.py on staging; do not regenerate it to make a
failing test pass.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import authz

ROLE_SETS = ['ADMIN_EQUIVALENT_ROLES', 'ANALYTICS_DASHBOARD_ROLES', 'APPROVER_ROLES', 'ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'CROSS_BRANCH_ROLES', 'ESTIMATING_ONLY_ROLES', 'ESTIMATOR_ROLES', 'FIELD_SALES_ROLES', 'FULL_ACCESS_ROLES', 'LINE_ITEM_EDIT_ROLES', 'MANAGEMENT_ROLES', 'MARKETING_ROLES', 'PORTFOLIO_EDITOR_ROLES', 'PUBLIC_LEADS_ROLES', 'REP_VIEWER_ROLES', 'RETIRED_SALES_ROLES', 'ROSTER_REP_ROLES', 'SALES_REP_DB_ROLES']

PRE_H54_MATRIX = {
    'admin': {'sets': ['ADMIN_EQUIVALENT_ROLES', 'ANALYTICS_DASHBOARD_ROLES', 'APPROVER_ROLES', 'ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'CROSS_BRANCH_ROLES', 'ESTIMATOR_ROLES', 'FULL_ACCESS_ROLES', 'LINE_ITEM_EDIT_ROLES', 'MARKETING_ROLES', 'PORTFOLIO_EDITOR_ROLES', 'PUBLIC_LEADS_ROLES', 'REP_VIEWER_ROLES'], 'is_estimator': True, 'is_approver': True, 'sees_all_branches': True, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': True, 'is_portfolio_editor': True, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': False, 'require_estimator': True, 'require_estimate_viewer': True, 'leads': True, 'public_leads': True, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': True},
    'ceo': {'sets': ['ANALYTICS_DASHBOARD_ROLES', 'APPROVER_ROLES', 'ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'CROSS_BRANCH_ROLES', 'FULL_ACCESS_ROLES', 'LINE_ITEM_EDIT_ROLES', 'MANAGEMENT_ROLES', 'PUBLIC_LEADS_ROLES', 'REP_VIEWER_ROLES'], 'is_estimator': False, 'is_approver': True, 'sees_all_branches': True, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': False, 'is_portfolio_editor': False, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': False, 'require_estimator': True, 'require_estimate_viewer': True, 'leads': True, 'public_leads': True, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': True},
    'inside_sales': {'sets': ['ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'PORTFOLIO_EDITOR_ROLES', 'PUBLIC_LEADS_ROLES', 'ROSTER_REP_ROLES', 'SALES_REP_DB_ROLES'], 'is_estimator': False, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': True, 'is_marketing_manager': False, 'is_portfolio_editor': True, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': False, 'require_estimator': False, 'require_estimate_viewer': False, 'leads': True, 'public_leads': True, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': False},
    'install_estimating': {'sets': ['ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'ESTIMATING_ONLY_ROLES', 'ESTIMATOR_ROLES', 'LINE_ITEM_EDIT_ROLES'], 'is_estimator': True, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': True, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': False, 'is_portfolio_editor': False, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': True, 'require_estimator': True, 'require_estimate_viewer': True, 'leads': False, 'public_leads': False, 'proposals': False, 'sales_performance': False, 'analytics_dashboard': False},
    'install_sales': {'sets': ['ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'FIELD_SALES_ROLES', 'PORTFOLIO_EDITOR_ROLES', 'ROSTER_REP_ROLES', 'SALES_REP_DB_ROLES'], 'is_estimator': False, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': True, 'is_roster_rep': True, 'is_marketing_manager': False, 'is_portfolio_editor': True, 'requires_aspire_sales_rep': True, 'intake_types': ['install'], 'own_lead_scoped': True, 'hides_public_lead_queue': True, 'require_estimator': False, 'require_estimate_viewer': False, 'leads': True, 'public_leads': False, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': False},
    'maintenance_estimating': {'sets': ['ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'ESTIMATING_ONLY_ROLES', 'ESTIMATOR_ROLES', 'LINE_ITEM_EDIT_ROLES'], 'is_estimator': True, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': True, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': False, 'is_portfolio_editor': False, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': True, 'require_estimator': True, 'require_estimate_viewer': True, 'leads': False, 'public_leads': False, 'proposals': False, 'sales_performance': False, 'analytics_dashboard': False},
    'maintenance_sales': {'sets': ['ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'FIELD_SALES_ROLES', 'PORTFOLIO_EDITOR_ROLES', 'ROSTER_REP_ROLES', 'SALES_REP_DB_ROLES'], 'is_estimator': False, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': True, 'is_roster_rep': True, 'is_marketing_manager': False, 'is_portfolio_editor': True, 'requires_aspire_sales_rep': True, 'intake_types': ['maintenance'], 'own_lead_scoped': True, 'hides_public_lead_queue': True, 'require_estimator': False, 'require_estimate_viewer': False, 'leads': True, 'public_leads': False, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': False},
    'manager': {'sets': ['ANALYTICS_DASHBOARD_ROLES', 'APPROVER_ROLES', 'ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'FULL_ACCESS_ROLES', 'LINE_ITEM_EDIT_ROLES', 'MANAGEMENT_ROLES', 'PUBLIC_LEADS_ROLES', 'REP_VIEWER_ROLES'], 'is_estimator': False, 'is_approver': True, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': False, 'is_portfolio_editor': False, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': False, 'require_estimator': True, 'require_estimate_viewer': True, 'leads': True, 'public_leads': True, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': True},
    'marketing': {'sets': ['ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'MARKETING_ROLES', 'PORTFOLIO_EDITOR_ROLES'], 'is_estimator': False, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': True, 'is_portfolio_editor': True, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': True, 'require_estimator': False, 'require_estimate_viewer': False, 'leads': True, 'public_leads': False, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': False},
    'outside_sales': {'sets': ['RETIRED_SALES_ROLES', 'SALES_REP_DB_ROLES'], 'is_estimator': False, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': True, 'is_roster_rep': True, 'is_marketing_manager': False, 'is_portfolio_editor': True, 'requires_aspire_sales_rep': True, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': True, 'hides_public_lead_queue': True, 'require_estimator': False, 'require_estimate_viewer': False, 'leads': True, 'public_leads': False, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': False},
    'procurement': {'sets': ['ASSIGNABLE_ROLES', 'CANONICAL_ROLES'], 'is_estimator': False, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': False, 'is_portfolio_editor': False, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': True, 'require_estimator': False, 'require_estimate_viewer': False, 'leads': True, 'public_leads': False, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': False},
    'regional_director': {'sets': ['ANALYTICS_DASHBOARD_ROLES', 'APPROVER_ROLES', 'ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'FULL_ACCESS_ROLES', 'LINE_ITEM_EDIT_ROLES', 'MANAGEMENT_ROLES', 'PUBLIC_LEADS_ROLES', 'REP_VIEWER_ROLES'], 'is_estimator': False, 'is_approver': True, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': False, 'is_portfolio_editor': False, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': False, 'require_estimator': True, 'require_estimate_viewer': True, 'leads': True, 'public_leads': True, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': True},
    'sales': {'sets': ['CANONICAL_ROLES', 'FIELD_SALES_ROLES', 'PORTFOLIO_EDITOR_ROLES', 'RETIRED_SALES_ROLES', 'ROSTER_REP_ROLES', 'SALES_REP_DB_ROLES'], 'is_estimator': False, 'is_approver': False, 'sees_all_branches': False, 'is_estimating_only': False, 'is_sales_rep': True, 'is_roster_rep': True, 'is_marketing_manager': False, 'is_portfolio_editor': True, 'requires_aspire_sales_rep': True, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': True, 'hides_public_lead_queue': True, 'require_estimator': False, 'require_estimate_viewer': False, 'leads': True, 'public_leads': False, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': False},
    'vice_president': {'sets': ['ANALYTICS_DASHBOARD_ROLES', 'APPROVER_ROLES', 'ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'CROSS_BRANCH_ROLES', 'FULL_ACCESS_ROLES', 'LINE_ITEM_EDIT_ROLES', 'MANAGEMENT_ROLES', 'PUBLIC_LEADS_ROLES', 'REP_VIEWER_ROLES'], 'is_estimator': False, 'is_approver': True, 'sees_all_branches': True, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': False, 'is_marketing_manager': False, 'is_portfolio_editor': False, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': False, 'require_estimator': True, 'require_estimate_viewer': True, 'leads': True, 'public_leads': True, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': True},
    'vp_sales': {'sets': ['ADMIN_EQUIVALENT_ROLES', 'ANALYTICS_DASHBOARD_ROLES', 'APPROVER_ROLES', 'ASSIGNABLE_ROLES', 'CANONICAL_ROLES', 'CROSS_BRANCH_ROLES', 'ESTIMATOR_ROLES', 'FULL_ACCESS_ROLES', 'LINE_ITEM_EDIT_ROLES', 'MARKETING_ROLES', 'PORTFOLIO_EDITOR_ROLES', 'PUBLIC_LEADS_ROLES', 'REP_VIEWER_ROLES', 'ROSTER_REP_ROLES', 'SALES_REP_DB_ROLES'], 'is_estimator': True, 'is_approver': True, 'sees_all_branches': True, 'is_estimating_only': False, 'is_sales_rep': False, 'is_roster_rep': True, 'is_marketing_manager': True, 'is_portfolio_editor': True, 'requires_aspire_sales_rep': False, 'intake_types': ['maintenance', 'install'], 'own_lead_scoped': False, 'hides_public_lead_queue': False, 'require_estimator': True, 'require_estimate_viewer': True, 'leads': True, 'public_leads': True, 'proposals': True, 'sales_performance': True, 'analytics_dashboard': True},
}


def _passes(fn, *args) -> bool:
    try:
        fn(*args)
        return True
    except HTTPException:
        return False


def _observed(role: str) -> dict:
    user = {"id": "u1", "role": role}
    return dict(
        sets=sorted(n for n in ROLE_SETS if role in getattr(authz, n)),
        is_estimator=authz.is_estimator(role),
        is_approver=authz.is_approver(role),
        sees_all_branches=authz.sees_all_branches(role),
        is_estimating_only=authz.is_estimating_only(role),
        is_sales_rep=authz.is_sales_rep(role),
        is_roster_rep=authz.is_roster_rep(role),
        is_marketing_manager=authz.is_marketing_manager(role),
        is_portfolio_editor=authz.is_portfolio_editor(role),
        requires_aspire_sales_rep=authz.requires_aspire_sales_rep(role),
        intake_types=authz.allowed_intake_types(role),
        own_lead_scoped=bool(authz.own_lead_filter(user)[0]),
        hides_public_lead_queue=authz.hides_public_lead_queue(user),
        require_estimator=_passes(authz.require_estimator, user),
        require_estimate_viewer=_passes(authz.require_estimate_viewer, user),
        leads=_passes(authz.require_lead_access, user),
        public_leads=_passes(authz.require_public_leads_access, user),
        proposals=_passes(authz.require_proposals_access, user),
        sales_performance=_passes(authz.require_sales_performance_access, user),
        analytics_dashboard=_passes(authz.require_analytics_dashboard, user),
    )


@pytest.mark.parametrize("role", sorted(PRE_H54_MATRIX))
def test_pre_existing_role_matrix_is_unchanged(role):
    assert _observed(role) == PRE_H54_MATRIX[role]


def test_every_pre_existing_role_is_still_known():
    assert set(PRE_H54_MATRIX) - {"outside_sales"} <= authz.CANONICAL_ROLES
