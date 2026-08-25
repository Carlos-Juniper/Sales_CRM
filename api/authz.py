"""Canonical role model + server-side authorization.

One role vocabulary for the whole app (nine business roles), the
estimator/approver ownership split enforced server-side, the approval-tier
authority ladder, and branch scoping derived from the authenticated user —
never from a client-supplied query param (BRD I-9.5).

Layered on `require_auth`: handlers call `require_estimator(user)` /
`require_approver(user)` / `require_approval_authority(user, value)` with the
decoded JWT payload, and `resolve_branch_scope(user)` to build row-level scope.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException

from db import query

# ── Canonical role set (§2, LOCKED) ───────────────────────────────

CANONICAL_ROLES = frozenset({
    "procurement",
    "sales",
    "admin",
    "manager",
    "regional_director",
    "maintenance_estimating",
    "install_estimating",
    "vice_president",
    "ceo",
})

# Legacy auth roles collapse into `sales` (inside/outside distinction retired).
LEGACY_ROLE_MAP = {
    "inside_sales": "sales",
    "outside_sales": "sales",
}

# Estimator-owned scope: line items / sections / services / components / takeoff.
ESTIMATOR_ROLES = frozenset({"maintenance_estimating", "install_estimating", "admin"})

# Approver-owned scope: complexity/margin adjustments + approve/hand-back.
APPROVER_ROLES = frozenset({"manager", "regional_director", "vice_president", "ceo", "admin"})

# Widened edit scope: managers and above may also mutate line items,
# not just approve them. Approver edit rights and approval-tier ceilings are
# independently gated — editing and approving are separate checks.
LINE_ITEM_EDIT_ROLES = ESTIMATOR_ROLES | APPROVER_ROLES

# Roles that see every branch. Default per §5.3: admin/VP/CEO see
# all; everyone else (incl. regional_director, procurement) is scoped to their
# own branch until Carlos confirms the cross-branch matrix (§7 open item).
CROSS_BRANCH_ROLES = frozenset({"admin", "vice_president", "ceo"})

# Approval-authority ceilings in integer cents (mirrors the approval-tier
# ladder: manager <$100k · RD ≤$250k · VP ≤$1M · CEO/admin unlimited). A role
# may approve any estimate at or under its ceiling; over-ceiling requests 403
# (the auto-route to the higher tier is added separately). None = unlimited.
APPROVAL_CEILING_CENTS: dict[str, Optional[int]] = {
    "manager": 10_000_000,
    "regional_director": 25_000_000,
    "vice_president": 100_000_000,
    "ceo": None,
    "admin": None,
}


def normalize_role(role: Optional[str]) -> str:
    """Map a stored/JWT role onto the canonical vocabulary (legacy → sales)."""
    role = (role or "").strip()
    return LEGACY_ROLE_MAP.get(role, role)


def is_estimator(role: Optional[str]) -> bool:
    return normalize_role(role) in ESTIMATOR_ROLES


def is_approver(role: Optional[str]) -> bool:
    return normalize_role(role) in APPROVER_ROLES


def sees_all_branches(role: Optional[str]) -> bool:
    return normalize_role(role) in CROSS_BRANCH_ROLES


def approval_ceiling_cents(role: Optional[str]) -> Optional[int]:
    """Max estimate value (cents) the role may approve; None = unlimited.

    Raises 403 semantics via require_approval_authority — non-approver roles
    have no ceiling entry and should never reach the value check.
    """
    return APPROVAL_CEILING_CENTS.get(normalize_role(role))


# ── Request guards (layered on require_auth) ─────────────────────────────────

def require_estimator(user: dict) -> None:
    """403 unless the JWT role may edit line items/sections/takeoff.

    Allows estimators AND approver-tier roles (manager, RD, VP, CEO, admin).
    Approval-tier ceilings are separately enforced by require_approval_authority.
    """
    if normalize_role(user.get("role")) not in LINE_ITEM_EDIT_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Estimator or manager-tier role required: line items, sections, and takeoff.",
        )


def require_approver(user: dict) -> None:
    """403 unless the JWT role owns approver scope (adjustments/approve)."""
    if not is_approver(user.get("role")):
        raise HTTPException(
            status_code=403,
            detail="Approver role required: adjustments and approvals are approver-owned.",
        )


def require_approval_authority(user: dict, value_cents: int) -> None:
    """403 unless the approver's tier ceiling covers the estimate value."""
    require_approver(user)
    ceiling = approval_ceiling_cents(user.get("role"))
    if ceiling is not None and value_cents > ceiling:
        raise HTTPException(
            status_code=403,
            detail=(
                "Estimate value exceeds your approval tier ceiling — "
                "route to the next approval tier."
            ),
        )


# ── Branch scoping (derived from the JWT, never the client) ─────────────────

@dataclass(frozen=True)
class BranchScope:
    """Row-level scope for estimate reads.

    kind = 'all'    → no branch restriction (cross-branch role)
           'branch' → restrict to `branch` (resolved name, matches estimates.branch)
           'none'   → user has no branch assignment; sees no rows
    """
    kind: str
    branch: Optional[str] = None


async def resolve_branch_name(branch_id: Optional[str]) -> Optional[str]:
    """Resolve a user's branch_id to the territory name stored on estimates.

    users.branch_id holds a sales_territories.id ("Orlando, FL"), which is also
    the value estimates.branch carries. Looks it up in the `sales_territories`
    table (sql/migrations/004); falls back to the raw value when branch_id
    already holds the territory name (or no row matches).
    """
    if not branch_id:
        return None
    rows = await query("SELECT name FROM sales_territories WHERE id = %s", [branch_id])
    if rows and rows[0].get("name"):
        return rows[0]["name"]
    return branch_id


async def resolve_branch_scope(user: dict) -> BranchScope:
    """Derive the estimate-read scope from the authenticated user (BRD I-9.5)."""
    if sees_all_branches(user.get("role")):
        return BranchScope(kind="all")
    branch = await resolve_branch_name(user.get("branch_id"))
    if branch is None:
        return BranchScope(kind="none")
    return BranchScope(kind="branch", branch=branch)
