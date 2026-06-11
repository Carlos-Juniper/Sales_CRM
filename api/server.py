"""
FastAPI server for the Juniper Landscaping CRM.
Serves the studio/ frontend; reads/writes MySQL via aiomysql.

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
import aiomysql
import msal
from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from db import (
    get_pool,
    set_hoa_property_status,
    count_active_leads_for_property,
    has_won_lead_for_property,
)

SESSION_DURATION = 28800  # 8 hours in seconds
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
    # Starlette's ServerErrorMiddleware sits outside CORSMiddleware, so unhandled
    # exceptions never get CORS headers. This handler adds them so the browser can
    # read the error response instead of seeing an opaque network failure.
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


def _coerce_row(row: dict) -> dict:
    """Convert MySQL types (Decimal, date, datetime, JSON strings) to JSON-safe Python."""
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
        else:
            out[k] = v
    return out


async def _fetch_lead(lead_id: str) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM leads WHERE id = %s AND deleted_at IS NULL",
                (lead_id,),
            )
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Lead not found")
    return _coerce_row(dict(row))


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
    # Not persisted on leads; used only to author the lead_actions row on status change.
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


class PatchHoaPropertyBody(BaseModel):
    status: Optional[str] = None
    management_company_id: Optional[str] = None


class LoginBody(BaseModel):
    email: str
    password: str


# ── Auth dependency ──────────────────────────────────────────────────────────

async def require_auth(session: Optional[str] = Cookie(default=None)) -> dict:
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT u.id, u.name, u.email, u.role, u.branch_id, u.avatar_initials
                    FROM crm_sessions s
                    JOIN crm_users u ON u.id = s.user_id
                    WHERE s.token = %s AND s.expires_at > NOW()
                    """,
                    (session,),
                )
                user = await cur.fetchone()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Database error in require_auth", exc_info=True)
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    if not user:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return dict(user)


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
        conditions.append("status = %s")
        params.append(status)

    if lead_types:
        types = [t.strip() for t in lead_types.split(",") if t.strip()]
        if types:
            conditions.append(f"lead_type IN ({', '.join(['%s'] * len(types))})")
            params.extend(types)
    elif lead_type:
        conditions.append("lead_type = %s")
        params.append(lead_type)

    if search:
        conditions.append("property_name LIKE %s")
        params.append(f"%{search}%")

    if states:
        state_list = [s.strip() for s in states.split(",") if s.strip()]
        if state_list:
            conditions.append(f"state IN ({', '.join(['%s'] * len(state_list))})")
            params.extend(state_list)

    if min_score is not None:
        conditions.append("score >= %s")
        params.append(min_score)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size
    count_args = tuple(params) if params else None
    query_args = tuple(params + [page_size, offset])

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                f"SELECT COUNT(*) AS cnt FROM leads {where}",
                count_args,
            )
            cnt_row = await cur.fetchone()
            total: int = cnt_row["cnt"] if cnt_row else 0

            await cur.execute(
                f"SELECT * FROM leads {where} ORDER BY {sort_by} {sort_dir} LIMIT %s OFFSET %s",
                query_args,
            )
            rows = await cur.fetchall()

    total_pages = math.ceil(total / page_size) if page_size > 0 else 0
    return {
        "data": [_coerce_row(dict(r)) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@app.get("/api/leads/{lead_id}")
async def get_lead(lead_id: str, _user: dict = Depends(require_auth)) -> dict:
    return await _fetch_lead(lead_id)


@app.post("/api/leads", status_code=201)
async def create_lead(body: CreateLeadBody, _user: dict = Depends(require_auth)) -> dict:
    new_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO leads
                    (id, source, lead_type, property_name, city, state,
                     estimated_contract_value, estimated_acreage, status,
                     contact_name, contact_email)
                VALUES (%s, 'manual', %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    new_id,
                    body.lead_type,
                    body.property_name,
                    body.city,
                    body.state,
                    body.estimated_contract_value,
                    body.estimated_acreage,
                    body.status,
                    body.contact_name,
                    body.contact_email,
                ),
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

    set_clause = ", ".join(f"{f} = %s" for f, _ in updates)
    set_params: list[Any] = [v for _, v in updates]

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE leads SET {set_clause}, updated_at = NOW() WHERE id = %s",
                (*set_params, lead_id),
            )
            new_status = data.get("status")
            if new_status and new_status != current.get("status"):
                hoa_prop_id = current.get("hoa_property_id")
                if hoa_prop_id:
                    if new_status == "won":
                        await set_hoa_property_status(hoa_prop_id, "won")
                    elif new_status == "lost":
                        if not await has_won_lead_for_property(hoa_prop_id):
                            if await count_active_leads_for_property(hoa_prop_id) == 0:
                                await set_hoa_property_status(hoa_prop_id, "uncontacted")
                await cur.execute(
                    """
                    INSERT INTO lead_actions
                        (lead_id, action_type, prev_status, new_status, performed_by)
                    VALUES (%s, 'status_change', %s, %s, %s)
                    """,
                    (lead_id, current.get("status"), new_status, performed_by),
                )

    return await _fetch_lead(lead_id)


@app.delete("/api/leads/{lead_id}", status_code=204)
async def delete_lead(lead_id: str, _user: dict = Depends(require_auth)) -> None:
    lead = await _fetch_lead(lead_id)
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE leads SET deleted_at = NOW() WHERE id = %s AND deleted_at IS NULL",
                (lead_id,),
            )
    hoa_prop_id = lead.get("hoa_property_id")
    if hoa_prop_id and not await has_won_lead_for_property(hoa_prop_id):
        if await count_active_leads_for_property(hoa_prop_id) == 0:
            await set_hoa_property_status(hoa_prop_id, "uncontacted")


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
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT * FROM lead_actions
                WHERE lead_id = %s
                  AND action_type IN ('email_sent', 'call_logged', 'note_added')
                ORDER BY performed_at DESC
                """,
                (lead_id,),
            )
            rows = await cur.fetchall()

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

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO lead_actions (lead_id, action_type, detail, performed_by)
                VALUES (%s, %s, %s, %s)
                """,
                (body.lead_id, action_type, body.message, body.performed_by),
            )
            # Promote 'new' → 'contacted'
            await cur.execute(
                """
                UPDATE leads
                SET status = 'contacted', updated_at = NOW()
                WHERE id = %s AND status = 'new'
                """,
                (body.lead_id,),
            )

    return {"success": True, "message_id": f"msg_{uuid.uuid4().hex[:12]}"}


