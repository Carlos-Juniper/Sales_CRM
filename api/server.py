"""
FastAPI server for the Juniper Landscaping CRM.
Serves the studio/ frontend; reads/writes BigQuery via google-cloud-bigquery.
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
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import bcrypt
import jwt
import msal
from dotenv import load_dotenv
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from google.cloud import bigquery
from pydantic import BaseModel

load_dotenv()
logger = logging.getLogger(__name__)

from db import (
    T, P, PA, query, execute,
    set_hoa_property_status,
    count_active_leads_for_property,
    has_won_lead_for_property,
)

SESSION_DURATION = 28800  # 8 hours in seconds
JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"

_ALLOWED_ORIGINS = {"http://localhost:5173", "http://localhost:5174"}

app = FastAPI(title="Juniper CRM API")

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

_LEAD_BQ_TYPES: dict[str, str] = {
    "status": "STRING", "assigned_to": "STRING", "notes": "STRING",
    "priority": "INT64", "property_name": "STRING", "lead_type": "STRING",
    "address": "STRING", "city": "STRING", "state": "STRING", "zip": "STRING",
    "bid_deadline": "DATE", "estimated_acreage": "FLOAT64",
    "estimated_contract_value": "FLOAT64", "contact_name": "STRING",
    "contact_email": "STRING", "handoff_notes": "STRING", "division_id": "INT64",
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
        f"SELECT * FROM {T('leads')} WHERE id = @id AND deleted_at IS NULL",
        [P("id", "STRING", lead_id)],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Lead not found")
    return _coerce_row(rows[0])


# ── Request / response models ────────────────────────────────────────────────

class CreateLeadBody(BaseModel):
    property_name: str
    city: str
    state: str
    lead_type: str
    estimated_contract_value: Optional[float] = None
    estimated_acreage: Optional[float] = None
    status: str = "new"
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None


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
    estimated_contract_value: Optional[float] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    handoff_notes: Optional[str] = None
    division_id: Optional[int] = None
    performed_by: Optional[str] = None


class OutreachSendBody(BaseModel):
    lead_id: str
    channel: str
    message: str
    performed_by: Optional[str] = None


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


class LoginBody(BaseModel):
    email: str
    password: str


# ── Auth dependency ──────────────────────────────────────────────────────────

async def require_auth(session: Optional[str] = Cookie(default=None)) -> dict:
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
    return payload


# ── Leads ────────────────────────────────────────────────────────────────────

@app.get("/api/leads")
async def list_leads(
    status: Optional[str] = None,
    lead_type: Optional[str] = None,
    lead_types: Optional[str] = None,
    search: Optional[str] = None,
    states: Optional[str] = None,
    min_score: Optional[int] = None,
    sort_by: str = "score",
    sort_dir: str = "desc",
    page: int = 1,
    page_size: int = Query(default=25, le=100),
    _user: dict = Depends(require_auth),
) -> dict:
    if sort_by not in _ALLOWED_SORT:
        sort_by = "score"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    conditions: list[str] = ["deleted_at IS NULL"]
    params: list[Any] = []

    if status:
        conditions.append("status = @status")
        params.append(P("status", "STRING", status))

    if lead_types:
        types = [t.strip() for t in lead_types.split(",") if t.strip()]
        if types:
            conditions.append("lead_type IN UNNEST(@lead_types)")
            params.append(PA("lead_types", "STRING", types))
    elif lead_type:
        conditions.append("lead_type = @lead_type")
        params.append(P("lead_type", "STRING", lead_type))

    if search:
        conditions.append("LOWER(property_name) LIKE LOWER(@search)")
        params.append(P("search", "STRING", f"%{search}%"))

    if states:
        state_list = [s.strip() for s in states.split(",") if s.strip()]
        if state_list:
            conditions.append("state IN UNNEST(@states)")
            params.append(PA("states", "STRING", state_list))

    if min_score is not None:
        conditions.append("score >= @min_score")
        params.append(P("min_score", "INT64", min_score))

    where = f"WHERE {' AND '.join(conditions)}"
    offset = (page - 1) * page_size

    count_rows = await query(f"SELECT COUNT(*) AS cnt FROM {T('leads')} {where}", list(params))
    total = int(count_rows[0]["cnt"]) if count_rows else 0

    data_params = list(params) + [P("lim", "INT64", page_size), P("off", "INT64", offset)]
    rows = await query(
        f"SELECT * FROM {T('leads')} {where} ORDER BY {sort_by} {sort_dir} LIMIT @lim OFFSET @off",
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
    return await _fetch_lead(lead_id)


@app.post("/api/leads", status_code=201)
async def create_lead(body: CreateLeadBody, _user: dict = Depends(require_auth)) -> dict:
    new_id = str(uuid.uuid4())
    await execute(
        f"""
        INSERT INTO {T('leads')}
            (id, source, lead_type, property_name, city, state,
             estimated_contract_value, estimated_acreage, status,
             contact_name, contact_email, created_at, updated_at)
        VALUES
            (@id, 'manual', @lead_type, @property_name, @city, @state,
             @estimated_contract_value, @estimated_acreage, @status,
             @contact_name, @contact_email, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            P("id", "STRING", new_id),
            P("lead_type", "STRING", body.lead_type),
            P("property_name", "STRING", body.property_name),
            P("city", "STRING", body.city),
            P("state", "STRING", body.state),
            P("estimated_contract_value", "FLOAT64", body.estimated_contract_value),
            P("estimated_acreage", "FLOAT64", body.estimated_acreage),
            P("status", "STRING", body.status),
            P("contact_name", "STRING", body.contact_name),
            P("contact_email", "STRING", body.contact_email),
        ],
    )
    return await _fetch_lead(new_id)


