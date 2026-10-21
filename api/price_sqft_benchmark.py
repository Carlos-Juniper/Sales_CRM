"""Company-wide maintenance price-per-square-foot benchmark.

The margin panel compares the open job's $/sq ft with the mean of per-estimate
$/sq ft across every maintenance estimate in the CRM. The cohort is not the
estimator's own bids and not a branch slice.

Numerator is the computed contract total (the same section-sqft line formula
as studio/src/lib/estimating/calc.ts). The stored ``contract_value_cents``
column is never read — a blank import with a zero or stale rollup and no
lines has no computed total and is left out.

Denominator is turf sq ft + bed sq ft. Bed area is the bed section's
``square_feet`` when that is positive; a seeded line value of 0 is not the
bed area. A positive bed-line override on a turf or legacy region is added.
Job price is not a function of that bed line override, so including bed in
the denominator does not change the contract total.
"""
from __future__ import annotations

import math
import re
from typing import Any, Awaitable, Callable, Optional

QueryFn = Callable[..., Awaitable[list]]

TURF_CATEGORY = "turf"
BED_CATEGORY = "bed_maint"
_BED_LABEL = re.compile(r"\bbeds?\b", re.IGNORECASE)

# Every maintenance estimate. No estimator, branch, or lifecycle predicate.
# contract_value_cents is intentionally absent — there is no stored-total fallback.
COHORT_SQL = """
SELECT e.id AS estimate_id,
       es.id AS section_id,
       es.name AS section_name,
       es.square_feet AS section_square_feet,
       sc.code AS section_category_code,
       ss.id AS line_id,
       ss.label AS line_label,
       ss.square_feet AS line_square_feet,
       ss.qty AS qty,
       ss.unit_sell_cents AS unit_sell_cents,
       ss.complexity_pct AS complexity_pct,
       lc.code AS line_category_code
  FROM estimates e
  LEFT JOIN estimate_sections es ON es.estimate_id = e.id
  LEFT JOIN service_categories sc ON sc.id = es.service_category_id
  LEFT JOIN section_services ss ON ss.section_id = es.id
  LEFT JOIN services svc ON svc.id = ss.service_id
  LEFT JOIN service_categories lc ON lc.id = svc.service_category_id
 WHERE e.estimate_type = 'maintenance'
"""


class PriceSqftError(ValueError):
    """A measurement is present but unusable. Callers must not substitute 0."""


def js_round(value: float) -> int:
    """Match JavaScript Math.round (half away from zero toward +∞ for positives)."""
    if value >= 0:
        return int(math.floor(value + 0.5))
    return int(math.ceil(value - 0.5))


def _float_or_none(value: Any) -> Optional[float]:
    if value is None:
        return None
    number = float(value)
    if not math.isfinite(number):
        raise PriceSqftError("square footage is not a finite number")
    if number < 0:
        raise PriceSqftError("square footage is negative")
    return number


def _section_kind(name: str, category_code: Optional[str]) -> str:
    """'turf', 'bed', or 'other'. A category code wins over the section name."""
    if category_code:
        if category_code == TURF_CATEGORY:
            return "turf"
        if category_code == BED_CATEGORY:
            return "bed"
        return "other"
    normalized = (name or "").strip().lower()
    if normalized == "turf":
        return "turf"
    if normalized in ("bed", "beds"):
        return "bed"
    return "other"


def _line_is_bed(line: dict) -> bool:
    code = line.get("category_code")
    if code:
        return code == BED_CATEGORY
    return bool(_BED_LABEL.search(line.get("label") or ""))


def _positive_bed_line_sqft(section: dict) -> float:
    total = 0.0
    for line in section.get("lines") or []:
        if not _line_is_bed(line):
            continue
        sqft = line.get("square_feet")
        if sqft is None:
            continue
        if sqft > 0:
            total += sqft
    return total


def measure_sqft(estimate: dict) -> dict:
    """Return turfSqft, bedSqft, totalSqft, and sqftKnown.

    ``sqftKnown`` is false when the estimate has no sections or a section
    whose area would be counted has NULL square feet (blank import). An
    explicit 0 is known. Negative area raises — it is not coerced to 0.
    """
    sections = list((estimate.get("sections") or {}).values())
    if not sections:
        return {"turfSqft": 0.0, "bedSqft": 0.0, "totalSqft": 0.0, "sqftKnown": False}

    kinds = [_section_kind(s.get("name") or "", s.get("category_code")) for s in sections]
    any_classified = any(kind in ("turf", "bed") for kind in kinds)

    turf = 0.0
    bed = 0.0
    for section, kind in zip(sections, kinds):
        raw = section.get("square_feet")
        counts_section = kind in ("turf", "bed") or not any_classified
        if counts_section and raw is None:
            return {"turfSqft": 0.0, "bedSqft": 0.0, "totalSqft": 0.0, "sqftKnown": False}
        section_sqft = 0.0 if raw is None else float(raw)
        bed_lines = _positive_bed_line_sqft(section)
        if kind == "bed":
            # Seeded bed lines are 0. The section area is the bed, when set.
            # A 0 section with a typed line area uses the line — not a hardcoded 0.
            if section_sqft > 0:
                bed += section_sqft
            else:
                bed += bed_lines
        elif kind == "turf" or not any_classified:
            turf += section_sqft
            bed += bed_lines
        else:
            bed += bed_lines

    return {
        "turfSqft": turf,
        "bedSqft": bed,
        "totalSqft": turf + bed,
        "sqftKnown": True,
    }


