"""Settings API — company + branch config writes with audit (Handoff 38, Slices 4–5).

The Settings page's write path. Every value here was hardcoded twice before
migration 020 moved the source of truth into the DB; this module is the only
place those rows are mutated, and every successful write is audited.

Two authorization boundaries, deliberately different:

  * Company writes (Slice 4) are ADMIN-ONLY, and admin is re-read LIVE from the
    users table by JWT id (Amendment B.2) — a stale/forged `admin` claim on a
    since-demoted user cannot widen scope. Company settings, margin bands and
    approval tiers are company-scoped: editing an approval tier moves the REAL
    403 boundary for approvals (§5.1), so its edit lives behind this guard.

  * Branch writes (Slice 5) are scoped by `resolve_branch_scope(user)` — the
    writable branch set comes from the caller's `user_branches` rows, NEVER the
    path or body. admin (kind='all') may write any branch; a BM/RD may write
    only a branch in its scope; anyone else 403. A branch id supplied in the
    path/body that is outside the caller's scope still 403s.

Every successful write inserts config_audit rows via `_audit`: one row per
changed setting_key, capturing from_value (read BEFORE the write), to_value,
and the actor (JWT email/id). DB access goes through this module's own
`query`/`execute` (imported from db) so tests patch api.settings.query /
api.settings.execute; the live role/scope re-reads live in api.authz and are
patched there.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from db import execute, query
from api import authz


# ── Audit helper (shared by both slices) ─────────────────────────────────────

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
    for company scope and the str(aspire_branch_id) for branch scope.
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


# ── Branch scope guard (branch writes) ───────────────────────────────────────

async def _require_branch_write_scope(user: dict, aspire_branch_id: int) -> None:
    """403 unless the caller may write `aspire_branch_id` (critical AC, §I-9.5).

    The writable branch set comes from resolve_branch_scope(user) — the caller's
    user_branches — NEVER the path or body. admin (kind='all') may write any
    branch; a scoped role (BM/RD) may write only a branch in its list; a user
    with no branches (kind='none') writes nothing. A branch id in the path/body
    outside the caller's scope always 403s: the request cannot widen scope.
    """
    scope = await authz.resolve_branch_scope(user)
    if scope.kind == "all":
        return
    if scope.kind == "branch" and aspire_branch_id in scope.ids:
        return
    raise HTTPException(
        status_code=403,
        detail="Branch out of scope: you may edit only branches assigned to you.",
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


class BranchSettingsPatch(BaseModel):
    """Partial update of a branch's settings.

    `aspire_branch_id` may appear in the body for wire compatibility but is
    IGNORED for authorization — scope comes from user_branches, never the body
    (critical AC). crew_rate_cents_per_hour writes branch_settings; production
    rate writes catalog_items; material factors write material_calcs.factors.
    """
    aspire_branch_id: Optional[int] = None
    crew_rate_cents_per_hour: Optional[int] = None
    # {catalog_item_id: production_rate}
    production_rates: Optional[dict[str, float]] = None
    # {material_key: {factor_name: value, ...}} — factor columns only, never
    # unit_cost/unit_sell.
    material_factors: Optional[dict[str, dict]] = None


# Company setting column map (camel-free: bodies already use snake_case columns).
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

    # ── Slice 5: branch settings + scope guard ───────────────────────────────

    @app.get("/api/settings/branch/{aspire_branch_id}")
    async def get_branch_settings(
        aspire_branch_id: int, user: dict = Depends(require_auth)
    ) -> dict:
        """Read one branch's settings. Scoped read: a caller may see only a
        branch in its resolve_branch_scope; admin sees any.

        crew_rate_cents_per_hour has NO fallback (migration 020 §2): an
        unconfigured branch returns crewRateCentsPerHour=None so the UI shows
        "no crew rate configured", never an invented number.
        """
        await _require_branch_write_scope(user, aspire_branch_id)
        rows = await query(
            "SELECT * FROM branch_settings WHERE aspire_branch_id = %s",
            [aspire_branch_id],
        )
        crew_rate = rows[0].get("crew_rate_cents_per_hour") if rows else None
        return {
            "aspireBranchId": aspire_branch_id,
            "crewRateCentsPerHour": (
                None if crew_rate is None else int(crew_rate)
            ),
        }

    @app.patch("/api/settings/branch/{aspire_branch_id}")
    async def patch_branch_settings(
        aspire_branch_id: int,
        body: BranchSettingsPatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Update a branch's crew rate / production rates / material factors.

        Scope guard runs FIRST (before any read or write): the writable branch
        is the path id validated against resolve_branch_scope — an out-of-scope
        BM 403s and nothing persists. Every changed setting is audited with
        scope_type='branch', scope_id=str(aspire_branch_id).
        """
        await _require_branch_write_scope(user, aspire_branch_id)

        actor = _actor(user)
        scope_id = str(aspire_branch_id)
        changed = 0

        # ── crew rate → branch_settings ──────────────────────────────────────
        if body.crew_rate_cents_per_hour is not None:
            rows = await query(
                "SELECT crew_rate_cents_per_hour FROM branch_settings WHERE aspire_branch_id = %s",
                [aspire_branch_id],
            )
            prior = rows[0].get("crew_rate_cents_per_hour") if rows else None
            # UPSERT: a branch with no row yet gets one; an existing row is bumped.
            await execute(
                """INSERT INTO branch_settings (aspire_branch_id, crew_rate_cents_per_hour)
                     VALUES (%s, %s)
                   ON DUPLICATE KEY UPDATE crew_rate_cents_per_hour = VALUES(crew_rate_cents_per_hour)""",
                [aspire_branch_id, body.crew_rate_cents_per_hour],
            )
            await _audit(
                scope_type="branch",
                scope_id=scope_id,
                setting_key="crew_rate_cents_per_hour",
                from_value=prior,
                to_value=body.crew_rate_cents_per_hour,
                actor=actor,
            )
            changed += 1

        # ── production rates → catalog_items.production_rate ─────────────────
        for catalog_item_id, rate in (body.production_rates or {}).items():
            rows = await query(
                "SELECT production_rate FROM catalog_items WHERE id = %s",
                [catalog_item_id],
            )
            if not rows:
                raise HTTPException(
                    status_code=404,
                    detail=f"Catalog item {catalog_item_id} not found",
                )
            prior = rows[0].get("production_rate")
            await execute(
                "UPDATE catalog_items SET production_rate = %s WHERE id = %s",
                [rate, catalog_item_id],
            )
            await _audit(
                scope_type="branch",
                scope_id=scope_id,
                setting_key=f"production_rate.{catalog_item_id}",
                from_value=prior,
                to_value=rate,
                actor=actor,
            )
            changed += 1

        # ── material factors → material_calcs.factors ────────────────────────
        # FACTOR columns only — never unit_cost/unit_sell. A branch override is
        # its own row (aspire_branch_id set); NULL aspire_branch_id is the
        # company-wide row. Uniqueness is (material_key, COALESCE(branch,0)).
        for material_key, factors in (body.material_factors or {}).items():
            changed += await _write_material_factors(
                material_key, aspire_branch_id, factors, scope_id, actor
            )

        if changed == 0:
            raise HTTPException(status_code=400, detail="No branch settings to update")

        return await get_branch_settings_payload(aspire_branch_id)

    async def get_branch_settings_payload(aspire_branch_id: int) -> dict:
        rows = await query(
            "SELECT * FROM branch_settings WHERE aspire_branch_id = %s",
            [aspire_branch_id],
        )
        crew_rate = rows[0].get("crew_rate_cents_per_hour") if rows else None
        return {
            "aspireBranchId": aspire_branch_id,
            "crewRateCentsPerHour": None if crew_rate is None else int(crew_rate),
        }


