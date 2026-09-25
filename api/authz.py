"""Canonical role model + server-side authorization.

One role vocabulary for the whole app, the estimator/approver ownership
split enforced server-side, the approval-tier authority ladder, and branch
scoping derived from the authenticated user — never from a client-supplied
query param (BRD I-9.5).

Layered on `require_auth`: handlers call `require_estimator(user)` /
`require_approver(user)` / `require_approval_authority(user, value)` with the
decoded JWT payload, and `resolve_branch_scope(user)` to build row-level scope.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from fastapi import HTTPException, Query

from db import query

# ── Canonical role set (§2, LOCKED) ───────────────────────────────

CANONICAL_ROLES = frozenset({
    "procurement",
    "sales",
    "maintenance_sales",
    "install_sales",
    "inside_sales",
    "admin",
    # regional_sales is field sales (many assigned branches, direct reports).
    # vp_sales shares admin's grants and still earns commission.
    # Neither is regional_director or vice_president.
    "regional_sales",
    "vp_sales",
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

# Stored values that still authorize. They are not assignable: create/PATCH
# of a *new* sales or outside_sales role is rejected. Nothing rewrites
# existing users.role rows, because maintenance vs install is not knowable.
RETIRED_SALES_ROLES = frozenset({"sales", "outside_sales"})

RETIRED_SALES_ASSIGNMENT_DETAIL = (
    "The sales role is no longer assignable. "
    "Choose Maintenance Sales or Install Sales."
)

# The five assignable sales roles. Each has its own commission structure
# and workflow. Legacy sales is not in this set.
SALES_TEAM_ROLES = frozenset({
    "inside_sales",
    "maintenance_sales",
    "install_sales",
    "regional_sales",
    "vp_sales",
})

# Roles an admin may write onto a users row. `sales` stays in CANONICAL_ROLES
# so existing sessions keep working, and is absent here.
ASSIGNABLE_ROLES = CANONICAL_ROLES - frozenset({"sales"})

# Admin and VP of Sales share every admin grant. Checked instead of
# `role == "admin"`. regional_sales is field sales, not a member.
# regional_director and vice_president are not members.
ADMIN_EQUIVALENT_ROLES = frozenset({"admin", "vp_sales"})

# `inside_sales` qualifies raw public/government leads and assigns them on to
# field sales. `outside_sales` is a legacy alias of `sales` for access checks
# only — it is not assignable. `maintenance_sales` and `install_sales` are the
# field-sales roles and differ by intake type. Legacy `sales` keeps that same
# access until an admin reassigns the person. Nothing here rewrites rows.
LEGACY_ROLE_MAP = {
    "outside_sales": "sales",
}

# Field-sales personas. maintenance_sales, install_sales, and regional_sales
# are the assignable ones. Legacy `sales` stays in the set so existing users
# keep own-lead scoping, both-intake access, and the Aspire rep requirement.
# regional_sales matches that, and also sees direct reports inside its
# assigned branches (see lead_scope_clause). outside_sales normalizes to
# sales before this check.
FIELD_SALES_ROLES = frozenset({
    "sales", "maintenance_sales", "install_sales", "regional_sales",
})

# users.role values that identify a sales rep in selector queries (sales
# performance, commissions) and in GET /api/users?role=sales. The five
# assignable sales roles come first. Legacy sales and outside_sales stay so
# un-migrated rows still appear. regional_sales is a field-sales commission
# earner (Aspire required, own book plus direct reports). vp_sales earns
# commission without being field-sales. `?role=sales` matches this whole
# tuple. Any other role value, including inside_sales or maintenance_sales
# alone, stays an exact match.
SALES_REP_DB_ROLES = (
    "inside_sales",
    "maintenance_sales",
    "install_sales",
    "regional_sales",
    "vp_sales",
    "sales",
    "outside_sales",
)

# Normalized roles that own client-reference and team-roster rows and may
# edit the shared portfolio. inside_sales is in this set and stays OUT of
# FIELD_SALES_ROLES, so its leads remain company-wide. outside_sales is not
# listed: normalize_role maps it to sales before the check.
ROSTER_REP_ROLES = FIELD_SALES_ROLES | frozenset({"inside_sales"})

# Intake types a role may submit. Only maintenance_sales and install_sales
# are locked. Legacy sales, inside sales, the admin-equivalent sales roles,
# and the manager tier may submit both.
_INTAKE_TYPES = ("maintenance", "install")
_INTAKE_TYPE_LOCK = {
    "maintenance_sales": "maintenance",
    "install_sales": "install",
}

# Estimator-owned scope: line items / sections / services / components / takeoff.
# Admin-equivalent roles (admin, vp_sales) are included. regional_sales is not.
ESTIMATOR_ROLES = frozenset({"maintenance_estimating", "install_estimating"}) | ADMIN_EQUIVALENT_ROLES

# Approver-owned scope: complexity/margin adjustments + approve/hand-back.
# regional_director and vice_president stay on this ladder. vp_sales joins
# because it is admin-equivalent. regional_sales does not.
APPROVER_ROLES = frozenset({
    "manager", "regional_director", "vice_president", "ceo",
}) | ADMIN_EQUIVALENT_ROLES

# Widened edit scope: managers and above may also mutate line items,
# not just approve them. Approver edit rights and approval-tier ceilings are
# independently gated — editing and approving are separate checks.
LINE_ITEM_EDIT_ROLES = ESTIMATOR_ROLES | APPROVER_ROLES

# Roles that see every branch. Default per §5.3: admin-equivalent roles
# (admin, vp_sales), vice_president, and CEO see all. regional_sales does not.
# Everyone else (incl. regional_director, procurement) is scoped to their
# own branch until Carlos confirms the cross-branch matrix (§7 open item).
# NOTE: `marketing` is intentionally absent — its cross-branch reach is limited
# to the marketing-asset tables (MARKETING_ROLES), NOT to estimate branch scope.
CROSS_BRANCH_ROLES = frozenset({"vice_president", "ceo"}) | ADMIN_EQUIVALENT_ROLES

# Roles that may view sales performance / commission data for any rep.
# Broader than CROSS_BRANCH_ROLES — adds manager and regional_director so
# branch-level leaders can see their team's numbers without gaining full
# cross-branch write privileges (mark-paid, etc. remain CROSS_BRANCH_ROLES).
REP_VIEWER_ROLES = frozenset({
    "vice_president", "ceo", "manager", "regional_director",
}) | ADMIN_EQUIVALENT_ROLES

# Estimating disciplines only. Admin-equivalent roles are estimators for
# line-item edits but remain super-roles for every other surface — do not
# use ESTIMATOR_ROLES here. vp_sales stays out; regional_sales is field sales.
ESTIMATING_ONLY_ROLES = frozenset({"maintenance_estimating", "install_estimating"})

# Branch and company leadership. Admin-equivalent roles are listed separately
# so public-lead and analytics comments can say "admin and management"
# without folding them together. regional_director and vice_president stay
# in MANAGEMENT_ROLES; the new sales roles do not.
MANAGEMENT_ROLES = frozenset({"manager", "regional_director", "vice_president", "ceo"})
FULL_ACCESS_ROLES = MANAGEMENT_ROLES | ADMIN_EQUIVALENT_ROLES

# Public-lead qualification queue (unassigned higher_gov / sam_gov rows).
# FIELD_SALES_ROLES (sales, maintenance_sales, install_sales) are absent on
# purpose: they get the same denial as legacy sales. The existing inside_sales
# role is the qualifier and stays on this list with admin-equivalent roles
# and management.
PUBLIC_LEADS_ROLES = frozenset({"inside_sales"}) | FULL_ACCESS_ROLES

# Analytics dashboard is admin-equivalent roles plus manager, regional
# director, vice president, and CEO. Field sales (sales, maintenance_sales,
# install_sales), inside sales, estimators, procurement, and marketing are
# refused. Reps use their own pipeline, not this dashboard.
ANALYTICS_DASHBOARD_ROLES = FULL_ACCESS_ROLES

# Scraper sources that feed the public-lead queue. A row leaves the queue once
# assigned_to is set (it then belongs to that rep's leads).
PUBLIC_LEAD_SOURCES = ("higher_gov", "sam_gov")

# Roles that may manage per-rep proposal roster rows (client_references,
# team_members) for ANY sales rep, and that keep the legacy company-wide /
# any-branch write path. Admin-equivalent roles retain super-role access.
# Portfolio editing is wider — see PORTFOLIO_EDITOR_ROLES. This is a
# resource-scoped role gate, deliberately NOT a new branch-scoping mechanism.
MARKETING_ROLES = frozenset({"marketing"}) | ADMIN_EQUIVALENT_ROLES

# Shared portfolio (one company-wide set, not owned by a rep). Every roster
# rep (legacy sales, inside_sales, maintenance_sales, install_sales) and
# marketing may add and edit; admin-equivalent roles keep super-role access.
# Other roles stay read-only on the write endpoints.
PORTFOLIO_EDITOR_ROLES = ROSTER_REP_ROLES | frozenset({"marketing"}) | ADMIN_EQUIVALENT_ROLES

def normalize_role(role: Optional[str]) -> str:
    """Map a stored/JWT role onto the canonical vocabulary (legacy → sales)."""
    role = (role or "").strip()
    return LEGACY_ROLE_MAP.get(role, role)


def ensure_assignable_role(role: str, current: Optional[str] = None) -> str:
    """Return a role that may be written onto a users row.

    Keeping the row's current `sales` or `outside_sales` value is allowed so
    an edit of branches or active does not force a reassignment. Assigning
    either retired role to someone else is 400. Any other unknown role is 422.
    """
    role = (role or "").strip()
    if current is not None and role == (current or "").strip():
        return role
    if role in RETIRED_SALES_ROLES:
        raise HTTPException(
            status_code=400,
            detail=RETIRED_SALES_ASSIGNMENT_DETAIL,
        )
    if role not in CANONICAL_ROLES:
        raise HTTPException(status_code=422, detail=f"Unknown role {role!r}")
    return role


def is_estimator(role: Optional[str]) -> bool:
    return normalize_role(role) in ESTIMATOR_ROLES


def is_approver(role: Optional[str]) -> bool:
    return normalize_role(role) in APPROVER_ROLES


def sees_all_branches(role: Optional[str]) -> bool:
    return normalize_role(role) in CROSS_BRANCH_ROLES


def is_marketing_manager(role: Optional[str]) -> bool:
    """True if the role may manage any rep's client references and team roster."""
    return normalize_role(role) in MARKETING_ROLES