# ── HOA Properties ───────────────────────────────────────────────────────────

_HOA_JSON_COLS = frozenset({"raw_data"})


def _coerce_hoa_row(row: dict) -> dict:
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
        else:
            out[k] = v
    return out


async def _fetch_hoa_property(hoa_property_id: str) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM hoa_properties WHERE id = %s",
                (hoa_property_id,),
            )
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="HOA property not found")
    return _coerce_hoa_row(dict(row))


@app.get("/api/hoa-properties")
async def list_hoa_properties(
    state: Optional[str] = None,
    status: Optional[str] = None,
    branch_id: Optional[str] = None,
    min_acreage: Optional[float] = None,
    page: int = 1,
    page_size: int = Query(default=25, le=100),
    _user: dict = Depends(require_auth),
) -> dict:
    conditions: list[str] = []
    params: list[Any] = []

    if state:
        conditions.append("state = %s")
        params.append(state.upper())
    if status:
        conditions.append("status = %s")
        params.append(status)
    if branch_id:
        conditions.append("branch_id = %s")
        params.append(branch_id)
    if min_acreage is not None:
        conditions.append("estimated_acreage >= %s")
        params.append(min_acreage)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size
    count_args = tuple(params) if params else None
    query_args = tuple(params + [page_size, offset])

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                f"SELECT COUNT(*) AS cnt FROM hoa_properties {where}",
                count_args,
            )
            cnt_row = await cur.fetchone()
            total: int = cnt_row["cnt"] if cnt_row else 0

            await cur.execute(
                f"SELECT * FROM hoa_properties {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
                query_args,
            )
            rows = await cur.fetchall()

    total_pages = math.ceil(total / page_size) if page_size > 0 else 0
    return {
        "data": [_coerce_hoa_row(dict(r)) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@app.post("/api/hoa-properties/{hoa_property_id}/promote", status_code=201)
async def promote_hoa_property(
    hoa_property_id: str,
    _user: dict = Depends(require_auth),
) -> dict:
    from api.pipeline import promote_hoa_to_lead  # lazy import to avoid startup cost
    try:
        lead = await promote_hoa_to_lead(hoa_property_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _coerce_row(lead.to_dict())


@app.patch("/api/hoa-properties/{hoa_property_id}")
async def patch_hoa_property(
    hoa_property_id: str,
    body: PatchHoaPropertyBody,
    _user: dict = Depends(require_auth),
) -> dict:
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    _PATCHABLE = frozenset({"status", "management_company_id"})
    updates = [(f, v) for f, v in data.items() if f in _PATCHABLE]
    if not updates:
        raise HTTPException(status_code=400, detail="No patchable fields provided")

    set_clause = ", ".join(f"{f} = %s" for f, _ in updates)
    set_params: list[Any] = [v for _, v in updates]

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE hoa_properties SET {set_clause}, updated_at = NOW() WHERE id = %s",
                (*set_params, hoa_property_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="HOA property not found")

    return await _fetch_hoa_property(hoa_property_id)


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
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                f"SELECT * FROM bids {where}",
                tuple(params) if params else None,
            )
            rows = await cur.fetchall()

    return [_coerce_row(dict(r)) for r in rows]


@app.post("/api/bids", status_code=201)
async def create_bid(body: CreateBidBody, _user: dict = Depends(require_auth)) -> dict:
    new_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO bids (id, lead_id, estimated_value, status, title, agency, branch_id, notes)
                VALUES (%s, %s, %s, 'pending', %s, %s, %s, %s)
                """,
                (
                    new_id,
                    body.lead_id,
                    body.estimated_value,
                    body.title,
                    body.agency,
                    body.branch_id,
                    body.notes,
                ),
            )
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM bids WHERE id = %s", (new_id,))
            row = await cur.fetchone()

    return _coerce_row(dict(row))


@app.patch("/api/bids/{bid_id}")
async def patch_bid(bid_id: str, body: PatchBidBody, _user: dict = Depends(require_auth)) -> dict:
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{f} = %s" for f in data)
    params: list[Any] = list(data.values())

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                f"UPDATE bids SET {set_clause} WHERE id = %s",
                (*params, bid_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Bid not found")
            await cur.execute("SELECT * FROM bids WHERE id = %s", (bid_id,))
            row = await cur.fetchone()

    return _coerce_row(dict(row))


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
        conditions.append("role = %s")
        params.append(role)
    if branch_id:
        conditions.append("branch_id = %s")
        params.append(branch_id)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                f"SELECT id, name, email, role, branch_id, avatar_initials FROM users {where}",
                tuple(params) if params else None,
            )
            rows = await cur.fetchall()

    return [dict(r) for r in rows]


# ── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard/inside-sales")
async def dashboard_inside_sales(_user: dict = Depends(require_auth)) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT COUNT(*) AS cnt FROM leads WHERE deleted_at IS NULL")
            total_leads: int = (await cur.fetchone())["cnt"]

            await cur.execute(
                "SELECT COUNT(*) AS cnt FROM leads WHERE status = 'new' AND deleted_at IS NULL"
            )
            new_leads: int = (await cur.fetchone())["cnt"]

            await cur.execute(
                "SELECT status, COUNT(*) AS cnt FROM leads WHERE deleted_at IS NULL GROUP BY status"
            )
            leads_by_status: dict[str, int] = {
                r["status"]: r["cnt"] for r in await cur.fetchall()
            }

            await cur.execute(
                "SELECT AVG(score) AS avg_score FROM leads WHERE score IS NOT NULL AND deleted_at IS NULL"
            )
            avg_row = await cur.fetchone()
            avg_score = float(avg_row["avg_score"]) if avg_row["avg_score"] is not None else 0.0

            await cur.execute(
                "SELECT state, COUNT(*) AS cnt FROM leads WHERE deleted_at IS NULL GROUP BY state ORDER BY cnt DESC"
            )
            leads_by_state: dict[str, int] = {
                r["state"]: r["cnt"] for r in await cur.fetchall()
            }

    return {
        "total_leads": total_leads,
        "new_leads": new_leads,
        "leads_by_status": leads_by_status,
        "avg_score": round(avg_score, 1),
        "leads_by_state": leads_by_state,
    }


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
async def login(body: LoginBody, response: Response) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, name, email, role, branch_id, avatar_initials FROM crm_users WHERE email = %s",
                (body.email,),
            )
            user = await cur.fetchone()
            if not user:
                raise HTTPException(status_code=401, detail="Invalid credentials")

            await cur.execute(
                "SELECT password_hash, failed_attempts, locked_until FROM crm_logins WHERE user_id = %s",
                (user["id"],),
            )
            login_row = await cur.fetchone()
            if not login_row:
                raise HTTPException(status_code=401, detail="Invalid credentials")

            now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

            if login_row["locked_until"] and login_row["locked_until"] > now_utc:
                raise HTTPException(status_code=403, detail="Account temporarily locked. Try again later.")

            if not bcrypt.checkpw(body.password.encode(), login_row["password_hash"].encode()):
                new_attempts = login_row["failed_attempts"] + 1
                lock_until = now_utc + timedelta(minutes=15) if new_attempts >= 5 else None
                await cur.execute(
                    "UPDATE crm_logins SET failed_attempts = %s, locked_until = %s, updated_at = %s WHERE user_id = %s",
                    (new_attempts, lock_until, now_utc, user["id"]),
                )
                raise HTTPException(status_code=401, detail="Invalid credentials")

            # Purge expired sessions, reset failed attempts, create new session
            token = secrets.token_hex(32)
            expires_at = now_utc + timedelta(seconds=SESSION_DURATION)

            await cur.execute("DELETE FROM crm_sessions WHERE expires_at < NOW()")
            await cur.execute(
                "UPDATE crm_logins SET failed_attempts = 0, locked_until = NULL, last_login = %s, updated_at = %s WHERE user_id = %s",
                (now_utc, now_utc, user["id"]),
            )
            await cur.execute(
                "INSERT INTO crm_sessions (token, user_id, expires_at, created_at) VALUES (%s, %s, %s, %s)",
                (token, user["id"], expires_at, now_utc),
            )

    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_DURATION,
    )
    return dict(user)


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
                scopes=[],  # MSAL adds openid/profile/email automatically; passing them raises ValueError
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

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, name, email, role, branch_id, avatar_initials FROM crm_users WHERE email = %s",
                (email,),
            )
            user = await cur.fetchone()
            if not user:
                raise HTTPException(status_code=403, detail="No CRM account for this Microsoft account")

            now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
            token = secrets.token_hex(32)
            expires_at = now_utc + timedelta(seconds=SESSION_DURATION)

            await cur.execute("DELETE FROM crm_sessions WHERE expires_at < NOW()")
            await cur.execute(
                "INSERT INTO crm_sessions (token, user_id, expires_at, created_at) VALUES (%s, %s, %s, %s)",
                (token, user["id"], expires_at, now_utc),
            )

    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_DURATION,
    )
    return dict(user)


@app.post("/api/auth/logout")
async def logout(response: Response, session: Optional[str] = Cookie(default=None)) -> dict:
    if session:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM crm_sessions WHERE token = %s", (session,))
    response.delete_cookie(key="session")
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user: dict = Depends(require_auth)) -> dict:
    return user
