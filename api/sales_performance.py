"""Sales Performance API — /api/sales-performance/* routes.

Surfaces win/loss metrics for sales reps: summary KPIs (win rate, deal counts,
average contract value, loss category breakdown), a won-deals list, and a
lost-deals list.  All three endpoints share the same auth, date-defaulting, and
user-scoping patterns used by api/commissions.py.

Mirrors the register(app, require_auth) module pattern from api/commissions.py.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query

from db import query
from api import authz

logger = logging.getLogger(__name__)


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
    """True if the authenticated user may view any rep's sales performance data."""
    return authz.normalize_role(user.get("role")) in authz.REP_VIEWER_ROLES


def _default_date_range(start_date: Optional[str], end_date: Optional[str]) -> tuple[str, str]:
    """Return (start_date, end_date), defaulting to Jan 1 of the current year through today."""
    now = datetime.now(tz=timezone.utc)
    if not start_date:
        start_date = f"{now.year}-01-01"
    if not end_date:
        end_date = now.date().isoformat()
    return start_date, end_date


def register(app, require_auth) -> None:
    """Attach all sales-performance routes to the FastAPI app with the shared auth dep."""

    @app.get("/api/sales-performance/summary")
    async def get_sales_performance_summary(
        user_id: Optional[str] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Return KPI summary: won/lost counts, totals, averages, win rate, loss categories.

        Admins (CROSS_BRANCH_ROLES) may pass ?user_id= to scope to a specific rep, or
        omit it to aggregate across all reps.  Non-admins are always scoped to themselves.
        """
        can_view_all = _can_view_all(user)

        # Determine the target user: non-admins are always self-scoped.
        # Admins with no user_id param get aggregate data (target_user_id=None).
        if not can_view_all:
            if user_id and user_id != user["id"]:
                raise HTTPException(
                    status_code=403,
                    detail="You can only view your own sales performance",
                )
            target_user_id: Optional[str] = user["id"]
        else:
            target_user_id = user_id or None  # None → all reps

        start_date, end_date = _default_date_range(start_date, end_date)

        # ── Won query: commissions table (one row per won deal) ──────────────
        won_params: list[Any] = [start_date, end_date]
        won_user_clause = ""
        if target_user_id:
            won_user_clause = "AND user_id = %s"
            won_params.append(target_user_id)

        won_rows = await query(
            f"""
            SELECT
                COUNT(*) AS won_count,
                COALESCE(SUM(contract_value_cents), 0) AS won_total_cents
            FROM commissions
            WHERE status != 'cancelled'
              AND created_at >= %s AND created_at <= %s
              {won_user_clause}
            """,
            won_params,
        )
        won = won_rows[0] if won_rows else {}
        won_count = int(won.get("won_count") or 0)
        won_total_cents = int(won.get("won_total_cents") or 0)

        # ── Lost query: estimates + transition log ────────────────────────────
        # Use MAX(at) per estimate so we match on the most recent 'lost' transition,
        # which is the canonical lost date even if the estimate was re-opened and
        # re-lost (edge case).
        lost_params: list[Any] = [start_date, end_date]
        lost_user_clause = ""
        if target_user_id:
            lost_user_clause = "AND e.user_id = %s"
            lost_params.append(target_user_id)

        lost_rows = await query(
            f"""
            SELECT
                COUNT(*) AS lost_count,
                COALESCE(SUM(e.contract_value_cents), 0) AS lost_total_cents
            FROM estimates e
            JOIN (
                SELECT estimate_id, MAX(`at`) AS lost_at
                FROM estimate_status_transitions
                WHERE to_status = 'lost'
                GROUP BY estimate_id
            ) t ON t.estimate_id = e.id
            WHERE e.status = 'lost'
              AND t.lost_at >= %s AND t.lost_at <= %s
              {lost_user_clause}
            """,
            lost_params,
        )
        lost = lost_rows[0] if lost_rows else {}
        lost_count = int(lost.get("lost_count") or 0)
        lost_total_cents = int(lost.get("lost_total_cents") or 0)

        # ── Loss category breakdown ───────────────────────────────────────────
        cat_params: list[Any] = [start_date, end_date]
        if target_user_id:
            cat_params.append(target_user_id)

        cat_rows = await query(
            f"""
            SELECT
                e.aspire_lost_reason_id,
                COUNT(*) AS count,
                COALESCE(SUM(e.contract_value_cents), 0) AS total_cents
            FROM estimates e
            JOIN (
                SELECT estimate_id, MAX(`at`) AS lost_at
                FROM estimate_status_transitions
                WHERE to_status = 'lost'
                GROUP BY estimate_id
            ) t ON t.estimate_id = e.id
            WHERE e.status = 'lost'
              AND t.lost_at >= %s AND t.lost_at <= %s
              {lost_user_clause}
            GROUP BY e.aspire_lost_reason_id
            ORDER BY total_cents DESC
            """,
            cat_params,
        )

        loss_categories = [
            {
                "aspire_lost_reason_id": r.get("aspire_lost_reason_id"),
                "count": int(r.get("count") or 0),
                "total_cents": int(r.get("total_cents") or 0),
            }
            for r in cat_rows
        ]

        # ── Derived metrics ───────────────────────────────────────────────────
        total_closed = won_count + lost_count
        win_rate = won_count / total_closed if total_closed > 0 else 0.0
        won_avg_cents = won_total_cents // won_count if won_count > 0 else 0
        lost_avg_cents = lost_total_cents // lost_count if lost_count > 0 else 0

        return {
            "won_count": won_count,
            "won_total_cents": won_total_cents,
            "won_avg_cents": won_avg_cents,
            "lost_count": lost_count,
            "lost_total_cents": lost_total_cents,
            "lost_avg_cents": lost_avg_cents,
            "win_rate": win_rate,
            "loss_categories": loss_categories,
        }

    @app.get("/api/sales-performance/won-deals")
    async def get_won_deals(
        user_id: Optional[str] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> list:
        """Return the list of won deals (commission rows) for a rep or all reps.

        Each row includes the property name, estimate type, notes, Aspire number,
        and the rep's name/email for admin views.
        """
        can_view_all = _can_view_all(user)

        if not can_view_all:
            if user_id and user_id != user["id"]:
                raise HTTPException(
                    status_code=403,
                    detail="You can only view your own sales performance",
                )
            target_user_id: Optional[str] = user["id"]
        else:
            target_user_id = user_id or None

        start_date, end_date = _default_date_range(start_date, end_date)

        params: list[Any] = [start_date, end_date]
        user_clause = ""
        if target_user_id:
            user_clause = "AND c.user_id = %s"
            params.append(target_user_id)

        rows = await query(
            f"""
            SELECT
                c.id,
                c.estimate_id,
                c.contract_value_cents,
                c.created_at AS won_at,
                l.property_name,
                e.estimate_type,
                e.notes,
                e.aspire_number,
                u.name AS rep_name,
                u.email AS rep_email
            FROM commissions c
            JOIN estimates e ON c.estimate_id = e.id
            JOIN leads l     ON c.lead_id     = l.id
            JOIN users u     ON c.user_id     = u.id
            WHERE c.status != 'cancelled'
              AND c.created_at >= %s AND c.created_at <= %s
              {user_clause}
            ORDER BY c.created_at DESC
            """,
            params,
        )
        return [_coerce_row(row) for row in rows]

    @app.get("/api/sales-performance/lost-deals")
    async def get_lost_deals(
        user_id: Optional[str] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> list:
        """Return the list of lost estimates for a rep or all reps.

        Groups by estimate so each deal appears once even if the status was
        toggled multiple times; lost_at is the most recent 'lost' transition.
        """
        can_view_all = _can_view_all(user)

        if not can_view_all:
            if user_id and user_id != user["id"]:
                raise HTTPException(
                    status_code=403,
                    detail="You can only view your own sales performance",
                )
            target_user_id: Optional[str] = user["id"]
        else:
            target_user_id = user_id or None

        start_date, end_date = _default_date_range(start_date, end_date)

        params: list[Any] = [start_date, end_date]
        user_clause = ""
        if target_user_id:
            user_clause = "AND e.user_id = %s"
            params.append(target_user_id)

        rows = await query(
            f"""
            SELECT
                e.id,
                e.contract_value_cents,
                e.estimate_type,
                e.notes,
                e.aspire_number,
                e.aspire_lost_reason_id,
                l.property_name,
                u.name AS rep_name,
                u.email AS rep_email,
                MAX(t.`at`) AS lost_at
            FROM estimates e
            JOIN leads l ON e.lead_id = l.id
            JOIN users u ON e.user_id = u.id
            JOIN estimate_status_transitions t
                ON t.estimate_id = e.id AND t.to_status = 'lost'
            WHERE e.status = 'lost'
              AND t.`at` >= %s AND t.`at` <= %s
              {user_clause}
            GROUP BY
                e.id, e.contract_value_cents, e.estimate_type, e.notes,
                e.aspire_number, e.aspire_lost_reason_id, l.property_name,
                u.name, u.email
            ORDER BY lost_at DESC
            """,
            params,
        )
        return [_coerce_row(row) for row in rows]
