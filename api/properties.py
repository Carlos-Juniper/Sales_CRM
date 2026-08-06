"""Properties API — /api/properties/* routes (Handoff 15: canonical model).

App-owned CANONICAL property records are the SOURCE OF TRUTH; Aspire is
downstream. Every vertical prospecting table (hoa_properties, …) feeds into
this table on engagement via (source_type, source_id); `property_type` drives
estimating/Aspire logic while `source_type`/`source_id` trace provenance.

Create is LOCAL-ONLY and an upsert on (source_type, source_id): promotion is
idempotent, and NO Aspire push happens here — a property stays 'unsynced'
until an estimate is submitted for it. The one and only sync trigger is
estimate submission (api/estimating.py → sync_property_if_needed), which
flips the row pending → synced/failed.

Search reads the local table (modeled on list_hoa_properties). A best-effort
proxy surfaces a property's existing Aspire opportunities so intake catches
prior work before creating anything (the front-end dedup step).

All Aspire vocabulary is confined to api/aspire_sync.py; this module never
speaks it directly.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query

from db import execute, query
from api import aspire_sync, pipeline
from api.aspire_sync import PropertyInput


def _new_id() -> str:
    return str(uuid.uuid4())


def _now_utc() -> datetime:
    # Naive UTC to match the DB's DATETIME columns, sourced from a tz-aware clock
    # (avoids the deprecated datetime.utcnow()).
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _property_out(r: dict) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "propertyType": r.get("property_type"),
        "sourceType": r.get("source_type"),
        "sourceId": r.get("source_id"),
        "address1": r.get("address1"),
        "address2": r.get("address2"),
        "city": r.get("city"),
        "state": r.get("state"),
        "zip": r.get("zip"),
        "branchCity": r.get("branch_city"),
        "customerType": r.get("customer_type"),
        "managementCompanyId": r.get("management_company_id"),
        "aspirePropertyId": r.get("aspire_property_id"),
        "aspireSyncStatus": r.get("aspire_sync_status"),
        "createdAt": _iso(r.get("created_at")),
        "updatedAt": _iso(r.get("updated_at")),
    }


# ── Background push + persistence ─────────────────────────────────────────────

def _sync_status_col(status: str) -> str:
    return {"synced": "synced", "failed": "failed"}.get(status, "pending")


async def _persist_property_result(property_id: str, res) -> None:
    status_col = _sync_status_col(res.status)
    synced_at = _now_utc() if res.status == "synced" else None
    await execute(
        """UPDATE properties
             SET aspire_property_id = COALESCE(%s, aspire_property_id),
                 aspire_sync_status = %s,
                 aspire_sync_error = %s,
                 aspire_synced_at = %s,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = %s""",
        [res.aspire_property_id, status_col, res.error, synced_at, property_id],
    )


async def _sync_property_bg(property_id: str) -> None:
    """Push one property to Aspire (the reusable trigger — Handoff 15 §5.4).

    Invoked from estimate submission, NEVER from create_property. Sets
    aspire_sync_status='pending' at the start of the push; the result flips it
    to synced/failed via _persist_property_result.
    """
    rows = await query("SELECT * FROM properties WHERE id = %s", [property_id])
    if not rows:
        return
    p = rows[0]
    # Mark the push queued/in-flight before touching Aspire.
    await execute(
        """UPDATE properties
             SET aspire_sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
           WHERE id = %s""",
        [property_id],
    )
    # A property is a branch-level entity, NOT tied to a single opportunity type,
    # so it registers under the city's primary (maintenance) branch. The branch map
    # is keyed by (city, is_install); install opportunities pick their own branch at
    # opportunity-push time (see estimating._build_opportunity_input). Hence the
    # deliberate is_install=False here — the property row carries no install flag.
    inp = PropertyInput(
        name=p.get("name", ""),
        address1=p.get("address1") or "",
        city=p.get("city") or "",
        state=p.get("state") or "",
        zip=p.get("zip") or "",
        branch_city=p.get("branch_city") or "",
        is_install=False,
        address2=p.get("address2"),
    )
    res = await aspire_sync.push_property(inp)
    await _persist_property_result(property_id, res)


async def sync_property_if_needed(property_id: str) -> None:
    """Estimate-submission trigger: push the property to Aspire iff it has not
    already been pushed (only 'unsynced'/'failed' rows; 'pending' is in-flight
    and 'synced' must never re-push)."""
    rows = await query(
        "SELECT aspire_sync_status FROM properties WHERE id = %s", [property_id]
    )
    if not rows:
        return
    if rows[0].get("aspire_sync_status") in ("unsynced", "failed", None):
        await _sync_property_bg(property_id)


# ── Routes ────────────────────────────────────────────────────────────────────

def register(app, require_auth) -> None:
    @app.get("/api/properties")
    async def list_properties(
        search: Optional[str] = None,
        page_size: int = Query(default=25, le=200),
        _user: dict = Depends(require_auth),
    ) -> list:
        conditions: list[str] = []
        params: list[Any] = []
        if search:
            conditions.append("(name LIKE %s OR address1 LIKE %s OR city LIKE %s)")
            like = f"%{search}%"
            params.extend([like, like, like])
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.append(page_size)
        rows = await query(
            f"SELECT * FROM properties {where} ORDER BY name LIMIT %s", params
        )
        return [_property_out(r) for r in rows]

    @app.get("/api/properties/{property_id}/opportunities")
    async def property_opportunities(
        property_id: str, _user: dict = Depends(require_auth)
    ) -> list:
        rows = await query(
            "SELECT aspire_property_id FROM properties WHERE id = %s", [property_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Not found")
        # Best-effort — [] when sync disabled / property unsynced / Aspire down.
        return await aspire_sync.list_opportunities_for_property(rows[0].get("aspire_property_id"))

    @app.post("/api/properties", status_code=201)
    async def create_property(
        body: dict, _user: dict = Depends(require_auth)
    ) -> dict:
        if not body.get("name"):
            raise HTTPException(status_code=400, detail="name is required")

        source_type = body.get("sourceType") or "manual"
        source_id = body.get("sourceId")
        property_type = body.get("propertyType") or (
            source_type if source_type != "manual" else "manual"
        )

        # Upsert on (source_type, source_id): promotion / find-or-create is
        # idempotent — return the existing row if the vertical row was already
        # promoted. (source_type='manual' rows carry source_id NULL and are
        # never deduped this way — MySQL treats NULLs as distinct.)
        if source_id is not None:
            existing = await query(
                "SELECT * FROM properties WHERE source_type = %s AND source_id = %s",
                [source_type, source_id],
            )
            if existing:
                return _property_out(existing[0])

        property_id = _new_id()
        await execute(
            """INSERT INTO properties
                 (id, property_type, source_type, source_id, name, address1,
                  address2, city, state, zip, branch_city, customer_type,
                  management_company_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE id = id""",
            [
                property_id,
                property_type,
                source_type,
                source_id,
                body.get("name"),
                body.get("address1", ""),
                body.get("address2"),
                body.get("city", ""),
                body.get("state", ""),
                body.get("zip", ""),
                body.get("branchCity"),
                body.get("customerType"),
                body.get("managementCompanyId"),
            ],
        )
        # LOCAL-ONLY: no Aspire push here. The row stays 'unsynced' (column
        # default) until an estimate submission triggers sync_property_if_needed.
        if source_id is not None:
            # Authoritative re-read via the UNIQUE key (covers a concurrent promote).
            rows = await query(
                "SELECT * FROM properties WHERE source_type = %s AND source_id = %s",
                [source_type, source_id],
            )
        else:
            rows = await query("SELECT * FROM properties WHERE id = %s", [property_id])
        return _property_out(rows[0])

    @app.post("/api/properties/{property_id}/promote", status_code=201)
    async def promote_property(
        property_id: str, _user: dict = Depends(require_auth)
    ) -> dict:
        """Create-lead-from-property (generalized promote — Handoff 15 §5.5)."""
        try:
            lead = await pipeline.promote_property_to_lead(property_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        return lead.to_dict()