def is_roster_rep(role: Optional[str]) -> bool:
    """True for a role that owns its own client references and team roster.

    Legacy `sales`, `outside_sales` (normalized to sales), `inside_sales`,
    `maintenance_sales`, and `install_sales`. This is not the lead-book
    check: `inside_sales` is a roster rep and is not a field-sales rep.
    """
    return normalize_role(role) in ROSTER_REP_ROLES


def is_portfolio_editor(role: Optional[str]) -> bool:
    """True if the role may add or edit the shared portfolio."""
    return normalize_role(role) in PORTFOLIO_EDITOR_ROLES


def coalesce_rep_id(*values: Optional[str]) -> Optional[str]:
    """Collapse rep_id / user_id / body repId into one owning-rep id.

    Empty strings are ignored. Two different non-empty values are a 400 —
    the caller named two reps.
    """
    present = [v.strip() for v in values if v and str(v).strip()]
    if not present:
        return None
    if len(set(present)) > 1:
        raise HTTPException(
            status_code=400,
            detail="rep_id and user_id must be the same rep.",
        )
    return present[0]


def roster_rep_query(
    rep_id: Optional[str] = Query(
        default=None,
        description=(
            "Owning sales rep (users.id). On reads, filters client references "
            "and the team roster to that rep. On creates, the new row is owned "
            "by that rep. Marketing and admin may name any roster rep "
            "(sales, outside_sales, inside_sales, maintenance_sales, "
            "install_sales). A roster rep may name only themselves; omitting "
            "it on a write assigns the row to the caller. On a read, field "
            "sales who omit it are scoped to their own id. Marketing, admin, "
            "and management who omit it keep the unscoped list."
        ),
    ),
    user_id: Optional[str] = Query(
        default=None,
        description="Alias of rep_id. When both are sent they must match.",
    ),
) -> Optional[str]:
    """Query dependency: `rep_id` or `user_id` selects which rep's roster."""
    return coalesce_rep_id(rep_id, user_id)


