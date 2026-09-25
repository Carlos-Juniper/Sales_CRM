"""
FastAPI server for the Juniper Landscaping CRM.
Serves the studio/ frontend; reads/writes GCP Cloud SQL (MySQL) via aiomysql.
Auth uses JWT cookies (no session table).

Run with:
    uvicorn api.server:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import jwt
from dotenv import load_dotenv
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()
logger = logging.getLogger(__name__)

from contextlib import asynccontextmanager

from api import authz
from db import (
    query, execute, _in_clause,
    set_hoa_property_status,
    count_active_leads_for_property,
    has_won_lead_for_property,
    close_pool,
)
from api import authz
SESSION_DURATION = 28800  # 8 hours in seconds
JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"

_ALLOWED_ORIGINS = {"http://localhost:5174", "http://localhost:5173"}
_extra_origins = os.environ.get("CORS_EXTRA_ORIGINS", "")
if _extra_origins:
    _ALLOWED_ORIGINS.update(o.strip() for o in _extra_origins.split(",") if o.strip())

@asynccontextmanager
async def lifespan(app):
    # Schema migrations are applied via scripts/migrate.py before each deploy,
    # not at app boot.
    sweep_tasks = []
    # Durability sweep for best-effort Aspire pushes — only when sync is enabled,
    # so tests and standalone runs never spawn it.
    if os.environ.get("ASPIRE_SYNC_ENABLED", "false").strip().lower() in ("1", "true", "yes"):
        from api.estimating import sweep_loop
        sweep_tasks.append(asyncio.create_task(sweep_loop()))
    # Beam reconciler — recovery for callbacks Attentive dead-lettered after its
    # own 24h retry window. Read-only against Attentive; it can never order.
    if os.environ.get("BEAM_SYNC_ENABLED", "false").strip().lower() in ("1", "true", "yes"):
        from api.beam_sync import sweep_loop as beam_sweep_loop
        sweep_tasks.append(asyncio.create_task(beam_sweep_loop()))
    # Headless Chromium for server-side PDF rendering — only when explicitly enabled.
    # Tests must NOT set PDF_RENDER_ENABLED so no browser is spawned during pytest.
    if os.environ.get("PDF_RENDER_ENABLED", "").strip().lower() in ("1", "true", "yes"):
        from api.proposal_render import start_browser
        await start_browser()
    try:
        yield
    finally:
        for task in sweep_tasks:
            task.cancel()
        from api.proposal_render import stop_browser
        await stop_browser()
        await close_pool()


app = FastAPI(title="Juniper CRM API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception: %s %s", request.method, request.url.path)
    origin = request.headers.get("origin", "")
    headers: dict[str, str] = {}
    if origin in _ALLOWED_ORIGINS:
        headers["access-control-allow-origin"] = origin
        headers["access-control-allow-credentials"] = "true"
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=headers,
    )


# ── Type coercion ────────────────────────────────────────────────────────────

_JSON_COLS = frozenset({"score_factors", "raw_data"})
_ALLOWED_SORT = frozenset({"score", "created_at", "estimated_contract_value", "bid_deadline"})

_LEAD_TYPES: dict[str, str] = {
    "status": "STRING", "assigned_to": "STRING", "notes": "STRING",
    "priority": "INT64", "property_name": "STRING", "lead_type": "STRING",
    "address": "STRING", "city": "STRING", "state": "STRING", "zip": "STRING",
    "bid_deadline": "DATE", "estimated_acreage": "FLOAT64", "units": "INT64",
    "estimated_contract_value": "FLOAT64", "contact_name": "STRING",
    "contact_email": "STRING", "handoff_notes": "STRING", "division_id": "INT64",
    "property_id": "STRING",
}


def _coerce_row(row: dict) -> dict:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif k in _JSON_COLS and isinstance(v, str):
            try:
                out[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                out[k] = v
        elif k in _JSON_COLS and isinstance(v, (dict, list)):
            out[k] = v
        else:
            out[k] = v
    return out


async def _fetch_lead(lead_id: str) -> dict:
    rows = await query(
        "SELECT * FROM leads WHERE id = %s AND deleted_at IS NULL",
        [lead_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Lead not found")
    return _coerce_row(rows[0])


# ── Request / response models ────────────────────────────────────────────────

# leads.notes is TEXT. 10_000 characters stays under the utf8mb4 TEXT byte
# ceiling (65,535) for a first-touch note.
LEAD_NOTES_MAX_LENGTH = 10_000


def _lead_notes_for_insert(notes: Optional[str]) -> Optional[str]:
    """Store blank notes as NULL so create matches a lead with no notes yet."""
    if notes is None:
        return None
    stripped = notes.strip()
    return stripped or None


class CreateLeadBody(BaseModel):
    property_name: str
    city: str
    state: str
    lead_type: str
    address: Optional[str] = None
    estimated_contract_value: Optional[float] = None
    estimated_acreage: Optional[float] = None
    units: Optional[int] = None
    status: str = "new"
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    # Canonical properties.id — optional: manual leads may have none.
    property_id: Optional[str] = None
    # WS1: branch the lead belongs to (from the branch picker in AddLeadModal).
    branch_id: Optional[str] = None
    # Same column the lead-detail Notes section edits via PATCH (leads.notes).
    # Omitted, null, or blank stores NULL. The lead row's created_by and
    # created_at are the creator and timestamp; notes itself is one text field.
    notes: Optional[str] = Field(default=None, max_length=LEAD_NOTES_MAX_LENGTH)


class PatchLeadBody(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None
    priority: Optional[int] = None
    property_name: Optional[str] = None
    lead_type: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    bid_deadline: Optional[str] = None
    estimated_acreage: Optional[float] = None
    units: Optional[int] = None
    estimated_contract_value: Optional[float] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    handoff_notes: Optional[str] = None
    division_id: Optional[int] = None
    # Canonical properties.id. The proposal generator requires this to be set.
    property_id: Optional[str] = None
    performed_by: Optional[str] = None


class MsGraphTokenBody(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    scope: str = ""


class CalendarEventCreateBody(BaseModel):
    subject: str
    start_iso: str
    end_iso: str
    attendees: list[str] = []
    body: Optional[str] = None
    online_meeting: bool = True


class CalendarEventUpdateBody(BaseModel):
    subject: Optional[str] = None
    start_iso: Optional[str] = None
    end_iso: Optional[str] = None
    attendees: Optional[list[str]] = None
    body: Optional[str] = None


class ScheduleMeetingBody(BaseModel):
    subject: str
    start_iso: str
    end_iso: str
    attendees: list[str] = []
    body: Optional[str] = None
    online_meeting: bool = True


class CreateBidBody(BaseModel):
    lead_id: str
    estimated_value: float
    title: Optional[str] = None
    agency: Optional[str] = None
    branch_id: Optional[str] = None
    notes: Optional[str] = None


class PatchBidBody(BaseModel):
    status: Optional[str] = None
    estimated_value: Optional[float] = None
    notes: Optional[str] = None


class CreateHOAPropertyBody(BaseModel):
    property_name: str
    association_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: str = "FL"
    zip: Optional[str] = None
    county: Optional[str] = None
    acreage: Optional[float] = None        # stored as estimated_acreage
    units: Optional[int] = None
    status: str = "Prospect"
    branch_id: Optional[str] = None
    management_company_id: Optional[str] = None


class PMContactBody(BaseModel):
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class CreateManagementCompanyBody(BaseModel):
    company_name: str                       # stored as name
    website: Optional[str] = None
    phone: Optional[str] = None
    street: Optional[str] = None           # stored as mailing_address
    city: Optional[str] = None             # stored as mailing_city
    state: str = "FL"                      # stored as mailing_state
    zip: Optional[str] = None              # stored as mailing_zip
    primary_email: Optional[str] = None   # stored as contact_email
    branch_id: Optional[str] = None
    contacts: list[PMContactBody] = []


class PatchManagementCompanyBody(BaseModel):
    company_name: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    primary_email: Optional[str] = None
    branch_id: Optional[str] = None
    assigned_to: Optional[str] = None
    status: Optional[str] = None
    last_contacted: Optional[str] = None
    contact_status: Optional[str] = None


class PatchHoaPropertyBody(BaseModel):
    status: Optional[str] = None
    management_company_id: Optional[str] = None
    assigned_to: Optional[str] = None
    last_contacted: Optional[str] = None
    contact_status: Optional[str] = None
    branch_id: Optional[str] = None
    # Location and identity fields
    property_name: Optional[str] = None
    association_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    county: Optional[str] = None
    estimated_acreage: Optional[float] = None
    units: Optional[int] = None


class AddPMContactBody(BaseModel):
    name: str
    title: Optional[str] = None   # stored in `role` column
    email: Optional[str] = None
    phone: Optional[str] = None


class PatchPMContactBody(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None   # stored in `role` column
    email: Optional[str] = None
    phone: Optional[str] = None


# ── Auth dependency ──────────────────────────────────────────────────────────

async def require_auth(
    request: Request,
    session: Optional[str] = Cookie(default=None),
) -> dict:
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT_SECRET not configured")
    try:
        payload = jwt.decode(session, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    # ── Render-token scope guard ─────────────────────────────────────────────
    # Render tokens are short-lived (120 s) JWTs with scope="proposal_render".
    # They are only valid for:
    #   • GET requests
    #   • /api/proposals/config/... (config look-up routes, no proposal-id check)
    #   • /api/proposals/{their proposal_id} and sub-paths
    #   • /api/leads/{their lead_id} and /api/estimating/estimates/{their
    #     estimate_id} — exact paths, no sub-paths. The print route blocks on
    #     both before it sets __PROPOSAL_READY__, so denying them means every
    #     render times out. Pinned to the ids named in the token: a render token
    #     still cannot read any other lead or estimate.
    # Any other use → 403.
    if payload.get("scope") == "proposal_render":
        if request.method != "GET":
            raise HTTPException(
                status_code=403,
                detail="Render token not valid for this resource",
            )
        path = request.url.path
        # Config routes are always allowed (check first so "config" is not
        # mistaken for a proposal_id).
        if path.startswith("/api/proposals/config/"):
            return payload
        # Proposal-scoped routes: must match the token's proposal_id exactly.
        pid = payload.get("proposal_id", "")
        pattern = rf"^/api/proposals/{re.escape(pid)}(/.*)?$"
        if pid and re.match(pattern, path):
            return payload
        # The proposal's own lead and estimate — exact paths only.
        lead_id = payload.get("lead_id") or ""
        estimate_id = payload.get("estimate_id") or ""
        if lead_id and path == f"/api/leads/{lead_id}":
            return payload
        if estimate_id and path == f"/api/estimating/estimates/{estimate_id}":
            return payload
        raise HTTPException(
            status_code=403,
            detail="Render token not valid for this resource",
        )

    return payload


# ── Estimating ───────────────────────────────────────────────────────────────
# Routes live in api/estimating.py; registered here so they share require_auth.
from api import estimating as _estimating  # noqa: E402
from api import properties as _properties  # noqa: E402
from api import beam_routes as _beam_routes  # noqa: E402
from api import proposals as _proposals    # noqa: E402
from api import settings as _settings      # noqa: E402
from api import commissions as _commissions  # noqa: E402
from api import sales_performance as _sales_performance  # noqa: E402

_estimating.register(app, require_auth)
_properties.register(app, require_auth)
# Beam also registers /webhooks/attentive, deliberately OUTSIDE require_auth:
# Attentive cannot send auth headers, so that route gates on a URL query token.
_beam_routes.register(app, require_auth)
_proposals.register(app, require_auth)
_settings.register(app, require_auth)
_commissions.register(app, require_auth)
_sales_performance.register(app, require_auth)


# ── Leads ────────────────────────────────────────────────────────────────────

@app.get("/api/leads")
async def list_leads(
    status: Optional[str] = None,
    lead_type: Optional[str] = None,
    lead_types: Optional[str] = None,
    search: Optional[str] = None,
    states: Optional[str] = None,
    min_score: Optional[int] = None,
    property_id: Optional[str] = None,
    sources: Optional[str] = None,
    mine: bool = False,
    unassigned_only: bool = False,
    sort_by: str = "score",
    sort_dir: str = "desc",
    page: int = 1,
    page_size: int = Query(default=25, le=100),
    _user: dict = Depends(require_auth),
) -> dict:
    authz.require_not_estimating_only(_user, "leads")
    # unassigned_only is the public qualification queue, not "my leads".
    if unassigned_only and authz.hides_public_lead_queue(_user):
        authz.require_public_leads_access(_user)

    if sort_by not in _ALLOWED_SORT:
        sort_by = "score"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    conditions: list[str] = ["deleted_at IS NULL"]
    params: list[Any] = []

    if status:
        conditions.append("status = %s")
        params.append(status)

    if lead_types:
        types = [t.strip() for t in lead_types.split(",") if t.strip()]
        if types:
            placeholders, vals = _in_clause(types)
            conditions.append(f"lead_type IN ({placeholders})")
            params.extend(vals)
    elif lead_type:
        conditions.append("lead_type = %s")
        params.append(lead_type)

    if search:
        conditions.append("LOWER(property_name) LIKE LOWER(%s)")
        params.append(f"%{search}%")

    if states:
        state_list = [s.strip() for s in states.split(",") if s.strip()]
        if state_list:
            placeholders, vals = _in_clause(state_list)
            conditions.append(f"state IN ({placeholders})")
            params.extend(vals)

    if sources:
        source_list = [s.strip() for s in sources.split(",") if s.strip()]
        if source_list:
            placeholders, vals = _in_clause(source_list)
            conditions.append(f"source IN ({placeholders})")
            params.extend(vals)

    # User-scoped book of leads. The identity comes from the JWT, never from a
    # client-supplied param (BRD I-9.5) — `mine` is a boolean switch, not an id.
    # Field-sales roles (sales, maintenance_sales, install_sales, and legacy
    # outside_sales) are always scoped, even when the client omits ?mine=true.
    # The pipeline board and the analytics cards call this list that way.
    # Admin, manager-type, and inside_sales keep the wider list.
    owner_sql, owner_params = authz.own_lead_filter(_user)
    if mine or owner_sql:
        conditions.append(authz.OWN_LEAD_PREDICATE)
        params.extend(owner_params or [_user["id"], _user["id"]])

    # Public Leads review queue: once a rep assigns a lead to a CRM it moves to
    # that CRM's "My Leads" (mine=true) and should drop out of the shared queue.
    # Never deleted — assigned_to alone gates queue membership.
    if unassigned_only:
        conditions.append("assigned_to IS NULL")

    # Sales and every other non-qualifier still list their own leads, but the
    # unassigned government queue stays inside sales / admin / management.
    if authz.hides_public_lead_queue(_user):
        placeholders = ", ".join(["%s"] * len(authz.PUBLIC_LEAD_SOURCES))
        conditions.append(f"NOT (source IN ({placeholders}) AND assigned_to IS NULL)")
        params.extend(list(authz.PUBLIC_LEAD_SOURCES))

    if min_score is not None:
        conditions.append("score >= %s")
        params.append(min_score)

    # Property engagement: look up the lead(s) hanging off one
    # canonical properties.id ("Request estimate" gating + intake lead context).
    if property_id:
        conditions.append("property_id = %s")
        params.append(property_id)

    where = f"WHERE {' AND '.join(conditions)}"
    offset = (page - 1) * page_size

    count_rows = await query(f"SELECT COUNT(*) AS cnt FROM leads {where}", list(params))
    total = int(count_rows[0]["cnt"]) if count_rows else 0

    data_params = list(params) + [page_size, offset]
    rows = await query(
        f"SELECT * FROM leads {where} ORDER BY {sort_by} {sort_dir} LIMIT %s OFFSET %s",
        data_params,
    )

    return {
        "data": [_coerce_row(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if page_size > 0 else 0,
    }


@app.get("/api/leads/{lead_id}")
async def get_lead(lead_id: str, _user: dict = Depends(require_auth)) -> dict:
    authz.require_not_estimating_only(_user, "leads")
    lead = await _fetch_lead(lead_id)
    authz.require_lead_access(_user, lead.get("source"), lead.get("assigned_to"))
    authz.require_own_lead(_user, lead)
    return lead


@app.post("/api/leads", status_code=201)
async def create_lead(body: CreateLeadBody, _user: dict = Depends(require_auth)) -> dict:
    authz.require_not_estimating_only(_user, "leads")
    new_id = str(uuid.uuid4())

    # WS1 auto-property safety net: if no property_id was supplied, create a
    # canonical 'manual' property row so the lead always has a linked property.
    # Uses INSERT ... ON DUPLICATE KEY UPDATE (unique key uq_prop_source on
    # source_type+source_id) so re-submits are idempotent.
    property_id = body.property_id
    if property_id is None:
        property_id = str(uuid.uuid4())
        await execute(
            """
            INSERT INTO properties
                (id, name, source_type, source_id, address1, city, state,
                 aspire_sync_status, created_at, updated_at)
            VALUES
                (%s, %s, 'manual', %s, %s, %s, %s,
                 'pending', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
                updated_at = CURRENT_TIMESTAMP()
            """,
            [
                property_id,
                body.property_name,
                new_id,           # source_id = lead_id so re-submits hit the unique key
                body.address or '',
                body.city,
                body.state,
            ],
        )

    await execute(
        """
        INSERT INTO leads
            (id, source, lead_type, property_name, address, city, state,
             estimated_contract_value, estimated_acreage, units, status,
             contact_name, contact_email, property_id, branch_id, notes,
             created_by, created_at, updated_at)
        VALUES
            (%s, 'manual', %s, %s, %s, %s, %s,
             %s, %s, %s, %s,
             %s, %s, %s, %s, %s,
             %s, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            new_id,
            body.lead_type,
            body.property_name,
            body.address,
            body.city,
            body.state,
            body.estimated_contract_value,
            body.estimated_acreage,
            body.units,
            body.status,
            body.contact_name,
            body.contact_email,
            property_id,
            body.branch_id,
            _lead_notes_for_insert(body.notes),
            _user["id"],
        ],
    )
    return await _fetch_lead(new_id)


