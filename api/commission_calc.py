"""Commission dates, tiers, and cent math.

Payout timing comes from the plan rule's payout_schedule. This module does
not read the database and does not shape API responses.

maintenance_3_payment follows the maintenance program: payment 1 is 3% of 50%
of contract value at the end of the quarter the contract starts in; payment 2
is 3% of the other 50% and waits on the 6th billing installment; payment 3 is
3% of additional revenue through 12 months and waits on the 12th installment.
construction_billing_quarterly waits on billing and collections. This module
does not invent those dates.

Enhancement rates are deferred until the Enhancement sale type exists.
estimates.estimate_type is maintenance or install, so these rates are not
calculated here: 3% for a new client at 55% gross profit or higher, 1.5% on
amounts over $5,000 at 50% gross profit or higher, and 1.5% on amounts over
$10,000 at 45% gross profit or higher.

Close timestamps and stored dates share one conversion. A datetime is a
timestamp: naive values are UTC, then the value is converted to
America/New_York and the Eastern calendar date is returned. A date, or a
YYYY-MM-DD string, is already a calendar date and is not shifted, so a
payout DATE does not move across midnight.
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
PENDING_BILLING_DATA = "pending_billing_data"

# Estimate types the standard plan can price. Enhancement is not one of them.
PLAN_ESTIMATE_TYPES = frozenset({"maintenance", "install"})


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


def calendar_date(value: Any) -> date:
    """Calendar date for a close timestamp or a stored DATE.

    A datetime is a timestamp. Naive datetimes are UTC. The timestamp is
    converted to America/New_York and the Eastern calendar date is returned.
    A date (not a datetime) is already a calendar date and is returned
    unchanged. A string of at most 10 characters is parsed as YYYY-MM-DD
    with no timezone conversion. A longer string is parsed as a timestamp
    and converted the same way as a datetime.
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


def close_quarter_label(value: Any) -> str:
    """`2026-Q1` for the Eastern calendar quarter of a close timestamp."""
    closed = calendar_date(value)
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
    Payments 2 and 3, and every construction payout, stay
    `pending_billing_data` with a null payout date. Construction payout
    amounts stay null: those checks depend on collections.
    """
    total = int(total_cents)
    if payout_schedule == MAINTENANCE_3_PAYMENT:
        anchor = calendar_date(contract_start) if contract_start is not None else calendar_date(close_at)
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
    if payout_schedule == CONSTRUCTION_BILLING_QUARTERLY:
        return [_pending_row(1, None)]
    raise ValueError(f"Unknown payout_schedule {payout_schedule!r}")


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

    Maintenance and install both price `contract_value_cents`. A maintenance
    estimate stores the annual first-year roll-up (occurrences/year pricing;
    no multi-year term is stored), so that column is the first-year base.
    """
    if not rules:
        return None
    basis = str(rules[0].get("basis") or "")
    base = int(contract_value_cents or 0)
    tiers = tiers_from_rules(rules)
    if basis == "first_year_revenue":
        return marginal_amount_cents(0, base, tiers)
    if basis == "calendar_year_cumulative_revenue":
        return marginal_amount_cents(cumulative_before_cents, base, tiers)
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
