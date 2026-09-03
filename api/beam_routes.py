"""Beam / Attentive takeoff routes.

Kept out of api/estimating.py, which is already 2400 lines; registered from
api/server.py the same way.

Two things here are unlike every other route in the estimating surface:

  * ``POST .../generate`` is the only route in the codebase that spends money.
    Attentive bills per takeoff and confirmed that generation needs no portal
    click, so the click that used to be a human's inside Beam is now our HTTP
    call. It is estimator-gated, it shows cost before it commits, and
    ``beam_requests.submitted_at`` makes a double-submit or a network retry a
    no-op instead of a second order.
  * ``POST /webhooks/attentive`` sits OUTSIDE require_auth, because Attentive
    cannot send auth headers — credentials must be URL query params. It is
    therefore treated as a notification only: it reads request_id and discards
    the rest of the body, then re-fetches the measurements with our own bearer
    token. A forged callback can cause a redundant fetch and nothing else.
"""
from __future__ import annotations

import hmac
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote

from fastapi import BackgroundTasks, Depends, HTTPException, Query, Request

from db import execute, query
from api import authz
from api import beam_sync
from api.beam_client import BeamClient, BeamError, beam_env

logger = logging.getLogger(__name__)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _editor_url(attentive_request_id: Optional[str]) -> Optional[str]:
    """Deep link into Attentive's map editor.

    No credentials in the URL: every estimator has their own Beam portal login,
    so their session authorises the view and Attentive attributes the edit to
    them. Must follow BEAM_ENV — a stage request id does not resolve on prod.
    """
    if not attentive_request_id:
        return None
    app_var = "ATTENTIVE_STAGE_APP_URL" if beam_env() == "stage" else "ATTENTIVE_APP_URL"
    app_url = os.environ.get(app_var, "").rstrip("/")
    if not app_url:
        return None
    return f"{app_url}/request/{quote(attentive_request_id)}"


def _request_json(row: dict, unmapped: Optional[list] = None) -> dict:
    return {
        "id": row["id"],
        "propertyId": row.get("property_id"),
        "estimateId": row.get("estimate_id"),
        "attentiveRequestId": row.get("attentive_request_id"),
        "editorUrl": _editor_url(row.get("attentive_request_id")),
        "status": row.get("status"),
        "costCents": row.get("cost_cents"),
        "etaSeconds": row.get("eta_seconds"),
        "parcelAreaSqft": _float(row.get("parcel_area_sqft")),
        "address": row.get("address"),
        "submittedAt": row.get("submitted_at"),
        "completedAt": row.get("completed_at"),
        "syncStatus": row.get("beam_sync_status"),
        "syncError": row.get("beam_sync_error"),
        "unmapped": unmapped or [],
    }


def _output_json(row: dict) -> dict:
    return {
        "id": row["id"],
        "featureName": row.get("feature_name"),
        "measurementName": row.get("measurement_name"),
        "value": _float(row.get("value")),
        "unit": row.get("unit"),
        "geometryType": row.get("geometry_type"),
        "isCustom": bool(row.get("is_custom")),
        "appliedToSectionId": row.get("applied_to_section_id"),
        "appliedValue": _float(row.get("applied_value")),
        "appliedUnit": row.get("applied_unit"),
        "outputUpdatedAt": row.get("output_updated_at"),
    }


def _float(value: Any) -> Optional[float]:
    return None if value is None else float(value)