@app.patch("/api/leads/{lead_id}")
async def patch_lead(lead_id: str, body: PatchLeadBody, _user: dict = Depends(require_auth)) -> dict:
    authz.require_not_estimating_only(_user, "leads")
    current = await _fetch_lead(lead_id)
    authz.require_lead_access(_user, current.get("source"), current.get("assigned_to"))
    authz.require_own_lead(_user, current)

    _PATCHABLE = frozenset({
        "status", "assigned_to", "notes", "priority",
        "property_name", "lead_type", "address", "city", "state", "zip", "bid_deadline",
        "estimated_acreage", "units", "estimated_contract_value",
        "contact_name", "contact_email", "handoff_notes", "division_id",
        "property_id",
    })
    data = body.model_dump(exclude_none=True)
    performed_by = data.pop("performed_by", None)

    updates = [(f, v) for f, v in data.items() if f in _PATCHABLE]
    if not updates:
        return current

    if "bid_deadline" in data and isinstance(data["bid_deadline"], str):
        try:
            data["bid_deadline"] = date.fromisoformat(data["bid_deadline"])
            updates = [(f, data[f] if f == "bid_deadline" else v) for f, v in updates]
        except ValueError:
            pass

    set_clause = ", ".join(f"{f} = %s" for f, _ in updates)
    # Coerce values to correct Python types for aiomysql
    coerced_vals: list[Any] = []
    for f, v in updates:
        t = _LEAD_TYPES.get(f, "STRING")
        if t == "INT64":
            coerced_vals.append(int(v) if v is not None else None)
        elif t == "FLOAT64":
            coerced_vals.append(float(v) if v is not None else None)
        else:
            coerced_vals.append(v)
    coerced_vals.append(lead_id)

    await execute(
        f"UPDATE leads SET {set_clause}, updated_at = CURRENT_TIMESTAMP() WHERE id = %s",
        coerced_vals,
    )

    new_status = data.get("status")
    if new_status and new_status != current.get("status"):
        # Reverse-lookup: lead → canonical property → (if the
        # property came from an HOA prospect) hoa_properties via source_id.
        prop_id = current.get("property_id")
        if prop_id and new_status == "won":
            prop_rows = await query(
                "SELECT source_type, source_id FROM properties WHERE id = %s",
                [prop_id],
            )
            if (
                prop_rows
                and prop_rows[0].get("source_type") == "hoa"
                and prop_rows[0].get("source_id")
            ):
                await set_hoa_property_status(prop_rows[0]["source_id"], "won")
            # "lost" no longer auto-downgrades the property — status is managed manually
        await execute(
            """
            INSERT INTO lead_actions
                (lead_id, action_type, prev_status, new_status, performed_by, performed_at)
            VALUES
                (%s, 'status_change', %s, %s, %s, CURRENT_TIMESTAMP())
            """,
            [
                lead_id,
                current.get("status"),
                new_status,
                performed_by,
            ],
        )

    return await _fetch_lead(lead_id)


