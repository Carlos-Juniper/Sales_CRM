"""Proposal Export & Generator API — /api/proposals/* routes (Handoff 37).

Mirrors the api/estimating.py facade pattern exactly:
  * register(app, require_auth) is called from api/server.py
  * DB access via from db import execute, query
  * JSON is camelCase (matches studio/src/types/proposal.ts); DB is snake_case
  * Row mappers convert at the boundary — never trust the DB column order

Slice 3 scope (this file, Amendment A):
  Config read endpoints — project from crm.branches / new proposal config tables:
    GET /api/proposals/config/branches       → BranchProfile[]
    GET /api/proposals/config/team-members   → TeamMember[]  (+ optional filters, rep_id)
    GET /api/proposals/config/client-references → ClientReference[]  (+ optional rep_id)
    GET /api/proposals/config/portfolio      → PortfolioProperty[]
    GET /api/proposals/config/insurance      → InsuranceCert (current cert)
    GET /api/proposals/config/licenses       → { licenses[], certifications[] }

Slice 4 will extend this same module with the ProposalRequest CRUD routes.
Router object name: `register` (same as estimating.py).
Mount point: /api/proposals (registered in api/server.py).

Amendment A notes baked into this file:
  A.1  branch key is aspire_branch_id (INT), not a territory string
  A.2  BranchProfile is a read-model projected from crm.branches + crm.regions
  A.3  region is crm.regions (config table); regionId in all response shapes
  A.4  TeamMember.title aligns to CANONICAL_ROLES ('manager' not 'branch_manager')
  A.6  null-branch rows (aspire_branch_id IS NULL) are returned IN ADDITION to
       branch matches, never instead — both for team_members and client_references

Region on the team-roster and client-reference pickers:
  Users have no region column. Region is crm.regions, stored on
  branches.region_id. A caller's region is the distinct region_id of the
  branches in their user_branches rows. GET team-members and
  client-references take region_id: omit it to default to that set, pass a
  regions.id to pick another, or pass 'all' to turn the filter off. Rows
  whose region cannot be resolved stay in the list (see _region_match_sql).

Per-rep roster reads (client references and team members):
  Field sales (FIELD_SALES_ROLES) who omit rep_id are limited to their own
  rows plus legacy rows whose owner_user_id is NULL. Naming another rep is
  403. Marketing, admin, and management who omit rep_id see every row. A
  rep_id filter is (owner = that rep OR owner IS NULL) and is AND-ed with
  the region filter.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query, Response

from db import execute, query
from api import authz
from api._serialize import coerce_row

logger = logging.getLogger(__name__)


# ── Operating-roster filter (Amendment A.2) ──────────────────────────────────
# Not every crm.branches row is a real office. Nine carry "DO NOT USE" in the
# name; the seven below are placeholders, training branches and holding
# entities that are still active = 1, so they need naming explicitly.

_NON_OFFICE_BRANCHES = (
    "*** PICK A BRANCH ***",
    "General Holding",
    "Learning & Development",
    "Contract and Billing",
    "Training Branch",
    "Training Branch EC",
    "Golden Palms on Orange River",
)

# Sorts the no-region bucket last, after every real region's sort_order.
_UNGROUPED_REGION_SORT = 10_000

# Bound, not inlined. db.query()/aiomysql %-formats the SQL whenever params is
# non-empty, so a literal '%DO NOT USE%' raises ValueError ('%D') on the
# signer-scoped branches query (which also binds aspire_branch_id placeholders).
_DO_NOT_USE_LIKE = "%DO NOT USE%"

_BRANCH_ROSTER_FILTER = (
    "active = 1 AND branch_name NOT LIKE %s AND branch_name NOT IN ("
    + ", ".join("'" + n.replace("'", "''") + "'" for n in _NON_OFFICE_BRANCHES)
    + ")"
)

# Clients care about the town, not our internal division split — "Venice
# Install" and "Venice Maintenance" both read as "Venice".
_BRANCH_SERVICE_LINE_SUFFIX = re.compile(r"\s+(Install|Maintenance)$")

# Specialty divisions are booked as their own branch but operate out of a host
# office's yard, so their address is that office's. Where the host is also in
# the roster the division name is redundant.
_BRANCH_DIVISION = re.compile(r"\b(Aquatics|Sports Turf)\b")

_STATE_NAMES = {
    "FL": "Florida",
    "NC": "North Carolina",
    "PA": "Pennsylvania",
    "SC": "South Carolina",
    "TX": "Texas",
}


# ── Row mappers (DB snake_case → API camelCase) ───────────────────────────────

def _num(v: Any) -> Any:
    """Convert Decimal to float; pass all other types through."""
    if isinstance(v, Decimal):
        return float(v)
    return v


def _iso(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


# Won/lost proposals stay visible in the packages list for this many days after
# the status-change action is recorded in lead_actions, then drop automatically.
CLOSED_PACKAGE_GRACE_DAYS = 7

# Newest proposal_requests row for the joined lead. created_at is the source of
# truth: ids are `prop-` plus a random uuid4 fragment, so they only break a
# timestamp tie. Historical rows stay in the table.
_LATEST_PACKAGE_PER_LEAD_SQL = (
    "pr.id = ("
    "SELECT pr_latest.id FROM proposal_requests pr_latest "
    "WHERE pr_latest.lead_id = pr.lead_id "
    "ORDER BY pr_latest.created_at DESC, pr_latest.id DESC "
    "LIMIT 1)"
)


def _proposal_recency_key(row: dict) -> tuple:
    """Sort key for 'latest generated proposal': created_at, then id."""
    created = row.get("created_at")
    if not isinstance(created, datetime):
        created = datetime.min
    return (created, str(row.get("id") or ""))


def _latest_package_per_lead(rows: list[dict]) -> list[dict]:
    """Keep one package row per lead: the newest proposal by created_at.

    The list query applies the same rule in SQL. This pass covers a result
    that still contains older generations (the unit tests stub the driver).
    Nothing is deleted. Survivors stay in updated_at order, newest first.
    """
    best: dict[Any, dict] = {}
    for row in rows:
        lead_id = row.get("lead_id")
        current = best.get(lead_id)
        if current is None or _proposal_recency_key(row) > _proposal_recency_key(current):
            best[lead_id] = row
    return sorted(
        best.values(),
        key=lambda r: r.get("updated_at") if isinstance(r.get("updated_at"), datetime) else datetime.min,
        reverse=True,
    )


def _package_code(proposal_id: str, created_at: Any) -> str:
    """Stable display code for the proposals list. Not a stored column."""
    if isinstance(created_at, datetime):
        year: Any = created_at.year
    elif isinstance(created_at, str) and len(created_at) >= 4 and created_at[:4].isdigit():
        year = created_at[:4]
    else:
        year = "0000"
    suffix = re.sub(r"[^A-Za-z0-9]", "", proposal_id)[:6].upper() or "000000"
    return f"P-{year}-{suffix}"


def _package_subtitle(row: dict) -> Optional[str]:
    notes = (row.get("notes") or "").strip()
    if notes:
        return notes
    handoff = (row.get("handoff_notes") or "").strip()
    if handoff:
        return handoff
    place = ", ".join(part for part in ((row.get("city") or "").strip(), (row.get("state") or "").strip()) if part)
    return place or None


def _proposal_package_out(row: dict) -> dict:
    """List-row read model: proposal joined to its lead, assignee, and latest render.

    Section keys are intentionally omitted — the proposals list does not show
    the document's chapter chips.
    """
    amount = row.get("estimated_contract_value")
    if isinstance(amount, Decimal):
        amount = float(amount)
    elif amount is not None:
        amount = float(amount)

    version = row.get("render_version")
    page_count = row.get("page_count")
    assignee = None
    if row.get("assignee_id"):
        assignee = {
            "id": row["assignee_id"],
            "name": row.get("assignee_name") or "Unknown",
            "email": row.get("assignee_email") or "",
            "role": row.get("assignee_role") or "sales",
            "branchId": row.get("assignee_branch_id") or "",
            "avatarInitials": row.get("assignee_initials") or "?",
        }

    return {
        "id": row["id"],
        "leadId": row.get("lead_id") or "",
        "propertyId": row.get("property_id"),
        "title": (row.get("property_name") or "").strip() or "Untitled proposal",
        "subtitle": _package_subtitle(row),
        "amount": amount,
        "status": row.get("lead_status"),
        "updatedAt": _iso(row.get("updated_at")),
        "closedAt": _iso(row.get("closed_at")),
        "code": _package_code(row["id"], row.get("created_at")),
        "version": int(version) if version is not None else None,
        "pageCount": int(page_count) if page_count is not None else None,
        "assignee": assignee,
    }


def _branch_profile_out(r: dict) -> dict:
    """Project a crm.branches + crm.regions JOIN row into BranchProfile.

    The default /config/branches query filters on lat/lng IS NOT NULL before
    mapping (the distance-based proximity footer needs real coordinates), so
    lat/lng are floats there. The proposalId-scoped query does not filter on
    coordinates — an office like Corporate may have none — so lat/lng pass
    through as None (BranchProfile.lat/lng are `number | null` on the
    frontend) rather than crashing float(None).
    regionId and branchName are from branches; regionId comes from the join.
    """
    lat = _num(r["lat"])
    lng = _num(r["lng"])
    return {
        "aspireBranchId": r["aspire_branch_id"],
        "branchName": r["branch_name"],
        "city": r.get("city") or "",
        "regionId": r.get("region_id") or "",
        "address": _build_address(r),
        "lat": float(lat) if lat is not None else None,
        "lng": float(lng) if lng is not None else None,
    }


def _build_address(r: dict) -> str:
    """Construct a single-line address from branches columns.

    Produces the standard US postal format:
      "5880 Staley Road, Fort Myers, FL 33905"
    """
    street = (r.get("address1") or "").strip()
    city = (r.get("city") or "").strip()
    state = (r.get("state") or "").strip()
    zip_code = (r.get("zip") or "").strip()

    # Build "City, STATE ZIP" segment
    state_zip = " ".join(filter(None, [state, zip_code]))
    city_state_zip = ", ".join(filter(None, [city, state_zip]))

    # Combine street + city-state-zip
    return ", ".join(filter(None, [street, city_state_zip]))


# Sentinel for "do not restrict by region". Not a crm.regions.id.
_REGION_FILTER_ALL = "all"

# Applied filter, for a client that wants to label the default selection.
# "all" means no region restriction; otherwise comma-separated regions.id
# values. The JSON body stays an array so existing callers keep working.
_REGION_FILTER_HEADER = "X-Region-Filter"


def _region_id_out(row: dict) -> Optional[str]:
    """branches.region_id as a slug, or None when the region is unknown."""
    raw = row.get("region_id")
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _set_region_filter_header(response: Response, region_ids: Optional[list[str]]) -> None:
    response.headers[_REGION_FILTER_HEADER] = (
        _REGION_FILTER_ALL if not region_ids else ",".join(region_ids)
    )


async def _caller_region_ids(user_id: Optional[str]) -> list[str]:
    """Distinct regions of the branches assigned to this user.

    Region is not stored on users. It lives on branches.region_id
    (crm.regions.id). The caller's region is that set for the branches in
    their user_branches rows — the same assignment table that scopes
    estimates. A branch with a null or blank region_id does not invent a
    region for the caller.
    """
    if not user_id:
        return []
    rows = await query(
        """
        SELECT DISTINCT b.region_id AS region_id
        FROM user_branches ub
        INNER JOIN branches b ON b.aspire_branch_id = ub.aspire_branch_id
        WHERE ub.user_id = %s
          AND b.region_id IS NOT NULL
          AND b.region_id <> ''
        ORDER BY b.region_id
        """,
        [user_id],
    )
    seen: list[str] = []
    for row in rows:
        rid = _region_id_out(row)
        if rid and rid not in seen:
            seen.append(rid)
    return seen


async def _resolve_region_filter(
    region_id: Optional[str], user: dict
) -> Optional[list[str]]:
    """Region ids to keep, or None when the picker must not restrict by region.

    An omitted region_id defaults to the caller's region(s). When that set
    is empty — no user_branches rows, or every assigned branch has no
    region — the default is unrestricted, the same as region_id=all.
    Restricting those callers to "unknown region only" would hide the
    people they need to put on a proposal.

    An explicit id is checked against crm.regions. 'all' (any case) turns
    the filter off so a rep can leave their region.
    """
    if region_id is not None:
        token = region_id.strip()
        if token.lower() == _REGION_FILTER_ALL:
            return None
        if not token or len(token) > 36:
            raise HTTPException(
                status_code=400,
                detail="region_id must be a crm.regions.id or 'all'.",
            )
        found = await query("SELECT id FROM regions WHERE id = %s", [token])
        if not found:
            raise HTTPException(
                status_code=400,
                detail="Unknown region_id. Pass a crm.regions.id or 'all'.",
            )
        return [token]
    caller_regions = await _caller_region_ids(user.get("id"))
    return caller_regions or None


def _region_match_sql(region_ids: Optional[list[str]]) -> tuple[str, list[Any]]:
    """Predicate for a roster row's region, plus its bound params.

    A row matches when its branch's region is one of region_ids, OR the
    region cannot be determined. Unknown means the row has no
    aspire_branch_id (company-wide roster), the branch row is missing, or
    branches.region_id is null or blank. Those rows stay in the list so
    missing region data is visible instead of silently dropped. The joined
    region_id is null in every one of those cases except a blank string,
    which is matched on its own.

    Returns ("", []) when there is nothing to restrict.
    """
    if not region_ids:
        return "", []
    placeholders = ", ".join(["%s"] * len(region_ids))
    clause = (
        f"(b.region_id IN ({placeholders})"
        " OR b.region_id IS NULL OR b.region_id = ''"
        " OR t.aspire_branch_id IS NULL)"
    )
    return clause, list(region_ids)


async def _fetch_roster(
    *,
    table: str,
    order_by: str,
    region_ids: Optional[list[str]],
    aspire_branch_id: Optional[int],
    team_type: Optional[str] = None,
    include_user_branch_twins: bool = False,
    owner_user_id: Optional[str] = None,
) -> list[dict]:
    """Active roster rows for one picker, with the branch's region joined on.

    table and order_by are fixed literals from the call sites, never request
    input. include_user_branch_twins is the team-member branch filter's
    third arm (migration 058): a manager pinned to one city-twin is also
    returned for the other via user_branches.
    """
    conditions = ["t.active = 1"]
    params: list[Any] = []

    if aspire_branch_id is not None:
        if include_user_branch_twins:
            conditions.append(
                "(t.aspire_branch_id = %s OR t.aspire_branch_id IS NULL"
                " OR t.user_id IN (SELECT user_id FROM user_branches"
                " WHERE aspire_branch_id = %s))"
            )
            params.extend([aspire_branch_id, aspire_branch_id])
        else:
            conditions.append(
                "(t.aspire_branch_id = %s OR t.aspire_branch_id IS NULL)"
            )
            params.append(aspire_branch_id)

    if team_type:
        conditions.append("t.team_type = %s")
        params.append(team_type)

    if owner_user_id is not None:
        # Own rows plus legacy company-wide rows (owner_user_id NULL) that
        # predate per-rep ownership. Hiding the NULL rows dropped them from
        # marketing's Settings view whenever a rep was selected.
        conditions.append("(t.owner_user_id = %s OR t.owner_user_id IS NULL)")
        params.append(owner_user_id)

    region_sql, region_params = _region_match_sql(region_ids)
    if region_sql:
        conditions.append(region_sql)
        params.extend(region_params)

    where = "WHERE " + " AND ".join(conditions)
    return await query(
        f"SELECT t.*, b.region_id "
        f"FROM {table} t "
        f"LEFT JOIN branches b ON b.aspire_branch_id = t.aspire_branch_id "
        f"{where} ORDER BY {order_by}",
        params or None,
    )


def _team_member_out(r: dict) -> dict:
    """Map a team_members row to TeamMember API shape."""
    return {
        "id": r["id"],
        "name": r["name"],
        "title": r["title"],
        "teamType": r["team_type"],
        # Amendment A.1/A.4: INT or None
        "aspireBranchId": r.get("aspire_branch_id"),
        # Amendment A.4: user_id link
        "userId": r.get("user_id"),
        "location": r.get("location"),
        "bio": r.get("bio") or "",
        "headshotObjectKey": r.get("headshot_object_key"),
        "active": bool(r["active"]),
        "sortOrder": r["sort_order"],
        # branches.region_id via the roster join. null = company-wide row,
        # missing branch, or a branch whose region was never set.
        "regionId": _region_id_out(r),
        # Sales rep this roster row belongs to. Null = legacy company/branch row.
        "ownerUserId": r.get("owner_user_id"),
    }


def _client_reference_out(r: dict) -> dict:
    """Map a client_references row to ClientReference API shape."""
    return {
        "id": r["id"],
        # Amendment A.1: INT or None (None = company-wide)
        "aspireBranchId": r.get("aspire_branch_id"),
        "propertyName": r["property_name"],
        "servicesProvided": r["services_provided"],
        "contactName": r["contact_name"],
        "contactTitle": r.get("contact_title"),
        "phone": r["phone"],
        "email": r["email"],
        "address": r["address"],
        "clientSinceYear": r["client_since_year"],
        "active": bool(r["active"]),
        # branches.region_id via the roster join. null when the reference is
        # company-wide or its branch has no region.
        "regionId": _region_id_out(r),
        # Sales rep this reference belongs to. Null = legacy company/branch row.
        "ownerUserId": r.get("owner_user_id"),
    }


_ROSTER_VIEW_DENIED = (
    "You can view only your own client references and team roster."
)


async def _authorize_rep_roster_read(user: dict, rep_id: str) -> None:
    """403 unless the caller may read this rep's roster.

    The rep themselves, plus marketing and admin. A live role re-read gates
    the cross-rep grant so a demoted token cannot keep it.
    """
    if rep_id == user.get("id"):
        return
    if authz.is_marketing_manager(await authz._live_role(user)):
        return
    raise HTTPException(status_code=403, detail=_ROSTER_VIEW_DENIED)


def _scope_roster_read(user: dict, rep_id: Optional[str]) -> Optional[str]:
    """Owner id to filter a roster read by, or None for the full list.

    Field sales who omit rep_id are scoped to themselves so ProposalBuilder
    cannot read every other rep's references and roster by leaving the
    parameter off. Naming another rep is 403. Marketing, admin, and
    management (and every non-field role, including inside_sales) who omit
    rep_id stay unscoped. A non-field caller who does pass rep_id is still
    checked by ``_authorize_rep_roster_read``.
    """
    if not authz.is_sales_rep(user.get("role")):
        return rep_id
    caller_id = user.get("id")
    if not caller_id or (rep_id is not None and rep_id != caller_id):
        raise HTTPException(status_code=403, detail=_ROSTER_VIEW_DENIED)
    return caller_id


def _portfolio_property_out(r: dict) -> dict:
    """Map a portfolio_properties row to PortfolioProperty API shape.

    Calls coerce_row first so that any Decimal/datetime/bytes values returned
    by aiomysql are normalised before field access — the same pattern applied
    to the company endpoint (commit 5c17026).  This is the root cause of the
    Bug 4 500: aiomysql can return TEXT columns as bytes under certain charset
    configurations; coerce_row converts bytes → str so json.loads succeeds.
    """
    r = coerce_row(r)

    # photo_object_keys is TEXT NOT NULL storing a JSON array (e.g. '[]').
    # After coerce_row, it is always str or None; guard the empty/null case.
    photo_keys_raw = r.get("photo_object_keys") or "[]"
    if isinstance(photo_keys_raw, str):
        try:
            photo_keys = json.loads(photo_keys_raw)
        except (json.JSONDecodeError, TypeError):
            photo_keys = []
    else:
        # Already a list (a driver that parses JSON columns itself). Pass it
        # through rather than discarding it — the isinstance guard below still
        # rejects anything that is not a list, so this cannot widen the shape.
        photo_keys = photo_keys_raw

    return {
        "id": r["id"],
        "name": r["name"],
        "cityState": r["city_state"],
        # Amendment A.3: regionId (not a union type)
        "regionId": r["region_id"],
        "photoObjectKeys": photo_keys if isinstance(photo_keys, list) else [],
        "sortOrder": r["sort_order"],
    }


def _insurance_cert_out(r: dict) -> dict:
    """Map a licenses_certifications row (kind='insurance') to the API response shape.

    Handoff 42: insurance data now lives in licenses_certifications. The output
    shape is intentionally stable so proposal consumers are unaffected. The
    'label' field is sourced from 'name' (insurance rows store their label in
    name per the migration 033 COALESCE). 'uploadedAt' is mapped from
    updated_at (the closest equivalent after the table merge).
    """
    return {
        "id": r["id"],
        "objectKey": r.get("object_key"),
        "expiryDate": _iso(r.get("expiry_date")),
        "label": r.get("name"),  # insurance rows store display name in 'name'
        "uploadedAt": _iso(r.get("updated_at")),
    }


def _license_out(r: dict) -> dict:
    """Map a licenses_certifications row to the API response shape."""
    return {
        "id": r["id"],
        "kind": r["kind"],
        "name": r["name"],
        "issuingBody": r.get("issuing_body"),
        "identifier": r.get("identifier"),
        "holderName": r.get("holder_name"),
        "aspireBranchId": r.get("aspire_branch_id"),
        "issuedDate": _iso(r.get("issued_date")),
        "expiryDate": _iso(r.get("expiry_date")),
        "objectKey": r.get("object_key"),
        "isExpired": bool(r["is_expired"]),
        "active": bool(r["active"]),
    }


# ── ProposalRequest helpers ───────────────────────────────────────────────────

# ── Signer resolution (Handoff 43 §3.1 / §3.2) ───────────────────────────────

# Returned when the proposal names no signer, or names a user row that no longer
# exists. Every field null so the frontend applies its company-level fallback —
# a client-facing letter must never print an id or an empty line where a name
# belongs.
_EMPTY_SIGNER: dict = {
    "name": None,
    "title": None,
    "phone": None,
    "email": None,
    "branchAddress": None,
}


async def _resolve_signer_office(user_id: str, estimate_id: Optional[str]) -> Optional[str]:
    """The office address to print under the signer's name, or None.

    Two rules, in order:

      1. The estimate's branch, when the signer is assigned to it. For a job in
         Fort Myers signed by someone who covers Fort Myers, that is the office
         the client should call — and it is the only answer that stays right for
         a regional director covering eight branches.

      2. Their sole branch, when they hold exactly one.

    Anything else returns None. A signer holding several branches on an estimate
    outside all of them has no determinable office, and printing an arbitrary
    one of the eight on a client document is worse than printing the company
    address. Guessing here was the reason §3.2 was left open.
    """
    branch_rows = await query(
        "SELECT aspire_branch_id FROM user_branches WHERE user_id = %s",
        [user_id],
    )
    held = [int(r["aspire_branch_id"]) for r in branch_rows]
    if not held:
        return None

    target: Optional[int] = None
    if estimate_id:
        est_rows = await query(
            "SELECT aspire_branch_id FROM estimates WHERE id = %s", [estimate_id]
        )
        est_branch = est_rows[0].get("aspire_branch_id") if est_rows else None
        if est_branch is not None and int(est_branch) in held:
            target = int(est_branch)
    if target is None and len(held) == 1:
        target = held[0]
    if target is None:
        return None

    rows = await query(
        "SELECT address1, city, state, zip FROM branches WHERE aspire_branch_id = %s",
        [target],
    )
    if not rows:
        return None
    return _build_address(rows[0]) or None


def _new_proposal_id() -> str:
    """Generate a proposal-prefixed id matching the _new_id() pattern in estimating.py."""
    return f"prop-{uuid.uuid4().hex[:12]}"


def _now_utc() -> datetime:
    """Naive UTC datetime — matches the DB's DATETIME columns (no tz stored)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _json_col_out(v: Any) -> Any:
    """Deserialise a TEXT/JSON column if aiomysql returns it as a string."""
    if isinstance(v, (str, bytes, bytearray)):
        try:
            return json.loads(v)
        except (json.JSONDecodeError, TypeError):
            return v
    return v