def requires_aspire_sales_rep(role: Optional[str]) -> bool:
    """True if saving this role must resolve an Aspire ContactID (§2.8).

    Field sales (legacy `sales` and the maintenance/install split) stamp
    SalesRepID on opportunity push. Other roles save with no Aspire link.
    """
    return normalize_role(role) in FIELD_SALES_ROLES


def allowed_intake_types(role: Optional[str]) -> list[str]:
    """Intake types (`maintenance`, `install`) this role may submit.

    `maintenance_sales` and `install_sales` are locked to one type. Every
    other role — including legacy `sales`, admin, and manager-tier roles —
    may submit both. An empty or unknown role is not locked, so a missing
    claim cannot accidentally hide an intake.
    """
    locked = _INTAKE_TYPE_LOCK.get(normalize_role(role))
    if locked is None:
        return list(_INTAKE_TYPES)
    return [locked]


def require_intake_type(user: dict, estimate_type: str) -> None:
    """403 when a split sales role submits the other intake type.

    Admins, managers, legacy `sales`, and every non-locked role pass. Callers
    still reject an estimateType that is neither maintenance nor install.
    """
    allowed = allowed_intake_types(user.get("role"))
    if estimate_type not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Role may only submit {allowed[0]} intakes.",
        )


def is_sales_rep(role: Optional[str]) -> bool:
    """True for a field-sales role whose leads are a personal book.

    Legacy `sales` and `outside_sales` (which normalizes to `sales`) are
    included, as are `maintenance_sales`, `install_sales`, and
    `regional_sales`. The existing `inside_sales` role stays distinct: it
    works the shared public-lead queue and must not be forced onto a
    personal book.
    """
    return normalize_role(role) in FIELD_SALES_ROLES