@app.delete("/api/leads/{lead_id}", status_code=204)
async def delete_lead(lead_id: str, _user: dict = Depends(require_auth)) -> None:
    authz.require_not_estimating_only(_user, "leads")
    lead = await _fetch_lead(lead_id)
    authz.require_lead_access(_user, lead.get("source"), lead.get("assigned_to"))
    authz.require_own_lead(_user, lead)
    await execute(
        "UPDATE leads SET deleted_at = CURRENT_TIMESTAMP() WHERE id = %s AND deleted_at IS NULL",
        [lead_id],
    )
    # Property status is managed manually — deleting a lead does not auto-downgrade it


# ── Outreach ─────────────────────────────────────────────────────────────────

async def _record_lead_action(
    *,
    lead_id: str,
    action_type: str,
    detail: Optional[str],
    performed_by: Optional[str],
    external_message_id: Optional[str],
) -> None:
    """Insert a row into lead_actions (id auto-assigned by MySQL)."""
    await execute(
        """
        INSERT INTO lead_actions
            (lead_id, action_type, detail, performed_by, performed_at, external_message_id)
        VALUES
            (%s, %s, %s, %s, CURRENT_TIMESTAMP(), %s)
        """,
        [
            lead_id,
            action_type,
            detail,
            performed_by,
            external_message_id,
        ],
    )



# ── Activity feed ────────────────────────────────────────────────────────────

_ACTION_TO_CHANNEL_FULL: dict[str, str] = {
    "note_added": "note",
    "meeting_scheduled": "meeting",
    "meeting_cancelled": "meeting",
}


@app.get("/api/leads/{lead_id}/activity")
async def get_lead_activity(lead_id: str, _user: dict = Depends(require_auth)) -> list:
    """Unified activity feed across all channels."""
    authz.require_not_estimating_only(_user, "leads")
    # Missing leads keep the historical empty feed. A public-queue row is
    # refused for roles that cannot qualify those leads. Field sales
    # (sales, maintenance_sales, install_sales) are limited to assigned_to
    # or created_by.
    meta = await query(
        "SELECT source, assigned_to, created_by FROM leads WHERE id = %s AND deleted_at IS NULL",
        [lead_id],
    )
    if meta:
        authz.require_lead_access(_user, meta[0].get("source"), meta[0].get("assigned_to"))
        authz.require_own_lead(_user, meta[0])
    rows = await query(
        """
        SELECT * FROM lead_actions
        WHERE lead_id = %s
        ORDER BY performed_at DESC
        """,
        [lead_id],
    )
    return [
        {
            "id": str(r["id"]),
            "channel": _ACTION_TO_CHANNEL_FULL.get(r["action_type"], r["action_type"]),
            "direction": "out",
            "body": r.get("detail") or "",
            "performed_by": r.get("performed_by") or "",
            "performed_at": (
                r["performed_at"].isoformat()
                if isinstance(r["performed_at"], datetime)
                else str(r["performed_at"])
            ),
            "external_message_id": r.get("external_message_id"),
        }
        for r in rows
        if r["action_type"] in _ACTION_TO_CHANNEL_FULL
    ]


# ── Settings / connections ────────────────────────────────────────────────────


@app.get("/api/settings/connections")
async def get_connections(_user: dict = Depends(require_auth)) -> dict:
    """Returns Microsoft Graph connection status.

    Uses the same token-row lookup as calendar Graph calls (JWT id, then email)
    so Settings and Calendar cannot disagree about whether Graph is connected.
    """
    from api import graph as _graph

    try:
        graph_connected = await _graph.has_graph_connection(
            _user.get("id", ""),
            _user.get("email"),
        )
    except Exception:
        graph_connected = False

    return {"graph": {"connected": graph_connected}}



