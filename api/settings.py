"""Settings API — company config writes with audit (Handoff 38, Slice 4).

The Settings page's company write path. Every value here was hardcoded twice
before migration 020 moved the source of truth into the DB; this module is the
only place those rows are mutated, and every successful write is audited.

Company writes are ADMIN-ONLY, and admin is re-read LIVE from the users table by
JWT id (Amendment B.2) — a stale/forged `admin` claim on a since-demoted user
cannot widen scope. Company settings, margin bands and approval tiers are
company-scoped: editing an approval tier moves the REAL 403 boundary for
approvals (§5.1), so its edit lives behind this guard.

Every successful write inserts config_audit rows via `_audit`: one row per
changed setting_key, capturing from_value (read BEFORE the write), to_value, and
the actor (JWT email/id). DB access goes through this module's own
`query`/`execute` (imported from db) so tests patch api.settings.query /
api.settings.execute; the live role re-read lives in api.authz and is patched
there.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from db import execute, query
from api import authz


# ── Audit helper ─────────────────────────────────────────────────────────────

def _actor(user: dict) -> str:
    """Stable actor string for the audit trail — email first, then id.

    Mirrors the estimate_adjustments convention (JWT-derived identity); email
    is the human-readable handle the audit read-back keys on.
    """
    return user.get("email") or user.get("id") or "unknown"


def _to_audit_value(value: Any) -> Optional[str]:
    """Render a from/to value as the audit column's TEXT (NULL stays NULL)."""
    if value is None:
        return None
    return str(value)