@app.patch("/api/leads/{lead_id}")
async def patch_lead(lead_id: str, body: PatchLeadBody, _user: dict = Depends(require_auth)) -> dict:
    current = await _fetch_lead(lead_id)

    _PATCHABLE = frozenset({
        "status", "assigned_to", "notes", "priority",
        "property_name", "lead_type", "address", "city", "state", "zip", "bid_deadline",
        "estimated_acreage", "estimated_contract_value",
        "contact_name", "contact_email", "handoff_notes", "division_id",
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

    set_clause = ", ".join(f"{f} = @{f}" for f, _ in updates)
    bq_params = [P(f, _LEAD_BQ_TYPES.get(f, "STRING"), v) for f, v in updates]
    bq_params.append(P("lead_id", "STRING", lead_id))

    await execute(
        f"UPDATE {T('leads')} SET {set_clause}, updated_at = CURRENT_TIMESTAMP() WHERE id = @lead_id",
        bq_params,
    )

    new_status = data.get("status")
    if new_status and new_status != current.get("status"):
        hoa_prop_id = current.get("hoa_property_id")
        if hoa_prop_id:
            if new_status == "won":
                await set_hoa_property_status(hoa_prop_id, "won")
            # "lost" no longer auto-downgrades the property — status is managed manually
        await execute(
            f"""
            INSERT INTO {T('lead_actions')}
                (id, lead_id, action_type, prev_status, new_status, performed_by, performed_at)
            VALUES
                (@id, @lead_id, 'status_change', @prev_status, @new_status, @performed_by, CURRENT_TIMESTAMP())
            """,
            [
                P("id", "STRING", str(uuid.uuid4())),
                P("lead_id", "STRING", lead_id),
                P("prev_status", "STRING", current.get("status")),
                P("new_status", "STRING", new_status),
                P("performed_by", "STRING", performed_by),
            ],
        )

    return await _fetch_lead(lead_id)


@app.delete("/api/leads/{lead_id}", status_code=204)
async def delete_lead(lead_id: str, _user: dict = Depends(require_auth)) -> None:
    await _fetch_lead(lead_id)
    await execute(
        f"UPDATE {T('leads')} SET deleted_at = CURRENT_TIMESTAMP() WHERE id = @id AND deleted_at IS NULL",
        [P("id", "STRING", lead_id)],
    )
    # Property status is managed manually — deleting a lead does not auto-downgrade it


# ── Outreach ─────────────────────────────────────────────────────────────────

_CHANNEL_TO_ACTION: dict[str, str] = {
    "email": "email_sent",
    "phone": "call_logged",
    "linkedin": "email_sent",
}
_ACTION_TO_CHANNEL: dict[str, str] = {
    "email_sent": "email",
    "call_logged": "phone",
    "note_added": "note",
}


@app.get("/api/outreach/{lead_id}")
async def get_outreach(lead_id: str, _user: dict = Depends(require_auth)) -> list:
    rows = await query(
        f"""
        SELECT * FROM {T('lead_actions')}
        WHERE lead_id = @lead_id
          AND action_type IN UNNEST(@types)
        ORDER BY performed_at DESC
        """,
        [
            P("lead_id", "STRING", lead_id),
            PA("types", "STRING", ["email_sent", "call_logged", "note_added"]),
        ],
    )
    return [
        {
            "id": str(r["id"]),
            "lead_id": r["lead_id"],
            "channel": _ACTION_TO_CHANNEL.get(r["action_type"], r["action_type"]),
            "message": r.get("detail") or "",
            "sent_at": (
                r["performed_at"].isoformat()
                if isinstance(r["performed_at"], datetime)
                else str(r["performed_at"])
            ),
            "response_received": False,
            "response_at": None,
            "sequence_step": 1,
            "next_follow_up": None,
        }
        for r in rows
    ]


@app.post("/api/outreach/send")
async def send_outreach(body: OutreachSendBody, _user: dict = Depends(require_auth)) -> dict:
    action_type = _CHANNEL_TO_ACTION.get(body.channel, "email_sent")
    await execute(
        f"""
        INSERT INTO {T('lead_actions')}
            (id, lead_id, action_type, detail, performed_by, performed_at)
        VALUES
            (@id, @lead_id, @action_type, @detail, @performed_by, CURRENT_TIMESTAMP())
        """,
        [
            P("id", "STRING", str(uuid.uuid4())),
            P("lead_id", "STRING", body.lead_id),
            P("action_type", "STRING", action_type),
            P("detail", "STRING", body.message),
            P("performed_by", "STRING", body.performed_by),
        ],
    )
    await execute(
        f"""
        UPDATE {T('leads')} SET status = 'contacted', updated_at = CURRENT_TIMESTAMP()
        WHERE id = @id AND status = 'new'
        """,
        [P("id", "STRING", body.lead_id)],
    )

    # Auto-flip the linked HOA property's contact_status when outreach is sent
    from api.pipeline import set_property_contacted

    lead_rows = await query(
        f"SELECT hoa_property_id FROM {T('leads')} WHERE id = @id",
        [P("id", "STRING", body.lead_id)],
    )
    if lead_rows:
        hoa_prop_id = lead_rows[0].get("hoa_property_id")
        if hoa_prop_id:
            await set_property_contacted(hoa_prop_id)

    return {"success": True, "message_id": f"msg_{uuid.uuid4().hex[:12]}"}


# ── HOA Properties ───────────────────────────────────────────────────────────

_HOA_JSON_COLS = frozenset({"raw_data"})


def _shape_hoa_row(row: dict) -> dict:
    """Coerce BigQuery types and rename DB columns to frontend-expected names."""
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
        f"SELECT * FROM {T('hoa_properties')} WHERE id = @id",
        [P("id", "STRING", hoa_property_id)],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="HOA property not found")
    return _shape_hoa_row(rows[0])


@app.get("/api/hoa-properties/filter-options")
async def hoa_filter_options(_user: dict = Depends(require_auth)) -> dict:
    rows = await query(
        f"SELECT DISTINCT city, branch_id FROM {T('hoa_properties')} WHERE city IS NOT NULL ORDER BY city"
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
        conditions.append("state = @state")
        params.append(P("state", "STRING", state.upper()))
    if status:
        vals = [s.strip() for s in status.split(",") if s.strip()]
        if vals:
            conditions.append("status IN UNNEST(@hoa_statuses)")
            params.append(PA("hoa_statuses", "STRING", vals))
    if branch_id:
        vals = [s.strip() for s in branch_id.split(",") if s.strip()]
        if vals:
            conditions.append("branch_id IN UNNEST(@branch_ids)")
            params.append(PA("branch_ids", "STRING", vals))
    if city:
        vals = [s.strip() for s in city.split(",") if s.strip()]
        if vals:
            conditions.append("city IN UNNEST(@cities)")
            params.append(PA("cities", "STRING", vals))
    if search:
        conditions.append(
            "(LOWER(property_name) LIKE LOWER(@search)"
            " OR LOWER(COALESCE(association_name,'')) LIKE LOWER(@search)"
            " OR LOWER(COALESCE(city,'')) LIKE LOWER(@search))"
        )
        params.append(P("search", "STRING", f"%{search}%"))
    if min_acreage is not None:
        conditions.append("estimated_acreage >= @min_acreage")
        params.append(P("min_acreage", "FLOAT64", min_acreage))

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size

    count_rows = await query(f"SELECT COUNT(*) AS cnt FROM {T('hoa_properties')} {where}", list(params))
    total = int(count_rows[0]["cnt"]) if count_rows else 0

    data_params = list(params) + [P("lim", "INT64", page_size), P("off", "INT64", offset)]
    rows = await query(
        f"SELECT * FROM {T('hoa_properties')} {where} ORDER BY created_at DESC LIMIT @lim OFFSET @off",
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
        f"""
        INSERT INTO {T('hoa_properties')}
            (id, property_name, association_name, address, city, state, zip, county,
             estimated_acreage, units, status, branch_id, management_company_id,
             assigned_to, contact_status, parcel_id, arcgis_source,
             created_at, updated_at)
        VALUES
            (@id, @property_name, @association_name, @address, @city, @state, @zip, @county,
             @estimated_acreage, @units, @status, @branch_id, @management_company_id,
             @assigned_to, 'uncontacted', @parcel_id, 'manual',
             CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            P("id", "STRING", new_id),
            P("property_name", "STRING", body.property_name),
            P("association_name", "STRING", body.association_name),
            P("address", "STRING", body.address),
            P("city", "STRING", body.city),
            P("state", "STRING", body.state),
            P("zip", "STRING", body.zip),
            P("county", "STRING", body.county),
            P("estimated_acreage", "FLOAT64", body.acreage),
            P("units", "INT64", body.units),
            P("status", "STRING", body.status),
            P("branch_id", "STRING", body.branch_id),
            P("management_company_id", "STRING", body.management_company_id),
            P("assigned_to", "STRING", user_id),
            P("parcel_id", "STRING", f"manual-{new_id}"),
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
    "property_name", "association_name",
    "address", "city", "state", "zip", "county",
    "estimated_acreage", "units",
})
_HOA_BQ_TYPES: dict[str, str] = {
    "status": "STRING",
    "management_company_id": "STRING",
    "assigned_to": "STRING",
    "last_contacted": "DATE",
    "contact_status": "STRING",
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
        f"SELECT id FROM {T('hoa_properties')} WHERE id = @id",
        [P("id", "STRING", hoa_property_id)],
    )
    if not existing:
        raise HTTPException(status_code=404, detail="HOA property not found")

    set_clause = ", ".join(f"{f} = @{f}" for f, _ in updates)
    bq_params = [P(f, _HOA_BQ_TYPES.get(f, "STRING"), v) for f, v in updates]
    bq_params.append(P("hoa_id", "STRING", hoa_property_id))

    await execute(
        f"UPDATE {T('hoa_properties')} SET {set_clause}, updated_at = CURRENT_TIMESTAMP() WHERE id = @hoa_id",
        bq_params,
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

_MGMT_COL_BQ_TYPES: dict[str, str] = {
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
        conditions.append("LOWER(name) LIKE LOWER(@search)")
        params.append(P("search", "STRING", f"%{search}%"))
    if branch_id:
        conditions.append("branch_id = @branch_id")
        params.append(P("branch_id", "STRING", branch_id))
    if status:
        conditions.append("status = @mgmt_status")
        params.append(P("mgmt_status", "STRING", status))
    if assigned_to:
        conditions.append("assigned_to = @assigned_to")
        params.append(P("assigned_to", "STRING", assigned_to))

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size

    count_rows = await query(
        f"SELECT COUNT(*) AS cnt FROM {T('property_management_companies')} {where}",
        list(params),
    )
    total = int(count_rows[0]["cnt"]) if count_rows else 0

    data_params = list(params) + [P("lim", "INT64", page_size), P("off", "INT64", offset)]
    rows = await query(
        f"SELECT * FROM {T('property_management_companies')} {where} ORDER BY created_at DESC LIMIT @lim OFFSET @off",
        data_params,
    )

    # Batch-fetch contacts for all returned companies to avoid N+1 queries
    contacts_by_company: dict[str, list[dict]] = {}
    if rows:
        company_ids = [r["id"] for r in rows]
        contact_rows = await query(
            f"""
            SELECT * FROM {T('hoa_contact_information')}
            WHERE management_company_id IN UNNEST(@ids)
            ORDER BY id ASC
            """,
            [PA("ids", "STRING", company_ids)],
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
        f"""
        INSERT INTO {T('property_management_companies')}
            (id, name, website, phone, mailing_address, mailing_city, mailing_state,
             mailing_zip, contact_email, branch_id, assigned_to, status, contact_status,
             created_at, updated_at)
        VALUES
            (@id, @name, @website, @phone, @mailing_address, @mailing_city, @mailing_state,
             @mailing_zip, @contact_email, @branch_id, @assigned_to, 'Target', 'uncontacted',
             CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            P("id", "STRING", new_id),
            P("name", "STRING", body.company_name),
            P("website", "STRING", body.website),
            P("phone", "STRING", body.phone),
            P("mailing_address", "STRING", body.street),
            P("mailing_city", "STRING", body.city),
            P("mailing_state", "STRING", body.state),
            P("mailing_zip", "STRING", body.zip),
            P("contact_email", "STRING", body.primary_email),
            P("branch_id", "STRING", body.branch_id),
            P("assigned_to", "STRING", user_id),
        ],
    )

    # Insert each contact that has at least a name or email
    for contact in body.contacts:
        if not (contact.name or "").strip() and not (contact.email or "").strip():
            continue
        contact_id = uuid.uuid4().int % (2**62) + 1
        await execute(
            f"""
            INSERT INTO {T('hoa_contact_information')}
                (id, management_company_id, contact_name, role, email, phone, source, created_at)
            VALUES
                (@id, @mgmt_id, @contact_name, @role, @email, @phone, 'manual', CURRENT_TIMESTAMP())
            """,
            [
                P("id", "INT64", contact_id),
                P("mgmt_id", "STRING", new_id),
                P("contact_name", "STRING", contact.name),
                P("role", "STRING", contact.title),
                P("email", "STRING", contact.email or None),
                P("phone", "STRING", contact.phone),
            ],
        )

    # Fetch the newly created company row
    company_rows = await query(
        f"SELECT * FROM {T('property_management_companies')} WHERE id = @id",
        [P("id", "STRING", new_id)],
    )
    contact_rows = await query(
        f"""
        SELECT * FROM {T('hoa_contact_information')}
        WHERE management_company_id = @id ORDER BY id ASC
        """,
        [P("id", "STRING", new_id)],
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
        f"SELECT id FROM {T('property_management_companies')} WHERE id = @id",
        [P("id", "STRING", company_id)],
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Management company not found")

    # Translate body field names to DB column names
    updates_db = [(_MGMT_FIELD_TO_COL.get(f, f), v) for f, v in updates_raw]

    set_clause = ", ".join(f"{col} = @{col}" for col, _ in updates_db)
    bq_params = [P(col, _MGMT_COL_BQ_TYPES.get(col, "STRING"), v) for col, v in updates_db]
    bq_params.append(P("company_id", "STRING", company_id))

    await execute(
        f"UPDATE {T('property_management_companies')} SET {set_clause}, updated_at = CURRENT_TIMESTAMP() WHERE id = @company_id",
        bq_params,
    )

    company_rows = await query(
        f"SELECT * FROM {T('property_management_companies')} WHERE id = @id",
        [P("id", "STRING", company_id)],
    )
    contact_rows = await query(
        f"""
        SELECT * FROM {T('hoa_contact_information')}
        WHERE management_company_id = @id ORDER BY id ASC
        """,
        [P("id", "STRING", company_id)],
    )
    contacts = [_shape_contact_row(cr) for cr in contact_rows]
    return _shape_mgmt_row(company_rows[0], contacts)


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
        conditions.append("lead_id = @lead_id")
        params.append(P("lead_id", "STRING", lead_id))
    if status:
        conditions.append("status = @bid_status")
        params.append(P("bid_status", "STRING", status))

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = await query(f"SELECT * FROM {T('bids')} {where}", params or None)
    return [_coerce_row(r) for r in rows]


@app.post("/api/bids", status_code=201)
async def create_bid(body: CreateBidBody, _user: dict = Depends(require_auth)) -> dict:
    new_id = str(uuid.uuid4())
    await execute(
        f"""
        INSERT INTO {T('bids')}
            (id, lead_id, estimated_value, status, title, agency, branch_id, notes,
             created_at, updated_at)
        VALUES
            (@id, @lead_id, @estimated_value, 'pending', @title, @agency, @branch_id, @notes,
             CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            P("id", "STRING", new_id),
            P("lead_id", "STRING", body.lead_id),
            P("estimated_value", "FLOAT64", body.estimated_value),
            P("title", "STRING", body.title),
            P("agency", "STRING", body.agency),
            P("branch_id", "STRING", body.branch_id),
            P("notes", "STRING", body.notes),
        ],
    )
    rows = await query(f"SELECT * FROM {T('bids')} WHERE id = @id", [P("id", "STRING", new_id)])
    return _coerce_row(rows[0])


@app.patch("/api/bids/{bid_id}")
async def patch_bid(bid_id: str, body: PatchBidBody, _user: dict = Depends(require_auth)) -> dict:
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    existing = await query(f"SELECT id FROM {T('bids')} WHERE id = @id", [P("id", "STRING", bid_id)])
    if not existing:
        raise HTTPException(status_code=404, detail="Bid not found")

    _BID_BQ_TYPES = {"status": "STRING", "estimated_value": "FLOAT64", "notes": "STRING"}
    set_clause = ", ".join(f"{f} = @{f}" for f in data)
    bq_params = [P(f, _BID_BQ_TYPES.get(f, "STRING"), v) for f, v in data.items()]
    bq_params.append(P("bid_id", "STRING", bid_id))

    await execute(
        f"UPDATE {T('bids')} SET {set_clause}, updated_at = CURRENT_TIMESTAMP() WHERE id = @bid_id",
        bq_params,
    )

    # When a bid moves to 'pursuing', mark the linked HOA property as contacted
    from api.pipeline import set_property_contacted

    new_bid_status = data.get("status")
    if new_bid_status == "pursuing":
        bid_rows = await query(
            f"SELECT lead_id FROM {T('bids')} WHERE id = @id",
            [P("id", "STRING", bid_id)],
        )
        if bid_rows:
            lead_id_for_bid = bid_rows[0].get("lead_id")
            if lead_id_for_bid:
                lead_rows = await query(
                    f"SELECT hoa_property_id FROM {T('leads')} WHERE id = @id",
                    [P("id", "STRING", lead_id_for_bid)],
                )
                if lead_rows:
                    hoa_prop_id = lead_rows[0].get("hoa_property_id")
                    if hoa_prop_id:
                        await set_property_contacted(hoa_prop_id)

    rows = await query(f"SELECT * FROM {T('bids')} WHERE id = @id", [P("id", "STRING", bid_id)])
    return _coerce_row(rows[0])


# ── Users ────────────────────────────────────────────────────────────────────

@app.get("/api/users")
async def list_users(
    role: Optional[str] = None,
    branch_id: Optional[str] = None,
    _user: dict = Depends(require_auth),
) -> list:
    conditions: list[str] = []
    params: list[Any] = []
    if role:
        conditions.append("role = @role")
        params.append(P("role", "STRING", role))
    if branch_id:
        conditions.append("branch_id = @branch_id")
        params.append(P("branch_id", "STRING", branch_id))

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = await query(
        f"SELECT id, name, email, role, branch_id, avatar_initials FROM {T('users')} {where}",
        params or None,
    )
    return list(rows)


# ── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard/inside-sales")
async def dashboard_inside_sales(_user: dict = Depends(require_auth)) -> dict:
    total_rows, new_rows, status_rows, avg_rows, state_rows = await asyncio.gather(
        query(f"SELECT COUNT(*) AS cnt FROM {T('leads')} WHERE deleted_at IS NULL"),
        query(f"SELECT COUNT(*) AS cnt FROM {T('leads')} WHERE status = 'new' AND deleted_at IS NULL"),
        query(f"SELECT status, COUNT(*) AS cnt FROM {T('leads')} WHERE deleted_at IS NULL GROUP BY status"),
        query(f"SELECT AVG(score) AS avg_score FROM {T('leads')} WHERE score IS NOT NULL AND deleted_at IS NULL"),
        query(f"SELECT state, COUNT(*) AS cnt FROM {T('leads')} WHERE deleted_at IS NULL GROUP BY state ORDER BY cnt DESC"),
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

def _issue_jwt(user: dict, response: Response) -> dict:
    payload = {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "branch_id": user["branch_id"],
        "avatar_initials": user["avatar_initials"],
        "exp": datetime.now(timezone.utc) + timedelta(seconds=SESSION_DURATION),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_DURATION,
    )
    return {k: v for k, v in payload.items() if k != "exp"}


@app.post("/api/auth/login")
async def login(body: LoginBody, response: Response) -> dict:
    user_rows = await query(
        f"SELECT id, name, email, role, branch_id, avatar_initials FROM {T('users')} WHERE email = @email",
        [P("email", "STRING", body.email)],
    )
    if not user_rows:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = user_rows[0]

    login_rows = await query(
        f"SELECT password_hash, failed_attempts, locked_until FROM {T('logins')} WHERE user_id = @user_id",
        [P("user_id", "STRING", user["id"])],
    )
    if not login_rows:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    login_row = login_rows[0]

    now_utc = datetime.now(timezone.utc)
    locked_until = login_row.get("locked_until")
    if locked_until:
        lu = locked_until if locked_until.tzinfo else locked_until.replace(tzinfo=timezone.utc)
        if lu > now_utc:
            raise HTTPException(status_code=403, detail="Account temporarily locked. Try again later.")

    if not bcrypt.checkpw(body.password.encode(), login_row["password_hash"].encode()):
        new_attempts = (login_row.get("failed_attempts") or 0) + 1
        lock_until = now_utc + timedelta(minutes=15) if new_attempts >= 5 else None
        await execute(
            f"UPDATE {T('logins')} SET failed_attempts = @attempts, locked_until = @lock_until, updated_at = CURRENT_TIMESTAMP() WHERE user_id = @user_id",
            [
                P("attempts", "INT64", new_attempts),
                P("lock_until", "TIMESTAMP", lock_until),
                P("user_id", "STRING", user["id"]),
            ],
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")

    await execute(
        f"UPDATE {T('logins')} SET failed_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP(), updated_at = CURRENT_TIMESTAMP() WHERE user_id = @user_id",
        [P("user_id", "STRING", user["id"])],
    )
    return _issue_jwt(user, response)


class EntraCallbackBody(BaseModel):
    code: str
    redirect_uri: str


@app.post("/api/auth/entra-callback")
async def entra_callback(body: EntraCallbackBody, response: Response) -> dict:
    client_id = os.environ["ENTRA_CLIENT_ID"]
    tenant_id = os.environ["ENTRA_TENANT_ID"]
    client_secret = os.environ["ENTRA_CLIENT_SECRET"]

    authority = f"https://login.microsoftonline.com/{tenant_id}"
    msal_app = msal.ConfidentialClientApplication(
        client_id, authority=authority, client_credential=client_secret
    )

    try:
        loop = asyncio.get_event_loop()
        token_result = await loop.run_in_executor(
            None,
            lambda: msal_app.acquire_token_by_authorization_code(
                body.code,
                scopes=[],
                redirect_uri=body.redirect_uri,
            ),
        )
    except Exception as exc:
        logger.error("MSAL token exchange failed", exc_info=True)
        raise HTTPException(status_code=503, detail="Could not reach Microsoft authentication service") from exc

    if "error" in token_result:
        raise HTTPException(status_code=401, detail=token_result.get("error_description", "SSO token exchange failed"))

    claims = token_result.get("id_token_claims", {})
    email = claims.get("email") or claims.get("preferred_username", "")
    if not email:
        raise HTTPException(status_code=401, detail="No email in Entra ID token")

    user_rows = await query(
        f"SELECT id, name, email, role, branch_id, avatar_initials FROM {T('users')} WHERE email = @email",
        [P("email", "STRING", email)],
    )
    if not user_rows:
        raise HTTPException(status_code=403, detail="No CRM account for this Microsoft account")

    return _issue_jwt(user_rows[0], response)


@app.post("/api/auth/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(key="session")
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user: dict = Depends(require_auth)) -> dict:
    return user


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