# ── HOA Properties ───────────────────────────────────────────────────────────

_HOA_JSON_COLS = frozenset({"raw_data"})


def _shape_hoa_row(row: dict) -> dict:
    """Coerce types and rename DB columns to frontend-expected names."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif k in _HOA_JSON_COLS and isinstance(v, str):
            try:
                out[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                out[k] = v
        elif k in _HOA_JSON_COLS and isinstance(v, (dict, list)):
            out[k] = v
        else:
            out[k] = v
    # Rename DB columns to frontend-expected names
    out["acreage"] = out.get("estimated_acreage")
    out["branch"] = out.get("branch_id")
    return out


async def _fetch_hoa_property(hoa_property_id: str) -> dict:
    rows = await query(
        "SELECT * FROM hoa_properties WHERE id = %s",
        [hoa_property_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="HOA property not found")
    return _shape_hoa_row(rows[0])


@app.get("/api/hoa-properties/filter-options")
async def hoa_filter_options(_user: dict = Depends(require_auth)) -> dict:
    rows = await query(
        "SELECT DISTINCT city, branch_id FROM hoa_properties WHERE city IS NOT NULL ORDER BY city"
    )
    cities = sorted({r["city"] for r in rows if r.get("city")})
    branches = sorted({r["branch_id"] for r in rows if r.get("branch_id")})
    return {"cities": cities, "branches": branches}


@app.get("/api/hoa-properties")
async def list_hoa_properties(
    state: Optional[str] = None,
    status: Optional[str] = None,       # comma-separated for multi-select: "Prospect,Active"
    branch_id: Optional[str] = None,    # comma-separated: "Central,South"
    city: Optional[str] = None,         # comma-separated: "Orlando,Tampa"
    search: Optional[str] = None,
    min_acreage: Optional[float] = None,
    page: int = 1,
    page_size: int = Query(default=25, le=1000),
    _user: dict = Depends(require_auth),
) -> dict:
    conditions: list[str] = []
    params: list[Any] = []

    if state:
        conditions.append("state = %s")
        params.append(state.upper())
    if status:
        vals = [s.strip() for s in status.split(",") if s.strip()]
        if vals:
            placeholders, pvals = _in_clause(vals)
            conditions.append(f"status IN ({placeholders})")
            params.extend(pvals)
    if branch_id:
        vals = [s.strip() for s in branch_id.split(",") if s.strip()]
        if vals:
            placeholders, pvals = _in_clause(vals)
            conditions.append(f"branch_id IN ({placeholders})")
            params.extend(pvals)
    if city:
        vals = [s.strip() for s in city.split(",") if s.strip()]
        if vals:
            placeholders, pvals = _in_clause(vals)
            conditions.append(f"city IN ({placeholders})")
            params.extend(pvals)
    if search:
        conditions.append(
            "(LOWER(property_name) LIKE LOWER(%s)"
            " OR LOWER(COALESCE(association_name,'')) LIKE LOWER(%s)"
            " OR LOWER(COALESCE(city,'')) LIKE LOWER(%s))"
        )
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    if min_acreage is not None:
        conditions.append("estimated_acreage >= %s")
        params.append(min_acreage)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size

    count_rows = await query(f"SELECT COUNT(*) AS cnt FROM hoa_properties {where}", list(params))
    total = int(count_rows[0]["cnt"]) if count_rows else 0

    data_params = list(params) + [page_size, offset]
    rows = await query(
        f"SELECT * FROM hoa_properties {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
        data_params,
    )

    return {
        "data": [_shape_hoa_row(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if page_size > 0 else 0,
    }


_ALLOWED_HOA_STATUSES = frozenset({"Prospect", "Bidding", "Active", "At Risk", "Lost"})


@app.post("/api/hoa-properties", status_code=201)
async def create_hoa_property(
    body: CreateHOAPropertyBody,
    _user: dict = Depends(require_auth),
) -> dict:
    if body.status not in _ALLOWED_HOA_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{body.status}'")
    user_id = _user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user id")
    new_id = str(uuid.uuid4())
    # parcel_id and arcgis_source are NOT NULL in schema — use sentinel values for manual entries
    await execute(
        """
        INSERT INTO hoa_properties
            (id, property_name, association_name, address, city, state, zip, county,
             estimated_acreage, units, status, branch_id, management_company_id,
             assigned_to, contact_status, parcel_id, arcgis_source,
             created_at, updated_at)
        VALUES
            (%s, %s, %s, %s, %s, %s, %s, %s,
             %s, %s, %s, %s, %s,
             %s, 'uncontacted', %s, 'manual',
             CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            new_id,
            body.property_name,
            body.association_name,
            body.address,
            body.city,
            body.state,
            body.zip,
            body.county,
            body.acreage,
            body.units,
            body.status,
            body.branch_id,
            body.management_company_id,
            user_id,
            f"manual-{new_id}",
        ],
    )
    return await _fetch_hoa_property(new_id)