async def _load_request(beam_request_id: str) -> dict:
    rows = await query("SELECT * FROM beam_requests WHERE id = %s", [beam_request_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Takeoff request not found")
    return rows[0]


def register(app, require_auth) -> None:

    @app.post("/api/estimating/estimates/{estimate_id}/beam/draft", status_code=201)
    async def create_draft(estimate_id: str, body: dict, user: dict = Depends(require_auth)) -> dict:
        """Create an Attentive draft. Costs nothing — generate is the billable step."""
        authz.require_estimator(user)

        est_rows = await query(
            "SELECT id, name, property_id FROM estimates WHERE id = %s", [estimate_id]
        )
        if not est_rows:
            raise HTTPException(status_code=404, detail="Estimate not found")
        estimate = est_rows[0]
        property_id = estimate.get("property_id")
        if not property_id:
            raise HTTPException(
                status_code=400,
                detail="Estimate has no linked property; a takeoff is measured against a property.",
            )
        address = (body.get("address") or "").strip()
        if not address:
            raise HTTPException(status_code=400, detail="address is required")

        # Our id, not the estimate's — the measurement belongs to the property so a
        # re-bid can reuse it. This is what Attentive echoes on every callback.
        beam_request_id = str(uuid.uuid4())
        await execute(
            """INSERT INTO beam_requests (id, property_id, estimate_id, address, status)
               VALUES (%s,%s,%s,%s,'unordered')""",
            [beam_request_id, property_id, estimate_id, address],
        )

        async with BeamClient() as client:
            try:
                created = await client.create_request(
                    name=estimate.get("name") or address,
                    address=address,
                    downstream_id=beam_request_id,
                )
            except BeamError as exc:
                await execute(
                    "UPDATE beam_requests SET beam_sync_status='failed', beam_sync_error=%s WHERE id=%s",
                    [str(exc), beam_request_id],
                )
                raise HTTPException(status_code=502, detail=f"Attentive rejected the draft: {exc}")

            await execute(
                "UPDATE beam_requests SET attentive_request_id=%s, status='draft' WHERE id=%s",
                [str(created.get("id")), beam_request_id],
            )
            # Cost and ETA are only on the retrieve response; the estimator must see
            # both before the generate action commits to the spend.
            try:
                detail = await client.get_request(str(created.get("id")))
            except BeamError:
                detail = {}

        if detail:
            await execute(
                """UPDATE beam_requests SET cost_cents=%s, eta_seconds=%s, report_type=%s,
                          parcel_area_sqft=%s WHERE id=%s""",
                [
                    detail.get("cost"),
                    detail.get("eta"),
                    detail.get("report_type"),
                    (detail.get("input") or {}).get("parcel_area"),
                    beam_request_id,
                ],
            )
        return _request_json(await _load_request(beam_request_id))

    @app.get("/api/estimating/estimates/{estimate_id}/beam")
    async def latest_for_estimate(estimate_id: str, _user: dict = Depends(require_auth)) -> Optional[dict]:
        """The most recent takeoff request for this estimate, or null if none."""
        rows = await query(
            "SELECT * FROM beam_requests WHERE estimate_id = %s ORDER BY created_at DESC LIMIT 1",
            [estimate_id],
        )
        return _request_json(rows[0]) if rows else None

    @app.post("/api/estimating/beam/requests/{beam_request_id}/generate")
    async def generate(beam_request_id: str, user: dict = Depends(require_auth)) -> dict:
        """Order the takeoff. Billable — estimator-gated and idempotent."""
        authz.require_estimator(user)
        row = await _load_request(beam_request_id)

        # submitted_at is the spend guard: once set, this request has already been
        # ordered and a repeat call must not place a second order.
        if row.get("submitted_at"):
            return _request_json(row)
        if not row.get("attentive_request_id"):
            raise HTTPException(status_code=409, detail="Draft has not been created at Attentive")

        async with BeamClient() as client:
            try:
                reports = await client.get_report_types()
                if not reports:
                    raise HTTPException(
                        status_code=502, detail="Attentive returned no report types for this account"
                    )
                await client.generate_request(
                    row["attentive_request_id"],
                    address=row["address"],
                    report_id=str(reports[0]["id"]),
                )
            except BeamError as exc:
                raise HTTPException(status_code=502, detail=f"Attentive rejected the order: {exc}")

        await execute(
            "UPDATE beam_requests SET submitted_at=%s, submitted_by_user_id=%s, status='queued' WHERE id=%s",
            [_now_utc(), user.get("sub") or user.get("id"), beam_request_id],
        )
        return _request_json(await _load_request(beam_request_id))

    @app.get("/api/estimating/beam/requests/{beam_request_id}")
    async def get_request(beam_request_id: str, _user: dict = Depends(require_auth)) -> dict:
        row = await _load_request(beam_request_id)
        outputs = await query(
            "SELECT * FROM beam_outputs WHERE beam_request_id = %s ORDER BY feature_name",
            [beam_request_id],
        )
        payload = _request_json(row)
        payload["outputs"] = [_output_json(o) for o in outputs]
        payload["unmapped"] = [
            {"featureName": o.get("feature_name"), "unit": o.get("unit")}
            for o in outputs
            if beam_sync.mapping_for(o.get("feature_name")) is None
        ]
        return payload

    @app.post("/api/estimating/beam/requests/{beam_request_id}/accept")
    async def accept_changes(beam_request_id: str, user: dict = Depends(require_auth)) -> dict:
        """Clear the 'takeoff changed since pricing' flag once the estimator has reviewed."""
        authz.require_estimator(user)
        row = await _load_request(beam_request_id)
        if row.get("estimate_id"):
            await execute(
                "UPDATE estimates SET takeoff_changed_at = NULL WHERE id = %s", [row["estimate_id"]]
            )
        return _request_json(await _load_request(beam_request_id))

    # ── Callback ─────────────────────────────────────────────────────────────

    @app.post("/webhooks/attentive")
    async def attentive_callback(
        request: Request, background: BackgroundTasks, token: str = Query(default="")
    ) -> dict:
        expected = os.environ.get("ATTENTIVE_WEBHOOK_TOKEN", "")
        if not expected or not hmac.compare_digest(token, expected):
            raise HTTPException(status_code=403, detail="Invalid callback token")

        try:
            body = await request.json()
        except Exception:
            body = {}
        # Only the id is read. Measurements in the body are ignored on purpose:
        # the URL-param auth Attentive requires is too weak to trust with data,
        # so everything is re-fetched with our own bearer token.
        data = body.get("data") or {}
        attentive_request_id = str(data.get("request_id") or "")
        if not attentive_request_id:
            return {"ok": True, "ignored": "no request_id"}

        rows = await query(
            "SELECT id FROM beam_requests WHERE attentive_request_id = %s", [attentive_request_id]
        )
        if not rows:
            logger.info("attentive callback for unknown request %s", attentive_request_id)
            return {"ok": True, "ignored": "unknown request"}

        background.add_task(beam_sync.ingest_request, rows[0]["id"])
        return {"ok": True}
