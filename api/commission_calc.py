"""Pure commission cadence and plan math.

Payout timing comes from the plan rule's payout_schedule.

maintenance_3_payment follows the maintenance program: payment 1 is 3% of 50%
of contract value at the end of the quarter the contract starts in; payment 2
is 3% of the other 50% and waits on the 6th billing installment; payment 3 is
3% of additional revenue through 12 months and waits on the 12th installment.
construction_billing_quarterly and enhancement_month_after_quarter wait on
billing and collections. This module does not invent those dates.

Nothing in this module reads the database — callers pass rows in and get cents
and dates out.

Close timestamps are evaluated in America/New_York. Naive datetimes are UTC,
which matches a TIMESTAMP read back on a UTC session (Cloud SQL default).
A date with no time is already a calendar date and is not shifted.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional, Sequence
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

_MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

# Last-resort label when the standard plan row is missing. The seed in
# migration 065 is the source of truth for the name.
STANDARD_PLAN_KEY = "standard"
STANDARD_PLAN_NAME = "Standard Sales Commission"

# Stored on commission_plan_rules.payout_schedule. Callers pass the value
# through; this module does not pick a schedule on its own.
MAINTENANCE_3_PAYMENT = "maintenance_3_payment"
CONSTRUCTION_BILLING_QUARTERLY = "construction_billing_quarterly"
ENHANCEMENT_MONTH_AFTER_QUARTER = "enhancement_month_after_quarter"
PENDING_BILLING_DATA = "pending_billing_data"

# Standard-plan estimate types. Resolution uses the estimate, not a role name.
PLAN_ESTIMATE_TYPES = frozenset({"maintenance", "install", "enhancement"})


@dataclass(frozen=True)
class CommissionTier:
    tier_min_cents: int
    tier_max_cents: Optional[int]
    rate: Decimal


def et_today() -> date:
    """Today's calendar date in America/New_York."""
    return datetime.now(ET).date()


def to_et(dt: datetime) -> datetime:
    """Convert a timestamp to America/New_York. Naive values are UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ET)


def close_date_of(value: Any) -> date:
    """Calendar close date in America/New_York.

    Datetimes (aware, or naive-as-UTC) convert to Eastern. A date, or a
    `YYYY-MM-DD` string, is returned unchanged so a payout DATE is never
    shifted across midnight.
    """
    if isinstance(value, datetime):
        return to_et(value).date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if len(text) <= 10:
        return date.fromisoformat(text[:10])
    text = text.replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    return to_et(datetime.fromisoformat(text)).date()


def calendar_date(value: Any) -> date:
    """A stored DATE (payout date) with no timezone conversion."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def close_quarter_label(value: Any) -> str:
    """`2026-Q1` for the Eastern calendar quarter of a close timestamp."""
    closed = close_date_of(value)
    quarter = (closed.month - 1) // 3 + 1
    return f"{closed.year}-Q{quarter}"


def period_label(payout: date) -> str:
    """`April 2026`, matching commissions.payment_period."""
    return f"{_MONTHS[payout.month - 1]} {payout.year}"