@app.post("/api/hoa-properties/{hoa_property_id}/promote", status_code=201)
async def promote_hoa_property(
    hoa_property_id: str,
    _user: dict = Depends(require_auth),
) -> dict:
    from api.pipeline import promote_hoa_to_lead
    try:
        lead = await promote_hoa_to_lead(hoa_property_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _coerce_row(lead.to_dict())


_HOA_PATCHABLE = frozenset({
    "status", "management_company_id",
    "assigned_to", "last_contacted", "contact_status",
    "branch_id",
    "property_name", "association_name",
    "address", "city", "state", "zip", "county",
    "estimated_acreage", "units",
})
_HOA_TYPES: dict[str, str] = {
    "status": "STRING",
    "management_company_id": "STRING",
    "assigned_to": "STRING",
    "last_contacted": "DATE",
    "contact_status": "STRING",
    "branch_id": "STRING",
    "property_name": "STRING",
    "association_name": "STRING",
    "address": "STRING",
    "city": "STRING",
    "state": "STRING",
    "zip": "STRING",
    "county": "STRING",
    "estimated_acreage": "NUMERIC",
    "units": "INT64",
}


@app.patch("/api/hoa-properties/{hoa_property_id}")
async def patch_hoa_property(
    hoa_property_id: str,
    body: PatchHoaPropertyBody,
    _user: dict = Depends(require_auth),
) -> dict:
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates = [(f, v) for f, v in data.items() if f in _HOA_PATCHABLE]
    if not updates:
        raise HTTPException(status_code=400, detail="No patchable fields provided")

    if "last_contacted" in data:
        try:
            date.fromisoformat(str(data["last_contacted"]))
        except ValueError:
            raise HTTPException(status_code=400, detail="last_contacted must be a valid ISO date (YYYY-MM-DD)")

    existing = await query(
        "SELECT id FROM hoa_properties WHERE id = %s",
        [hoa_property_id],
    )
    if not existing:
        raise HTTPException(status_code=404, detail="HOA property not found")

    set_clause = ", ".join(f"{f} = %s" for f, _ in updates)
    coerced_vals: list[Any] = []
    for f, v in updates:
        t = _HOA_TYPES.get(f, "STRING")
        if t == "INT64":
            coerced_vals.append(int(v) if v is not None else None)
        elif t in ("NUMERIC", "FLOAT64"):
            coerced_vals.append(float(v) if v is not None else None)
        else:
            coerced_vals.append(v)
    coerced_vals.append(hoa_property_id)

    await execute(
        f"UPDATE hoa_properties SET {set_clause}, updated_at = CURRENT_TIMESTAMP() WHERE id = %s",
        coerced_vals,
    )
    return await _fetch_hoa_property(hoa_property_id)


# ── Management Companies ─────────────────────────────────────────────────────

# Maps PatchManagementCompanyBody field names to DB column names where they differ.
_MGMT_FIELD_TO_COL: dict[str, str] = {
    "company_name": "name",
    "street": "mailing_address",
    "city": "mailing_city",
    "state": "mailing_state",
    "zip": "mailing_zip",
    "primary_email": "contact_email",
}

_MGMT_COL_TYPES: dict[str, str] = {
    "name": "STRING",
    "website": "STRING",
    "phone": "STRING",
    "mailing_address": "STRING",
    "mailing_city": "STRING",
    "mailing_state": "STRING",
    "mailing_zip": "STRING",
    "contact_email": "STRING",
    "branch_id": "STRING",
    "assigned_to": "STRING",
    "status": "STRING",
    "last_contacted": "DATE",
    "contact_status": "STRING",
}


def _shape_mgmt_row(row: dict, contacts: list[dict] | None = None) -> dict:
    """Map DB column names to frontend-expected field names."""
    return {
        "id": row.get("id"),
        "company_name": row.get("name"),
        "website": row.get("website"),
        "phone": row.get("phone"),
        "street": row.get("mailing_address"),
        "city": row.get("mailing_city"),
        "state": row.get("mailing_state"),
        "zip": row.get("mailing_zip"),
        "primary_email": row.get("contact_email"),
        "branch_id": row.get("branch_id"),
        "assigned_to": row.get("assigned_to"),
        "status": row.get("status"),
        "last_contacted": row.get("last_contacted").isoformat() if isinstance(row.get("last_contacted"), date) else row.get("last_contacted"),
        "contact_status": row.get("contact_status"),
        "created_at": row.get("created_at").isoformat() if isinstance(row.get("created_at"), datetime) else row.get("created_at"),
        "updated_at": row.get("updated_at").isoformat() if isinstance(row.get("updated_at"), datetime) else row.get("updated_at"),
        "contacts": contacts if contacts is not None else [],
    }


def _shape_contact_row(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "name": row.get("contact_name"),
        "title": row.get("role"),
        "email": row.get("email"),
        "phone": row.get("phone"),
    }


@app.get("/api/management-companies")
async def list_management_companies(
    search: Optional[str] = None,
    branch_id: Optional[str] = None,
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    page: int = 1,
    page_size: int = Query(default=50, le=5000),
    _user: dict = Depends(require_auth),
) -> dict:
    conditions: list[str] = []
    params: list[Any] = []

    if search:
        conditions.append("LOWER(name) LIKE LOWER(%s)")
        params.append(f"%{search}%")
    if branch_id:
        conditions.append("branch_id = %s")
        params.append(branch_id)
    if status:
        conditions.append("status = %s")
        params.append(status)
    if assigned_to:
        conditions.append("assigned_to = %s")
        params.append(assigned_to)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size

    count_rows = await query(
        f"SELECT COUNT(*) AS cnt FROM property_management_companies {where}",
        list(params),
    )
    total = int(count_rows[0]["cnt"]) if count_rows else 0

    data_params = list(params) + [page_size, offset]
    rows = await query(
        f"SELECT * FROM property_management_companies {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
        data_params,
    )

    # Batch-fetch contacts for all returned companies to avoid N+1 queries
    contacts_by_company: dict[str, list[dict]] = {}
    if rows:
        company_ids = [r["id"] for r in rows]
        placeholders, pvals = _in_clause(company_ids)
        contact_rows = await query(
            f"""
            SELECT * FROM hoa_contact_information
            WHERE management_company_id IN ({placeholders})
            ORDER BY id ASC
            """,
            pvals,
        )
        for cr in contact_rows:
            cid = cr["management_company_id"]
            contacts_by_company.setdefault(cid, []).append(_shape_contact_row(cr))

    items = [_shape_mgmt_row(r, contacts_by_company.get(r["id"], [])) for r in rows]

    return {
        "data": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if page_size > 0 else 0,
    }


@app.post("/api/management-companies", status_code=201)
async def create_management_company(
    body: CreateManagementCompanyBody,
    _user: dict = Depends(require_auth),
) -> dict:
    user_id = _user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user id")
    new_id = str(uuid.uuid4())
    await execute(
        """
        INSERT INTO property_management_companies
            (id, name, website, phone, mailing_address, mailing_city, mailing_state,
             mailing_zip, contact_email, branch_id, assigned_to, status, contact_status,
             created_at, updated_at)
        VALUES
            (%s, %s, %s, %s, %s, %s, %s,
             %s, %s, %s, %s, 'Target', 'uncontacted',
             CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            new_id,
            body.company_name,
            body.website,
            body.phone,
            body.street,
            body.city,
            body.state,
            body.zip,
            body.primary_email,
            body.branch_id,
            user_id,
        ],
    )

    # Insert each contact that has at least a name or email
    for contact in body.contacts:
        if not (contact.name or "").strip() and not (contact.email or "").strip():
            continue
        await execute(
            """
            INSERT INTO hoa_contact_information
                (management_company_id, contact_name, role, email, phone, source, created_at)
            VALUES
                (%s, %s, %s, %s, %s, 'manual', CURRENT_TIMESTAMP())
            """,
            [
                new_id,
                contact.name,
                contact.title,
                contact.email or None,
                contact.phone,
            ],
        )

    # Fetch the newly created company row
    company_rows = await query(
        "SELECT * FROM property_management_companies WHERE id = %s",
        [new_id],
    )
    contact_rows = await query(
        """
        SELECT * FROM hoa_contact_information
        WHERE management_company_id = %s ORDER BY id ASC
        """,
        [new_id],
    )
    contacts = [_shape_contact_row(cr) for cr in contact_rows]
    return _shape_mgmt_row(company_rows[0], contacts)


@app.patch("/api/management-companies/{company_id}")
async def patch_management_company(
    company_id: str,
    body: PatchManagementCompanyBody,
    _user: dict = Depends(require_auth),
) -> dict:
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    _PATCHABLE = frozenset({
        "company_name", "website", "phone", "street", "city", "state", "zip",
        "primary_email", "branch_id", "assigned_to", "status",
        "last_contacted", "contact_status",
    })
    updates_raw = [(f, v) for f, v in data.items() if f in _PATCHABLE]
    if not updates_raw:
        raise HTTPException(status_code=400, detail="No patchable fields provided")

    if "last_contacted" in data:
        try:
            date.fromisoformat(str(data["last_contacted"]))
        except ValueError:
            raise HTTPException(status_code=400, detail="last_contacted must be a valid ISO date (YYYY-MM-DD)")

    existing = await query(
        "SELECT id FROM property_management_companies WHERE id = %s",
        [company_id],
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Management company not found")

    # Translate body field names to DB column names
    updates_db = [(_MGMT_FIELD_TO_COL.get(f, f), v) for f, v in updates_raw]

    set_clause = ", ".join(f"{col} = %s" for col, _ in updates_db)
    db_vals = [v for _, v in updates_db]
    db_vals.append(company_id)

    await execute(
        f"UPDATE property_management_companies SET {set_clause}, updated_at = CURRENT_TIMESTAMP() WHERE id = %s",
        db_vals,
    )

    company_rows = await query(
        "SELECT * FROM property_management_companies WHERE id = %s",
        [company_id],
    )
    contact_rows = await query(
        """
        SELECT * FROM hoa_contact_information
        WHERE management_company_id = %s ORDER BY id ASC
        """,
        [company_id],
    )
    contacts = [_shape_contact_row(cr) for cr in contact_rows]
    return _shape_mgmt_row(company_rows[0], contacts)


@app.post("/api/management-companies/{company_id}/contacts")
async def add_management_company_contact(
    company_id: str,
    body: AddPMContactBody,
    _user: dict = Depends(require_auth),
) -> dict:
    existing = await query(
        "SELECT id FROM property_management_companies WHERE id = %s",
        [company_id],
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Management company not found")

    await execute(
        """
        INSERT INTO hoa_contact_information
            (management_company_id, contact_name, role, email, phone, source, created_at)
        VALUES
            (%s, %s, %s, %s, %s, 'manual', CURRENT_TIMESTAMP())
        """,
        [
            company_id,
            body.name,
            body.title,
            body.email,
            body.phone,
        ],
    )

    company_rows = await query(
        "SELECT * FROM property_management_companies WHERE id = %s",
        [company_id],
    )
    contact_rows = await query(
        """
        SELECT * FROM hoa_contact_information
        WHERE management_company_id = %s ORDER BY id ASC
        """,
        [company_id],
    )
    contacts = [_shape_contact_row(cr) for cr in contact_rows]
    return _shape_mgmt_row(company_rows[0], contacts)


@app.patch("/api/management-companies/{company_id}/contacts/{contact_id}")
async def patch_management_company_contact(
    company_id: str,
    contact_id: int,
    body: PatchPMContactBody,
    _user: dict = Depends(require_auth),
) -> dict:
    existing_company = await query(
        "SELECT id FROM property_management_companies WHERE id = %s",
        [company_id],
    )
    if not existing_company:
        raise HTTPException(status_code=404, detail="Management company not found")

    existing_contact = await query(
        """
        SELECT id FROM hoa_contact_information
        WHERE id = %s AND management_company_id = %s
        """,
        [contact_id, company_id],
    )
    if not existing_contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Map body field names to DB column names
    _CONTACT_FIELD_TO_COL = {"name": "contact_name", "title": "role"}
    updates = [(_CONTACT_FIELD_TO_COL.get(f, f), v) for f, v in data.items()]

    set_clause = ", ".join(f"{col} = %s" for col, _ in updates)
    db_vals = [v for _, v in updates]
    db_vals.extend([contact_id, company_id])

    await execute(
        f"""
        UPDATE hoa_contact_information
        SET {set_clause}
        WHERE id = %s AND management_company_id = %s
        """,
        db_vals,
    )

    company_rows = await query(
        "SELECT * FROM property_management_companies WHERE id = %s",
        [company_id],
    )
    contact_rows = await query(
        """
        SELECT * FROM hoa_contact_information
        WHERE management_company_id = %s ORDER BY id ASC
        """,
        [company_id],
    )
    contacts = [_shape_contact_row(cr) for cr in contact_rows]
    return _shape_mgmt_row(company_rows[0], contacts)


@app.delete("/api/management-companies/{company_id}/contacts/{contact_id}")
async def delete_management_company_contact(
    company_id: str,
    contact_id: int,
    _user: dict = Depends(require_auth),
) -> dict:
    existing_company = await query(
        "SELECT id FROM property_management_companies WHERE id = %s",
        [company_id],
    )
    if not existing_company:
        raise HTTPException(status_code=404, detail="Management company not found")

    existing_contact = await query(
        """
        SELECT id FROM hoa_contact_information
        WHERE id = %s AND management_company_id = %s
        """,
        [contact_id, company_id],
    )
    if not existing_contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    await execute(
        """
        DELETE FROM hoa_contact_information
        WHERE id = %s AND management_company_id = %s
        """,
        [contact_id, company_id],
    )

    company_rows = await query(
        "SELECT * FROM property_management_companies WHERE id = %s",
        [company_id],
    )
    contact_rows = await query(
        """
        SELECT * FROM hoa_contact_information
        WHERE management_company_id = %s ORDER BY id ASC
        """,
        [company_id],
    )
    contacts = [_shape_contact_row(cr) for cr in contact_rows]
    return _shape_mgmt_row(company_rows[0], contacts)


@app.get("/api/contacts")
async def list_contacts(_user: dict = Depends(require_auth)) -> list:
    rows = await query(
        """
        SELECT
            c.id,
            c.contact_name,
            c.role,
            c.email,
            m.name          AS company_name,
            m.mailing_city  AS city,
            m.mailing_state AS state
        FROM hoa_contact_information c
        JOIN property_management_companies m
          ON c.management_company_id = m.id
        WHERE c.email IS NOT NULL
        ORDER BY c.contact_name
        """,
        [],
    )
    return [
        {
            "id": str(r["id"]),
            "name": r["contact_name"] or "",
            "title": r["role"] or "",
            "email": r["email"] or "",
            "company": r["company_name"] or "",
            "city": r["city"] or "",
            "state": r["state"] or "",
            "type": "commercial",
        }
        for r in rows
    ]


# ── Bids ─────────────────────────────────────────────────────────────────────

@app.get("/api/bids")
async def list_bids(
    lead_id: Optional[str] = None,
    status: Optional[str] = None,
    _user: dict = Depends(require_auth),
) -> list:
    conditions: list[str] = []
    params: list[Any] = []
    if lead_id:
        conditions.append("lead_id = %s")
        params.append(lead_id)
    if status:
        conditions.append("status = %s")
        params.append(status)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = await query(f"SELECT * FROM bids {where}", params or ())
    return [_coerce_row(r) for r in rows]


@app.post("/api/bids", status_code=201)
async def create_bid(body: CreateBidBody, _user: dict = Depends(require_auth)) -> dict:
    new_id = str(uuid.uuid4())
    await execute(
        """
        INSERT INTO bids
            (id, lead_id, estimated_value, status, title, agency, branch_id, notes,
             created_at, updated_at)
        VALUES
            (%s, %s, %s, 'pending', %s, %s, %s, %s,
             CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            new_id,
            body.lead_id,
            body.estimated_value,
            body.title,
            body.agency,
            body.branch_id,
            body.notes,
        ],
    )
    rows = await query("SELECT * FROM bids WHERE id = %s", [new_id])
    return _coerce_row(rows[0])


@app.patch("/api/bids/{bid_id}")
async def patch_bid(bid_id: str, body: PatchBidBody, _user: dict = Depends(require_auth)) -> dict:
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    existing = await query("SELECT id FROM bids WHERE id = %s", [bid_id])
    if not existing:
        raise HTTPException(status_code=404, detail="Bid not found")

    _BID_TYPES = {"status": "STRING", "estimated_value": "FLOAT64", "notes": "STRING"}
    set_clause = ", ".join(f"{f} = %s" for f in data)
    coerced_vals: list[Any] = []
    for f, v in data.items():
        t = _BID_TYPES.get(f, "STRING")
        if t == "FLOAT64":
            coerced_vals.append(float(v) if v is not None else None)
        else:
            coerced_vals.append(v)
    coerced_vals.append(bid_id)

    await execute(
        f"UPDATE bids SET {set_clause}, updated_at = CURRENT_TIMESTAMP() WHERE id = %s",
        coerced_vals,
    )

    # When a bid moves to 'pursuing', mark the linked HOA property as contacted
    from api.pipeline import set_property_contacted

    new_bid_status = data.get("status")
    if new_bid_status == "pursuing":
        bid_rows = await query(
            "SELECT lead_id FROM bids WHERE id = %s",
            [bid_id],
        )
        if bid_rows:
            lead_id_for_bid = bid_rows[0].get("lead_id")
            if lead_id_for_bid:
                lead_rows = await query(
                    "SELECT property_id FROM leads WHERE id = %s",
                    [lead_id_for_bid],
                )
                # Reverse-lookup: lead → canonical property → (if
                # HOA-sourced) hoa_properties via source_id.
                prop_id = lead_rows[0].get("property_id") if lead_rows else None
                if prop_id:
                    prop_rows = await query(
                        "SELECT source_type, source_id FROM properties WHERE id = %s",
                        [prop_id],
                    )
                    if (
                        prop_rows
                        and prop_rows[0].get("source_type") == "hoa"
                        and prop_rows[0].get("source_id")
                    ):
                        await set_property_contacted(prop_rows[0]["source_id"])

    rows = await query("SELECT * FROM bids WHERE id = %s", [bid_id])
    return _coerce_row(rows[0])


# ── Users ────────────────────────────────────────────────────────────────────

@app.get("/api/users")
async def list_users(
    role: Optional[str] = None,
    branch_id: Optional[str] = None,
    _user: dict = Depends(require_auth),
) -> list:
    """List users, enriched with active, aspireRepId, and branches[].

    Additive enrichment over the original id/name/email/role/branch_id/avatar_initials
    response — existing callers are unaffected. branches[] is the set of
    aspire_branch_ids from user_branches, returned via GROUP_CONCAT subquery so
    the list remains a single DB round-trip.

    Filter rules:
      - ?role=<r>: restrict to that role AND active=1 (assignee pickers must
        exclude deactivated reps; Slice 6 deactivates, never deletes).
        `GET /api/users?role=sales` (and `?role=outside_sales`, the same
        alias) is the sales-role group: stored roles sales, outside_sales,
        inside_sales, maintenance_sales, install_sales, regional_sales_rep,
        and vp_sales. That is the Settings rep dropdown, the commission /
        sales-performance rep selectors, and the lead-assignee picker. Each item's
        `id` is the `rep_id` (alias `user_id`) to pass when marketing or
        admin reads or writes that rep's client references and team roster.
        Any other value, including `?role=inside_sales` or
        `?role=maintenance_sales`, stays an exact match of that one role.
      - plain GET: returns ALL rows including inactive so historical name lookups
        on old estimates still resolve.
    """
    conditions: list[str] = []
    params: list[Any] = []
    if role:
        # role=sales is the sales-role group (see docstring). Every other
        # role stays an exact match so an admin filter for one persona
        # does not widen.
        if authz.normalize_role(role) == "sales":
            placeholders = ", ".join(["%s"] * len(authz.SALES_REP_DB_ROLES))
            conditions.append(f"role IN ({placeholders})")
            params.extend(authz.SALES_REP_DB_ROLES)
        else:
            conditions.append("role = %s")
            params.append(role)
        # A role filter drives the assignee pickers (e.g. ?role=sales for the
        # lead-assignee picker, §2.8), so it must exclude DEACTIVATED users:
        # Slice 6 deactivates instead of deleting, and a deactivated rep must
        # not be assignable. A plain listing (no role) keeps returning inactive
        # rows so historical name lookups still resolve.
        conditions.append("active = 1")
    if branch_id:
        conditions.append("branch_id = %s")
        params.append(branch_id)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    # GROUP_CONCAT subquery for user_branches — avoids an N+1 per-user query.
    # The subquery returns NULL when there are no rows; we parse that below.
    rows = await query(
        f"""SELECT u.id, u.name, u.email, u.role, u.branch_id, u.avatar_initials,
                   u.active, u.aspire_rep_id,
                   (SELECT GROUP_CONCAT(ub.aspire_branch_id ORDER BY ub.aspire_branch_id)
                      FROM user_branches ub WHERE ub.user_id = u.id) AS aspire_branch_ids
              FROM users u {where}""",
        params or None,
    )

    result = []
    for r in rows:
        raw_ids = r.get("aspire_branch_ids")
        if raw_ids:
            branches: list[int] = [int(x) for x in str(raw_ids).split(",") if x]
        else:
            branches = []
        result.append({
            "id": r["id"],
            "name": r["name"],
            "email": r["email"],
            "role": r["role"],
            "branch_id": r.get("branch_id"),
            "avatar_initials": r.get("avatar_initials"),
            "active": bool(r.get("active", 1)),
            "aspireRepId": r.get("aspire_rep_id"),
            "branches": branches,
        })
    return result


# ── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard/inside-sales")
async def dashboard_inside_sales(_user: dict = Depends(require_auth)) -> dict:
    # Admin and management only. Field sales and inside_sales are 403 here,
    # matching the analytics allowlist. The own-lead predicate stays so a
    # role that is both allowed on this dashboard and a field-sales rep
    # would still see only its book.
    authz.require_analytics_dashboard(_user)
    owner_sql, owner_params = authz.own_lead_filter(_user)
    scope = f" AND {owner_sql}" if owner_sql else ""

    def _dash(sql: str):
        if scope:
            sql = sql.replace("deleted_at IS NULL", f"deleted_at IS NULL{scope}", 1)
        return query(sql, list(owner_params) if owner_params else None)

    total_rows, new_rows, status_rows, avg_rows, state_rows = await asyncio.gather(
        _dash("SELECT COUNT(*) AS cnt FROM leads WHERE deleted_at IS NULL"),
        _dash("SELECT COUNT(*) AS cnt FROM leads WHERE status = 'new' AND deleted_at IS NULL"),
        _dash("SELECT status, COUNT(*) AS cnt FROM leads WHERE deleted_at IS NULL GROUP BY status"),
        _dash("SELECT AVG(score) AS avg_score FROM leads WHERE score IS NOT NULL AND deleted_at IS NULL"),
        _dash("SELECT state, COUNT(*) AS cnt FROM leads WHERE deleted_at IS NULL GROUP BY state ORDER BY cnt DESC"),
    )
    avg_val = avg_rows[0]["avg_score"] if avg_rows and avg_rows[0]["avg_score"] is not None else 0.0
    return {
        "total_leads": int(total_rows[0]["cnt"]) if total_rows else 0,
        "new_leads": int(new_rows[0]["cnt"]) if new_rows else 0,
        "leads_by_status": {r["status"]: int(r["cnt"]) for r in status_rows},
        "avg_score": round(float(avg_val), 1),
        "leads_by_state": {r["state"]: int(r["cnt"]) for r in state_rows},
    }


# ── Auth ─────────────────────────────────────────────────────────────────────

def _session_user(user: dict) -> dict:
    """Public session user. `allowed_intake_types` is derived, not stored on the JWT."""
    from api import authz

    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "branch_id": user["branch_id"],
        "avatar_initials": user["avatar_initials"],
        # Aspire ContactID for defaulting an opportunity's SalesRepContactID; may be
        # null until the one-time backfill runs. .get keeps pre-backfill rows working.
        "aspire_rep_id": user.get("aspire_rep_id"),
        "allowed_intake_types": authz.allowed_intake_types(user.get("role")),
    }


