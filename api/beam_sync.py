"""Beam / Attentive takeoff ingest — the port between Attentive and estimating.

With api/beam_client.py, the only place Attentive vocabulary (feature names,
``sq ft``, the integer status enum) appears.

Divergence from api/aspire_sync.py, which is a strictly DB-free port: this module
does read and write the DB. Aspire's port pushes OUR data outward, so the domain
can assemble the payload first; Beam's flow pulls THEIR data inward and has to
decide, per output, whether it may touch an estimator's work. That decision needs
the current row state, so it lives here rather than being smeared across the
route layer.

Two rules this module exists to enforce:

  * A measurement is converted within its dimension or surfaced as unmapped.
    It is never coerced across dimensions and never silently zeroed — an
    acres-vs-square-feet mix-up on the maintenance side once produced errors of
    several orders of magnitude on a single property.
  * Attentive's outputs are mutable after delivery. Ingest may auto-apply only
    while the estimate is unpriced and the section still holds exactly what we
    last wrote. Otherwise it flags, and an estimator accepts the diff.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from db import execute, query
from api.beam_client import BeamClient, BeamError

logger = logging.getLogger(__name__)

_SWEEP_INTERVAL_SECONDS = int(os.environ.get("BEAM_SWEEP_INTERVAL", "21600"))

# Attentive's integer status enum → our readable ENUM (migration 014).
STATUS_BY_CODE = {
    1: "draft",
    2: "in_progress",
    3: "completed",
    4: "failed",
    5: "queued",
    6: "investigating",
    7: "resubmitted",
}

# Estimate statuses at which Beam may write straight into sections. Past these,
# a number has been quoted and only the estimator may change it.
UNPRICED_STATUSES = ("new_from_sales", "queued", "in_progress")


def sync_enabled() -> bool:
    return os.environ.get("BEAM_SYNC_ENABLED", "").strip().lower() in ("1", "true", "yes")


# ── Units ────────────────────────────────────────────────────────────────────
#
# unit string → (dimension, multiplier to the dimension's canonical unit).
# Canonical is sq ft for area and ft for length. A unit absent from this table is
# surfaced as unmapped rather than guessed.

_UNITS: dict[str, tuple[str, float]] = {
    "sq ft": ("area", 1.0),
    "sqft": ("area", 1.0),
    "sq. ft.": ("area", 1.0),
    "square feet": ("area", 1.0),
    "sq yd": ("area", 9.0),
    "square yards": ("area", 9.0),
    "acre": ("area", 43560.0),
    "acres": ("area", 43560.0),
    "ft": ("length", 1.0),
    "feet": ("length", 1.0),
    "linear feet": ("length", 1.0),
    "yd": ("length", 3.0),
    "yards": ("length", 3.0),
    "mile": ("length", 5280.0),
    "miles": ("length", 5280.0),
    "count": ("count", 1.0),
    "each": ("count", 1.0),
}


class UnknownUnit(ValueError):
    """A unit string Attentive sent that is not in the conversion table."""


class DimensionMismatch(ValueError):
    """An area measurement offered to a length target, or vice versa."""


def _normalise(unit: str) -> str:
    return (unit or "").strip().lower()


def convert(value: float, from_unit: str, to_unit: str) -> float:
    """Convert within a dimension. Across dimensions is physically meaningless — raise."""
    src_dim, src_factor = _UNITS[_lookup(from_unit)]
    dst_dim, dst_factor = _UNITS[_lookup(to_unit)]
    if src_dim != dst_dim:
        raise DimensionMismatch(
            f"cannot convert {from_unit!r} ({src_dim}) to {to_unit!r} ({dst_dim})"
        )
    return float(value) * src_factor / dst_factor


def _lookup(unit: str) -> str:
    key = _normalise(unit)
    if key not in _UNITS:
        raise UnknownUnit(f"unrecognised unit {unit!r}")
    return key


# ── Feature map ──────────────────────────────────────────────────────────────
#
# Hardcoded for now; it moves to a config table when the admin settings page is
# built — that is the next build queued for that page. The names below are the
# exact feature.name strings of the only report type this account is provisioned
# for ("Softscapes only"), read from Attentive's own /reports/ endpoint. A name
# absent here is reported as unmapped, never dropped — so adding a report type
# later degrades to hand entry rather than to silently wrong numbers.

SECTION_SQUARE_FEET = "section_square_feet"
ESTIMATE_TURF_ACRES = "estimate_turf_area_acres"
ESTIMATE_CURB_MILES = "estimate_curb_miles"
LINEAR_ONLY = "linear_only"


@dataclass(frozen=True)
class FeatureMapping:
    group: str      # the estimate_sections.name this feature's area rolls into
    target: str     # one of the four constants above
    unit: str       # the unit the target is stored in


# Linear features map to LINEAR_ONLY: they are retained in beam_outputs and shown
# to the estimator, but never written to square_feet. That conflation is the
# error class this integration is built to make impossible.
FEATURE_MAP: dict[str, FeatureMapping] = {
    "lawn": FeatureMapping("Turf", SECTION_SQUARE_FEET, "sq ft"),
    "mulch bed": FeatureMapping("Beds", SECTION_SQUARE_FEET, "sq ft"),
    "gravel bed": FeatureMapping("Beds", SECTION_SQUARE_FEET, "sq ft"),
    "hedge": FeatureMapping("Beds", SECTION_SQUARE_FEET, "sq ft"),
    "hard edge": FeatureMapping("Edging", LINEAR_ONLY, "ft"),
    "soft edge": FeatureMapping("Edging", LINEAR_ONLY, "ft"),
    # Tree is the report's seventh feature and is deliberately absent: it is a
    # point count, and no section prices off a count.
}


def mapping_for(feature_name: str) -> Optional[FeatureMapping]:
    return FEATURE_MAP.get((feature_name or "").strip().lower())


# ── Results ──────────────────────────────────────────────────────────────────

@dataclass
class UnmappedOutput:
    feature_name: str
    measurement_name: str
    value: Optional[float]
    unit: Optional[str]
    reason: str


@dataclass
class IngestResult:
    status: str                                  # synced | failed | disabled | flagged
    outputs_stored: int = 0
    sections_applied: int = 0
    unmapped: list[UnmappedOutput] = field(default_factory=list)
    flagged: bool = False
    error: Optional[str] = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Ingest ───────────────────────────────────────────────────────────────────

async def ingest_request(beam_request_id: str, *, client: Optional[BeamClient] = None) -> IngestResult:
    """Re-fetch a request and its outputs from Attentive and reconcile them locally.

    Callbacks never supply data — only the request id — so this is the single
    path by which Attentive measurements enter the system.
    """
    if not sync_enabled():
        return IngestResult(status="disabled")

    rows = await query("SELECT * FROM beam_requests WHERE id = %s", [beam_request_id])
    if not rows:
        return IngestResult(status="failed", error="unknown beam_request")
    req_row = rows[0]
    attentive_id = req_row.get("attentive_request_id")
    if not attentive_id:
        return IngestResult(status="failed", error="request has not been created at Attentive yet")

    owns_client = client is None
    client = client or BeamClient()
    try:
        request = await client.get_request(attentive_id)
        outputs = await client.get_outputs(attentive_id)
    except BeamError as exc:
        await _mark_sync(beam_request_id, "failed", str(exc))
        return IngestResult(status="failed", error=str(exc))
    finally:
        if owns_client:
            await client.close()

    await _persist_request(beam_request_id, request)
    stored = await _persist_outputs(beam_request_id, _output_rows(outputs))
    result = await _apply_or_flag(req_row, beam_request_id)
    result.outputs_stored = stored
    await _mark_sync(beam_request_id, "synced", None)
    return result


def _output_rows(outputs: Any) -> list[dict]:
    """Attentive has returned both a bare list and a paginated envelope; accept either."""
    if isinstance(outputs, list):
        return outputs
    if isinstance(outputs, dict):
        for key in ("results", "data", "outputs"):
            if isinstance(outputs.get(key), list):
                return outputs[key]
    return []


async def _persist_request(beam_request_id: str, request: dict) -> None:
    await execute(
        """UPDATE beam_requests
             SET status = COALESCE(%s, status),
                 cost_cents = COALESCE(%s, cost_cents),
                 eta_seconds = COALESCE(%s, eta_seconds),
                 report_type = COALESCE(%s, report_type),
                 parcel_area_sqft = COALESCE(%s, parcel_area_sqft),
                 completed_at = COALESCE(%s, completed_at)
           WHERE id = %s""",
        [
            STATUS_BY_CODE.get(request.get("status")),
            request.get("cost"),
            request.get("eta"),
            request.get("report_type"),
            (request.get("input") or {}).get("parcel_area"),
            request.get("completed_at"),
            beam_request_id,
        ],
    )


async def _persist_outputs(beam_request_id: str, rows: list[dict]) -> int:
    """Append every measurement verbatim. The unique key versions redeliveries."""
    stored = 0
    for row in rows:
        feature = row.get("feature") or {}
        geojson = row.get("output_geojson")
        for m in row.get("measurements") or []:
            await execute(
                """INSERT IGNORE INTO beam_outputs
                     (id, beam_request_id, attentive_output_id, feature_name, feature_uuid,
                      geometry_type, is_custom, measurement_name, value, unit,
                      output_updated_at, output_geojson)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [
                    str(uuid.uuid4()),
                    beam_request_id,
                    str(row.get("id")),
                    feature.get("name") or "",
                    feature.get("id"),
                    feature.get("geometry_type"),
                    1 if row.get("is_custom") else 0,
                    m.get("name") or "",
                    m.get("value"),
                    m.get("unit"),
                    row.get("output_updated_at"),
                    geojson.encode("utf-8") if isinstance(geojson, str) else geojson,
                ],
            )
            stored += 1
    return stored