def _render_out(row: dict) -> dict:
    """Map a proposal_renders DB row to camelCase API response."""
    created_at = row.get("created_at")
    return {
        "id": row["id"],
        "proposalId": row["proposal_id"],
        "version": row["version"],
        "objectKey": row["object_key"],
        "pageCount": row.get("page_count"),
        "status": row["status"],
        "errorMessage": row.get("error_message"),
        "renderedBy": row["rendered_by"],
        "durationMs": row.get("duration_ms"),
        "renderedAt": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
        # null for renders that predate overflow detection; [] means measured
        # and nothing was clipped. The client must not conflate the two.
        "overflowingPages": _json_col_out(row.get("overflowing_pages")),
    }


def _proposal_request_out(r: dict) -> dict:
    """Map a proposal_requests row to the ProposalRequest API shape (camelCase).

    All JSON columns are deserialised here so the caller receives Python dicts/
    lists, not raw strings.  The shape matches ProposalRequest in
    studio/src/types/proposal.ts exactly.
    """
    return {
        "id": r["id"],
        "leadId": r["lead_id"],
        "estimateId": r["estimate_id"],
        "createdBy": r["created_by"],
        "sections": _json_col_out(r.get("sections") or "[]"),
        "orgChart": _json_col_out(r["org_chart"]),
        "startupPlan": _json_col_out(r["startup_plan"]),
        "teamMemberIds": _json_col_out(r.get("team_member_ids") or "[]"),
        "executiveTeamMemberIds": _json_col_out(r.get("executive_team_member_ids") or "[]"),
        "clientReferenceIds": _json_col_out(r.get("client_reference_ids") or "[]"),
        "portfolioPropertyIds": _json_col_out(r.get("portfolio_property_ids") or "[]"),
        # NULL means "no custom chapter order saved — use the natural default",
        # distinct from a populated array. Do not coerce a missing value to "[]"
        # the way the id-list fields above do.
        "chapterOrder": _json_col_out(r.get("chapter_order")),
        "signerUserId": r["signer_user_id"],
        "createdAt": _iso(r["created_at"]),
        "updatedAt": _iso(r["updated_at"]),
    }