def _issue_jwt(user: dict, response: Response) -> dict:
    payload = {
        **_session_user(user),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=SESSION_DURATION),
    }
    # The intake flag is derived from role on every response. Keep it out of the
    # cookie so a role already on the token picks up the flag without re-login,
    # and so the claim set stays the identity fields require_auth already trusts.
    token_payload = {k: v for k, v in payload.items() if k != "allowed_intake_types"}
    token = jwt.encode(token_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_DURATION,
    )
    return {k: v for k, v in payload.items() if k != "exp"}


@app.post("/api/proposals/{proposal_id}/render-token")
async def issue_render_token(
    proposal_id: str,
    user: dict = Depends(require_auth),
) -> dict:
    """Mint a short-lived (120 s) render-scoped JWT for a specific proposal.

    The caller must hold a normal session cookie.  The returned token may be
    used only for GET requests against /api/proposals/<proposal_id>/... and
    /api/proposals/config/... routes.
    """
    authz.require_proposals_access(user)
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT_SECRET not configured")
    payload = {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "branch_id": user["branch_id"],
        "scope": "proposal_render",
        "proposal_id": proposal_id,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=120),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"token": token}


def _avatar_initials(name: str) -> str:
    """First letter of the first two words, uppercased (crm_users caps at 5)."""
    parts = [p for p in name.split() if p]
    initials = "".join(p[0] for p in parts[:2]).upper()
    return initials[:5]