# ── Apply vs flag ────────────────────────────────────────────────────────────

async def _apply_or_flag(req_row: dict, beam_request_id: str) -> IngestResult:
    estimate_id = req_row.get("estimate_id")
    if not estimate_id:
        # Property-scoped measurement with no estimate attached yet; stored only.
        return IngestResult(status="synced")

    est_rows = await query("SELECT id, status FROM estimates WHERE id = %s", [estimate_id])
    if not est_rows:
        return IngestResult(status="synced")

    latest = await _latest_outputs(beam_request_id)
    groups, unmapped = _group(latest)

    if est_rows[0].get("status") not in UNPRICED_STATUSES:
        await _flag_estimate(estimate_id)
        return IngestResult(status="flagged", flagged=True, unmapped=unmapped)

    applied = 0
    for group_name, entries in groups.items():
        if await _apply_group(estimate_id, group_name, entries):
            applied += 1
        else:
            await _flag_estimate(estimate_id)

    await _apply_estimate_columns(estimate_id, latest)
    return IngestResult(status="synced", sections_applied=applied, unmapped=unmapped)


async def _latest_outputs(beam_request_id: str) -> list[dict]:
    """The newest version of each measurement — prior versions stay for the audit trail."""
    return await query(
        """SELECT o.* FROM beam_outputs o
             JOIN (SELECT attentive_output_id, measurement_name,
                          MAX(COALESCE(output_updated_at, created_at)) AS latest
                     FROM beam_outputs WHERE beam_request_id = %s
                    GROUP BY attentive_output_id, measurement_name) newest
               ON newest.attentive_output_id = o.attentive_output_id
              AND newest.measurement_name = o.measurement_name
              AND COALESCE(o.output_updated_at, o.created_at) = newest.latest
            WHERE o.beam_request_id = %s""",
        [beam_request_id, beam_request_id],
    )


