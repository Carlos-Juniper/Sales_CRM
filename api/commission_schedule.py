"""API shapes for commission installments and payout schedules.

Status is derived at read time. Amount groups keep a null total when every
contributing installment has no amount, and flag a partial total when known
and unknown amounts share a group.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Optional, Sequence

from api.commission_calc import PENDING_BILLING_DATA, calendar_date

logger = logging.getLogger(__name__)

_ROLLUP_STATUSES = frozenset({
    "paid",
    "cancelled",
    PENDING_BILLING_DATA,
    "due",
    "upcoming",
})

# by_payout_period / quarter installment buckets. Dated rows keep their date.
# Undated known amounts (maintenance payment 2) stay out of the unknown bucket
# (payment 3, construction).
BUCKET_DATED = "dated"
BUCKET_UNSCHEDULED = "unscheduled"
BUCKET_PENDING = "pending_billing_data"
_UNSCHEDULED_LABEL = "Unscheduled"
_KIND_ORDER = {
    BUCKET_DATED: 0,
    BUCKET_UNSCHEDULED: 1,
    BUCKET_PENDING: 2,
}


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
    pending sibling. An unrecognized status is logged and raised.
    """
    unknown = [status for status in statuses if status not in _ROLLUP_STATUSES]
    if unknown:
        logger.error("Unknown installment status in rollup: %s", unknown)
        raise ValueError(f"Unknown installment status: {unknown[0]}")
    active = [status for status in statuses if status != "cancelled"]
    if not active:
        return "cancelled"
    if all(status == "paid" for status in active):
        return "paid"
    if any(status == "due" for status in active):
        return "due"
    if any(status == "upcoming" for status in active):
        return "upcoming"
    if any(status == PENDING_BILLING_DATA for status in active):
        return PENDING_BILLING_DATA
    return "upcoming"


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


@dataclass
class _AmountGroup:
    known_cents: int = 0
    known: int = 0
    unknown: int = 0
    statuses: list = field(default_factory=list)
    labels: list = field(default_factory=list)
    payout_date: Optional[str] = None
    installment_number: int = 0
    bucket: str = ""

    def add(self, inst: dict) -> None:
        self.statuses.append(inst.get("status"))
        label = inst.get("payout_period")
        if label:
            self.labels.append(label)
        if self.payout_date is None and inst.get("payout_date"):
            self.payout_date = inst.get("payout_date")
        if inst.get("status") == "cancelled":
            return
        raw_amount = inst.get("amount_cents")
        if raw_amount is None:
            self.unknown += 1
            return
        self.known += 1
        self.known_cents += int(raw_amount)

    def finish(self, *, default_label: Optional[str]) -> dict:
        """Sum known cents. All-unknown is null, not 0. A mix sets amount_partial."""
        if self.known == 0 and self.unknown > 0:
            amount: Optional[int] = None
            partial = False
        elif self.unknown > 0:
            amount = self.known_cents
            partial = True
        else:
            amount = self.known_cents
            partial = False
        if self.labels and all(label == self.labels[0] for label in self.labels):
            period = self.labels[0]
        else:
            period = default_label
        return {
            "payout_period": period,
            "payout_date": self.payout_date,
            "amount_cents": amount,
            "amount_partial": partial,
            "status": rollup_status(self.statuses),
        }


def _installment_bucket(inst: dict) -> str:
    if inst.get("payout_date"):
        return BUCKET_DATED
    if inst.get("amount_cents") is None:
        return BUCKET_PENDING
    return BUCKET_UNSCHEDULED


def _render_group(group: _AmountGroup, *, default_label: Optional[str]) -> dict:
    """Public amount fields for one check or one quarter installment group."""
    return group.finish(default_label=default_label)


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
    (amount unknown). Those two are never added together. Undated periods
    sort last: the sort key is `(payout_date is None, payout_date)`, then
    bucket order. Callers do not re-sort.
    """
    quarters: dict[str, dict] = {}
    periods: dict[tuple, _AmountGroup] = {}
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
            agg = bucket["_groups"].setdefault(group_key, _AmountGroup())
            agg.installment_number = number
            agg.bucket = kind
            agg.add(inst)

            if kind == BUCKET_DATED:
                period_key = (BUCKET_DATED, inst.get("payout_date"))
            else:
                period_key = (kind,)
            period = periods.setdefault(period_key, _AmountGroup())
            period.bucket = kind
            period.add(inst)

    quarter_rows = []
    for quarter in sorted(quarters):
        bucket = quarters[quarter]
        installments = []
        for key in sorted(
            bucket["_groups"],
            key=lambda item: (item[1], _KIND_ORDER.get(item[0], 9), item[2] or ""),
        ):
            agg = bucket["_groups"][key]
            kind = agg.bucket
            default_label = _UNSCHEDULED_LABEL if kind == BUCKET_UNSCHEDULED else None
            finished = _render_group(agg, default_label=default_label)
            installments.append({
                "installment_number": agg.installment_number,
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

    def _period_sort(item: tuple[tuple, _AmountGroup]) -> tuple:
        period = item[1]
        payout = period.payout_date
        return (
            payout is None,
            "" if payout is None else payout,
            _KIND_ORDER.get(period.bucket, 9),
        )

    by_payout_period = []
    for _key, period in sorted(periods.items(), key=_period_sort):
        kind = period.bucket
        default_label = _UNSCHEDULED_LABEL if kind == BUCKET_UNSCHEDULED else None
        finished = _render_group(period, default_label=default_label)
        by_payout_period.append({
            "payout_period": finished["payout_period"],
            "payout_date": finished["payout_date"],
            "amount_cents": finished["amount_cents"],
            "amount_partial": finished["amount_partial"],
            "status": finished["status"],
            "bucket": kind,
        })
    return {"quarters": quarter_rows, "by_payout_period": by_payout_period}
