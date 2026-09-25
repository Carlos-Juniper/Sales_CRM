"""Create and cancel commissions when an estimate is won or lost.

Rate precedence (the user's role is not a gate):
  1. Active v_current_commission_plans row → that plan's rules. The legacy
     rate query does not run.
  2. Else an active v_current_commission_rates row → today's flat rate on
     contract_value_cents, plan_key left NULL. Payout timing still comes
     from the standard plan rule for this estimate type.
  3. Else a maintenance or install estimate → the standard plan.
  4. Else no-op.

Installment rows follow the matched rule's payout_schedule. A missing
schedule is logged and the commission still gets installment 1, stored as
pending_billing_data with a null amount and a null date, so a won commission
is never committed with zero installments. The commission insert and the
installment insert commit in one transaction. If the installment insert
fails, the commission insert rolls back, and a retry is not blocked by
INSERT IGNORE.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from db import execute, query, transaction
from api.commission_calc import (
    PENDING_BILLING_DATA,
    PLAN_ESTIMATE_TYPES,
    STANDARD_PLAN_KEY,
    build_installment_rows,
    calendar_date,
    compute_plan_amount,
    effective_rate,
)

logger = logging.getLogger(__name__)

_UNRESOLVED_CLIENT_NOTE = (
    "client_type unresolved; provisional new-client construction tiers applied. "
    "No reliable new-vs-existing signal on the lead, property, or Aspire record."
)

_ESTIMATE_SQL = """
SELECT e.contract_value_cents, e.lead_id, e.estimate_type,
       e.service_start_date, l.crm_rep AS crm_rep_id
FROM estimates e
JOIN leads l ON l.id = e.lead_id
WHERE e.id = %s
"""

_PRIOR_INSTALL_SQL = """
SELECT COALESCE(SUM(c.contract_value_cents), 0) AS prior_cents
FROM commissions c
JOIN estimates e ON e.id = c.estimate_id
WHERE c.user_id = %s
  AND c.status != 'cancelled'
  AND e.estimate_type = 'install'
  AND c.estimate_id <> %s
  AND YEAR(COALESCE(CONVERT_TZ(c.created_at, '+00:00', 'America/New_York'), c.created_at)) = %s
  AND (c.client_type = 'new' OR c.client_type IS NULL)