def is_regional_sales(role: Optional[str]) -> bool:
    """True for Regional Sales: field sales plus a team and many branches."""
    return normalize_role(role) == "regional_sales"


# Same predicate the Leads tab uses for ?mine=true. The id is always the
# JWT subject, never a client-supplied user id (BRD I-9.5).
OWN_LEAD_PREDICATE = "(assigned_to = %s OR created_by = %s)"

# regional_sales: own book plus users.reports_to_user_id = the caller.
TEAM_LEAD_PREDICATE = (
    "(assigned_to = %s OR created_by = %s"
    " OR assigned_to IN (SELECT id FROM users WHERE reports_to_user_id = %s)"
    " OR created_by IN (SELECT id FROM users WHERE reports_to_user_id = %s))"
)

# Territories whose maintenance or install Aspire branch is on the caller's
# user_branches rows. leads.branch_id stores the sales_territories id.
ASSIGNED_BRANCH_LEAD_PREDICATE = (
    "branch_id IN ("
    "SELECT st.id FROM sales_territories st"
    " JOIN user_branches ub ON ub.user_id = %s"
    " AND (ub.aspire_branch_id = st.aspire_branch_id_maintenance"
    " OR ub.aspire_branch_id = st.aspire_branch_id_install))"
)

OWN_LEAD_DENIED = "You can only access your own leads."
REGIONAL_LEAD_DENIED = (
    "You can only access your own leads and your direct reports' leads"
    " in your assigned branches."
)


