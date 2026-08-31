"""Proposal Export & Generator API — /api/proposals/* routes (Handoff 37).

Mirrors the api/estimating.py facade pattern exactly:
  * register(app, require_auth) is called from api/server.py
  * DB access via from db import execute, query
  * JSON is camelCase (matches studio/src/types/proposal.ts); DB is snake_case
  * Row mappers convert at the boundary — never trust the DB column order

Slice 3 scope (this file, Amendment A):
  Config read endpoints — project from crm.branches / new proposal config tables:
    GET /api/proposals/config/branches       → BranchProfile[]
    GET /api/proposals/config/team-members   → TeamMember[]  (+ optional filters)
    GET /api/proposals/config/client-references → ClientReference[]
    GET /api/proposals/config/portfolio      → PortfolioProperty[]
    GET /api/proposals/config/insurance      → InsuranceCert (current cert)

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
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query

from db import execute, query

logger = logging.getLogger(__name__)


# ── Operating-roster filter (Amendment A.2) ──────────────────────────────────
# 21 of the 56 crm.branches rows are not real offices (placeholders, training
# branches, holding entities, explicit "DO NOT USE" rows). Filter them out
# consistently across every branches query.

_BRANCH_ROSTER_FILTER = "active = 1 AND branch_name NOT LIKE '%DO NOT USE%'"

# Full exclusion list for reference (these branch_names also fail the filter):
#   '*** PICK A BRANCH ***', 'General Holding', 'Learning & Development',
#   'Contract and Billing', 'Training Branch', 'Training Branch EC',
#   'Golden Palms on Orange River', and 9 variations of "DO NOT USE" in the name.


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


def _branch_profile_out(r: dict) -> dict:
    """Project a crm.branches + crm.regions JOIN row into BranchProfile.

    Returns only rows that have lat/lng populated — the proximity footer needs
    real coordinates. Callers should filter on lat IS NOT NULL before mapping.
    regionId and branchName are from branches; regionId comes from the join.
    """
    return {
        "aspireBranchId": r["aspire_branch_id"],
        "branchName": r["branch_name"],
        "city": r.get("city") or "",
        "regionId": r.get("region_id") or "",
        "address": _build_address(r),
        "lat": float(_num(r["lat"])),
        "lng": float(_num(r["lng"])),
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
    }


def _portfolio_property_out(r: dict) -> dict:
    """Map a portfolio_properties row to PortfolioProperty API shape."""
    photo_keys = r.get("photo_object_keys") or "[]"
    if isinstance(photo_keys, str):
        try:
            photo_keys = json.loads(photo_keys)
        except (json.JSONDecodeError, TypeError):
            photo_keys = []

    before_after = r.get("before_after_object_keys")
    if isinstance(before_after, str):
        try:
            before_after = json.loads(before_after)
        except (json.JSONDecodeError, TypeError):
            before_after = None

    return {
        "id": r["id"],
        "name": r["name"],
        "cityState": r["city_state"],
        # Amendment A.3: regionId (not a union type)
        "regionId": r["region_id"],
        "photoObjectKeys": photo_keys if isinstance(photo_keys, list) else [],
        "beforeAfterObjectKeys": before_after,
        "sortOrder": r["sort_order"],
    }


def _insurance_cert_out(r: dict) -> dict:
    """Map an insurance_certificates row to the API response shape."""
    return {
        "id": r["id"],
        "objectKey": r["object_key"],
        "expiryDate": _iso(r["expiry_date"]),
        "label": r.get("label"),
        "uploadedAt": _iso(r["uploaded_at"]),
    }


# ── ProposalRequest helpers ───────────────────────────────────────────────────

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

    # ── GET /api/proposals/config/branches ─────────────────────────────────
    # Returns BranchProfile[] projected from crm.branches JOIN crm.regions.
    # Operating-roster filter applied (active = 1 AND name NOT LIKE '%DO NOT USE%').
    # Only rows with lat/lng populated are returned — the proximity footer
    # (§2 page 3) needs real coordinates; null-lat rows are skipped.

    @app.get("/api/proposals/config/branches")
    async def get_proposal_branches(
        _user: dict = Depends(require_auth),
    ) -> list:
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
        )
        return [_branch_profile_out(r) for r in rows]

    # ── GET /api/proposals/config/team-members ─────────────────────────────
    # Returns TeamMember[] with optional aspire_branch_id and team_type filters.
    #
    # Amendment A.6 null-branch-inclusion rule:
    #   When aspire_branch_id is supplied, null-aspire_branch_id rows are returned
    #   IN ADDITION to rows matching that branch — not instead of them.
    #   This surfaces the executive roster (team_type='executive') and
    #   company-wide specialist rows alongside branch-specific ones.

    @app.get("/api/proposals/config/team-members")
    async def get_proposal_team_members(
        aspire_branch_id: Optional[int] = Query(default=None),
        team_type: Optional[str] = Query(default=None),
        _user: dict = Depends(require_auth),
    ) -> list:
        conditions: list[str] = ["active = 1"]
        params: list[Any] = []

        if aspire_branch_id is not None:
            # Include branch-specific AND null-branch (company-wide) rows.
            conditions.append("(aspire_branch_id = %s OR aspire_branch_id IS NULL)")
            params.append(aspire_branch_id)

        if team_type:
            conditions.append("team_type = %s")
            params.append(team_type)

        where = "WHERE " + " AND ".join(conditions)
        rows = await query(
            f"SELECT * FROM team_members {where} ORDER BY sort_order, name",
            params or None,
        )
        return [_team_member_out(r) for r in rows]

    # ── GET /api/proposals/config/client-references ─────────────────────────
    # Returns ClientReference[] with optional aspire_branch_id filter.
    #
    # Amendment A.6 null-branch-inclusion rule:
    #   When aspire_branch_id is supplied, null-aspire_branch_id (company-wide)
    #   rows are returned IN ADDITION to branch-specific matches.
    #   Omitting the filter returns all active rows.

    @app.get("/api/proposals/config/client-references")
    async def get_proposal_client_references(
        aspire_branch_id: Optional[int] = Query(default=None),
        _user: dict = Depends(require_auth),
    ) -> list:
        conditions: list[str] = ["active = 1"]
        params: list[Any] = []

        if aspire_branch_id is not None:
            # Include branch-specific AND company-wide (null) rows.
            conditions.append("(aspire_branch_id = %s OR aspire_branch_id IS NULL)")
            params.append(aspire_branch_id)

        where = "WHERE " + " AND ".join(conditions)
        rows = await query(
            f"SELECT * FROM client_references {where} ORDER BY client_since_year DESC",
            params or None,
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
    # Returns the current (most recent by uploaded_at) insurance certificate.
    # The settings handoff admin UI handles upload/renewal. Returns null body
    # (empty list) when no cert has been seeded — the frontend should handle
    # this gracefully (shows a placeholder on the Insurance page).

    @app.get("/api/proposals/config/insurance")
    async def get_proposal_insurance(
        _user: dict = Depends(require_auth),
    ) -> Optional[dict]:
        rows = await query(
            "SELECT * FROM insurance_certificates ORDER BY uploaded_at DESC LIMIT 1",
        )
        if not rows:
            return None
        return _insurance_cert_out(rows[0])

    # ── POST /api/proposals ────────────────────────────────────────────────
    # Body: Omit<ProposalRequest, 'id'|'createdAt'|'updatedAt'>
    #
    # Validation (in order):
    #   1. estimateId exists in estimates table.
    #   2. estimate.lead_id == leadId (the estimate belongs to this lead).
    #   3. estimate.status == 'approved'.
    #
    # On success: inserts into proposal_requests and returns the full
    # ProposalRequest (camelCase) with generated id/timestamps.

    @app.post("/api/proposals", status_code=201)
    async def create_proposal(
        body: dict,
        _user: dict = Depends(require_auth),
    ) -> dict:
        lead_id = body.get("leadId")
        estimate_id = body.get("estimateId")
        created_by = body.get("createdBy")
        signer_user_id = body.get("signerUserId")

        # ── Validate required scalar fields ──────────────────────────────
        missing = [f for f, v in [
            ("leadId", lead_id), ("estimateId", estimate_id),
            ("createdBy", created_by), ("signerUserId", signer_user_id),
        ] if not v]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required fields: {', '.join(missing)}",
            )

        # ── Validate estimate exists, belongs to leadId, and is approved ─
        est_rows = await query(
            "SELECT id, lead_id, status FROM estimates WHERE id = %s",
            [estimate_id],
        )
        if not est_rows:
            raise HTTPException(
                status_code=404,
                detail=f"Estimate '{estimate_id}' not found.",
            )
        est = est_rows[0]

        if est.get("lead_id") != lead_id:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Estimate '{estimate_id}' does not belong to lead '{lead_id}'. "
                    "Proposal can only be generated for an estimate linked to this lead."
                ),
            )

        if est.get("status") != "approved":
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Estimate '{estimate_id}' has status '{est.get('status')}'; "
                    "only 'approved' estimates can be used to generate a proposal."
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

        rows = await query(
            "SELECT * FROM proposal_requests WHERE id = %s", [proposal_id]
        )
        return _proposal_request_out(rows[0])

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
        "signerUserId":           "signer_user_id",
    }
    # JSON columns that must be serialised before persisting.
    _PROPOSAL_JSON_COLS = frozenset({
        "sections", "orgChart", "startupPlan",
        "teamMemberIds", "executiveTeamMemberIds",
        "clientReferenceIds", "portfolioPropertyIds",
    })

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
                # Serialise JSON-typed columns before writing.
                if camel in _PROPOSAL_JSON_COLS:
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
            from api.attachments import signed_get_url
            # Use the object key as both the GCS key and the display filename
            # (the signer accepts the last path segment as the filename).
            filename = key.rsplit("/", 1)[-1] if "/" in key else key
            url = signed_get_url(key, filename)
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
        if lead_id:
            rows = await query(
                "SELECT * FROM proposal_requests WHERE lead_id = %s ORDER BY created_at DESC",
                [lead_id],
            )
        else:
            rows = await query(
                "SELECT * FROM proposal_requests ORDER BY created_at DESC",
            )
        return [_proposal_request_out(r) for r in rows]
