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


def _is_rep_viewer(user: dict) -> bool:
    """True for REP_VIEWER_ROLES: may pick among reps (which reps: visible_rep_ids)."""
    return authz.normalize_role(user.get("role")) in authz.REP_VIEWER_ROLES


async def _target_reps(user: dict, user_id: Optional[str]) -> Optional[frozenset[str]]:
    """The rep ids a request covers; None = every rep (Handoff 54 §9).

    ?user_id= narrows to one rep and is 403 unless that rep is in the
    caller's visible_rep_ids. Omitted, the caller gets every rep they may
    see: all for CROSS_BRANCH_ROLES, their branches' reps for other viewers,
    themselves for everyone else.
    """
    visible = await authz.visible_rep_ids(user, query)
    if user_id:
        if visible is not None and user_id not in visible:
            raise HTTPException(
                status_code=403,
                detail=(
                    "That rep is outside your branches"
                    if _is_rep_viewer(user)
                    else "You can only view your own sales performance"
                ),
            )
        return frozenset({user_id})
    return visible


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

    @app.get("/api/sales-performance/reps")
    async def get_sales_performance_reps(
        user: dict = Depends(require_auth),
    ) -> list:
        """Return all active sales users for the rep selector dropdown.

        Unlike /api/commissions/reps this does NOT require existing commission
        records — it returns every user in a sales role so the dropdown populates
        even on a fresh DB or when a rep hasn't closed any deals yet.
        """
        authz.require_sales_performance_access(user)
        if not _is_rep_viewer(user):
            raise HTTPException(status_code=403)

        # Handoff 54 §9: branch-scoped viewers list only the reps sharing one
        # of their branches; CROSS_BRANCH_ROLES list everyone.
        visible = await authz.visible_rep_ids(user, query)
        scope_clause, scope_params = authz.rep_id_clause("id", visible)
        placeholders = ", ".join(["%s"] * len(authz.SALES_REP_DB_ROLES))
        rows = await query(
            f"""
            SELECT id, name, email
            FROM users
            WHERE role IN ({placeholders})
              {scope_clause}
            ORDER BY name
            """,
            [*authz.SALES_REP_DB_ROLES, *scope_params],
        )
        return [_coerce_row(row) for row in rows]

    @app.get("/api/sales-performance/summary")
    async def get_sales_performance_summary(
        user_id: Optional[str] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Return KPI summary: won/lost counts, totals, averages, win rate, loss categories.

        ?user_id= narrows to one rep the caller may see (visible_rep_ids). Omitted,
        CROSS_BRANCH_ROLES aggregate across all reps, other REP_VIEWER_ROLES across
        the reps in their branches, and everyone else is scoped to themselves.
        """
        authz.require_sales_performance_access(user)
        # None → all reps; otherwise the visible (or requested) rep ids.
        target_reps = await _target_reps(user, user_id)

        start_date, end_date = _default_date_range(start_date, end_date)

        # ── Won query: commissions table (one row per won deal) ──────────────
        won_user_clause, won_scope = authz.rep_id_clause("user_id", target_reps)
        won_params: list[Any] = [start_date, end_date, *won_scope]

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
        # estimates has no user_id; the salesperson is crm_rep (users.id).
        lost_user_clause, lost_scope = authz.rep_id_clause("e.crm_rep", target_reps)
        lost_params: list[Any] = [start_date, end_date, *lost_scope]

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
        cat_params: list[Any] = [start_date, end_date, *lost_scope]

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
        authz.require_sales_performance_access(user)
        # None → all reps; otherwise the visible (or requested) rep ids.
        target_reps = await _target_reps(user, user_id)

        start_date, end_date = _default_date_range(start_date, end_date)

        user_clause, scope = authz.rep_id_clause("c.user_id", target_reps)
        params: list[Any] = [start_date, end_date, *scope]

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
        authz.require_sales_performance_access(user)
        # None → all reps; otherwise the visible (or requested) rep ids.
        target_reps = await _target_reps(user, user_id)

        start_date, end_date = _default_date_range(start_date, end_date)

        # estimates has no user_id; the salesperson is crm_rep (users.id).
        user_clause, scope = authz.rep_id_clause("e.crm_rep", target_reps)
        params: list[Any] = [start_date, end_date, *scope]

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
            -- crm_rep is nullable, so keep lost deals that have no salesperson.
            LEFT JOIN users u ON e.crm_rep = u.id
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