def _group(rows: list[dict]) -> tuple[dict[str, list[dict]], list[UnmappedOutput]]:
    """Split measurements into per-section area totals and an unmapped list."""
    groups: dict[str, list[dict]] = {}
    unmapped: list[UnmappedOutput] = []
    for row in rows:
        mapping = mapping_for(row.get("feature_name"))
        if mapping is None:
            unmapped.append(_unmapped(row, "no mapping for this feature"))
            continue
        if mapping.target != SECTION_SQUARE_FEET:
            # LINEAR_ONLY stops here by design — retained in beam_outputs and shown
            # to the estimator, never written to a square_feet column. Estimate-column
            # targets are applied by _apply_estimate_columns.
            continue
        try:
            sqft = convert(float(row["value"]), row["unit"], mapping.unit)
        except (UnknownUnit, DimensionMismatch, TypeError, ValueError) as exc:
            unmapped.append(_unmapped(row, str(exc)))
            continue
        groups.setdefault(mapping.group, []).append({"row": row, "value": sqft})
    return groups, unmapped


def _unmapped(row: dict, reason: str) -> UnmappedOutput:
    return UnmappedOutput(
        feature_name=row.get("feature_name") or "",
        measurement_name=row.get("measurement_name") or "",
        value=float(row["value"]) if row.get("value") is not None else None,
        unit=row.get("unit"),
        reason=reason,
    )