def own_lead_filter(user: dict) -> tuple[str, list]:
    """SQL predicate + params that limit a field-sales rep to their book.

    Empty for every other role, including admin, vp_sales, and manager-type
    roles (manager, regional_director, vice_president, ceo) and inside_sales.
    Those callers keep company-wide visibility unless they opt into ?mine=true.

    regional_sales is own rows plus direct reports, and only leads whose
    territory maps to one of the caller's user_branches rows.
    """
    if not is_sales_rep(user.get("role")):
        return "", []
    uid = user.get("id")
    if is_regional_sales(user.get("role")):
        return (
            f"({TEAM_LEAD_PREDICATE} AND {ASSIGNED_BRANCH_LEAD_PREDICATE})",
            [uid, uid, uid, uid, uid],
        )
    return OWN_LEAD_PREDICATE, [uid, uid]


def _lead_owned_by(lead: dict, user_id: Optional[str]) -> bool:
    return bool(
        user_id
        and (lead.get("assigned_to") == user_id or lead.get("created_by") == user_id)
    )


def require_own_lead(user: dict, lead: dict) -> None:
    """403 when a field-sales rep reads or writes a lead they do not own.

    Ownership matches the Leads tab: `assigned_to` or `created_by` is the
    caller. No-op for every other role, including inside_sales and vp_sales.
    A proposal-render token is already pinned to one lead id by require_auth,
    so it is admitted here too.

    regional_sales is not decided here: direct reports and branch assignment
    need a query. Callers use `await enforce_lead_visibility`.
    """
    if user.get("scope") == "proposal_render":
        return
    if is_regional_sales(user.get("role")):
        return
    if not is_sales_rep(user.get("role")):
        return
    if _lead_owned_by(lead, user.get("id")):
        return
    raise HTTPException(status_code=403, detail=OWN_LEAD_DENIED)


async def _reports_to_caller(caller_id: str, owner_id: Optional[str]) -> bool:
    if not owner_id:
        return False
    rows = await query(
        "SELECT id FROM users WHERE id = %s AND reports_to_user_id = %s",
        [owner_id, caller_id],
    )
    return bool(rows)


async def _lead_in_assigned_branches(user_id: str, lead: dict) -> bool:
    branch = (lead.get("branch_id") or "").strip()
    if not branch:
        return False
    rows = await query(
        "SELECT st.id FROM sales_territories st"
        " JOIN user_branches ub ON ub.user_id = %s"
        " AND (ub.aspire_branch_id = st.aspire_branch_id_maintenance"
        " OR ub.aspire_branch_id = st.aspire_branch_id_install)"
        " WHERE st.id = %s",
        [user_id, branch],
    )
    return bool(rows)


async def enforce_lead_visibility(user: dict, lead: dict) -> None:
    """403 unless this caller may open the lead.

    Field sales other than regional_sales use the sync own-lead check.
    regional_sales may open a lead they own or that a direct report owns,
    and only when the lead's territory is one of their assigned branches.
    """
    if user.get("scope") == "proposal_render" or not is_regional_sales(user.get("role")):
        require_own_lead(user, lead)
        return
    uid = user.get("id") or ""
    owned = _lead_owned_by(lead, uid)
    if not owned:
        owned = await _reports_to_caller(uid, lead.get("assigned_to")) or (
            await _reports_to_caller(uid, lead.get("created_by"))
        )
    if not owned or not await _lead_in_assigned_branches(uid, lead):
        raise HTTPException(status_code=403, detail=REGIONAL_LEAD_DENIED)


async def assert_can_view_rep(
    user: dict, requested_user_id: Optional[str], *, surface: str
) -> Optional[list[str]]:
    """Who this caller may read on commissions and sales performance.

    Returns None when the caller may see every rep (and omitted a user id).
    Returns a list of user ids to restrict the query to. 403 when
    `requested_user_id` is outside that list. regional_sales is limited to
    themselves and users.reports_to_user_id = them.
    """
    if normalize_role(user.get("role")) in REP_VIEWER_ROLES:
        return [requested_user_id] if requested_user_id else None
    uid = user.get("id") or ""
    allowed = [uid]
    if is_regional_sales(user.get("role")):
        rows = await query(
            "SELECT id FROM users WHERE reports_to_user_id = %s",
            [uid],
        )
        allowed.extend(r["id"] for r in rows if r.get("id") and r["id"] not in allowed)
        detail = "You can only view yourself and your direct reports."
    else:
        detail = f"You can only view your own {surface}"
    if requested_user_id and requested_user_id not in allowed:
        raise HTTPException(status_code=403, detail=detail)
    if requested_user_id:
        return [requested_user_id]
    return allowed