class EntraCallbackBody(BaseModel):
    id_token: str


@app.post("/api/auth/entra-callback")
async def entra_callback(body: EntraCallbackBody, response: Response) -> dict:
    client_id = os.environ["ENTRA_CLIENT_ID"]
    tenant_id = os.environ["ENTRA_TENANT_ID"]

    try:
        jwks_uri = f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
        jwks_client = jwt.PyJWKClient(jwks_uri)
        signing_key = jwks_client.get_signing_key_from_jwt(body.id_token)
        claims = jwt.decode(
            body.id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="SSO token expired")
    except Exception as exc:
        logger.error("Entra ID token validation failed", exc_info=True)
        raise HTTPException(status_code=401, detail="Invalid SSO token")

    email = (claims.get("email") or claims.get("preferred_username") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="No email in Entra ID token")

    return _issue_jwt(await _user_for_email(email), response)


async def _user_for_email(email: str) -> dict:
    """Resolve a provisioned CRM user by email, or 403.

    Matched case-insensitively — the casing Entra puts in the token is not under
    our control, and Slice 6 provisions users from a directory pick that may
    differ in case from what the token carries.
    """
    rows = await query(
        "SELECT id, name, email, role, branch_id, avatar_initials FROM users WHERE LOWER(email) = %s",
        [email],
    )
    if not rows:
        raise HTTPException(status_code=403, detail="User not provisioned. Contact your administrator.")
    return rows[0]


class EntraCompleteBody(BaseModel):
    code: str
    code_verifier: str
    redirect_uri: str