def computed_contract_cents(estimate: dict) -> Optional[int]:
    """Σ maintenance line totals from section square feet.

    Line-level square_feet does not enter. That is the job price: changing a
    bed override must not change this number. No lines, or a NULL section area
    on a line, means there is no computed total (do not fall back to a stored
    contract value). A total of 0 is not a computed price.
    """
    sections = list((estimate.get("sections") or {}).values())
    saw_line = False
    total = 0
    for section in sections:
        section_sqft = section.get("square_feet")
        for line in section.get("lines") or []:
            saw_line = True
            if section_sqft is None:
                return None
            rate = line.get("unit_sell_cents")
            rate_n = 0.0 if rate is None else float(rate)
            qty = line.get("qty")
            qty_n = 0.0 if qty is None else float(qty)
            complexity = line.get("complexity_pct")
            complexity_n = 0.0 if complexity is None else float(complexity)
            total += js_round((float(section_sqft) / 1000.0) * rate_n * qty_n * (1.0 + complexity_n))
    if not saw_line or total <= 0:
        return None
    return total


def cents_per_sqft(estimate: dict) -> Optional[float]:
    """Per-estimate cents per sq ft, or None when the estimate is excluded."""
    areas = measure_sqft(estimate)
    if not areas["sqftKnown"] or areas["totalSqft"] <= 0:
        return None
    contract = computed_contract_cents(estimate)
    if contract is None or contract <= 0:
        return None
    return contract / areas["totalSqft"]


def aggregate_price_per_sqft(estimates: list[dict], *, exclude_estimate_id: str) -> dict:
    """Unweighted mean of per-estimate $/sq ft.

    Drops the open estimate, blank imports (no sq ft or no computed contract
    total), and zero-sq-ft estimates. An empty cohort returns sampleSize 0
    and averageCentsPerSqft null — never a fabricated average.
    """
    if not exclude_estimate_id:
        raise PriceSqftError("exclude_estimate_id is required")
    rates: list[float] = []
    for estimate in estimates:
        if estimate.get("estimate_id") == exclude_estimate_id:
            continue
        rate = cents_per_sqft(estimate)
        if rate is None:
            continue
        rates.append(rate)
    if not rates:
        return {"sampleSize": 0, "averageCentsPerSqft": None}
    return {
        "sampleSize": len(rates),
        "averageCentsPerSqft": sum(rates) / len(rates),
    }


def rows_to_estimates(rows: list[dict]) -> list[dict]:
    """Group the flat cohort join into estimates → sections → lines."""
    by_id: dict[str, dict] = {}
    order: list[str] = []
    for row in rows:
        estimate_id = row.get("estimate_id")
        if not estimate_id:
            raise PriceSqftError("cohort row missing estimate_id")
        estimate = by_id.get(estimate_id)
        if estimate is None:
            estimate = {"estimate_id": estimate_id, "sections": {}}
            by_id[estimate_id] = estimate
            order.append(estimate_id)
        section_id = row.get("section_id")
        if section_id is None:
            continue
        section = estimate["sections"].get(section_id)
        if section is None:
            section = {
                "name": row.get("section_name") or "",
                "category_code": row.get("section_category_code"),
                "square_feet": _float_or_none(row.get("section_square_feet")),
                "lines": [],
            }
            estimate["sections"][section_id] = section
        line_id = row.get("line_id")
        if line_id is None:
            continue
        if any(line["id"] == line_id for line in section["lines"]):
            continue
        section["lines"].append(
            {
                "id": line_id,
                "label": row.get("line_label") or "",
                "category_code": row.get("line_category_code"),
                "square_feet": _float_or_none(row.get("line_square_feet")),
                "qty": row.get("qty"),
                "unit_sell_cents": row.get("unit_sell_cents"),
                "complexity_pct": row.get("complexity_pct"),
            }
        )
    return [by_id[estimate_id] for estimate_id in order]


async def benchmark_payload(estimate_id: str, query_fn: QueryFn) -> dict:
    rows = await query_fn(COHORT_SQL, [])
    return aggregate_price_per_sqft(rows_to_estimates(rows), exclude_estimate_id=estimate_id)
