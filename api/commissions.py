"""Commissions API — /api/commissions/* routes.

Tracks sales rep commission rates and earned commissions. Commission rates are
entered manually by administrators. Commissions are inserted by
api/commission_service.py (create_on_won) when an estimate transitions to
'won', and cancelled by cancel_for_estimate when it transitions to 'lost'.

Payout cadence is the estimate type: maintenance is three installments and
install waits on billing. Due vs upcoming is derived at read time from
America/New_York today and is not stored. Mark-paid writes live in
api/commission_service.py.

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

from db import query
from api import authz
from api import commission_service
from api.commission_calc import close_quarter_label, eastern_year_utc_bounds, et_today
from api.commission_schedule import (
    build_payout_schedule,
    commission_payout_period,
    public_installment,
    summarize_open_installments,
)

logger = logging.getLogger(__name__)


class MarkPaidBody(BaseModel):
    payment_period: str


_MARK_PAID_FORBIDDEN = "Only admin, VP, or CEO can mark commissions as paid"


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
    return authz.normalize_role(user.get("role")) in authz.REP_VIEWER_ROLES


def _require_own_or_viewer(user: dict, target_user_id: str) -> None:
    if not _can_view_all(user) and target_user_id != user["id"]:
        raise HTTPException(status_code=403, detail="You can only view your own commissions")


def _require_mark_paid(user: dict) -> None:
    """Admin, VP, or CEO only.

    Manager and regional director may view another rep's commissions. They
    cannot mark a commission or an installment paid. regional_sales_rep was
    scrapped and is not a mark-paid role.
    """
    if authz.normalize_role(user.get("role")) not in authz.CROSS_BRANCH_ROLES:
        raise HTTPException(status_code=403, detail=_MARK_PAID_FORBIDDEN)


_REP_PLAN_SQL = """
SELECT plan_key, plan_name
FROM v_current_commission_plans
WHERE user_id = %s
"""


async def _current_rep_plan(user_id: str) -> tuple[Optional[str], Optional[str]]:
    """Active user_commission_plans row. (None, None) when the rep has none.

    A missing assignment leaves legacy commission_rates in force. Do not
    substitute the standard plan.
    """
    rows = await query(_REP_PLAN_SQL, [user_id])
    if not rows:
        return None, None
    plan_key = rows[0].get("plan_key") or None
    plan_name = rows[0].get("plan_name") or None
    return plan_key, plan_name


def register(app, require_auth) -> None:
    """Attach all commission routes to the FastAPI app with the shared auth dep."""

    @app.get("/api/commissions/summary")
    async def get_commission_summary(
        user_id: Optional[str] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Closed-deal totals for the period, plus open checks as of today.

        scheduled_ytd_cents and paid_ytd_cents follow start_date and end_date
        (commission created_at). next_payout, upcoming_cents, and due_cents
        are open dated checks as of today in America/New_York. They are not
        filtered by start_date or end_date.

        plan_key and plan_name are the requested rep's current
        user_commission_plans row. Both are null when that rep has no
        assignment, so a legacy commission_rates row stays visible.
        """
        target_user_id = user_id or user["id"]
        _require_own_or_viewer(user, target_user_id)

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
        today = et_today()
        inst_rows = await query(
            """
            SELECT
                i.id, i.installment_number, i.payout_period_label, i.payout_date,
                i.amount_cents, i.status, c.status AS commission_status
            FROM commission_installments i
            JOIN commissions c ON c.id = i.commission_id
            WHERE c.user_id = %s
              AND c.status != 'cancelled'
              AND i.status != 'cancelled'
            """,
            [target_user_id],
        )
        public = [
            public_installment(row, row["commission_status"], today)
            for row in inst_rows
        ]
        open_money = summarize_open_installments(public)
        plan_key, plan_name = await _current_rep_plan(target_user_id)
        return {
            "scheduled_ytd_cents": int(result.get("scheduled_ytd_cents") or 0),
            "paid_ytd_cents": int(result.get("paid_ytd_cents") or 0),
            "next_payout": open_money["next_payout"],
            "upcoming_cents": open_money["upcoming_cents"],
            "due_cents": open_money["due_cents"],
            "plan_key": plan_key,
            "plan_name": plan_name,
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
        """Commissions for the signed-in rep, or the requested rep.

        Each row's plan_key is the plan stored on that commission. plan_name
        is the rep's current user_commission_plans name, null when the rep
        has no assignment.
        """
        target_user_id = user_id or user["id"]
        _require_own_or_viewer(user, target_user_id)

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
                c.plan_key, c.client_type, c.contract_start_date,
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
        ids = [row["id"] for row in rows if row.get("id")]
        inst_by: dict[str, list] = {cid: [] for cid in ids}
        raw_by: dict[str, list] = {cid: [] for cid in ids}
        if ids:
            placeholders = ", ".join(["%s"] * len(ids))
            inst_rows = await query(
                f"""
                SELECT id, commission_id, installment_number, payout_period_label,
                       payout_date, amount_cents, status,
                       billing_installment_number, collected_amount_cents
                FROM commission_installments
                WHERE commission_id IN ({placeholders})
                ORDER BY installment_number
                """,
                ids,
            )
            today = et_today()
            status_by_id = {row["id"]: row["status"] for row in rows if row.get("id")}
            for inst in inst_rows:
                cid = inst.get("commission_id")
                if not cid or cid not in inst_by:
                    continue
                raw_by[cid].append(inst)
                inst_by[cid].append(
                    public_installment(inst, status_by_id[cid], today)
                )
        rep_plan_key, rep_plan_name = await _current_rep_plan(target_user_id)
        out = []
        for row in rows:
            item = _coerce_row(row)
            created = row.get("created_at")
            item["close_quarter"] = close_quarter_label(created) if created else None
            # Commission snapshot. The rep's current assignment is plan_name
            # (and rep_plan_key) so a legacy row is not relabeled standard.
            item["plan_key"] = row.get("plan_key")
            item["rep_plan_key"] = rep_plan_key
            item["plan_name"] = rep_plan_name
            item["contract_start_date"] = item.get("contract_start_date")
            installments = inst_by.get(row.get("id"), []) if row.get("id") else []
            item["installments"] = installments
            item["payable"] = commission_service.commission_is_payable(
                row.get("status") or "",
                raw_by.get(row.get("id"), []) if row.get("id") else [],
            )
            period = commission_payout_period(row.get("payment_period"), installments)
            item["payout_period"] = period
            item["payout_period_label"] = period
            out.append(item)
        return out

    @app.get("/api/commissions/payout-schedule")
    async def get_payout_schedule(
        user_id: Optional[str] = Query(default=None),
        year: Optional[int] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Closed quarters and the checks they hit.

        `year`, when sent, is a half-open UTC range on commissions.created_at:
        Jan 1 00:00 Eastern through Jan 1 00:00 Eastern of the next year.
        start_date and end_date narrow that window. They do not replace it.

        When start_date and end_date are both sent and `year` is omitted, the
        filter is only that close-date range. There is no default year, so a
        December-to-January period is not clipped. The response `year` is null.

        With no year and fewer than both bounds, year defaults to this Eastern
        year. A single bound still narrows that default year.

        amount_cents is null when every installment in the group has no
        amount. amount_partial is true when the total omits unknown amounts.
        Undated rows are split: bucket `unscheduled` (amount known) and
        bucket `pending_billing_data` (amount unknown). Undated periods sort
        last.
        """
        target_user_id = user_id or user["id"]
        _require_own_or_viewer(user, target_user_id)
        today = et_today()
        # Both bounds and no year: the client's range is the whole filter.
        range_only = year is None and bool(start_date) and bool(end_date)
        if range_only:
            close_year = None
        else:
            close_year = year if year is not None else today.year
        conditions = [
            "c.user_id = %s",
            "c.status != 'cancelled'",
        ]
        params: list[Any] = [target_user_id]
        if close_year is not None:
            year_start, year_end = eastern_year_utc_bounds(close_year)
            conditions.append("c.created_at >= %s")
            conditions.append("c.created_at < %s")
            params.extend([year_start, year_end])
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
                c.id AS commission_id,
                c.commission_amount_cents,
                c.status AS commission_status,
                c.created_at,
                i.id,
                i.installment_number,
                i.payout_period_label,
                i.payout_date,
                i.amount_cents,
                i.status,
                i.billing_installment_number,
                i.collected_amount_cents
            FROM commissions c
            LEFT JOIN commission_installments i ON i.commission_id = c.id
            WHERE {where_clause}
            ORDER BY c.created_at, i.installment_number
            """,
            params,
        )
        deals_by_id: dict[str, dict] = {}
        for row in rows:
            if row.get("created_at") is None or row.get("commission_id") is None:
                continue
            deal = deals_by_id.get(row["commission_id"])
            if deal is None:
                deal = {
                    "close_quarter": close_quarter_label(row["created_at"]),
                    "commission_amount_cents": int(row.get("commission_amount_cents") or 0),
                    "installments": [],
                }
                deals_by_id[row["commission_id"]] = deal
            if row.get("id"):
                deal["installments"].append(
                    public_installment(row, row["commission_status"], today)
                )
        schedule = build_payout_schedule(list(deals_by_id.values()))
        return {
            "user_id": target_user_id,
            "year": close_year,
            "quarters": schedule["quarters"],
            "by_payout_period": schedule["by_payout_period"],
        }

    @app.post("/api/commissions/installments/{installment_id}/mark-paid")
    async def mark_installment_paid(
        installment_id: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Mark one installment paid. See commission_service.mark_installment_paid."""
        _require_mark_paid(user)
        await commission_service.mark_installment_paid(installment_id)
        return {"success": True}

    @app.post("/api/commissions/{commission_id}/mark-paid")
    async def mark_commission_paid(
        commission_id: str,
        body: MarkPaidBody,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Mark the commission and its open installments paid.

        mark_commission_paid returns 409 and writes nothing when the
        commission is cancelled or any installment is pending_billing_data,
        cancelled, or has a null amount. Already-paid rows keep paid_at.
        The installment update excludes cancelled rows. A missing commission
        is 404. The request body's payment_period is stored on the commission.
        """
        _require_mark_paid(user)
        await commission_service.mark_commission_paid(commission_id, body.payment_period)
        return {"success": True}

    @app.get("/api/commissions/reps")
    async def get_commission_reps(
        user: dict = Depends(require_auth),
    ) -> list:
        if not _can_view_all(user):
            raise HTTPException(status_code=403, detail="Only admin, VP, or CEO can view all reps")

        # Include legacy role aliases (outside_sales → sales) and the split
        # field-sales roles so a reassigned rep still appears.
        # v_current_commission_rates (mig 054) owns the active-rate predicate;
        # use it here instead of re-implementing the date filter inline.
        # Correlated subqueries return one rate per user (latest effective_date)
        # as a defensive tie-break; mig 055 adds the UNIQUE constraint that
        # makes multiple active rows structurally impossible.
        # plan_key and plan_name stay null when the rep has no
        # user_commission_plans row. Do not fill the standard plan: a null
        # plan leaves commission_rate (legacy commission_rates) visible.
        # regional_sales_rep is not a role and is not in this list.
        role_placeholders = ", ".join(["%s"] * len(authz.SALES_REP_DB_ROLES))
        rows = await query(
            f"""
            SELECT
                u.id,
                u.name,
                u.email,
                (SELECT v.commission_rate
                 FROM v_current_commission_rates v
                 WHERE v.user_id = u.id
                 ORDER BY v.effective_date DESC
                 LIMIT 1) AS commission_rate,
                (SELECT v.effective_date
                 FROM v_current_commission_rates v
                 WHERE v.user_id = u.id
                 ORDER BY v.effective_date DESC
                 LIMIT 1) AS effective_date,
                p.plan_key,
                p.plan_name
            FROM (
                SELECT DISTINCT u2.id, u2.name, u2.email
                FROM users u2
                JOIN commissions c ON u2.id = c.user_id
                WHERE u2.role IN ({role_placeholders})
            ) u
            LEFT JOIN v_current_commission_plans p ON p.user_id = u.id
            ORDER BY u.name
            """,
            list(authz.SALES_REP_DB_ROLES),
        )
        return [_coerce_row(row) for row in rows]