"""

_RULES_SQL = """
SELECT tier_min_cents, tier_max_cents, rate, basis, payout_schedule
FROM (
    SELECT
        tier_min_cents, tier_max_cents, rate, basis, payout_schedule, effective_date,
        MAX(effective_date) OVER (
            PARTITION BY plan_key, estimate_type, client_type
        ) AS max_effective
    FROM commission_plan_rules
    WHERE plan_key = %s
      AND estimate_type = %s
      AND effective_date <= CURDATE()
      AND client_type <=> %s
) latest
WHERE effective_date = max_effective
ORDER BY tier_min_cents
"""


@dataclass(frozen=True)
class CommissionBasis:
    plan_key: Optional[str]
    amount_cents: int
    rate: Decimal
    payout_schedule: Optional[str]
    client_type: Optional[str]
    notes: Optional[str]


async def _lookup_payout_schedule(plan_key: str, estimate_type: str) -> Optional[str]:
    """First schedule found for the requested plan, then the standard plan.

    The warning names the plan that was asked for, even when the standard
    plan was also checked.
    """
    for key in dict.fromkeys([plan_key, STANDARD_PLAN_KEY]):
        rows = await query(
            """
            SELECT payout_schedule
            FROM commission_plan_rules
            WHERE plan_key = %s
              AND estimate_type = %s
              AND effective_date <= CURDATE()
              AND payout_schedule IS NOT NULL
            ORDER BY effective_date DESC
            LIMIT 1
            """,
            [key, estimate_type],
        )
        if rows and rows[0].get("payout_schedule"):
            return str(rows[0]["payout_schedule"])
    logger.warning(
        "No payout_schedule for plan %s estimate type %s",
        plan_key, estimate_type,
    )
    return None


def _schedule_from_rules(rules: list[dict]) -> Optional[str]:
    for rule in rules:
        schedule = rule.get("payout_schedule")
        if schedule:
            return str(schedule)
    return None


async def _plan_basis(
    plan_key: str,
    estimate_type: str,
    contract_value_cents: int,
    user_id: str,
    estimate_id: str,
    close_year: int,
) -> Optional[CommissionBasis]:
    """One plan basis, or None when the rules cannot price this estimate."""
    client_type = None
    notes = None
    cumulative_before = 0
    bucket = None
    if estimate_type == "install":
        bucket = "new"
        notes = _UNRESOLVED_CLIENT_NOTE
        prior_rows = await query(
            _PRIOR_INSTALL_SQL, [user_id, estimate_id, close_year],
        )
        cumulative_before = int(prior_rows[0]["prior_cents"]) if prior_rows else 0
    rules = await query(_RULES_SQL, [plan_key, estimate_type, bucket])
    amount = compute_plan_amount(
        estimate_type=estimate_type,
        contract_value_cents=contract_value_cents,
        rules=rules,
        cumulative_before_cents=cumulative_before,
    )
    if amount is None:
        logger.warning(
            "No computable commission rule for plan %s estimate %s type %s",
            plan_key, estimate_id, estimate_type,
        )
        return None
    schedule = _schedule_from_rules(rules)
    if schedule is None:
        schedule = await _lookup_payout_schedule(plan_key, estimate_type)
    return CommissionBasis(
        plan_key=plan_key,
        amount_cents=amount,
        rate=effective_rate(amount, contract_value_cents),
        payout_schedule=schedule,
        client_type=client_type,
        notes=notes,
    )


async def _legacy_basis(
    user_id: str,
    estimate_type: str,
    contract_value_cents: int,
) -> Optional[CommissionBasis]:
    """Flat commission_rates amount. None when the rep has no active rate."""
    rows = await query(
        """
        SELECT commission_rate
        FROM v_current_commission_rates
        WHERE user_id = %s
        ORDER BY effective_date DESC
        LIMIT 1
        """,
        [user_id],
    )
    if not rows or rows[0].get("commission_rate") is None:
        return None
    rate = Decimal(str(rows[0]["commission_rate"]))
    amount = round(contract_value_cents * float(rate))
    schedule = await _lookup_payout_schedule(STANDARD_PLAN_KEY, estimate_type)
    return CommissionBasis(
        plan_key=None,
        amount_cents=amount,
        rate=rate,
        payout_schedule=schedule,
        client_type=None,
        notes=None,
    )


async def _resolve_basis(row: dict, estimate_id: str, close_year: int) -> Optional[CommissionBasis]:
    """Plan assignment wins and skips the legacy rate query."""
    user_id = row["crm_rep_id"]
    estimate_type = row.get("estimate_type") or ""
    contract_value_cents = int(row.get("contract_value_cents") or 0)
    assignment = await query(
        "SELECT plan_key FROM v_current_commission_plans WHERE user_id = %s",
        [user_id],
    )
    plan_key = assignment[0].get("plan_key") if assignment else None
    if plan_key:
        return await _plan_basis(
            str(plan_key), estimate_type, contract_value_cents,
            user_id, estimate_id, close_year,
        )
    legacy = await _legacy_basis(user_id, estimate_type, contract_value_cents)
    if legacy is not None:
        return legacy
    if estimate_type in PLAN_ESTIMATE_TYPES:
        return await _plan_basis(
            STANDARD_PLAN_KEY, estimate_type, contract_value_cents,
            user_id, estimate_id, close_year,
        )
    return None


def _pending_installment_one() -> dict:
    """Installment 1 when the plan has no payout schedule.

    The commission amount stays on the commission row. The check amount and
    date stay null until a schedule exists.
    """
    return {
        "installment_number": 1,
        "payout_period": None,
        "payout_date": None,
        "amount_cents": None,
        "status": PENDING_BILLING_DATA,
        "billing_installment_number": None,
        "collected_amount_cents": None,
    }


async def _insert_commission_installments(commission_id: str, rows: list[dict]) -> None:
    """Persist payout installments. Dates and amounts may be null."""
    if not rows:
        return
    params: list = []
    placeholders: list[str] = []
    for row in rows:
        placeholders.append("(%s, %s, %s, %s, %s, %s, %s, %s, %s)")
        payout = row.get("payout_date")
        params.extend([
            str(uuid.uuid4()),
            commission_id,
            row["installment_number"],
            row.get("payout_period"),
            None if payout is None else payout.isoformat(),
            row.get("amount_cents"),
            row.get("status") or "scheduled",
            row.get("billing_installment_number"),
            row.get("collected_amount_cents"),
        ])
    values_sql = ", ".join(placeholders)
    await execute(
        f"""
        INSERT INTO commission_installments
            (id, commission_id, installment_number, payout_period_label,
             payout_date, amount_cents, status, billing_installment_number,
             collected_amount_cents)
        VALUES {values_sql}
        """,
        params,
    )


async def _persist_won_commission(estimate_id: str, row: dict, basis: CommissionBasis) -> None:
    now_utc = datetime.now(timezone.utc).replace(microsecond=0)
    raw_start = row.get("service_start_date")
    contract_start = calendar_date(raw_start) if raw_start else None
    installments: list[dict] = []
    if basis.payout_schedule:
        installments = build_installment_rows(
            now_utc, basis.amount_cents, basis.payout_schedule, contract_start,
        )
    if not installments:
        logger.error(
            "No payout schedule for estimate %s plan %s; "
            "inserting installment 1 as pending_billing_data",
            estimate_id, basis.plan_key,
        )
        installments = [_pending_installment_one()]
    commission_id = str(uuid.uuid4())
    async with transaction():
        inserted = await execute(
            """
            INSERT IGNORE INTO commissions
                (id, estimate_id, lead_id, user_id, contract_value_cents,
                 commission_rate, commission_amount_cents, status, approved_at,
                 plan_key, client_type, notes, contract_start_date, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'approved', %s, %s, %s, %s, %s, %s)
            """,
            [
                commission_id, estimate_id, row["lead_id"], row["crm_rep_id"],
                int(row.get("contract_value_cents") or 0),
                basis.rate, basis.amount_cents, now_utc,
                basis.plan_key, basis.client_type, basis.notes,
                None if contract_start is None else contract_start.isoformat(),
                now_utc,
            ],
        )
        if not inserted:
            return
        await _insert_commission_installments(commission_id, installments)


async def create_on_won(estimate_id: str) -> None:
    """Insert a commission and its payout installments when an estimate is won.

    No-ops when the estimate has no lead or the lead has no crm_rep.
    Idempotent: the UNIQUE KEY on estimate_id makes a duplicate won a no-op.
    The commission insert and the installment insert commit together.
    """
    rows = await query(_ESTIMATE_SQL, [estimate_id])
    if not rows:
        return
    row = rows[0]
    if not row.get("crm_rep_id") or not row.get("lead_id"):
        return
    close_year = calendar_date(datetime.now(timezone.utc)).year
    basis = await _resolve_basis(row, estimate_id, close_year)
    if basis is None:
        return
    await _persist_won_commission(estimate_id, row, basis)


async def cancel_commission(commission_id: str) -> None:
    """Cancel a commission and every installment that has not been paid.

    Both updates run in one transaction. Paid installments stay paid.
    """
    async with transaction():
        await execute(
            """
            UPDATE commissions
            SET status = 'cancelled', updated_at = NOW()
            WHERE id = %s
            """,
            [commission_id],
        )
        await execute(
            """
            UPDATE commission_installments
            SET status = 'cancelled', updated_at = NOW()
            WHERE commission_id = %s
              AND status != 'paid'
            """,
            [commission_id],
        )


async def cancel_for_estimate(estimate_id: str) -> None:
    """Cancel every open commission on an estimate that was marked lost."""
    rows = await query(
        """
        SELECT id
        FROM commissions
        WHERE estimate_id = %s
          AND status != 'cancelled'
        """,
        [estimate_id],
    )
    for row in rows:
        await cancel_commission(row["id"])