def maintenance_known_halves(annual_commission_cents: int) -> tuple[int, int]:
    """Payments 1 and 2 of a maintenance commission.

    Each is 3% of 50% of contract value, which together are the full annual
    commission already calculated from the contract. Payment 1 rounds half-up.
    Payment 2 keeps the remainder so the pair sums to that annual amount.
    Payment 3 is additional billed revenue and is not included here.
    """
    total = int(annual_commission_cents)
    first = int(
        (Decimal(total) * Decimal("0.5")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    if first > total:
        first = total
    if first < 0:
        first = 0
    return first, total - first


def quarter_end_date(closed: date) -> date:
    """Last calendar day of the close quarter (install payout date)."""
    quarter = (closed.month - 1) // 3 + 1
    year = closed.year
    if quarter == 1:
        return date(year, 3, 31)
    if quarter == 2:
        return date(year, 6, 30)
    if quarter == 3:
        return date(year, 9, 30)
    return date(year, 12, 31)


def _pending_row(
    number: int,
    amount_cents: Optional[int],
    billing_installment_number: Optional[int] = None,
) -> dict:
    return {
        "installment_number": number,
        "payout_period": None,
        "payout_date": None,
        "amount_cents": amount_cents,
        "status": PENDING_BILLING_DATA,
        "billing_installment_number": billing_installment_number,
        "collected_amount_cents": None,
    }


def build_installment_rows(
    close_at: Any,
    total_cents: int,
    payout_schedule: str,
    contract_start: Any = None,
) -> list[dict]:
    """Installment dicts for one won commission.

    `payout_schedule` is the plan rule value. Maintenance returns three rows.
    Payment 1 is scheduled on the last day of the quarter that contains
    `contract_start`, or the won date when the contract has no start date.
    Payments 2 and 3, and every construction or enhancement payout, stay
    `pending_billing_data` with a null payout date. Construction and
    enhancement payout amounts stay null: those checks depend on collections.
    """
    total = int(total_cents)
    if payout_schedule == MAINTENANCE_3_PAYMENT:
        anchor = close_date_of(contract_start) if contract_start is not None else close_date_of(close_at)
        pay_on = quarter_end_date(anchor)
        first_amount, second_amount = maintenance_known_halves(total)
        return [
            {
                "installment_number": 1,
                "payout_period": period_label(pay_on),
                "payout_date": pay_on,
                "amount_cents": first_amount,
                "status": "scheduled",
                "billing_installment_number": None,
                "collected_amount_cents": None,
            },
            _pending_row(2, second_amount, 6),
            _pending_row(3, None, 12),
        ]
    if payout_schedule in (CONSTRUCTION_BILLING_QUARTERLY, ENHANCEMENT_MONTH_AFTER_QUARTER):
        return [_pending_row(1, None)]
    raise ValueError(f"Unknown payout_schedule {payout_schedule!r}")


def derive_installment_status(
    *,
    stored_status: str,
    commission_status: str,
    payout_date: Optional[date],
    today: date,
) -> str:
    """Read-time status: paid, cancelled, pending_billing_data, due, or upcoming.

    Due vs upcoming uses America/New_York `today` and is not stored. A null
    payout date stays pending_billing_data.
    """
    if stored_status == "paid" or commission_status == "paid":
        return "paid"
    if stored_status == "cancelled" or commission_status == "cancelled":
        return "cancelled"
    if stored_status == PENDING_BILLING_DATA or payout_date is None:
        return PENDING_BILLING_DATA
    if payout_date <= today:
        return "due"
    return "upcoming"


def public_installment(row: dict, commission_status: str, today: date) -> dict:
    """API installment object. `payout_period` is the check label."""
    raw_date = row.get("payout_date")
    payout = None if raw_date is None else calendar_date(raw_date)
    raw_amount = row.get("amount_cents")
    amount = None if raw_amount is None else int(raw_amount)
    raw_billing = row.get("billing_installment_number")
    raw_collected = row.get("collected_amount_cents")
    stored = row.get("status") or row.get("installment_status") or "scheduled"
    parent = row.get("commission_status") or commission_status or "approved"
    return {
        "id": row.get("id") or row.get("installment_id"),
        "installment_number": int(row.get("installment_number") or 0),
        "payout_period": row.get("payout_period_label") or row.get("payout_period"),
        "payout_date": None if payout is None else payout.isoformat(),
        "amount_cents": amount,
        "status": derive_installment_status(
            stored_status=stored,
            commission_status=parent,
            payout_date=payout,
            today=today,
        ),
        "billing_installment_number": None if raw_billing is None else int(raw_billing),
        "collected_amount_cents": None if raw_collected is None else int(raw_collected),
    }


def rollup_status(statuses: Sequence[str]) -> str:
    """One status for a check that holds several installments.

    Cancelled rows drop out unless they are the whole group. The most
    actionable open state wins: due, then upcoming, then
    pending_billing_data, then paid. An upcoming check is not hidden by a
    pending sibling.
    """
    active = [s for s in statuses if s != "cancelled"]
    if not active:
        return "cancelled"
    if all(s == "paid" for s in active):
        return "paid"
    if any(s == "due" for s in active):
        return "due"
    if any(s == "upcoming" for s in active):
        return "upcoming"
    if any(s == PENDING_BILLING_DATA for s in active):
        return PENDING_BILLING_DATA
    return "upcoming"


# by_payout_period / quarter installment buckets. Dated rows keep their date.
# Undated known amounts (maintenance payment 2) stay out of the unknown bucket
# (payment 3, construction, enhancement).
BUCKET_DATED = "dated"
BUCKET_UNSCHEDULED = "unscheduled"
BUCKET_PENDING = "pending_billing_data"
_UNSCHEDULED_LABEL = "Unscheduled"


def _installment_bucket(inst: dict) -> str:
    if inst.get("payout_date"):
        return BUCKET_DATED
    if inst.get("amount_cents") is None:
        return BUCKET_PENDING
    return BUCKET_UNSCHEDULED


def _new_amount_group() -> dict:
    return {
        "known_cents": 0,
        "known": 0,
        "unknown": 0,
        "_statuses": [],
        "_labels": [],
        "payout_date": None,
    }


def _add_to_amount_group(group: dict, inst: dict) -> None:
    group["_statuses"].append(inst.get("status"))
    label = inst.get("payout_period")
    if label:
        group["_labels"].append(label)
    if group["payout_date"] is None and inst.get("payout_date"):
        group["payout_date"] = inst.get("payout_date")
    if inst.get("status") == "cancelled":
        return
    raw_amount = inst.get("amount_cents")
    if raw_amount is None:
        group["unknown"] += 1
        return
    group["known"] += 1
    group["known_cents"] += int(raw_amount)


def _finish_amount_group(group: dict, *, default_label: Optional[str]) -> dict:
    """Sum known cents. All-unknown is null, not 0. A mix sets amount_partial."""
    if group["known"] == 0 and group["unknown"] > 0:
        amount: Optional[int] = None
        partial = False
    elif group["unknown"] > 0:
        amount = group["known_cents"]
        partial = True
    else:
        amount = group["known_cents"]
        partial = False
    labels = group["_labels"]
    if labels and all(label == labels[0] for label in labels):
        period = labels[0]
    else:
        period = default_label
    return {
        "payout_period": period,
        "payout_date": group["payout_date"],
        "amount_cents": amount,
        "amount_partial": partial,
        "status": rollup_status(group["_statuses"]),
    }


def summarize_open_installments(installments: Sequence[dict]) -> dict:
    """`next_payout`, `upcoming_cents`, and `due_cents` for one rep.

    Each installment dict is already in public form (derived status).
    `next_payout` is the earliest check that still has due or upcoming money.
    """
    upcoming = 0
    due = 0
    by_date: dict[str, dict] = {}
    for inst in installments:
        status = inst.get("status")
        amount = int(inst.get("amount_cents") or 0)
        if status == "upcoming":
            upcoming += amount
        elif status == "due":
            due += amount
        if status not in ("due", "upcoming"):
            continue
        key = inst["payout_date"]
        slot = by_date.setdefault(key, {
            "payout_period": inst.get("payout_period"),
            "payout_date": key,
            "amount_cents": 0,
        })
        slot["amount_cents"] += amount
    next_payout = by_date[min(by_date)] if by_date else None
    return {
        "next_payout": next_payout,
        "upcoming_cents": upcoming,
        "due_cents": due,
    }


def build_payout_schedule(deals: Sequence[dict]) -> dict:
    """Group closed deals into quarters and checks.

    Each deal has `close_quarter`, `commission_amount_cents`, and public
    `installments`. Cancelled installments stay in the status rollup and
    do not add to the check amount.

    A group whose amounts are all null returns `amount_cents` null.
    A group with both known and null amounts sums the known cents and sets
    `amount_partial`. Quarter rows that share an installment number still
    roll up only when they are the same check (same date, or the same
    undated bucket). A dated upcoming payment is not folded into an undated
    pending sibling.

    `by_payout_period` keeps one row per payout date. Undated rows split
    into `unscheduled` (amount known, date not) and `pending_billing_data`
    (amount unknown). Those two are never added together.
    """
    quarters: dict[str, dict] = {}
    periods: dict[tuple, dict] = {}
    for deal in deals:
        quarter = deal["close_quarter"]
        bucket = quarters.setdefault(quarter, {
            "close_quarter": quarter,
            "sales_count": 0,
            "commission_total_cents": 0,
            "_groups": {},
        })
        bucket["sales_count"] += 1
        bucket["commission_total_cents"] += int(deal.get("commission_amount_cents") or 0)
        for inst in deal.get("installments") or []:
            number = int(inst["installment_number"])
            kind = _installment_bucket(inst)
            group_key = (kind, number, inst.get("payout_date"))
            agg = bucket["_groups"].setdefault(group_key, _new_amount_group())
            agg["installment_number"] = number
            agg["bucket"] = kind
            _add_to_amount_group(agg, inst)

            if kind == BUCKET_DATED:
                period_key = (BUCKET_DATED, inst.get("payout_date"))
            else:
                period_key = (kind,)
            period = periods.setdefault(period_key, _new_amount_group())
            period["bucket"] = kind
            _add_to_amount_group(period, inst)

    quarter_rows = []
    for quarter in sorted(quarters):
        bucket = quarters[quarter]
        installments = []
        kind_order = {BUCKET_DATED: 0, BUCKET_UNSCHEDULED: 1, BUCKET_PENDING: 2}
        for key in sorted(
            bucket["_groups"],
            key=lambda item: (item[1], kind_order.get(item[0], 9), item[2] or ""),
        ):
            agg = bucket["_groups"][key]
            kind = agg["bucket"]
            default_label = _UNSCHEDULED_LABEL if kind == BUCKET_UNSCHEDULED else None
            finished = _finish_amount_group(agg, default_label=default_label)
            installments.append({
                "installment_number": agg["installment_number"],
                "payout_period": finished["payout_period"],
                "payout_date": finished["payout_date"],
                "amount_cents": finished["amount_cents"],
                "amount_partial": finished["amount_partial"],
                "status": finished["status"],
                "bucket": kind,
            })
        quarter_rows.append({
            "close_quarter": bucket["close_quarter"],
            "sales_count": bucket["sales_count"],
            "commission_total_cents": bucket["commission_total_cents"],
            "installments": installments,
        })

    def _period_sort(key: tuple) -> tuple:
        kind = key[0]
        order = {BUCKET_DATED: 0, BUCKET_UNSCHEDULED: 1, BUCKET_PENDING: 2}
        date_key = key[1] if len(key) > 1 and key[1] else ""
        return (order.get(kind, 9), date_key)

    by_payout_period = []
    for key in sorted(periods, key=_period_sort):
        period = periods[key]
        kind = period["bucket"]
        default_label = _UNSCHEDULED_LABEL if kind == BUCKET_UNSCHEDULED else None
        finished = _finish_amount_group(period, default_label=default_label)
        by_payout_period.append({
            "payout_period": finished["payout_period"],
            "payout_date": finished["payout_date"],
            "amount_cents": finished["amount_cents"],
            "amount_partial": finished["amount_partial"],
            "status": finished["status"],
            "bucket": kind,
        })
    return {"quarters": quarter_rows, "by_payout_period": by_payout_period}


def maintenance_first_year_cents(contract_value_cents: int) -> int:
    """Commissionable maintenance base: the first 12 months.

    `estimates.contract_value_cents` is the persisted roll-up of section
    totals. Maintenance lines are priced per year (`occurrences/yr` in the
    maintenance engine; uom `/yr`). Estimates, leads, and properties have no
    contract-term or multi-year column, so this stored value is the annual
    first-year amount, not a multi-year total.
    """
    return int(contract_value_cents or 0)


def marginal_amount_cents(
    cumulative_before_cents: int,
    deal_cents: int,
    tiers: Sequence[CommissionTier],
) -> int:
    """Marginal commission for `deal_cents` stacked on `cumulative_before_cents`.

    Each tier is `[tier_min_cents, tier_max_cents)` in cents (`tier_max_cents`
    None means no ceiling). A 0% band is a real tier: it consumes that slice
    so a later band does not see it. The total is rounded half-up to the cent.
    """
    if deal_cents <= 0 or not tiers:
        return 0
    start = int(cumulative_before_cents)
    end = start + int(deal_cents)
    total = Decimal(0)
    for tier in sorted(tiers, key=lambda t: (t.tier_min_cents, t.tier_max_cents is None)):
        lo = max(start, tier.tier_min_cents)
        hi = end if tier.tier_max_cents is None else min(end, tier.tier_max_cents)
        if hi > lo:
            total += Decimal(hi - lo) * tier.rate
    return int(total.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def tiers_from_rules(rules: Sequence[dict]) -> list[CommissionTier]:
    return [
        CommissionTier(
            tier_min_cents=int(rule.get("tier_min_cents") or 0),
            tier_max_cents=(
                None if rule.get("tier_max_cents") is None else int(rule["tier_max_cents"])
            ),
            rate=Decimal(str(rule.get("rate") or 0)),
        )
        for rule in rules
    ]


def compute_plan_amount(
    *,
    estimate_type: str,
    contract_value_cents: int,
    rules: Sequence[dict],
    cumulative_before_cents: int = 0,
) -> Optional[int]:
    """Cents owed under plan rules, or None when the basis is not computable.

    Enhancement bases are stored so they can be configured later. The CRM has
    no enhancement estimate type and no gross-profit percent, so those rules
    return None and the caller does not invent a commission.
    """
    if not rules:
        return None
    basis = str(rules[0].get("basis") or "")
    if estimate_type == "enhancement" or basis.startswith("enhancement"):
        return None
    tiers = tiers_from_rules(rules)
    if basis == "first_year_revenue":
        base = (
            maintenance_first_year_cents(contract_value_cents)
            if estimate_type == "maintenance"
            else int(contract_value_cents or 0)
        )
        return marginal_amount_cents(0, base, tiers)
    if basis == "calendar_year_cumulative_revenue":
        return marginal_amount_cents(cumulative_before_cents, int(contract_value_cents or 0), tiers)
    return None


def effective_rate(amount_cents: int, base_cents: int) -> Decimal:
    """Blended rate snapped to DECIMAL(6,5). The cent amount is the source of truth."""
    if base_cents <= 0 or amount_cents <= 0:
        return Decimal("0.00000")
    rate = (Decimal(int(amount_cents)) / Decimal(int(base_cents))).quantize(
        Decimal("0.00001"), rounding=ROUND_HALF_UP
    )
    if rate > Decimal("0.99999"):
        return Decimal("0.99999")
    if rate < 0:
        return Decimal("0.00000")
    return rate


def resolve_rate_source(
    assignment_plan_key: Optional[str],
    has_legacy_rate: bool,
    estimate_type: Optional[str],
) -> tuple[str, Optional[str]]:
    """Which rate structure applies. Payout cadence is not decided here.

    Returns (`plan`, plan_key), (`legacy`, None), or (`none`, None).

    An explicit plan assignment wins. Otherwise an active commission_rates
    row keeps today's flat-rate amount. Otherwise a maintenance, install, or
    enhancement estimate uses the standard plan. The user's role is not
    consulted: generic `sales` is not a gate.
    """
    if assignment_plan_key:
        return "plan", assignment_plan_key
    if has_legacy_rate:
        return "legacy", None
    if estimate_type in PLAN_ESTIMATE_TYPES:
        return "plan", STANDARD_PLAN_KEY
    return "none", None


def sum_prior_install_cents(
    rows: Sequence[dict],
    year: int,
    bucket: str,
) -> int:
    """Calendar-year install contract value already won, in one client bucket.

    `bucket` is `new` or `existing`. Unclassified rows (`client_type` NULL)
    sit in the new-client bucket, matching the provisional new-client tiers
    applied when the CRM cannot tell new from existing. The current deal is
    not in `rows`; the caller adds it by stacking marginal tiers on this sum.
    """
    total = 0
    for row in rows:
        created = row.get("created_at")
        if created is None:
            continue
        if close_date_of(created).year != year:
            continue
        client_type = row.get("client_type")
        if bucket == "existing":
            if client_type != "existing":
                continue
        elif client_type not in (None, "new"):
            continue
        total += int(row.get("contract_value_cents") or 0)
    return total