def is_estimating_only(role: Optional[str]) -> bool:
    """True for the two estimating disciplines. Admin is not included."""
    return normalize_role(role) in ESTIMATING_ONLY_ROLES


def is_public_lead(source: Optional[str], assigned_to: Optional[str]) -> bool:
    """Unassigned government-scraper leads are the public qualification queue."""
    return (source or "") in PUBLIC_LEAD_SOURCES and not assigned_to


def hides_public_lead_queue(user: dict) -> bool:
    """True when a lead list must omit unassigned government leads."""
    return normalize_role(user.get("role")) not in PUBLIC_LEADS_ROLES


def require_not_estimating_only(user: dict, surface: str) -> None:
    """403 for maintenance/install estimating.

    Every other role passes, including admin, inside_sales, and field sales
    (sales, maintenance_sales, install_sales). The split roles are not listed
    here: they match sales by staying out of ESTIMATING_ONLY_ROLES.
    """
    if is_estimating_only(user.get("role")):
        raise HTTPException(
            status_code=403,
            detail=f"Estimators cannot access {surface}.",
        )


def require_public_leads_access(user: dict) -> None:
    """403 unless the role may open the public-lead qualification queue."""
    require_not_estimating_only(user, "public leads")
    if normalize_role(user.get("role")) not in PUBLIC_LEADS_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Public leads are limited to inside sales, admin, and management.",
        )


def require_lead_access(
    user: dict,
    source: Optional[str] = None,
    assigned_to: Optional[str] = None,
) -> None:
    """Leads are closed to estimating disciplines. Public-queue rows are
    further limited to inside sales, admin, and management.
    """
    require_not_estimating_only(user, "leads")
    if is_public_lead(source, assigned_to):
        require_public_leads_access(user)


def require_proposals_access(user: dict) -> None:
    """403 for estimating disciplines. Sales and leadership may open proposals."""
    require_not_estimating_only(user, "proposals")


def require_sales_performance_access(user: dict) -> None:
    """403 for estimating disciplines. Own-vs-all scoping is separate."""
    require_not_estimating_only(user, "sales performance")


def require_analytics_dashboard(user: dict) -> None:
    """403 unless the role is admin or management."""
    if normalize_role(user.get("role")) not in ANALYTICS_DASHBOARD_ROLES:
        raise HTTPException(
            status_code=403,
            detail="The analytics dashboard is limited to admin and management.",
        )


async def approval_ceiling_cents(role: Optional[str]) -> Optional[int]:
    """Max estimate value (cents) the role may approve; None = unlimited.

    Reads the ceiling from the config-driven `approval_tiers` table (never a
    hardcoded constant — defect §5.1), so an admin editing a tier moves the
    ACTUAL 403 boundary, not just the displayed ladder. A role's ceiling is
    the top of its highest band: the MAX of `max_value_cents` across its rows,
    where a NULL `max_value_cents` (the top, unbounded tier) means unlimited.

    The maintenance and install ladders carry the same $ bands per role, so
    keying on role_key alone is unambiguous. A role with no tier rows yields
    0 — it can approve nothing. Admin has no approval_tiers rows (ceiling 0);
    vp_sales mirrors that exactly (no tier rows are seeded). require_approver
    still admits vp_sales because it sits in APPROVER_ROLES; the value check
    then rejects anything above 0. regional_sales is not an approver.
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

    Allows estimators AND approver-tier roles (manager, RD, VP, CEO, and
    admin-equivalent roles: admin and vp_sales). regional_sales is not.
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

    Cross-branch roles (admin, vp_sales, vice_president, and CEO) see
    everything. regional_sales is not in that set: like regional_director,
    its reach comes from holding many `user_branches` rows (B.1). Zero rows
    means the user sees nothing until Settings > Users assigns a branch.
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
