"""Commissions API — /api/commissions/* routes.

Tracks sales rep commission rates and earned commissions. Commission rates are
populated from Paycom (external process). Commissions are auto-created by a
database trigger when an estimate's status transitions to 'won'.

Backs the Commissions page in the inside-sales studio. Mirrors the module
pattern used by api/estimating.py and api/proposals.py.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel

from db import query, execute
from api import authz

logger = logging.getLogger(__name__)


class MarkPaidBody(BaseModel):
    payment_period: str


def _coerce_row(row: dict) -> dict:
    """Convert DB row types to JSON-serializable values (keys remain snake_case)."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _can_view_all(user: dict) -> bool:
    """True if the authenticated user may view any rep's commissions."""
    return authz.normalize_role(user.get("role")) in authz.CROSS_BRANCH_ROLES


def register(app, require_auth) -> None:
    """Attach all commission routes to the FastAPI app with the shared auth dep."""

    @app.get("/api/commissions/summary")
    async def get_commission_summary(
        user_id: Optional[str] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> dict:
        target_user_id = user_id or user["id"]

        if not _can_view_all(user) and target_user_id != user["id"]:
            raise HTTPException(status_code=403, detail="You can only view your own commissions")

        now = datetime.now(tz=timezone.utc)
        if not start_date:
            start_date = f"{now.year}-01-01"
        if not end_date:
            end_date = now.date().isoformat()

        rows = await query(
            """
            SELECT
                SUM(CASE WHEN status IN ('approved', 'paid') THEN commission_amount_cents ELSE 0 END) AS scheduled_ytd_cents,
                SUM(CASE WHEN status = 'paid' THEN commission_amount_cents ELSE 0 END) AS paid_ytd_cents
            FROM commissions
            WHERE user_id = %s
              AND created_at >= %s
              AND created_at <= %s
              AND status != 'cancelled'
            """,
            [target_user_id, start_date, end_date],
        )
        result = rows[0] if rows else {}
        return {
            "scheduled_ytd_cents": int(result.get("scheduled_ytd_cents") or 0),
            "paid_ytd_cents": int(result.get("paid_ytd_cents") or 0),
        }

    @app.get("/api/commissions/list")
    async def get_commissions_list(
        user_id: Optional[str] = Query(default=None),
        status: Optional[str] = Query(default=None),
        estimate_type: Optional[str] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> list:
        target_user_id = user_id or user["id"]

        if not _can_view_all(user) and target_user_id != user["id"]:
            raise HTTPException(status_code=403, detail="You can only view your own commissions")

        conditions: list[str] = ["c.user_id = %s"]
        params: list[Any] = [target_user_id]

        if status:
            conditions.append("c.status = %s")
            params.append(status)
        if estimate_type:
            conditions.append("e.estimate_type = %s")
            params.append(estimate_type)
        if start_date:
            conditions.append("c.created_at >= %s")
            params.append(start_date)
        if end_date:
            conditions.append("c.created_at <= %s")
            params.append(end_date)

        where_clause = " AND ".join(conditions)

        rows = await query(
            f"""
            SELECT
                c.id, c.estimate_id, c.lead_id, c.user_id,
                c.contract_value_cents, c.commission_rate, c.commission_amount_cents,
                c.status, c.approved_at, c.paid_at, c.payment_period,
                c.notes, c.created_at, c.updated_at,
                u.name AS rep_name, u.email AS rep_email,
                l.property_name,
                e.estimate_number, e.aspire_number, e.estimate_type
            FROM commissions c
            JOIN users u  ON c.user_id   = u.id
            JOIN leads l  ON c.lead_id   = l.id
            JOIN estimates e ON c.estimate_id = e.id
            WHERE {where_clause}
            ORDER BY c.created_at DESC
            """,
            params,
        )
        return [_coerce_row(row) for row in rows]

    @app.post("/api/commissions/{commission_id}/mark-paid")
    async def mark_commission_paid(
        commission_id: str,
        body: MarkPaidBody,
        user: dict = Depends(require_auth),
    ) -> dict:
        if authz.normalize_role(user.get("role")) not in authz.CROSS_BRANCH_ROLES:
            raise HTTPException(status_code=403, detail="Only admin, VP, or CEO can mark commissions as paid")

        result = await execute(
            """
            UPDATE commissions
            SET status = 'paid', paid_at = NOW(), payment_period = %s, updated_at = NOW()
            WHERE id = %s
            """,
            [body.payment_period, commission_id],
        )
        if result == 0:
            raise HTTPException(status_code=404, detail="Commission not found")
        return {"success": True}

    @app.get("/api/commissions/reps")
    async def get_commission_reps(
        user: dict = Depends(require_auth),
    ) -> list:
        if not _can_view_all(user):
            raise HTTPException(status_code=403)

        # Include legacy role aliases (outside_sales → sales) so reps stored
        # under old role values still appear.
        rows = await query(
            """
            SELECT DISTINCT u.id, u.name, u.email
            FROM users u
            JOIN commissions c ON u.id = c.user_id
            WHERE u.role IN ('sales', 'inside_sales', 'outside_sales')
            ORDER BY u.name
            """
        )
        return [_coerce_row(row) for row in rows]