async def _audit(
    *,
    scope_type: str,
    scope_id: Optional[str],
    setting_key: str,
    from_value: Any,
    to_value: Any,
    actor: str,
) -> None:
    """Insert exactly ONE config_audit row for a single changed setting.

    Callers invoke this once per changed setting_key AFTER reading the prior
    value, so from_value is always the state before the write. scope_id is NULL
    for company scope and the str(aspire_branch_id) for branch scope (Slice 5).
    """
    await execute(
        """INSERT INTO config_audit
             (id, scope_type, scope_id, setting_key, from_value, to_value, actor)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        [
            str(uuid.uuid4()),
            scope_type,
            scope_id,
            setting_key,
            _to_audit_value(from_value),
            _to_audit_value(to_value),
            actor,
        ],
    )


# ── Live admin re-read (company writes) ──────────────────────────────────────

async def _require_admin(user: dict) -> None:
    """403 unless the LIVE users row says admin and active (Amendment B.2).

    Never trusts the JWT `role` claim on the write path: a token that claims
    admin for a user since demoted or deactivated must not widen scope. Reuses
    authz._live_role, which reads role+active from users by JWT id and 403s on
    a missing/inactive row.
    """
    live_role = await authz._live_role(user)
    if live_role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin role required: company settings are admin-owned.",
        )


# ── Request bodies ───────────────────────────────────────────────────────────

class CompanySettingsPatch(BaseModel):
    """Partial update of the company_settings singleton (id=1).

    Every field is optional — the PATCH updates only the keys present. Types
    mirror the typed columns from migration 020 (no key/value blob).
    """
    sla_return_window_days: Optional[int] = None
    sla_at_risk_threshold_days: Optional[int] = None
    discrepancy_threshold_pct: Optional[float] = None
    default_target_margin: Optional[float] = None
    default_win_probability: Optional[float] = None
    default_priority: Optional[str] = None
    default_notify_bm_rd_on_return: Optional[bool] = None


class ApprovalTierPatch(BaseModel):
    """Partial update of one approval_tiers row (config-driven ladder, §5.1)."""
    label: Optional[str] = None
    min_value_cents: Optional[int] = None
    max_value_cents: Optional[int] = None
    tier_order: Optional[int] = None


class MarginBandPatch(BaseModel):
    """Partial update of one margin_bands row."""
    good_min: Optional[float] = None
    ok_min: Optional[float] = None


# Company setting columns (bodies already use snake_case column names).
_COMPANY_COLS: tuple[str, ...] = (
    "sla_return_window_days",
    "sla_at_risk_threshold_days",
    "discrepancy_threshold_pct",
    "default_target_margin",
    "default_win_probability",
    "default_priority",
    "default_notify_bm_rd_on_return",
)

_TIER_COLS: tuple[str, ...] = (
    "label",
    "min_value_cents",
    "max_value_cents",
    "tier_order",
)

_MARGIN_BAND_COLS: tuple[str, ...] = ("good_min", "ok_min")


def register(app, require_auth) -> None:
    """Attach settings routes to the FastAPI app with the shared auth dep."""

    # ── Slice 4: company settings ────────────────────────────────────────────

    @app.get("/api/settings/company")
    async def get_company_settings(_user: dict = Depends(require_auth)) -> dict:
        """Read the company_settings singleton (row id=1). Any authed role."""
        rows = await query("SELECT * FROM company_settings WHERE id = 1", [])
        if not rows:
            raise HTTPException(status_code=404, detail="Company settings not initialized")
        return dict(rows[0])

    @app.patch("/api/settings/company")
    async def patch_company_settings(
        body: CompanySettingsPatch, user: dict = Depends(require_auth)
    ) -> dict:
        """Partial update of the singleton; admin-only, audited per changed key.

        The live-admin check runs BEFORE any read or write, so a non-admin (even
        one holding an admin claim) never touches the row. from_value for each
        key is read from the current row before the UPDATE.
        """
        await _require_admin(user)
        updates = {
            col: getattr(body, col)
            for col in _COMPANY_COLS
            if getattr(body, col) is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No settings to update")

        rows = await query("SELECT * FROM company_settings WHERE id = 1", [])
        if not rows:
            raise HTTPException(status_code=404, detail="Company settings not initialized")
        current = rows[0]

        set_clause = ", ".join(f"{col} = %s" for col in updates)
        params: list[Any] = list(updates.values())
        await execute(
            f"UPDATE company_settings SET {set_clause} WHERE id = 1", params
        )

        actor = _actor(user)
        for col, new_value in updates.items():
            await _audit(
                scope_type="company",
                scope_id=None,
                setting_key=col,
                from_value=current.get(col),
                to_value=new_value,
                actor=actor,
            )

        refreshed = await query("SELECT * FROM company_settings WHERE id = 1", [])
        return dict(refreshed[0]) if refreshed else {**dict(current), **updates}

    @app.patch("/api/settings/company/approval-tiers/{tier_id}")
    async def patch_approval_tier(
        tier_id: str, body: ApprovalTierPatch, user: dict = Depends(require_auth)
    ) -> dict:
        """Edit one approval_tiers row (company-scoped, §5.1) — admin-only.

        Editing a tier moves the REAL approval 403 boundary, so it lives behind
        the same live-admin guard as the rest of company settings. One audit row
        per changed column, from_value read from the tier before the UPDATE.
        """
        await _require_admin(user)
        updates = {
            col: getattr(body, col)
            for col in _TIER_COLS
            if getattr(body, col) is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No tier fields to update")

        rows = await query("SELECT * FROM approval_tiers WHERE id = %s", [tier_id])
        if not rows:
            raise HTTPException(status_code=404, detail="Approval tier not found")
        current = rows[0]

        set_clause = ", ".join(f"{col} = %s" for col in updates)
        params: list[Any] = list(updates.values()) + [tier_id]
        await execute(
            f"UPDATE approval_tiers SET {set_clause} WHERE id = %s", params
        )

        actor = _actor(user)
        for col, new_value in updates.items():
            await _audit(
                scope_type="company",
                scope_id=None,
                setting_key=f"approval_tier.{tier_id}.{col}",
                from_value=current.get(col),
                to_value=new_value,
                actor=actor,
            )

        refreshed = await query("SELECT * FROM approval_tiers WHERE id = %s", [tier_id])
        return dict(refreshed[0]) if refreshed else {**dict(current), **updates}

    @app.patch("/api/settings/company/margin-bands/{band_id}")
    async def patch_margin_band(
        band_id: str, body: MarginBandPatch, user: dict = Depends(require_auth)
    ) -> dict:
        """Edit one margin_bands row (company-scoped) — admin-only, audited."""
        await _require_admin(user)
        updates = {
            col: getattr(body, col)
            for col in _MARGIN_BAND_COLS
            if getattr(body, col) is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No band fields to update")

        rows = await query("SELECT * FROM margin_bands WHERE id = %s", [band_id])
        if not rows:
            raise HTTPException(status_code=404, detail="Margin band not found")
        current = rows[0]

        set_clause = ", ".join(f"{col} = %s" for col in updates)
        params: list[Any] = list(updates.values()) + [band_id]
        await execute(
            f"UPDATE margin_bands SET {set_clause} WHERE id = %s", params
        )

        actor = _actor(user)
        for col, new_value in updates.items():
            await _audit(
                scope_type="company",
                scope_id=None,
                setting_key=f"margin_band.{band_id}.{col}",
                from_value=current.get(col),
                to_value=new_value,
                actor=actor,
            )

        refreshed = await query("SELECT * FROM margin_bands WHERE id = %s", [band_id])
        return dict(refreshed[0]) if refreshed else {**dict(current), **updates}
