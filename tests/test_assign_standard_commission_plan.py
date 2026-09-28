"""The standard-plan assignment is a script, not a migration."""
from __future__ import annotations

from api.authz import SALES_REP_DB_ROLES
from scripts.assign_standard_commission_plan import assignment_roles


def test_roles_follow_authz_and_include_vp_sales():
    roles = assignment_roles()
    assert list(roles[: len(SALES_REP_DB_ROLES)]) == list(SALES_REP_DB_ROLES)
    assert "vp_sales" in roles
    assert roles.count("vp_sales") == 1
    assert "michelle" not in " ".join(roles)
    assert "cady" not in " ".join(roles)