# ── Route registration ────────────────────────────────────────────────────────

def register(app, require_auth) -> None:
    """Attach all proposal routes to the FastAPI app with the shared auth dep.

    Called from api/server.py immediately after the estimating module is
    registered. Slice 4 will add ProposalRequest CRUD endpoints to this same
    function.

    Mount point: every route here is under /api/proposals.
    """

    async def _proposal_auth(user: dict = Depends(require_auth)) -> dict:
        authz.require_proposals_access(user)
        return user

    require_auth = _proposal_auth

    # ── GET /api/proposals/config/branches ─────────────────────────────────
    # Returns BranchProfile[] projected from crm.branches JOIN crm.regions.
    # Operating-roster filter applied (active = 1 AND name NOT LIKE '%DO NOT USE%').
    # Only rows with lat/lng populated are returned — the proximity footer
    # (§2 page 3) needs real coordinates; null-lat rows are skipped.
    #
    # proposalId (optional): the "Local Branches" footer on that same page is
    # meant to show the rep's own offices, not whichever branches happen to be
    # nearest by lat/lng — a lead with bad/missing coordinates could otherwise
    # surface an out-of-state office that has nothing to do with the deal. When
    # the proposal's signer (proposal_requests.signer_user_id, same source
    # _resolve_signer_office uses for the letter's return address) holds
    # branches in user_branches, this returns exactly those — lat/lng NOT
    # required, since an office like Corporate may not be geocoded at all.
    # Falls back to the full geocoded roster when there's no signer yet or the
    # signer holds no branches, rather than leaving the footer empty.

    @app.get("/api/proposals/config/branches")
    async def get_proposal_branches(
        proposal_id: Optional[str] = Query(default=None),
        _user: dict = Depends(require_auth),
    ) -> list:
        held_branch_ids: list[int] = []
        if proposal_id:
            proposal_rows = await query(
                "SELECT signer_user_id FROM proposal_requests WHERE id = %s",
                [proposal_id],
            )
            signer_user_id = proposal_rows[0].get("signer_user_id") if proposal_rows else None
            if signer_user_id:
                branch_rows = await query(
                    "SELECT aspire_branch_id FROM user_branches WHERE user_id = %s",
                    [signer_user_id],
                )
                held_branch_ids = [int(r["aspire_branch_id"]) for r in branch_rows]

        if held_branch_ids:
            placeholders = ", ".join(["%s"] * len(held_branch_ids))
            rows = await query(
                f"""
                SELECT
                    b.aspire_branch_id,
                    b.branch_name,
                    b.address1,
                    b.city,
                    b.state,
                    b.zip,
                    b.lat,
                    b.lng,
                    b.region_id
                FROM branches b
                WHERE {_BRANCH_ROSTER_FILTER}
                  AND b.aspire_branch_id IN ({placeholders})
                ORDER BY b.branch_name
                """,
                [_DO_NOT_USE_LIKE, *held_branch_ids],
            )
        else:
            rows = await query(
                f"""
                SELECT
                    b.aspire_branch_id,
                    b.branch_name,
                    b.address1,
                    b.city,
                    b.state,
                    b.zip,
                    b.lat,
                    b.lng,
                    b.region_id
                FROM branches b
                WHERE {_BRANCH_ROSTER_FILTER}
                  AND b.lat IS NOT NULL
                  AND b.lng IS NOT NULL
                ORDER BY b.branch_name
                """,
                [_DO_NOT_USE_LIKE],
            )
        return [_branch_profile_out(r) for r in rows]

    # ── GET /api/proposals/config/branch-coverage ──────────────────────────
    # The "where we operate" table on the Local Landscape Experts page.
    # Unlike /config/branches this does not require lat/lng — coverage is a
    # roster, not a proximity calculation, and only ~16 of 56 rows are geocoded.
    # Offices sharing an address are one office; different addresses are
    # separate offices even under the same town name.

    @app.get("/api/proposals/config/branch-coverage")
    async def get_proposal_branch_coverage(
        _user: dict = Depends(require_auth),
    ) -> list:
        rows = await query(
            f"""
            SELECT b.branch_name, b.address1, b.city, b.state,
                   b.region_id, r.name AS region_name, r.sort_order AS region_sort
            FROM branches b
            LEFT JOIN regions r ON r.id = b.region_id
            WHERE {_BRANCH_ROSTER_FILTER}
              AND b.address1 IS NOT NULL AND b.address1 <> ''
              AND b.state IS NOT NULL AND b.state <> ''
            ORDER BY b.state, b.branch_name
            """,
            [_DO_NOT_USE_LIKE],
        )

        # Region key for an office. Branches with no region_id fall into the
        # unnamed bucket, which the page renders under its generic heading —
        # an unassigned office must still appear, not silently vanish.
        def region_of(r: dict) -> tuple[int, str, str]:
            rid = (r["region_id"] or "").strip()
            if not rid:
                return (_UNGROUPED_REGION_SORT, "", "")
            return (r["region_sort"] or 0, rid, (r["region_name"] or rid).strip())

        by_address: dict[tuple, tuple[str, tuple[int, str, str], set[str]]] = {}
        for r in rows:
            key = (r["address1"].strip().lower(), (r["city"] or "").strip().lower())
            state = r["state"].strip().upper()
            name = _BRANCH_SERVICE_LINE_SUFFIX.sub("", r["branch_name"].strip())
            entry = by_address.setdefault(key, (state, region_of(r), set()))
            entry[2].add(name)

        by_state: dict[str, dict[tuple[int, str, str], set[str]]] = {}
        for state, region, names in by_address.values():
            # Rows sharing an address are one building, but not necessarily one
            # name: Panama City Beach and Tyndall share a yard and both belong on
            # the page. Only the division rows collapse into their host.
            hosts = {n for n in names if not _BRANCH_DIVISION.search(n)}
            by_state.setdefault(state, {}).setdefault(region, set()).update(hosts or names)

        def office_count(state: str) -> int:
            return sum(len(names) for names in by_state[state].values())

        def regions_of(state: str) -> list[dict]:
            # Keys sort by (sort_order, id), so real regions come out in their
            # configured order and the unnamed bucket lands last.
            out: list[dict] = []
            for key in sorted(by_state[state]):
                _sort, region_id, region_name = key
                out.append(
                    {
                        "regionId": region_id,
                        "regionName": region_name,
                        "branches": sorted(by_state[state][key]),
                    }
                )
            return out

        return [
            {
                "state": state,
                "stateName": _STATE_NAMES.get(state, state),
                "regions": regions_of(state),
            }
            for state in sorted(by_state, key=lambda s: (-office_count(s), s))
        ]

    # ── GET /api/proposals/config/team-members ─────────────────────────────
    # Returns TeamMember[] with optional aspire_branch_id, team_type, and
    # region_id filters.
    #
    # Amendment A.6 null-branch-inclusion rule:
    #   When aspire_branch_id is supplied, null-aspire_branch_id rows are returned
    #   IN ADDITION to rows matching that branch — not instead of them.
    #   This surfaces the executive roster (team_type='executive') and
    #   company-wide specialist rows alongside branch-specific ones.
    #
    #   Third arm (migration 058): a branch manager holds BOTH the Install and
    #   Maintenance id at their city via user_branches (the canonical service-area
    #   table, migration 019). Migration 057 pins each manager's team_members row
    #   to one twin, so the user_branches subquery surfaces them for the other.
    #   The subquery hits idx_user_branches_branch; the table is small.
    #
    # region_id defaults to the caller's region(s). Pass a regions.id to pick
    # another region, or 'all' to show every region. Rows with no resolvable
    # region are included either way. X-Region-Filter reports what was applied.

    @app.get("/api/proposals/config/team-members")
    async def get_proposal_team_members(
        response: Response,
        aspire_branch_id: Optional[int] = Query(default=None),
        team_type: Optional[str] = Query(default=None),
        region_id: Optional[str] = Query(
            default=None,
            description=(
                "crm.regions.id to filter to, or 'all' for every region. "
                "Omit to default to the caller's region(s), from "
                "user_branches joined to branches.region_id. Rows with no "
                "resolvable region are included."
            ),
        ),
        rep_id: Optional[str] = Depends(authz.roster_rep_query),
        user: dict = Depends(require_auth),
    ) -> list:
        owner_id = _scope_roster_read(user, rep_id)
        if owner_id is not None and not authz.is_sales_rep(user.get("role")):
            await _authorize_rep_roster_read(user, owner_id)
        region_ids = await _resolve_region_filter(region_id, user)
        _set_region_filter_header(response, region_ids)
        rows = await _fetch_roster(
            table="team_members",
            order_by="t.sort_order, t.name",
            region_ids=region_ids,
            aspire_branch_id=aspire_branch_id,
            team_type=team_type,
            include_user_branch_twins=True,
            owner_user_id=owner_id,
        )
        return [_team_member_out(r) for r in rows]

    # ── GET /api/proposals/config/client-references ─────────────────────────
    # Returns ClientReference[] with optional aspire_branch_id and region_id
    # filters.
    #
    # Amendment A.6 null-branch-inclusion rule:
    #   When aspire_branch_id is supplied, null-aspire_branch_id (company-wide)
    #   rows are returned IN ADDITION to branch-specific matches.
    #
    # region_id behaves the same as on team-members: default is the caller's
    # region, 'all' disables it, and references with no resolvable region
    # stay in the list. X-Region-Filter reports what was applied.

    @app.get("/api/proposals/config/client-references")
    async def get_proposal_client_references(
        response: Response,
        aspire_branch_id: Optional[int] = Query(default=None),
        region_id: Optional[str] = Query(
            default=None,
            description=(
                "crm.regions.id to filter to, or 'all' for every region. "
                "Omit to default to the caller's region(s), from "
                "user_branches joined to branches.region_id. Rows with no "
                "resolvable region are included."
            ),
        ),
        rep_id: Optional[str] = Depends(authz.roster_rep_query),
        user: dict = Depends(require_auth),
    ) -> list:
        owner_id = _scope_roster_read(user, rep_id)
        if owner_id is not None and not authz.is_sales_rep(user.get("role")):
            await _authorize_rep_roster_read(user, owner_id)
        region_ids = await _resolve_region_filter(region_id, user)
        _set_region_filter_header(response, region_ids)
        rows = await _fetch_roster(
            table="client_references",
            order_by="t.client_since_year DESC",
            region_ids=region_ids,
            aspire_branch_id=aspire_branch_id,
            owner_user_id=owner_id,
        )
        return [_client_reference_out(r) for r in rows]

    # ── GET /api/proposals/config/portfolio ─────────────────────────────────
    # Returns PortfolioProperty[] with optional region_id filter.
    # region_id matches crm.regions.id (e.g. 'east-coast', 'central').

    @app.get("/api/proposals/config/portfolio")
    async def get_proposal_portfolio(
        region_id: Optional[str] = Query(default=None),
        _user: dict = Depends(require_auth),
    ) -> list:
        conditions: list[str] = []
        params: list[Any] = []

        if region_id:
            conditions.append("region_id = %s")
            params.append(region_id)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = await query(
            f"SELECT * FROM portfolio_properties {where} ORDER BY sort_order, name",
            params or None,
        )
        return [_portfolio_property_out(r) for r in rows]

    # ── GET /api/proposals/config/insurance ─────────────────────────────────
    # Returns the single active company-wide insurance certificate. Insurance
    # is always global — no branch-scoped certs are permitted. Returns null
    # when no cert has been seeded; the frontend handles this gracefully with
    # a placeholder on the Insurance page.

    @app.get("/api/proposals/config/insurance")
    async def get_proposal_insurance(
        _user: dict = Depends(require_auth),
    ) -> Optional[dict]:
        # Insurance is always a single company-wide document — no branch scoping.
        rows = await query(
            "SELECT * FROM licenses_certifications "
            "WHERE kind = 'insurance' AND active = 1 AND aspire_branch_id IS NULL "
            "ORDER BY updated_at DESC LIMIT 1",
        )
        if not rows:
            return None
        return _insurance_cert_out(rows[0])

    # ── GET /api/proposals/config/licenses ──────────────────────────────────
    # Company-wide credentials (aspire_branch_id IS NULL) are returned in
    # addition to the requested branch's, never instead (Amendment A.6).
    # is_expired is computed in SQL against CURDATE() so a skewed client clock
    # cannot flip an expired credential back into a client-facing document.

    @app.get("/api/proposals/config/licenses")
    async def get_proposal_licenses(
        aspire_branch_id: Optional[int] = Query(None),
        include_expired: bool = Query(False),
        _user: dict = Depends(require_auth),
    ) -> dict:
        # Handoff 42: insurance kind rows are excluded here — proposals read
        # insurance via GET /api/proposals/config/insurance. License and
        # certification rows are unaffected.
        conditions = ["active = 1", "kind IN ('license', 'certification')"]
        params: list = []
        if aspire_branch_id is not None:
            conditions.append("(aspire_branch_id IS NULL OR aspire_branch_id = %s)")
            params.append(aspire_branch_id)
        else:
            conditions.append("aspire_branch_id IS NULL")
        if not include_expired:
            conditions.append("(expiry_date IS NULL OR expiry_date >= CURDATE())")

        rows = await query(
            "SELECT *, (expiry_date IS NOT NULL AND expiry_date < CURDATE()) AS is_expired "
            "FROM licenses_certifications "
            f"WHERE {' AND '.join(conditions)} "
            "ORDER BY sort_order, name",
            params or None,
        )
        out = [_license_out(r) for r in rows]
        return {
            "licenses": [r for r in out if r["kind"] == "license"],
            "certifications": [r for r in out if r["kind"] == "certification"],
        }

    # ── POST /api/proposals ────────────────────────────────────────────────
    # Body: Omit<ProposalRequest, 'id'|'createdAt'|'updatedAt'>
    #
    # WS2: estimate_id is now optional. A proposal can be generated as soon as a
    # lead exists. When estimate_id is supplied, we still validate that the
    # estimate belongs to this lead (lead_id mismatch → 422). The status=approved
    # gate is intentionally removed — the rep may generate a draft proposal at any
    # point in the estimating lifecycle.
    #
    # On success: inserts into proposal_requests and returns the full
    # ProposalRequest (camelCase) with generated id/timestamps.
    #
    # Re-anchor uploads (Option C, WS2 §3): when estimate_id is supplied, any
    # intake_attachments rows that were uploaded lead-scoped (lead_id = lead_id,
    # estimate_id IS NULL) for the three proposal kinds are re-anchored to the
    # estimate.

    @app.post("/api/proposals", status_code=201)
    async def create_proposal(
        body: dict,
        _user: dict = Depends(require_auth),
    ) -> dict:
        lead_id = body.get("leadId")
        estimate_id = body.get("estimateId") or None  # treat empty string as None
        created_by = body.get("createdBy")
        signer_user_id = body.get("signerUserId")

        # ── Validate required scalar fields (estimate_id is optional) ────
        missing = [f for f, v in [
            ("leadId", lead_id),
            ("createdBy", created_by),
            ("signerUserId", signer_user_id),
        ] if not v]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required fields: {', '.join(missing)}",
            )

        # A proposal is always owned by a lead, and that lead must already
        # point at a canonical property. Orphan packages (no lead, or a lead
        # with a null property_id) are rejected.
        lead_rows = await query(
            "SELECT id, property_id FROM leads WHERE id = %s",
            [lead_id],
        )
        if not lead_rows:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Lead '{lead_id}' was not found. "
                    "Attach this proposal to an existing lead."
                ),
            )
        if not lead_rows[0].get("property_id"):
            raise HTTPException(
                status_code=422,
                detail=(
                    "A property must be attached to the lead before a proposal "
                    "can be created."
                ),
            )

        # ── When estimate_id is supplied, validate it belongs to leadId ──
        if estimate_id:
            est_rows = await query(
                "SELECT id, lead_id FROM estimates WHERE id = %s",
                [estimate_id],
            )
            if est_rows and est_rows[0].get("lead_id") != lead_id:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Estimate '{estimate_id}' does not belong to lead '{lead_id}'. "
                        "Proposal can only be generated for an estimate linked to this lead."
                    ),
                )

        # ── Persist the new proposal request ─────────────────────────────
        proposal_id = _new_proposal_id()
        now = _now_utc()

        # Serialise all JSON columns — Python lists/dicts → JSON strings.
        sections = json.dumps(body.get("sections") or [])
        org_chart = json.dumps(body.get("orgChart") or {})
        startup_plan = json.dumps(body.get("startupPlan") or {})
        team_member_ids = json.dumps(body.get("teamMemberIds") or [])
        exec_team_ids = json.dumps(body.get("executiveTeamMemberIds") or [])
        client_ref_ids = json.dumps(body.get("clientReferenceIds") or [])
        portfolio_ids = json.dumps(body.get("portfolioPropertyIds") or [])

        await execute(
            """INSERT INTO proposal_requests
                 (id, lead_id, estimate_id, created_by, sections, org_chart,
                  startup_plan, team_member_ids, executive_team_member_ids,
                  client_reference_ids, portfolio_property_ids, signer_user_id,
                  created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                proposal_id, lead_id, estimate_id, created_by,
                sections, org_chart, startup_plan,
                team_member_ids, exec_team_ids, client_ref_ids, portfolio_ids,
                signer_user_id,
                now, now,
            ],
        )

        # ── Re-anchor lead-scoped uploads to the estimate (Option C) ─────
        # Re-anchors lead docs to estimate — two separate statements, not transactional.
        # Any proposal documents uploaded while there was no estimate (anchored
        # to lead_id) are linked to the now-known estimate so that
        # append_proposal_documents and the render pipeline find them via
        # estimate_id, not lead_id.
        if estimate_id:
            await execute(
                """UPDATE intake_attachments
                      SET estimate_id = %s
                    WHERE lead_id = %s
                      AND kind IN ('proposal_contract', 'proposal_measurements', 'proposal_other')
                      AND estimate_id IS NULL
                      AND status <> 'deleted'""",
                [estimate_id, lead_id],
            )

        rows = await query(
            "SELECT * FROM proposal_requests WHERE id = %s", [proposal_id]
        )
        return _proposal_request_out(rows[0])

    # ── GET /api/proposals/packages ────────────────────────────────────────
    # Registered before /api/proposals/{proposal_id} so "packages" is not
    # captured as a proposal id. One row per lead — the latest generated
    # proposal — joined to the lead (title, value, status, property) and the
    # latest complete render. Older proposal_requests rows are kept; reopen
    # them through GET /api/proposals?leadId=.

    @app.get("/api/proposals/packages")
    async def list_proposal_packages(
        exclude_status: Optional[str] = Query(default=None),
        _user: dict = Depends(require_auth),
    ) -> list:
        # The Proposals queue asks to omit closed leads. Status values match
        # leads.status (won, lost). Applied here so those rows are never fetched.
        # Grace window: an excluded-status row is still returned if its terminal
        # status_change was recorded within CLOSED_PACKAGE_GRACE_DAYS days, so
        # reps see recently-won/lost proposals for a week before they disappear.
        # The latest-per-lead predicate is AND-ed outside that OR group so an
        # older generation cannot leak back in through the grace window.
        excluded = [s.strip() for s in (exclude_status or "").split(",") if s.strip()]
        params: list[Any] = []
        team_sql = ""
        if authz.is_regional_sales(_user.get("role")):
            uid = _user.get("id")
            team_sql = (
                " AND (l.assigned_to = %s OR l.created_by = %s"
                " OR l.assigned_to IN (SELECT id FROM users WHERE reports_to_user_id = %s)"
                " OR l.created_by IN (SELECT id FROM users WHERE reports_to_user_id = %s))"
                " AND l.branch_id IN ("
                "SELECT st.id FROM sales_territories st"
                " JOIN user_branches ub ON ub.user_id = %s"
                " AND (ub.aspire_branch_id = st.aspire_branch_id_maintenance"
                " OR ub.aspire_branch_id = st.aspire_branch_id_install))"
            )
            params.extend([uid, uid, uid, uid, uid])
        if excluded:
            placeholders = ", ".join(["%s"] * len(excluded))
            where = (
                f"WHERE {_LATEST_PACKAGE_PER_LEAD_SQL}{team_sql}"
                f" AND (l.status NOT IN ({placeholders})"
                " OR COALESCE((SELECT MAX(la.performed_at)"
                "               FROM lead_actions la"
                "              WHERE la.lead_id = l.id"
                "                AND la.action_type = 'status_change'"
                "                AND la.new_status = l.status), '1970-01-01')"
                " >= NOW() - INTERVAL %s DAY)"
            )
            params.extend(excluded)
            params.append(CLOSED_PACKAGE_GRACE_DAYS)
        else:
            where = f"WHERE {_LATEST_PACKAGE_PER_LEAD_SQL}{team_sql}"
        rows = await query(
            f"""
            SELECT
                pr.id,
                pr.lead_id,
                pr.created_at,
                pr.updated_at,
                l.property_name,
                l.property_id,
                l.city,
                l.state,
                l.notes,
                l.handoff_notes,
                l.status AS lead_status,
                l.estimated_contract_value,
                u.id AS assignee_id,
                u.name AS assignee_name,
                u.email AS assignee_email,
                u.role AS assignee_role,
                u.branch_id AS assignee_branch_id,
                u.avatar_initials AS assignee_initials,
                rend.version AS render_version,
                rend.page_count,
                (SELECT MAX(la2.performed_at)
                   FROM lead_actions la2
                  WHERE la2.lead_id = l.id
                    AND la2.action_type = 'status_change'
                    AND la2.new_status = l.status) AS closed_at
            FROM proposal_requests pr
            INNER JOIN leads l
                ON l.id = pr.lead_id AND l.deleted_at IS NULL
            LEFT JOIN users u
                ON u.id = COALESCE(NULLIF(l.assigned_to, ''), pr.created_by)
            LEFT JOIN proposal_renders rend
                ON rend.proposal_id = pr.id
               AND rend.status = 'complete'
               AND rend.version = (
                    SELECT MAX(r2.version)
                    FROM proposal_renders r2
                    WHERE r2.proposal_id = pr.id AND r2.status = 'complete'
               )
            {where}
            ORDER BY pr.updated_at DESC
            """,
            params,
        )
        return [_proposal_package_out(r) for r in _latest_package_per_lead(rows)]

    # ── GET /api/proposals/:id ─────────────────────────────────────────────
    # Reopen / re-edit a persisted proposal.

    @app.get("/api/proposals/{proposal_id}")
    async def get_proposal(
        proposal_id: str,
        _user: dict = Depends(require_auth),
    ) -> dict:
        rows = await query(
            "SELECT * FROM proposal_requests WHERE id = %s", [proposal_id]
        )
        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"Proposal '{proposal_id}' not found.",
            )
        return _proposal_request_out(rows[0])

    # ── GET /api/proposals/:id/signer ──────────────────────────────────────
    # The signer block printed on the intro letter and the thank-you page.
    #
    # This is a route rather than a frontend derivation for two reasons.
    #
    # First, correctness: the office address needs users -> user_branches ->
    # branches, and the frontend cannot make that join. It previously printed
    # COMPANY_INFO.address for every rep because User.branch_id is a legacy
    # string that does not match branches.aspire_branch_id (Handoff 43 §3.2 —
    # user_branches is the mapping, and it already exists).
    #
    # Second, reachability: the headless renderer carries a render-scoped token
    # that is admitted on /api/proposals/{its id}/* and nothing else. The print
    # route used to resolve the signer from GET /api/users, which that token is
    # correctly refused — so every rendered PDF was signed "Your Juniper
    # Representative" regardless of who sent it. Hanging the signer off the
    # proposal fixes that without handing a render token the whole user
    # directory.
    #
    # Fields the DB does not know are returned null, NOT as a company fallback:
    # the company-level default belongs to the frontend, which is where
    # COMPANY_INFO lives.

    @app.get("/api/proposals/{proposal_id}/signer")
    async def get_proposal_signer(
        proposal_id: str,
        _user: dict = Depends(require_auth),
    ) -> dict:
        rows = await query(
            "SELECT signer_user_id, estimate_id FROM proposal_requests WHERE id = %s",
            [proposal_id],
        )
        if not rows:
            raise HTTPException(
                status_code=404, detail=f"Proposal '{proposal_id}' not found."
            )
        signer_user_id = rows[0].get("signer_user_id")
        estimate_id = rows[0].get("estimate_id")

        user_rows = await query(
            "SELECT id, name, email, phone, title FROM users WHERE id = %s",
            [signer_user_id],
        ) if signer_user_id else []
        if not user_rows:
            # A deleted signer must not take the whole document down — the
            # letter renders with the company block instead.
            return _EMPTY_SIGNER

        u = user_rows[0]
        branch_address = await _resolve_signer_office(signer_user_id, estimate_id)

        return {
            "name": u.get("name") or None,
            "title": (u.get("title") or "").strip() or None,
            "phone": (u.get("phone") or "").strip() or None,
            "email": u.get("email") or None,
            "branchAddress": branch_address,
        }

    # ── PATCH /api/proposals/:id ───────────────────────────────────────────
    # Partial update — any subset of the mutable ProposalRequest fields.
    # Always bumps updated_at.

    # Mapping: camelCase body key → snake_case DB column (updatable fields only;
    # id/lead_id/estimate_id/created_by/created_at are immutable after creation).
    _PROPOSAL_UPDATABLE = {
        "sections":               "sections",
        "orgChart":               "org_chart",
        "startupPlan":            "startup_plan",
        "teamMemberIds":          "team_member_ids",
        "executiveTeamMemberIds": "executive_team_member_ids",
        "clientReferenceIds":     "client_reference_ids",
        "portfolioPropertyIds":   "portfolio_property_ids",
        "chapterOrder":           "chapter_order",
        "signerUserId":           "signer_user_id",
    }
    # JSON columns that must be serialised before persisting.
    _PROPOSAL_JSON_COLS = frozenset({
        "sections", "orgChart", "startupPlan",
        "teamMemberIds", "executiveTeamMemberIds",
        "clientReferenceIds", "portfolioPropertyIds",
    })
    # JSON columns that are nullable — None means "clear it back to SQL NULL",
    # not the literal JSON string "null". chapterOrder is not in
    # _PROPOSAL_JSON_COLS: a rep clearing their custom order must write NULL.
    _PROPOSAL_NULLABLE_JSON_COLS = frozenset({"chapterOrder"})

    @app.patch("/api/proposals/{proposal_id}")
    async def patch_proposal(
        proposal_id: str,
        body: dict,
        _user: dict = Depends(require_auth),
    ) -> dict:
        # Confirm the proposal exists first.
        rows = await query(
            "SELECT id FROM proposal_requests WHERE id = %s", [proposal_id]
        )
        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"Proposal '{proposal_id}' not found.",
            )

        # Build the SET clause from the updatable keys present in the body.
        set_parts: list[str] = []
        params: list[Any] = []
        for camel, col in _PROPOSAL_UPDATABLE.items():
            if camel in body:
                set_parts.append(f"{col} = %s")
                value = body[camel]
                # Serialise JSON-typed columns before writing. Nullable JSON
                # columns skip serialisation when the value is None so the
                # column is written as SQL NULL, not the string "null".
                if camel in _PROPOSAL_NULLABLE_JSON_COLS:
                    value = json.dumps(value) if value is not None else None
                elif camel in _PROPOSAL_JSON_COLS:
                    value = json.dumps(value)
                params.append(value)

        # Always bump updated_at — even a no-field PATCH records activity.
        set_parts.append("updated_at = %s")
        params.append(_now_utc())
        params.append(proposal_id)

        await execute(
            f"UPDATE proposal_requests SET {', '.join(set_parts)} WHERE id = %s",
            params,
        )

        updated = await query(
            "SELECT * FROM proposal_requests WHERE id = %s", [proposal_id]
        )
        return _proposal_request_out(updated[0])

    # ── GET /api/proposals/config/media-url?key= ──────────────────────────
    # Short-lived signed GET URL for a proposal config asset (headshot / portfolio
    # photo / insurance cert PDF).  Uses the same GCS signing path as the
    # estimating attachment download-url endpoint (api/attachments.py:signed_get_url).
    # Returns {"url": "https://..."} with an ~10-minute TTL.
    #
    # Note: this endpoint must be declared BEFORE /api/proposals/:id so FastAPI
    # does not match "config" as a proposal id.

    @app.get("/api/proposals/config/media-url")
    async def get_proposal_media_url(
        key: str = Query(...),
        _user: dict = Depends(require_auth),
    ) -> dict:
        if not key:
            raise HTTPException(status_code=400, detail="key is required")
        try:
            from api.attachments import signed_get_url, GCS_CREDENTIALS_BUCKET
            # Use the object key as both the GCS key and the display filename
            # (the signer accepts the last path segment as the filename).
            filename = key.rsplit("/", 1)[-1] if "/" in key else key
            # Credential documents live in GCS_CREDENTIALS_BUCKET; all other
            # assets (headshots, portfolio, etc.) stay in GCS_ATTACHMENTS_BUCKET.
            cred_bucket = GCS_CREDENTIALS_BUCKET if key.startswith("credentials/") else None
            url = signed_get_url(key, filename, bucket=cred_bucket)
            return {"url": url}
        except Exception as exc:
            logger.warning("Failed to sign proposal media URL for key=%s: %s", key, exc)
            raise HTTPException(status_code=502, detail="Could not generate media URL") from exc

    # ── GET /api/proposals?leadId= ─────────────────────────────────────────
    # List all persisted proposals for a lead (so the rep can reopen past ones).
    # The path /api/proposals is intentionally BEFORE /api/proposals/:id above
    # to avoid FastAPI matching the literal string "?" as an id segment.

    @app.get("/api/proposals")
    async def list_proposals(
        lead_id: Optional[str] = Query(default=None, alias="leadId"),
        _user: dict = Depends(require_auth),
    ) -> list:
        if authz.is_regional_sales(_user.get("role")):
            uid = _user.get("id")
            team = (
                "(l.assigned_to = %s OR l.created_by = %s"
                " OR l.assigned_to IN (SELECT id FROM users WHERE reports_to_user_id = %s)"
                " OR l.created_by IN (SELECT id FROM users WHERE reports_to_user_id = %s))"
                " AND l.branch_id IN ("
                "SELECT st.id FROM sales_territories st"
                " JOIN user_branches ub ON ub.user_id = %s"
                " AND (ub.aspire_branch_id = st.aspire_branch_id_maintenance"
                " OR ub.aspire_branch_id = st.aspire_branch_id_install))"
            )
            params = [uid, uid, uid, uid, uid]
            lead_clause = ""
            if lead_id:
                lead_clause = " AND pr.lead_id = %s"
                params.append(lead_id)
            rows = await query(
                f"""SELECT pr.* FROM proposal_requests pr
                    JOIN leads l ON l.id = pr.lead_id
                    WHERE {team}{lead_clause}
                    ORDER BY pr.created_at DESC""",
                params,
            )
        elif lead_id:
            rows = await query(
                "SELECT * FROM proposal_requests WHERE lead_id = %s ORDER BY created_at DESC",
                [lead_id],
            )
        else:
            rows = await query(
                "SELECT * FROM proposal_requests ORDER BY created_at DESC",
            )
        return [_proposal_request_out(r) for r in rows]

    # ── GET /api/proposals/:id/validate ───────────────────────────────────────
    # Standalone pre-render data guard (Handoff 46 §5 Slice C2).
    # Returns 200 {"valid": true} when clean, or 422 with a list of blocking
    # issues when the resolved proposal data contains placeholder values.
    # The render endpoint calls the same guard before launching Chromium.

    @app.get("/api/proposals/{proposal_id}/validate")
    async def validate_proposal(
        proposal_id: str,
        _user: dict = Depends(require_auth),
    ):
        rows = await query(
            "SELECT id FROM proposal_requests WHERE id = %s",
            (proposal_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Proposal not found")

        from api.proposal_validation import validate_proposal_for_render

        issues = await validate_proposal_for_render(proposal_id)
        if issues:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "proposal_data_guard",
                    "message": "Proposal contains placeholder data that must be replaced before rendering",
                    "issues": [
                        {"field": i.field, "value": i.value, "reason": i.reason}
                        for i in issues
                    ],
                },
            )
        return {"valid": True}

    # ── POST /api/proposals/:id/render ────────────────────────────────────────
    # Trigger a server-side headless Chromium PDF render for a proposal.
    # Guard runs before Chromium fires — a 422 aborts before any browser
    # context is created, so there is no cost to an early rejection.
    # Returns the render result with download URL on success.

    @app.post("/api/proposals/{proposal_id}/render")
    async def render_proposal(
        proposal_id: str,
        user: dict = Depends(require_auth),
    ):
        rows = await query(
            "SELECT id, lead_id, estimate_id, team_member_ids, executive_team_member_ids"
            " FROM proposal_requests WHERE id = %s",
            (proposal_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Proposal not found")

        # Pre-send data guard (Handoff 46 §5 Slice C2): block renders that
        # contain placeholder names, fictional 555-01xx phones, or empty
        # company identity env vars. Runs before Chromium is allocated.
        from api.proposal_validation import (
            validate_proposal_for_render,
            proposal_document_warnings,
            proposal_team_bio_warnings,
        )

        guard_issues = await validate_proposal_for_render(proposal_id)
        if guard_issues:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "proposal_data_guard",
                    "message": "Render blocked: proposal contains placeholder data",
                    "issues": [
                        {"field": i.field, "value": i.value, "reason": i.reason}
                        for i in guard_issues
                    ],
                },
            )

        # Non-blocking pre-send warnings (Handoff 47 §7): a missing contract is
        # usually a mistake but a legitimate early-draft case, so it warns rather
        # than blocks. Collected before the render so it can ride the response.
        # WS2: when estimate_id is None, fall back to lead_id for the contract check.
        warnings: list[str] = []
        estimate_id = rows[0].get("estimate_id")
        _lead_id_for_warn = rows[0].get("lead_id")
        if estimate_id:
            warnings = await proposal_document_warnings(estimate_id=estimate_id)
        elif _lead_id_for_warn:
            warnings = await proposal_document_warnings(lead_id=_lead_id_for_warn)

        # Non-blocking bio warnings: each selected team member with an empty bio
        # will render a card without body text — warn so the rep can fill it
        # before sending. Decode both id lists and deduplicate.
        _raw_tm = rows[0].get("team_member_ids") or "[]"
        _raw_exec = rows[0].get("executive_team_member_ids") or "[]"
        try:
            _tm_ids: list[str] = json.loads(_raw_tm) if isinstance(_raw_tm, (str, bytes)) else list(_raw_tm or [])
        except (json.JSONDecodeError, TypeError):
            _tm_ids = []
        try:
            _exec_ids: list[str] = json.loads(_raw_exec) if isinstance(_raw_exec, (str, bytes)) else list(_raw_exec or [])
        except (json.JSONDecodeError, TypeError):
            _exec_ids = []
        _all_tm_ids = list(dict.fromkeys([str(i) for i in _tm_ids + _exec_ids if i]))
        warnings += await proposal_team_bio_warnings(_all_tm_ids)

        try:
            from api.proposal_render import render_proposal_pdf
            from api.proposal_documents import (
                ProposalDocumentDataError,
                ProposalDocumentInfraError,
            )
            result = await render_proposal_pdf(proposal_id, user)
        except ProposalDocumentDataError as exc:
            # A pending/failed attachment row (Handoff 47 §7) — a data problem,
            # named so the rep can fix it. 422, not 503: retrying won't help.
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "proposal_document_guard",
                    "message": str(exc),
                    "issues": [{"field": "documents", "value": "", "reason": str(exc)}],
                },
            )
        except ProposalDocumentInfraError as exc:
            # A GCS read failure appending a document (Handoff 47 §7) — infra,
            # retryable.
            raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "30"})
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "30"})
        except Exception as exc:
            logger.error("Render failed for proposal %s: %s", proposal_id, exc)
            raise HTTPException(status_code=503, detail="Render failed", headers={"Retry-After": "30"})

        return {
            "id": result.id,
            "status": result.status,
            "objectKey": result.object_key,
            "downloadUrl": result.download_url,
            "pageCount": result.page_count,
            "version": result.version,
            "renderedAt": result.rendered_at,
            # Pages whose content was clipped by the fixed 11in sheet. The
            # render still succeeded — the client toasts this so a rep can fix
            # the proposal before sending it, rather than discovering it after.
            "overflowingPages": result.overflowing_pages,
            # One entry per appended proposal document (Handoff 47 §5): the rep
            # can see what landed at the tail without opening the PDF.
            "documentManifest": result.document_manifest,
            # Non-blocking pre-send warnings (Handoff 47 §7), e.g. no contract
            # attached. The render still succeeded.
            "warnings": warnings,
        }

    # ── GET /api/proposals/:id/renders ────────────────────────────────────────
    # List all PDF renders for a proposal, ordered by version DESC.

    @app.get("/api/proposals/{proposal_id}/renders")
    async def list_renders(
        proposal_id: str,
        user: dict = Depends(require_auth),
    ):
        rows = await query(
            """
            SELECT id, proposal_id, version, object_key, page_count, status,
                   error_message, rendered_by, duration_ms, overflowing_pages,
                   created_at
            FROM proposal_renders
            WHERE proposal_id = %s
            ORDER BY version DESC
            """,
            (proposal_id,),
        )
        return [_render_out(r) for r in rows]

    # ── GET /api/proposals/:id/renders/:version/download ──────────────────────
    # Redirect to a short-lived signed GCS URL for the rendered PDF.

    @app.get("/api/proposals/{proposal_id}/renders/{version}/download")
    async def download_render(
        proposal_id: str,
        version: int,
        user: dict = Depends(require_auth),
    ):
        from fastapi.responses import RedirectResponse
        from api.attachments import signed_get_url as _signed_get_url

        rows = await query(
            "SELECT object_key FROM proposal_renders WHERE proposal_id = %s AND version = %s",
            (proposal_id, version),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Render not found")

        url = _signed_get_url(rows[0]["object_key"], f"proposal-v{version}.pdf")
        return RedirectResponse(url=url, status_code=302)
