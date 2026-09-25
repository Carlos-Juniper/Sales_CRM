"""Canonical role model + server-side authorization.

One role vocabulary for the whole app (ten business roles), the
estimator/approver ownership split enforced server-side, the approval-tier
authority ladder, and branch scoping derived from the authenticated user —
never from a client-supplied query param (BRD I-9.5).

Layered on `require_auth`: handlers call `require_estimator(user)` /
`require_approver(user)` / `require_approval_authority(user, value)` with the
decoded JWT payload, and `resolve_branch_scope(user)` to build row-level scope.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from fastapi import HTTPException

from db import query

# ── Canonical role set (§2, LOCKED) ───────────────────────────────

CANONICAL_ROLES = frozenset({
    "procurement",
    "sales",
    "inside_sales",
    "admin",
    "manager",
    "regional_director",
    "maintenance_estimating",
    "install_estimating",
    "vice_president",
    "ceo",
    # Handoff 50 §3: cross-branch owner of the company-wide proposal assets
    # (portfolio pages, client references, team bios/headshots, org chart).
    # Deliberately NOT an estimator or approver — see ESTIMATOR_ROLES /
    # APPROVER_ROLES below, which it is absent from.
    "marketing",
})

# `inside_sales` qualifies raw public/government leads and assigns them on to a
# `sales` CRM, so the two are distinct personas and only inside sales reaches the
# public lead feed. `outside_sales` remains retired and collapses into `sales`.
LEGACY_ROLE_MAP = {
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
# NOTE: `marketing` is intentionally absent — its cross-branch reach is limited
# to the marketing-asset tables (MARKETING_ROLES), NOT to estimate branch scope.
CROSS_BRANCH_ROLES = frozenset({"admin", "vice_president", "ceo"})

# Roles that may view sales performance / commission data for any rep.
# Broader than CROSS_BRANCH_ROLES — adds manager and regional_director so
# branch-level leaders can see their team's numbers without gaining full
# cross-branch write privileges (mark-paid, etc. remain CROSS_BRANCH_ROLES).
REP_VIEWER_ROLES = frozenset({"admin", "vice_president", "ceo", "manager", "regional_director"})

# Handoff 50 §3: roles that may manage the company-wide proposal assets —
# portfolio_properties, client_references, team_members, org-chart config.
# Marketing owns these cross-branch; admin retains its super-role access.
# This is a resource-scoped role gate, deliberately NOT a new branch-scoping
# mechanism (Carlos's §5.1 call: company-wide, role-gated).
MARKETING_ROLES = frozenset({"marketing", "admin"})

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


def is_marketing_manager(role: Optional[str]) -> bool:
    """True if the role may manage company-wide proposal assets (§3)."""
    return normalize_role(role) in MARKETING_ROLES


def is_sales_rep(role: Optional[str]) -> bool:
    """True for the CRM sales role. Legacy `outside_sales` normalizes to it.

    `inside_sales` stays distinct: that role works the shared public-lead
    queue and must not be forced onto a personal book.
    """
    return normalize_role(role) == "sales"


# Same predicate the Leads tab uses for ?mine=true. The id is always the
# JWT subject, never a client-supplied user id (BRD I-9.5).
OWN_LEAD_PREDICATE = "(assigned_to = %s OR created_by = %s)"


def own_lead_filter(user: dict) -> tuple[str, list]:
    """SQL predicate + params that limit a sales rep to their own leads.

    Empty for every other role, including admin and manager-type roles
    (manager, regional_director, vice_president, ceo) and inside_sales.
    Those callers keep the visibility they already have: company-wide
    unless they opt into ?mine=true.
    """
    if not is_sales_rep(user.get("role")):
        return "", []
    return OWN_LEAD_PREDICATE, [user.get("id"), user.get("id")]


def require_own_lead(user: dict, lead: dict) -> None:
    """403 when a sales rep reads or writes a lead they do not own.

    Ownership matches the Leads tab: `assigned_to` or `created_by` is the
    caller. No-op for every other role. A proposal-render token is already
    pinned to one lead id by require_auth, so it is admitted here too.
    """
    if user.get("scope") == "proposal_render":
        return
    if not is_sales_rep(user.get("role")):
        return
    uid = user.get("id")
    if uid and (lead.get("assigned_to") == uid or lead.get("created_by") == uid):
        return
    raise HTTPException(
        status_code=403,
        detail="You can only access your own leads.",
    )


async def approval_ceiling_cents(role: Optional[str]) -> Optional[int]:
    """Max estimate value (cents) the role may approve; None = unlimited.

    Reads the ceiling from the config-driven `approval_tiers` table (never a
    hardcoded constant — defect §5.1), so an admin editing a tier moves the
    ACTUAL 403 boundary, not just the displayed ladder. A role's ceiling is
    the top of its highest band: the MAX of `max_value_cents` across its rows,
    where a NULL `max_value_cents` (the top, unbounded tier) means unlimited.

    The maintenance and install ladders carry the same $ bands per role, so
    keying on role_key alone is unambiguous. A role with no tier rows (any
    non-approver) yields 0 — it can approve nothing; require_approver gates
    these before the value check is ever reached.
    """
    rows = await query(
        "SELECT max_value_cents FROM approval_tiers WHERE role_key = %s",
        [normalize_role(role)],
    )
    if not rows:
        return 0
    # A NULL max on any band = unbounded ceiling for the role.
    if any(r.get("max_value_cents") is None for r in rows):
        return None
    return max(int(r["max_value_cents"]) for r in rows)


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


_UNSET = object()  # sentinel: caller did not supply estimate_id at all


def require_estimate_viewer(user: dict, estimate_id: object = _UNSET) -> None:
    """403 unless the JWT role may OPEN an individual estimate (Handoff 50 §2).

    The estimate-detail surface — line-item editor, sections, takeoff, margins —
    is estimator/approver-owned. `sales` sees only the estimate QUEUE
    (list_estimates) plus the intake forms; it must not reach a single
    estimate's detail by typing its URL. Reuses the existing edit role set
    (estimators + manager-tier approvers) rather than a parallel list; every
    role that may read a detail may also edit it, and vice-versa. procurement,
    inside_sales, and marketing are likewise refused — none work estimates.

    Exception: a proposal-render token (scope="proposal_render") is admitted
    regardless of role. The server-level guard (api/server.py) has already
    pinned it to exactly this one estimate id, and the headless-Chromium render
    must read the estimate to build the proposal even when the requesting rep
    is `sales`. The token still cannot read any other estimate.

    WS2 null-guard: when the caller passes ``estimate_id=None`` explicitly
    (estimate-optional proposal — no estimate exists yet), there is no estimate
    to gate on and the check is a no-op. Callers that omit estimate_id entirely
    (existing estimate-detail routes) receive the sentinel ``_UNSET`` and are
    NOT no-op'd — the full role check applies as before.
    """
    # estimate_id=None means "no estimate on this proposal" — skip the gate.
    if estimate_id is None:
        return
    if user.get("scope") == "proposal_render":
        return
    if normalize_role(user.get("role")) not in LINE_ITEM_EDIT_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Estimator or manager-tier role required to open an estimate.",
        )


async def _live_role(user: dict) -> str:
    """Re-read the CURRENT role from the users table, keyed on the JWT user id.

    Immediate revocation on approver paths (Amendment B.2): a role change or a
    deactivation must revoke approval authority NOW, not when the token expires.
    Raises 403 if the user id is missing, the row is gone, or `active` is 0.
    Returns the canonical live role for the caller's authority checks.

    Scope is deliberately narrow: ONLY the approver guards re-read; every other
    route keeps trusting the token claim. The accepted tradeoff is that a
    deactivated user can still READ until the token expires — only approval
    authority is revoked immediately.
    """
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=403, detail="Approver identity missing.")
    rows = await query("SELECT role, active FROM users WHERE id = %s", [user_id])
    if not rows or not rows[0].get("active"):
        raise HTTPException(
            status_code=403,
            detail="Account is inactive — approval authority revoked.",
        )
    return normalize_role(rows[0].get("role"))


async def require_approver(user: dict) -> str:
    """403 unless the LIVE role owns approver scope (adjustments/approve).

    Re-reads role AND active from the users table (B.2) so a demotion or
    deactivation takes effect on the very next approver call, regardless of
    the stale JWT claim. Returns the validated live role so a caller that
    immediately follows with require_approval_authority can pass it through
    and skip a redundant users re-read.
    """
    live_role = await _live_role(user)
    if live_role not in APPROVER_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Approver role required: adjustments and approvals are approver-owned.",
        )
    return live_role


async def require_approval_authority(
    user: dict, value_cents: int, live_role: Optional[str] = None
) -> None:
    """403 unless the approver's tier ceiling covers the estimate value.

    The ceiling comes from the live `approval_tiers` table (§5.1) and the role
    from the live users row (B.2) — neither from the JWT. Pass `live_role` (the
    value returned by a preceding require_approver call) to reuse that users
    re-read; omit it and this guard re-reads on its own (standalone-safe).
    """
    if live_role is None:
        live_role = await _live_role(user)
    if live_role not in APPROVER_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Approver role required: adjustments and approvals are approver-owned.",
        )
    ceiling = await approval_ceiling_cents(live_role)
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
    """Row-level scope for estimate reads (Amendment B.1).

    kind = 'all'    → no branch restriction (cross-branch role)
           'branch' → restrict to `ids`, a list of aspire_branch_id ints drawn
                      from the user's `user_branches` rows (1 for a maintenance
                      estimator, ~8 for a regional director)
           'none'   → user has zero user_branches rows; sees no rows
    """
    kind: str
    ids: list[int] = field(default_factory=list)


async def resolve_branch_scope(user: dict) -> BranchScope:
    """Derive the estimate-read scope from the authenticated user (BRD I-9.5).

    Cross-branch roles (admin/VP/CEO) see everything. Every other role —
    including regional_director, whose reach comes from holding many
    `user_branches` rows rather than the role set (B.1) — is scoped to the
    aspire_branch_id list on its `user_branches` assignments. Zero rows → the
    user sees nothing until Settings > Users assigns a branch.
    """
    if sees_all_branches(user.get("role")):
        return BranchScope(kind="all")
    rows = await query(
        "SELECT aspire_branch_id FROM user_branches WHERE user_id = %s",
        [user.get("id")],
    )
    ids = [int(r["aspire_branch_id"]) for r in rows]
    if not ids:
        return BranchScope(kind="none")
    return BranchScope(kind="branch", ids=ids)