async def _apply_group(estimate_id: str, group_name: str, entries: list[dict]) -> bool:
    """Write one section's square_feet. Returns False if an estimator owns it now."""
    total = round(sum(e["value"] for e in entries), 2)
    rows = await query(
        "SELECT id, square_feet FROM estimate_sections WHERE estimate_id = %s AND name = %s",
        [estimate_id, group_name],
    )

    if not rows:
        section_id = str(uuid.uuid4())
        order_rows = await query(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM estimate_sections WHERE estimate_id = %s",
            [estimate_id],
        )
        await execute(
            """INSERT INTO estimate_sections (id, estimate_id, name, square_feet, sort_order)
               VALUES (%s,%s,%s,%s,%s)""",
            [section_id, estimate_id, group_name, total, order_rows[0]["next"]],
        )
    else:
        section_id = rows[0]["id"]
        previous = await _previously_applied_total(section_id)
        current = float(rows[0]["square_feet"] or 0)
        # previous is None the first time Beam touches an existing section; a
        # non-zero section we have never written is the estimator's own number.
        if previous is None:
            if round(current, 2) != 0:
                return False
        elif abs(current - previous) > 0.01:
            return False
        await execute(
            "UPDATE estimate_sections SET square_feet = %s WHERE id = %s", [total, section_id]
        )

    for entry in entries:
        await execute(
            """UPDATE beam_outputs
                 SET applied_to_section_id = %s, applied_value = %s, applied_unit = 'sq ft'
               WHERE id = %s""",
            [section_id, round(entry["value"], 4), entry["row"]["id"]],
        )
    return True


async def _previously_applied_total(section_id: str) -> Optional[float]:
    rows = await query(
        """SELECT SUM(applied_value) AS total FROM beam_outputs
            WHERE applied_to_section_id = %s AND applied_value IS NOT NULL""",
        [section_id],
    )
    total = rows[0].get("total") if rows else None
    return None if total is None else round(float(total), 2)


async def _apply_estimate_columns(estimate_id: str, rows: list[dict]) -> None:
    """turf_area_acres / curb_miles are stored in acres and miles; Beam sends sq ft and ft."""
    totals: dict[str, float] = {}
    for row in rows:
        mapping = mapping_for(row.get("feature_name"))
        if mapping is None or mapping.target not in (ESTIMATE_TURF_ACRES, ESTIMATE_CURB_MILES):
            continue
        try:
            totals[mapping.target] = totals.get(mapping.target, 0.0) + convert(
                float(row["value"]), row["unit"], mapping.unit
            )
        except (UnknownUnit, DimensionMismatch, TypeError, ValueError):
            continue  # already reported through the unmapped list

    if ESTIMATE_TURF_ACRES in totals:
        await execute(
            "UPDATE estimates SET turf_area_acres = %s WHERE id = %s",
            [round(totals[ESTIMATE_TURF_ACRES], 2), estimate_id],
        )
    if ESTIMATE_CURB_MILES in totals:
        await execute(
            "UPDATE estimates SET curb_miles = %s WHERE id = %s",
            [round(totals[ESTIMATE_CURB_MILES], 2), estimate_id],
        )


async def _flag_estimate(estimate_id: str) -> None:
    await execute(
        "UPDATE estimates SET takeoff_changed_at = %s WHERE id = %s", [_now_utc(), estimate_id]
    )


async def _mark_sync(beam_request_id: str, status: str, error: Optional[str]) -> None:
    await execute(
        """UPDATE beam_requests
             SET beam_sync_status = %s, beam_sync_error = %s, beam_synced_at = %s
           WHERE id = %s""",
        [status, error, _now_utc() if status == "synced" else None, beam_request_id],
    )


# ── Sweep ────────────────────────────────────────────────────────────────────
#
# Attentive retries callbacks with exponential backoff over 24 hours before
# dead-lettering, so this is the recovery path only past that window. At their
# guidance it runs every 4–6 hours; polling harder just costs DB load.

async def sweep_once(limit: int = 50) -> None:
    rows = await query(
        """SELECT id FROM beam_requests
             WHERE attentive_request_id IS NOT NULL
               AND status IN ('in_progress','queued','investigating','resubmitted')
             ORDER BY updated_at LIMIT %s""",
        [limit],
    )
    async with BeamClient() as client:
        for row in rows:
            await ingest_request(row["id"], client=client)


async def sweep_loop() -> None:
    while True:
        await asyncio.sleep(_SWEEP_INTERVAL_SECONDS)
        try:
            await sweep_once()
        except Exception:  # never let the sweep loop die
            logger.exception("beam sync sweep failed")
