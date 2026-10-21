"""Maintenance margin groups. Must stay in lockstep with
``studio/src/lib/estimating/marginGroups.ts``.

Maintenance margin is four commercial groups, in this order:

    Mowing, Pest Control, Optional Services, Subcontractors

Every group is always emitted (zeros allowed) so displayed percents can
sum to 100. A line that does not resolve a group raises
``UnassignedMarginGroupError`` listing every such label — the caller
does not receive a partial sum.

Install estimates do not use this module. They stay grouped by line label.
"""
from __future__ import annotations

import math
import re

from api.maintenance_pricing import _round_half_up

MARGIN_GROUPS: tuple[str, ...] = (
    "Mowing",
    "Pest Control",
    "Optional Services",
    "Subcontractors",
)

_SLASHES = re.compile(r"/+")
_WHITESPACE = re.compile(r"\s+")
_MOW = re.compile(r"\bmow")


class UnassignedMarginGroupError(ValueError):
    """One or more maintenance lines have no commercial margin group."""

    def __init__(self, labels: list[str]):
        self.labels = list(labels)
        joined = ", ".join(self.labels)
        super().__init__(f"Service has no margin group: {joined}")


def line_price_cents(
    square_feet: float,
    unit_sell_cents: float,
    qty: float,
    complexity_pct: float,
) -> int:
    """Same formula as ``maintServiceLine`` / ``contractTotal`` (section sqft).

    Half-up for positive cents so it matches JavaScript ``Math.round``.
    """
    value = (square_feet / 1000.0) * unit_sell_cents * qty * (1.0 + complexity_pct)
    return _round_half_up(value)


def resolve_margin_group(
    label: str,
    service_type: str | None = None,
    margin_group: str | None = None,
) -> str | None:
    """Return one of ``MARGIN_GROUPS``, or None when the line cannot be placed.

    An explicit ``margin_group`` wins when it is one of the four names.
    Any other non-empty explicit value is unassigned (it does not fall
    through to the label). Null/blank falls through to the label and
    service type.
    """
    explicit = (margin_group or "").strip()
    if explicit:
        if explicit in MARGIN_GROUPS:
            return explicit
        return None
    blob = _WHITESPACE.sub(" ", _SLASHES.sub(" ", f"{label} {service_type or ''}")).strip().lower()
    if "subcontract" in blob:
        return "Subcontractors"
    if "optional" in blob:
        return "Optional Services"
    if any(token in blob for token in ("pest", "insect", "disease", "ipm")):
        return "Pest Control"
    if _MOW.search(blob) or "small area island production" in blob:
        return "Mowing"
    return None


def maintenance_group_prices(lines: list[dict]) -> dict[str, int]:
    """Price cents per commercial group. Raises if any line is unassigned.

    Each line dict uses ``label``, ``square_feet`` (the section's sqft, the
    same input ``contractTotal`` uses), ``unit_sell_cents``, ``qty``,
    ``complexity_pct``, and optional ``service_type`` / ``margin_group``.
    """
    totals = {name: 0 for name in MARGIN_GROUPS}
    unassigned: list[str] = []
    for line in lines:
        label = str(line.get("label") or "")
        group = resolve_margin_group(
            label,
            line.get("service_type"),
            line.get("margin_group"),
        )
        if group is None:
            unassigned.append(label)
            continue
        totals[group] += line_price_cents(
            float(line.get("square_feet") or 0),
            float(line.get("unit_sell_cents") or 0),
            float(line.get("qty") or 0),
            float(line.get("complexity_pct") or 0),
        )
    if unassigned:
        raise UnassignedMarginGroupError(unassigned)
    return totals


def rounded_share_percents(prices: list[int], contract: int) -> list[int]:
    """Largest-remainder integer percents. They sum to 100 when contract > 0.

    Zero contract yields all zeros (no fabricated 100 split). Ties go to
    the lower index.
    """
    if contract <= 0:
        return [0 for _ in prices]
    floors = [math.floor(price * 100 / contract) for price in prices]
    leftover = 100 - sum(floors)
    ranked = sorted(
        range(len(prices)),
        key=lambda i: (-(prices[i] * 100 - floors[i] * contract), i),
    )
    out = list(floors)
    for index in ranked[:leftover]:
        out[index] += 1
    return out