async def _write_material_factors(
    material_key: str,
    aspire_branch_id: int,
    factors: dict,
    scope_id: str,
    actor: str,
) -> int:
    """Persist a branch material-factor override and audit it.

    Writes ONLY the factors JSON — unit_cost_cents / unit_sell_cents are never
    touched here (locked: branch overrides are formula factors, not prices). The
    override is its own row keyed on (material_key, aspire_branch_id); the
    company-wide row (aspire_branch_id NULL) is left intact. Returns 1 (one
    changed setting) so the caller can tally writes.
    """
    rows = await query(
        """SELECT factors FROM material_calcs
             WHERE material_key = %s AND branch_scope_key = %s""",
        [material_key, aspire_branch_id],
    )
    if rows:
        prior = rows[0].get("factors")
        await execute(
            """UPDATE material_calcs SET factors = %s
                 WHERE material_key = %s AND branch_scope_key = %s""",
            [json.dumps(factors), material_key, aspire_branch_id],
        )
    else:
        # No branch override yet — clone identity from the company-wide row so
        # the NOT NULL non-factor columns (label/compute_type/uom/prices) carry
        # over unchanged; only factors and the branch id differ.
        base = await query(
            """SELECT label, compute_type, unit_sell_cents, unit_cost_cents, uom,
                      volume_quote_threshold_sf
                 FROM material_calcs
                WHERE material_key = %s AND aspire_branch_id IS NULL""",
            [material_key],
        )
        if not base:
            raise HTTPException(
                status_code=404,
                detail=f"Material {material_key} has no company-wide row to override",
            )
        b = base[0]
        prior = None
        await execute(
            """INSERT INTO material_calcs
                 (id, material_key, aspire_branch_id, label, compute_type, factors,
                  unit_sell_cents, unit_cost_cents, uom, volume_quote_threshold_sf)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                str(uuid.uuid4()),
                material_key,
                aspire_branch_id,
                b.get("label"),
                b.get("compute_type"),
                json.dumps(factors),
                b.get("unit_sell_cents"),
                b.get("unit_cost_cents"),
                b.get("uom"),
                b.get("volume_quote_threshold_sf"),
            ],
        )
    await _audit(
        scope_type="branch",
        scope_id=scope_id,
        setting_key=f"material_factors.{material_key}",
        from_value=prior,
        to_value=factors,
        actor=actor,
    )
    return 1