@app.post("/api/auth/entra-complete")
async def entra_complete(body: EntraCompleteBody, response: Response) -> dict:
    """Redeem the Entra authorization code server-side and open a session.

    Replaces the browser-side token exchange. The redemption has to happen here
    for Graph to work at all: a code redeemed by browser JavaScript yields a
    SPA-bound refresh token that no server can redeem (AADSTS9002327), which is
    why Calendar and Mail could never refresh and looped on "reconnect".

    One round trip does both jobs — opens the CRM session and stores the Graph
    tokens — so there is no separate /auth/ms-graph-token call during sign-in.
    That endpoint stays for the Settings reconnect flow.
    """
    from api import graph as _graph

    result = _graph.exchange_code(body.code, body.code_verifier, body.redirect_uri)

    # MSAL validates the id_token signature, issuer and audience against the
    # authority before populating id_token_claims, and the response arrives over
    # TLS straight from Microsoft, so no second JWKS round trip is needed here.
    claims = result.get("id_token_claims") or {}
    email = (claims.get("email") or claims.get("preferred_username") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="No email in Entra ID token")

    user = await _user_for_email(email)

    # Graph storage is best-effort: a KMS or DB failure must not cost the user
    # their sign-in. They land in the app and hit the reconnect prompt instead.
    refresh_token = result.get("refresh_token")
    if refresh_token:
        try:
            await _graph.store_tokens(
                user["id"],
                access_token=result["access_token"],
                refresh_token=refresh_token,
                expires_in=result.get("expires_in", 3600),
                scope=result.get("scope", ""),
            )
        except Exception:
            logger.error("Graph token storage failed for user %s", user["id"], exc_info=True)
    else:
        # offline_access was not consented, so Graph works until the access
        # token expires and then prompts a reconnect. Sign-in is unaffected.
        logger.warning("Entra returned no refresh_token for %s", email)

    return _issue_jwt(user, response)


@app.post("/api/auth/ms-graph-token")
async def store_ms_graph_token(body: MsGraphTokenBody, user: dict = Depends(require_auth)) -> dict:
    """Store or refresh the user's Microsoft Graph OAuth tokens."""
    from api import graph as _graph
    await _graph.store_tokens(
        user["id"],
        access_token=body.access_token,
        refresh_token=body.refresh_token,
        expires_in=body.expires_in,
        scope=body.scope,
    )
    return {"ok": True}


@app.delete("/api/auth/ms-graph-token")
async def delete_ms_graph_token(user: dict = Depends(require_auth)) -> dict:
    """Remove the user's Microsoft Graph tokens, disconnecting their account."""
    from db import execute as _execute
    await _execute(
        "DELETE FROM user_graph_tokens WHERE user_id = %s",
        [user["id"]],
    )
    return {"ok": True}


@app.post("/api/auth/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(key="session")
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user: dict = Depends(require_auth)) -> dict:
    """Current session. `role` is the JWT claim; `allowed_intake_types` is derived.

    The intake list is computed here (not stored on the token) so existing
    sessions gain it on the next /me without a new login. It follows the JWT
    role, the same staleness as every other non-approver route.
    """
    from api import authz

    return {
        **user,
        "allowed_intake_types": authz.allowed_intake_types(user.get("role")),
    }


# ── Calendar ─────────────────────────────────────────────────────────────────

async def _graph_call(coro):
    """Await a Microsoft Graph coroutine with connection-aware error mapping.

    ``GraphNotConnected`` (no token row) → HTTP 400, which Calendar treats as
    the “connect your account” empty state.

    ``GraphTokenRefreshFailed`` is also a ValueError subclass, but a token row
    *does* exist — Settings correctly shows Connected. Mapping that to 400 made
    Calendar ask the user to connect in a loop. Surface it as 502 instead so
    the UI shows retry, not a reconnect prompt.

    Other ValueErrors stay 400 for backward compatibility.
    """
    from api.graph import GraphNotConnected, GraphTokenRefreshFailed

    try:
        return await coro
    except GraphNotConnected as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except GraphTokenRefreshFailed as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/calendar/events")
async def calendar_list_events(
    start: str,
    end: str,
    user: dict = Depends(require_auth),
) -> list:
    from api import graph as _graph
    return await _graph_call(
        _graph.list_events(user["id"], start, end, user.get("email"))
    )


@app.post("/api/calendar/events")
async def calendar_create_event(
    body: CalendarEventCreateBody,
    user: dict = Depends(require_auth),
) -> dict:
    from api import graph as _graph
    return await _graph_call(
        _graph.create_event(
            user["id"],
            subject=body.subject,
            start_iso=body.start_iso,
            end_iso=body.end_iso,
            attendees=body.attendees,
            body=body.body,
            online_meeting=body.online_meeting,
            email=user.get("email"),
        )
    )


@app.patch("/api/calendar/events/{event_id}")
async def calendar_update_event(
    event_id: str,
    body: CalendarEventUpdateBody,
    user: dict = Depends(require_auth),
) -> dict:
    from api import graph as _graph
    return await _graph_call(
        _graph.update_event(
            user["id"],
            event_id,
            subject=body.subject,
            start_iso=body.start_iso,
            end_iso=body.end_iso,
            attendees=body.attendees,
            body=body.body,
            email=user.get("email"),
        )
    )


@app.delete("/api/calendar/events/{event_id}", status_code=204)
async def calendar_delete_event(
    event_id: str,
    user: dict = Depends(require_auth),
) -> None:
    from api import graph as _graph
    await _graph_call(_graph.delete_event(user["id"], event_id, email=user.get("email")))

    rows = await query(
        """
        SELECT lead_id, detail FROM lead_actions
        WHERE action_type = 'meeting_scheduled' AND external_message_id = %s
        LIMIT 1
        """,
        [event_id],
    )
    if rows:
        await _record_lead_action(
            lead_id=rows[0]["lead_id"],
            action_type="meeting_cancelled",
            detail=rows[0]["detail"],
            performed_by=user["id"],
            external_message_id=event_id,
        )


@app.post("/api/leads/{lead_id}/schedule-meeting")
async def schedule_lead_meeting(
    lead_id: str,
    body: ScheduleMeetingBody,
    user: dict = Depends(require_auth),
) -> dict:
    """Create a calendar event and record a meeting_scheduled lead action."""
    from api import graph as _graph

    authz.require_not_estimating_only(user, "leads")
    lead = await _fetch_lead(lead_id)
    authz.require_lead_access(user, lead.get("source"), lead.get("assigned_to"))
    authz.require_own_lead(user, lead)

    event = await _graph_call(
        _graph.create_event(
            user["id"],
            subject=body.subject,
            start_iso=body.start_iso,
            end_iso=body.end_iso,
            attendees=body.attendees,
            body=body.body,
            online_meeting=body.online_meeting,
            email=user.get("email"),
        )
    )

    event_id = event.get("id", "")

    await _record_lead_action(
        lead_id=lead_id,
        action_type="meeting_scheduled",
        detail=body.subject,
        performed_by=user["id"],
        external_message_id=event_id,
    )

    return {"event": event, "lead_id": lead_id}


# ── Proposal asset proxy ─────────────────────────────────────────────────────
#
# Streams brand photography (headshots, service photos) from a private GCS
# bucket through the Cloud Run service account so the bucket never needs
# allUsers:objectViewer.  No auth required — the headless renderer and the
# browser both call this as a plain <img src>.
#
# Allowed prefixes are the only three sets uploaded by upload_proposal_assets.py.
# Anything else gets a 404 so we never proxy arbitrary bucket contents.

_PROPOSAL_ASSETS_BUCKET: str = os.environ.get(
    "PROPOSAL_ASSETS_BUCKET", "juniper-crm-proposal-assets"
)
_ALLOWED_ASSET_PREFIXES = (
    "proposal/photos/",
    "proposal/portfolio/",
    "proposal/headshots/",
)


@app.get("/proposal-assets/{path:path}")
async def serve_proposal_asset(path: str) -> Response:
    if not any(path.startswith(p) for p in _ALLOWED_ASSET_PREFIXES):
        raise HTTPException(status_code=404)
    # GCS keys are literal strings — no filesystem traversal — so `..` in
    # a key just means a blob whose name contains `..`, not a directory escape.
    # Safe by GCS semantics; noted here so a future filesystem-backed swap is
    # not silently assumed safe.
    from api.attachments import _gcs
    from google.cloud.exceptions import NotFound
    try:
        blob = _gcs().bucket(_PROPOSAL_ASSETS_BUCKET).blob(path)
        data = blob.download_as_bytes()
        content_type = blob.content_type or "application/octet-stream"
    except NotFound:
        raise HTTPException(status_code=404)
    except Exception as exc:
        logger.warning("proposal-asset proxy error for %r: %s", path, exc)
        raise HTTPException(status_code=404)
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ── Frontend (SPA) ───────────────────────────────────────────────────────────

_DIST_DIR = Path(__file__).parent.parent / "dist"

if _DIST_DIR.is_dir():
    _assets_dir = _DIST_DIR / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        candidate = _DIST_DIR / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST_DIR / "index.html")
