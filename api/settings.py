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

from fastapi import Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from db import execute, query
from api import authz
from api import aspire_sync
from api import graph
from api._serialize import coerce_row


# Exact §2.8 copy shown when a sales user has no resolvable Aspire ContactID.
# The UI keys off this string verbatim; do NOT reword it.
SALES_ASPIRE_BLOCK_COPY = (
    "No Aspire contact matches this email. Create an Aspire user with the same "
    "email address, then click Link Aspire Rep. Until then, estimates from this "
    "rep push to Aspire without a sales rep — and opportunities already pushed "
    "must be corrected in Aspire by hand."
)


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


class AuthorizeUserBody(BaseModel):
    """Authorize a person PICKED from the M365 directory (§2.8).

    name/email come straight from the directory pick — the admin never types the
    email, so the lowercased-email match Entra SSO relies on is typo-proof. role
    is validated against CANONICAL_ROLES; branches are an optional replace-set of
    aspire_branch_id.
    """
    name: str
    email: str
    role: str
    branches: Optional[list[int]] = None


class UserAdminPatch(BaseModel):
    """Partial update of one users row (role / branches / active).

    Every field optional — the PATCH applies only the keys present. Setting role
    to 'sales' re-runs the aspire_rep_id hard-block; `active` toggles the
    deactivate flag (never a DELETE); `branches` is a replace-set on
    user_branches.
    """
    role: Optional[str] = None
    branches: Optional[list[int]] = None
    active: Optional[bool] = None


# ── Slice 13a: H37 config table bodies ───────────────────────────────────────

class TeamMemberCreate(BaseModel):
    """Create body for a team_members row (branch-scoped or company-wide).

    aspireBranchId=None means company-wide / executive roster — only admin may
    write those rows. A BM/RD may create rows for a branch in their scope only.
    bio is NOT NULL in the DB but TEXT cannot carry a DEFAULT in MySQL, so callers
    must supply it (or pass an empty string).
    """
    name: str
    title: str
    teamType: str
    aspireBranchId: Optional[int] = None
    userId: Optional[str] = None
    location: Optional[str] = None
    bio: str = ""
    headshotObjectKey: Optional[str] = None
    sortOrder: int = 0


class TeamMemberPatch(BaseModel):
    """Partial update for team_members. Every field optional."""
    name: Optional[str] = None
    title: Optional[str] = None
    teamType: Optional[str] = None
    userId: Optional[str] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    headshotObjectKey: Optional[str] = None
    sortOrder: Optional[int] = None


# Updatable columns for team_members PATCH (camelCase body key -> DB column).
_TM_UPDATABLE: dict[str, str] = {
    "name": "name",
    "title": "title",
    "teamType": "team_type",
    "userId": "user_id",
    "location": "location",
    "bio": "bio",
    "headshotObjectKey": "headshot_object_key",
    "sortOrder": "sort_order",
}


class ClientReferenceCreate(BaseModel):
    """Create body for a client_references row.

    aspireBranchId=None = company-wide; only admin may create those.
    """
    propertyName: str
    servicesProvided: str
    contactName: str
    contactTitle: Optional[str] = None
    phone: str
    email: str
    address: str
    clientSinceYear: int
    aspireBranchId: Optional[int] = None


class ClientReferencePatch(BaseModel):
    """Partial update for client_references."""
    propertyName: Optional[str] = None
    servicesProvided: Optional[str] = None
    contactName: Optional[str] = None
    contactTitle: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    clientSinceYear: Optional[int] = None


# Updatable columns for client_references PATCH.
_CR_UPDATABLE: dict[str, str] = {
    "propertyName": "property_name",
    "servicesProvided": "services_provided",
    "contactName": "contact_name",
    "contactTitle": "contact_title",
    "phone": "phone",
    "email": "email",
    "address": "address",
    "clientSinceYear": "client_since_year",
}


class PortfolioPropertyCreate(BaseModel):
    """Create body for portfolio_properties — admin-only, company-scoped.

    photo_object_keys is a JSON array of GCS keys; the DB column is TEXT so we
    serialise before writing. beforeAfterObjectKeys is a JSON object or None.
    """
    name: str
    cityState: str
    regionId: str
    photoObjectKeys: list[str] = []
    beforeAfterObjectKeys: Optional[dict] = None
    sortOrder: int = 0


class PortfolioPropertyPatch(BaseModel):
    """Partial update for portfolio_properties."""
    name: Optional[str] = None
    cityState: Optional[str] = None
    regionId: Optional[str] = None
    photoObjectKeys: Optional[list[str]] = None
    beforeAfterObjectKeys: Optional[dict] = None
    sortOrder: Optional[int] = None


# Updatable columns for portfolio_properties PATCH (camelCase -> DB).
_PP_UPDATABLE: dict[str, str] = {
    "name": "name",
    "cityState": "city_state",
    "regionId": "region_id",
    "photoObjectKeys": "photo_object_keys",
    "beforeAfterObjectKeys": "before_after_object_keys",
    "sortOrder": "sort_order",
}
# portfolio_properties columns that hold JSON and must be serialised before write.
_PP_JSON_COLS: frozenset[str] = frozenset({"photoObjectKeys", "beforeAfterObjectKeys"})


# ── Slice 15a: licenses_certifications + insurance_certificates bodies ────────

class LicenseCreate(BaseModel):
    """Create body for a licenses_certifications row.

    aspireBranchId=None = company-wide (admin-only). A BM/RD may create rows
    only for branches in their user_branches scope. kind must be 'license' or
    'certification'. issuedDate/expiryDate are ISO-8601 strings (YYYY-MM-DD).
    """
    kind: str  # 'license' | 'certification'
    name: str
    issuingBody: Optional[str] = None
    identifier: Optional[str] = None
    holderName: Optional[str] = None
    aspireBranchId: Optional[int] = None
    issuedDate: Optional[str] = None  # ISO YYYY-MM-DD
    expiryDate: Optional[str] = None  # ISO YYYY-MM-DD; None = non-expiring
    objectKey: Optional[str] = None
    sortOrder: int = 0


class LicensePatch(BaseModel):
    """Partial update for a licenses_certifications row. Every field optional."""
    kind: Optional[str] = None
    name: Optional[str] = None
    issuingBody: Optional[str] = None
    identifier: Optional[str] = None
    holderName: Optional[str] = None
    issuedDate: Optional[str] = None
    expiryDate: Optional[str] = None
    objectKey: Optional[str] = None
    sortOrder: Optional[int] = None


# Updatable columns for LicensePatch (camelCase body key -> DB column).
_LC_UPDATABLE: dict[str, str] = {
    "kind": "kind",
    "name": "name",
    "issuingBody": "issuing_body",
    "identifier": "identifier",
    "holderName": "holder_name",
    "issuedDate": "issued_date",
    "expiryDate": "expiry_date",
    "objectKey": "object_key",
    "sortOrder": "sort_order",
}


class InsuranceCreate(BaseModel):
    """Create body for an insurance_certificates row.

    object_key is required (the cert IS the upload). expiryDate is required —
    the settings handoff shows a renewal warning off this date. label is optional
    (useful when tracking multiple policy types). Company-wide, admin-only.
    """
    objectKey: str
    expiryDate: str  # ISO YYYY-MM-DD — NOT NULL in the schema
    label: Optional[str] = None


class InsurancePatch(BaseModel):
    """Partial update for insurance_certificates."""
    objectKey: Optional[str] = None
    expiryDate: Optional[str] = None
    label: Optional[str] = None


# Updatable columns for InsurancePatch (camelCase -> DB).
_INS_UPDATABLE: dict[str, str] = {
    "objectKey": "object_key",
    "expiryDate": "expiry_date",
    "label": "label",
}


# ── Company setting column map (camel-free: bodies already use snake_case columns).
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


# ── Output serializers for Slice 15a ─────────────────────────────────────────

def _license_settings_out(r: dict) -> dict:
    """Map a licenses_certifications DB row to the settings API response shape.

    Applies coerce_row so issued_date/expiry_date/updated_at serialize as ISO
    strings (not raw datetime.date objects). Field names match _license_out in
    proposals.py so reads and writes round-trip cleanly.
    """
    coerced = coerce_row(dict(r))
    return {
        "id": coerced["id"],
        "kind": coerced["kind"],
        "name": coerced["name"],
        "issuingBody": coerced.get("issuing_body"),
        "identifier": coerced.get("identifier"),
        "holderName": coerced.get("holder_name"),
        "aspireBranchId": coerced.get("aspire_branch_id"),
        "issuedDate": coerced.get("issued_date"),
        "expiryDate": coerced.get("expiry_date"),
        "objectKey": coerced.get("object_key"),
        "active": bool(coerced.get("active", 1)),
        "sortOrder": coerced.get("sort_order", 0),
        "updatedAt": coerced.get("updated_at"),
    }


def _insurance_settings_out(r: dict) -> dict:
    """Map an insurance_certificates DB row to the settings API response shape.

    Applies coerce_row so expiry_date/uploaded_at serialize as ISO strings.
    Field names match _insurance_cert_out in proposals.py so the proposals read
    endpoint and the settings write endpoints round-trip the same shape.
    """
    coerced = coerce_row(dict(r))
    return {
        "id": coerced["id"],
        "objectKey": coerced["object_key"],
        "expiryDate": coerced.get("expiry_date"),
        "label": coerced.get("label"),
        "uploadedAt": coerced.get("uploaded_at"),
    }


def register(app, require_auth) -> None:
    """Attach settings routes to the FastAPI app with the shared auth dep."""

    # ── Slice 4: company settings ────────────────────────────────────────────

    @app.get("/api/settings/company")
    async def get_company_settings(_user: dict = Depends(require_auth)) -> dict:
        """Read the company_settings singleton (row id=1). Any authed role."""
        rows = await query("SELECT * FROM company_settings WHERE id = 1", [])
        if not rows:
            raise HTTPException(status_code=404, detail="Company settings not initialized")
        return coerce_row(dict(rows[0]))

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
        return coerce_row(dict(refreshed[0])) if refreshed else coerce_row({**dict(current), **updates})

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
        return coerce_row(dict(refreshed[0])) if refreshed else coerce_row({**dict(current), **updates})

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
        return coerce_row(dict(refreshed[0])) if refreshed else coerce_row({**dict(current), **updates})

    # ── Slice 9: manageable-branches list (section-nav branch picker) ─────────

    @app.get("/api/settings/branches")
    async def list_manageable_branches(user: dict = Depends(require_auth)) -> list[dict]:
        """Operating branches the caller may MANAGE (the branch-picker source).

        Scope comes from resolve_branch_scope (Amendment B.1), never the request:
        admin (kind='all') gets every operating branch; a BM/RD (kind='branch')
        gets only its user_branches; a user with zero branches (kind='none')
        gets []. The operating-roster filter (active=1 AND branch_name NOT LIKE
        '%DO NOT USE%') lives in the WHERE clause so the 21-of-56 non-office rows
        never reach the UI. Returns [{aspireBranchId, branchName, city}] sorted
        by branch_name.
        """
        scope = await authz.resolve_branch_scope(user)
        if scope.kind == "none":
            return []

        where = ["active = 1", "branch_name NOT LIKE '%DO NOT USE%'"]
        params: list[Any] = []
        if scope.kind == "branch":
            # Parameterized placeholders only — ids are never interpolated.
            placeholders = ", ".join(["%s"] * len(scope.ids))
            where.append(f"aspire_branch_id IN ({placeholders})")
            params.extend(scope.ids)

        rows = await query(
            f"""SELECT aspire_branch_id, branch_name, city
                  FROM branches
                 WHERE {' AND '.join(where)}
                 ORDER BY branch_name""",
            params,
        )
        return [
            {
                "aspireBranchId": int(r["aspire_branch_id"]),
                "branchName": r["branch_name"],
                "city": r.get("city"),
            }
            for r in rows
        ]

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

    # ── Slice 6: user administration (§2.8) — admin-only writes ──────────────

    @app.get("/api/settings/users/directory")
    async def search_user_directory(
        q: str = "", user: dict = Depends(require_auth)
    ) -> list[dict]:
        """Proxy the M365 directory search so an admin PICKS a person (§2.8).

        Returns {name, email} candidates. Admin-only (live re-read) because the
        pick feeds the authorize path; a blank/short query returns [] without
        touching Graph.
        """
        await _require_admin(user)
        return await graph.search_directory(q)

    @app.post("/api/settings/users", status_code=201)
    async def authorize_user(
        body: AuthorizeUserBody, user: dict = Depends(require_auth)
    ) -> dict:
        """Authorize a directory-picked person into `users` (§2.8) — admin-only.

        Not "create from scratch": name/email come from the M365 pick, so the
        stored email is exact. Email is lowercased (Entra SSO matches lowercased
        email). role='sales' triggers the aspire_rep_id hard-block; other roles
        save with no Aspire link and no warning. The authorize and any branch
        set are audited.
        """
        await _require_admin(user)

        role = body.role.strip()
        if role not in authz.CANONICAL_ROLES:
            raise HTTPException(status_code=422, detail=f"Unknown role {role!r}")

        email = body.email.strip().lower()

        # Hard-block sales without a resolvable Aspire contact BEFORE any write.
        aspire_rep_id: Optional[int] = None
        if role == "sales":
            aspire_rep_id = await _require_resolved_sales_rep(email, None)

        user_id = str(uuid.uuid4())
        await execute(
            """INSERT INTO users (id, email, name, role, active, aspire_rep_id)
                 VALUES (%s, %s, %s, %s, 1, %s)""",
            [user_id, email, body.name, role, aspire_rep_id],
        )

        actor = _actor(user)
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"user.{user_id}.authorize",
            from_value=None,
            to_value=email,
            actor=actor,
        )
        if body.branches is not None:
            await _replace_user_branches(user_id, body.branches, actor)

        return {
            "id": user_id,
            "email": email,
            "name": body.name,
            "role": role,
            "active": 1,
            "aspire_rep_id": aspire_rep_id,
        }

    @app.patch("/api/settings/users/{user_id}")
    async def patch_user(
        user_id: str, body: UserAdminPatch, user: dict = Depends(require_auth)
    ) -> dict:
        """Edit a user's role / branches / active flag (§2.8) — admin-only.

        Deactivate, never delete: `active=false` sets users.active=0 (no DELETE),
        so historical references survive and the user drops from ?role= pickers
        (which filter active=1). Setting role='sales' re-runs the aspire_rep_id
        hard-block against the row's stored rep or a live resolution. Branches
        are a replace-set. Every change is audited.
        """
        await _require_admin(user)

        rows = await query(
            "SELECT id, email, role, active, aspire_rep_id FROM users WHERE id = %s",
            [user_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="User not found")
        current = rows[0]
        actor = _actor(user)

        # ── role ─────────────────────────────────────────────────────────────
        if body.role is not None:
            new_role = body.role.strip()
            if new_role not in authz.CANONICAL_ROLES:
                raise HTTPException(status_code=422, detail=f"Unknown role {new_role!r}")

            new_rep_id = current.get("aspire_rep_id")
            if new_role == "sales":
                # Block a sales role that cannot resolve an Aspire contact BEFORE
                # writing anything (prevent-don't-repair).
                new_rep_id = await _require_resolved_sales_rep(
                    current.get("email") or "", current.get("aspire_rep_id")
                )

            await execute(
                "UPDATE users SET role = %s, aspire_rep_id = %s WHERE id = %s",
                [new_role, new_rep_id, user_id],
            )
            await _audit(
                scope_type="company",
                scope_id=None,
                setting_key=f"user.{user_id}.role",
                from_value=current.get("role"),
                to_value=new_role,
                actor=actor,
            )

        # ── active (deactivate/reactivate) ───────────────────────────────────
        if body.active is not None:
            new_active = 1 if body.active else 0
            await execute(
                "UPDATE users SET active = %s WHERE id = %s",
                [new_active, user_id],
            )
            await _audit(
                scope_type="company",
                scope_id=None,
                setting_key=f"user.{user_id}.active",
                from_value=current.get("active"),
                to_value=new_active,
                actor=actor,
            )

        # ── branches (replace-set) ───────────────────────────────────────────
        if body.branches is not None:
            await _replace_user_branches(user_id, body.branches, actor)

        refreshed = await query(
            "SELECT id, email, name, role, active, aspire_rep_id FROM users WHERE id = %s",
            [user_id],
        )
        return dict(refreshed[0]) if refreshed else {"id": user_id}

    @app.post("/api/settings/users/{user_id}/link-aspire-rep")
    async def link_aspire_rep(
        user_id: str, user: dict = Depends(require_auth)
    ) -> dict:
        """Resolve + persist a user's Aspire ContactID from their email (§2.8).

        The "Link Aspire Rep" path referenced by the sales-block copy. Resolves
        the row's email against Aspire; on a hit, sets aspire_rep_id and audits.
        On a miss, returns 422 with the same §2.8 copy so the admin knows the
        Aspire contact still doesn't exist.
        """
        await _require_admin(user)

        rows = await query(
            "SELECT id, email, aspire_rep_id FROM users WHERE id = %s", [user_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="User not found")
        email = (rows[0].get("email") or "").strip().lower()

        resolved = await aspire_sync.resolve_aspire_rep_id(email)
        if resolved is None:
            raise HTTPException(status_code=422, detail=SALES_ASPIRE_BLOCK_COPY)

        await execute(
            "UPDATE users SET aspire_rep_id = %s WHERE id = %s",
            [resolved, user_id],
        )
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"user.{user_id}.aspire_rep_id",
            from_value=rows[0].get("aspire_rep_id"),
            to_value=resolved,
            actor=_actor(user),
        )
        return {"id": user_id, "aspire_rep_id": resolved}

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

    # ── Slice 13a: team_members CRUD ─────────────────────────────────────────
    # Branch-scoped: BM/RD may write rows for branches in their user_branches;
    # company-wide (aspire_branch_id IS NULL) rows are admin-only.
    # Soft-delete only (active=0), never a hard DELETE.

    @app.post("/api/settings/team-members", status_code=201)
    async def create_team_member(
        body: TeamMemberCreate,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Create a team_members row with branch-scope or company-wide guard.

        Company-wide rows (aspireBranchId=None) require admin. Branch rows
        require either admin or a BM/RD whose user_branches includes that branch.
        """
        actor = _actor(user)

        if body.aspireBranchId is None:
            # Company-wide: admin only.
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            # Branch row: caller must have scope over this branch.
            await _require_branch_write_scope(user, body.aspireBranchId)
            scope_type = "branch"
            scope_id = str(body.aspireBranchId)

        row_id = str(uuid.uuid4())
        await execute(
            """INSERT INTO team_members
                 (id, name, title, team_type, aspire_branch_id, user_id,
                  location, bio, headshot_object_key, active, sort_order)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 1, %s)""",
            [
                row_id,
                body.name,
                body.title,
                body.teamType,
                body.aspireBranchId,
                body.userId,
                body.location,
                body.bio,
                body.headshotObjectKey,
                body.sortOrder,
            ],
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"team_member.{row_id}.create",
            from_value=None,
            to_value=body.name,
            actor=actor,
        )
        return {
            "id": row_id,
            "name": body.name,
            "title": body.title,
            "teamType": body.teamType,
            "aspireBranchId": body.aspireBranchId,
            "userId": body.userId,
            "location": body.location,
            "bio": body.bio,
            "headshotObjectKey": body.headshotObjectKey,
            "active": True,
            "sortOrder": body.sortOrder,
        }

    @app.patch("/api/settings/team-members/{member_id}")
    async def patch_team_member(
        member_id: str,
        body: TeamMemberPatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Partial update of one team_members row.

        Scope is read from the EXISTING row's aspire_branch_id — the caller
        cannot change which branch a member belongs to via this endpoint, and
        a body-supplied branch id cannot widen scope. Company-wide rows (NULL)
        are admin-only; branch rows require BM/RD scope over that branch.
        """
        rows = await query(
            "SELECT * FROM team_members WHERE id = %s", [member_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Team member not found")
        current = rows[0]

        row_branch = current.get("aspire_branch_id")
        if row_branch is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, int(row_branch))
            scope_type = "branch"
            scope_id = str(row_branch)

        updates = {
            camel: col
            for camel, col in _TM_UPDATABLE.items()
            if getattr(body, camel) is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No team member fields to update")

        set_clause = ", ".join(f"{col} = %s" for col in updates.values())
        params: list[Any] = [getattr(body, camel) for camel in updates] + [member_id]
        await execute(
            f"UPDATE team_members SET {set_clause} WHERE id = %s", params
        )

        actor = _actor(user)
        for camel, col in updates.items():
            await _audit(
                scope_type=scope_type,
                scope_id=scope_id,
                setting_key=f"team_member.{member_id}.{col}",
                from_value=current.get(col),
                to_value=getattr(body, camel),
                actor=actor,
            )

        refreshed = await query("SELECT * FROM team_members WHERE id = %s", [member_id])
        r = refreshed[0] if refreshed else {**dict(current), **{col: getattr(body, camel) for camel, col in updates.items()}}
        return {
            "id": r["id"],
            "name": r["name"],
            "title": r["title"],
            "teamType": r["team_type"],
            "aspireBranchId": r.get("aspire_branch_id"),
            "userId": r.get("user_id"),
            "location": r.get("location"),
            "bio": r.get("bio") or "",
            "headshotObjectKey": r.get("headshot_object_key"),
            "active": bool(r["active"]),
            "sortOrder": r["sort_order"],
        }

    @app.delete("/api/settings/team-members/{member_id}")
    async def deactivate_team_member(
        member_id: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Soft-delete a team_members row by setting active=0.

        Never issues a hard DELETE — historical references in proposal_requests
        (teamMemberIds) must remain resolvable. Scope guard mirrors the update
        path: company-wide rows (aspire_branch_id IS NULL) are admin-only.
        """
        rows = await query(
            "SELECT * FROM team_members WHERE id = %s", [member_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Team member not found")
        current = rows[0]

        row_branch = current.get("aspire_branch_id")
        if row_branch is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, int(row_branch))
            scope_type = "branch"
            scope_id = str(row_branch)

        await execute(
            "UPDATE team_members SET active = %s WHERE id = %s", [0, member_id]
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"team_member.{member_id}.active",
            from_value=current.get("active"),
            to_value=0,
            actor=_actor(user),
        )
        return {"id": member_id, "active": False}

    # ── Slice 13a: client_references CRUD ─────────────────────────────────────
    # Branch-scoped (same rules as team_members): aspire_branch_id NULL = company-wide.
    # Soft-delete only (active=0).

    @app.post("/api/settings/client-references", status_code=201)
    async def create_client_reference(
        body: ClientReferenceCreate,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Create a client_references row, enforcing branch scope.

        aspireBranchId=None means company-wide (admin only). A BM/RD may only
        create rows for branches in their user_branches scope.
        """
        actor = _actor(user)

        if body.aspireBranchId is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, body.aspireBranchId)
            scope_type = "branch"
            scope_id = str(body.aspireBranchId)

        row_id = str(uuid.uuid4())
        await execute(
            """INSERT INTO client_references
                 (id, aspire_branch_id, property_name, services_provided,
                  contact_name, contact_title, phone, email, address,
                  client_since_year, active)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1)""",
            [
                row_id,
                body.aspireBranchId,
                body.propertyName,
                body.servicesProvided,
                body.contactName,
                body.contactTitle,
                body.phone,
                body.email,
                body.address,
                body.clientSinceYear,
            ],
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"client_reference.{row_id}.create",
            from_value=None,
            to_value=body.propertyName,
            actor=actor,
        )
        return {
            "id": row_id,
            "aspireBranchId": body.aspireBranchId,
            "propertyName": body.propertyName,
            "servicesProvided": body.servicesProvided,
            "contactName": body.contactName,
            "contactTitle": body.contactTitle,
            "phone": body.phone,
            "email": body.email,
            "address": body.address,
            "clientSinceYear": body.clientSinceYear,
            "active": True,
        }

    @app.patch("/api/settings/client-references/{ref_id}")
    async def patch_client_reference(
        ref_id: str,
        body: ClientReferencePatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Partial update of a client_references row.

        Scope is derived from the EXISTING row — a body-supplied aspireBranchId
        is ignored for authorization (scope comes from user_branches only).
        """
        rows = await query(
            "SELECT * FROM client_references WHERE id = %s", [ref_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Client reference not found")
        current = rows[0]

        row_branch = current.get("aspire_branch_id")
        if row_branch is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, int(row_branch))
            scope_type = "branch"
            scope_id = str(row_branch)

        updates = {
            camel: col
            for camel, col in _CR_UPDATABLE.items()
            if getattr(body, camel) is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No client reference fields to update")

        set_clause = ", ".join(f"{col} = %s" for col in updates.values())
        params: list[Any] = [getattr(body, camel) for camel in updates] + [ref_id]
        await execute(
            f"UPDATE client_references SET {set_clause} WHERE id = %s", params
        )

        actor = _actor(user)
        for camel, col in updates.items():
            await _audit(
                scope_type=scope_type,
                scope_id=scope_id,
                setting_key=f"client_reference.{ref_id}.{col}",
                from_value=current.get(col),
                to_value=getattr(body, camel),
                actor=actor,
            )

        refreshed = await query("SELECT * FROM client_references WHERE id = %s", [ref_id])
        r = refreshed[0] if refreshed else current
        return {
            "id": r["id"],
            "aspireBranchId": r.get("aspire_branch_id"),
            "propertyName": r["property_name"],
            "servicesProvided": r["services_provided"],
            "contactName": r["contact_name"],
            "contactTitle": r.get("contact_title"),
            "phone": r["phone"],
            "email": r["email"],
            "address": r["address"],
            "clientSinceYear": r["client_since_year"],
            "active": bool(r["active"]),
        }

    @app.delete("/api/settings/client-references/{ref_id}")
    async def deactivate_client_reference(
        ref_id: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Soft-delete a client_references row (active=0). Never a hard DELETE."""
        rows = await query(
            "SELECT * FROM client_references WHERE id = %s", [ref_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Client reference not found")
        current = rows[0]

        row_branch = current.get("aspire_branch_id")
        if row_branch is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, int(row_branch))
            scope_type = "branch"
            scope_id = str(row_branch)

        await execute(
            "UPDATE client_references SET active = %s WHERE id = %s", [0, ref_id]
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"client_reference.{ref_id}.active",
            from_value=current.get("active"),
            to_value=0,
            actor=_actor(user),
        )
        return {"id": ref_id, "active": False}

    # ── Slice 13a: portfolio_properties CRUD ──────────────────────────────────
    # Company-wide, admin-only.
    #
    # Migration 023 added portfolio_properties.active (TINYINT(1) NOT NULL DEFAULT 1).
    # The DELETE handler is now a soft-delete (UPDATE active=0), consistent with
    # team_members, client_references, and licenses_certifications.

    @app.get("/api/settings/portfolio")
    async def list_portfolio_properties(
        include_inactive: bool = False,
        user: dict = Depends(require_auth),
    ) -> list[dict]:
        """List portfolio_properties rows — admin-only.

        By default returns only active rows (active=1). include_inactive=true
        returns all rows for the admin management surface.
        """
        await _require_admin(user)

        where = "" if include_inactive else "WHERE active = 1"
        rows = await query(
            f"SELECT * FROM portfolio_properties {where} ORDER BY sort_order, name",
        )
        result = []
        import json as _json  # local alias avoids shadowing the module-level import
        for r in rows:
            photo_keys = r.get("photo_object_keys") or "[]"
            if isinstance(photo_keys, str):
                try:
                    photo_keys = _json.loads(photo_keys)
                except (ValueError, TypeError):
                    photo_keys = []
            ba_keys = r.get("before_after_object_keys")
            if isinstance(ba_keys, str):
                try:
                    ba_keys = _json.loads(ba_keys)
                except (ValueError, TypeError):
                    ba_keys = None
            result.append({
                "id": r["id"],
                "name": r["name"],
                "cityState": r["city_state"],
                "regionId": r["region_id"],
                "photoObjectKeys": photo_keys if isinstance(photo_keys, list) else [],
                "beforeAfterObjectKeys": ba_keys,
                "sortOrder": r["sort_order"],
                "active": bool(r.get("active", 1)),
            })
        return result

    @app.post("/api/settings/portfolio", status_code=201)
    async def create_portfolio_property(
        body: PortfolioPropertyCreate,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Create a portfolio_properties row — admin-only, company-scoped."""
        await _require_admin(user)
        actor = _actor(user)

        row_id = str(uuid.uuid4())
        await execute(
            """INSERT INTO portfolio_properties
                 (id, name, city_state, region_id, photo_object_keys,
                  before_after_object_keys, sort_order)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            [
                row_id,
                body.name,
                body.cityState,
                body.regionId,
                json.dumps(body.photoObjectKeys),
                json.dumps(body.beforeAfterObjectKeys) if body.beforeAfterObjectKeys is not None else None,
                body.sortOrder,
            ],
        )
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"portfolio_property.{row_id}.create",
            from_value=None,
            to_value=body.name,
            actor=actor,
        )
        return {
            "id": row_id,
            "name": body.name,
            "cityState": body.cityState,
            "regionId": body.regionId,
            "photoObjectKeys": body.photoObjectKeys,
            "beforeAfterObjectKeys": body.beforeAfterObjectKeys,
            "sortOrder": body.sortOrder,
        }

    @app.patch("/api/settings/portfolio/{property_id}")
    async def patch_portfolio_property(
        property_id: str,
        body: PortfolioPropertyPatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Partial update of a portfolio_properties row — admin-only."""
        await _require_admin(user)

        rows = await query(
            "SELECT * FROM portfolio_properties WHERE id = %s", [property_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Portfolio property not found")
        current = rows[0]

        updates = {
            camel: col
            for camel, col in _PP_UPDATABLE.items()
            if getattr(body, camel) is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No portfolio fields to update")

        set_clause = ", ".join(f"{col} = %s" for col in updates.values())
        # Serialise JSON columns before writing.
        params: list[Any] = [
            json.dumps(getattr(body, camel)) if camel in _PP_JSON_COLS else getattr(body, camel)
            for camel in updates
        ] + [property_id]
        await execute(
            f"UPDATE portfolio_properties SET {set_clause} WHERE id = %s", params
        )

        actor = _actor(user)
        for camel, col in updates.items():
            await _audit(
                scope_type="company",
                scope_id=None,
                setting_key=f"portfolio_property.{property_id}.{col}",
                from_value=current.get(col),
                to_value=getattr(body, camel),
                actor=actor,
            )

        refreshed = await query(
            "SELECT * FROM portfolio_properties WHERE id = %s", [property_id]
        )
        r = refreshed[0] if refreshed else current

        import json as _json  # local alias to avoid shadowing the module-level import
        photo_keys = r.get("photo_object_keys") or "[]"
        if isinstance(photo_keys, str):
            try:
                photo_keys = _json.loads(photo_keys)
            except (ValueError, TypeError):
                photo_keys = []
        ba_keys = r.get("before_after_object_keys")
        if isinstance(ba_keys, str):
            try:
                ba_keys = _json.loads(ba_keys)
            except (ValueError, TypeError):
                ba_keys = None

        return {
            "id": r["id"],
            "name": r["name"],
            "cityState": r["city_state"],
            "regionId": r["region_id"],
            "photoObjectKeys": photo_keys if isinstance(photo_keys, list) else [],
            "beforeAfterObjectKeys": ba_keys,
            "sortOrder": r["sort_order"],
        }

    @app.delete("/api/settings/portfolio/{property_id}")
    async def deactivate_portfolio_property(
        property_id: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Soft-delete a portfolio_properties row (active=0) — admin-only.

        Migration 023 added portfolio_properties.active so this handler now
        mirrors team_members and client_references: never a hard DELETE.
        Historical references to a portfolio property in past proposal_requests
        must remain resolvable; setting active=0 removes it from the generation
        surface while preserving the record.
        """
        await _require_admin(user)

        rows = await query(
            "SELECT * FROM portfolio_properties WHERE id = %s", [property_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Portfolio property not found")
        current = rows[0]

        await execute(
            "UPDATE portfolio_properties SET active = %s WHERE id = %s",
            [0, property_id],
        )
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"portfolio_property.{property_id}.active",
            from_value=current.get("active"),
            to_value=0,
            actor=_actor(user),
        )
        return {"id": property_id, "active": False}

    # ── Slice 15a: licenses_certifications CRUD ───────────────────────────────
    #
    # Branch-scoped (aspire_branch_id NULL = company-wide, admin-only).
    # SOFT-DELETE ONLY (active=0) — an expired license is a historical record
    # that past proposals referenced. NEVER issue a DELETE. §6 AC.
    # Scope derivation follows the same pattern as team_members / client_references:
    # the writable branch comes from resolve_branch_scope, never the body.

    @app.get("/api/settings/licenses")
    async def list_licenses(
        include_expired: bool = False,
        user: dict = Depends(require_auth),
    ) -> list[dict]:
        """List licenses_certifications rows visible to the caller.

        Admin sees all rows (any branch + company-wide). BM/RD see only rows
        for their branches plus company-wide rows. include_expired=true includes
        deactivated and past-expiry rows (for the Settings management surface).
        """
        scope = await authz.resolve_branch_scope(user)

        conditions: list[str] = []
        params: list[Any] = []

        if not include_expired:
            # Exclude inactive and expired rows by default.
            conditions.append("active = 1")
            conditions.append("(expiry_date IS NULL OR expiry_date >= CURDATE())")

        if scope.kind == "all":
            # admin — no branch restriction
            pass
        elif scope.kind == "branch":
            placeholders = ", ".join(["%s"] * len(scope.ids))
            conditions.append(f"(aspire_branch_id IS NULL OR aspire_branch_id IN ({placeholders}))")
            params.extend(scope.ids)
        else:
            # kind='none' — user has no branches; show only company-wide rows
            conditions.append("aspire_branch_id IS NULL")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = await query(
            f"SELECT * FROM licenses_certifications {where} ORDER BY sort_order, name",
            params or None,
        )
        return [_license_settings_out(r) for r in rows]

    @app.post("/api/settings/licenses", status_code=201)
    async def create_license(
        body: LicenseCreate,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Create a licenses_certifications row with branch-scope or company-wide guard.

        Company-wide rows (aspireBranchId=None) require admin (Amendment C.5).
        Branch rows require admin or a BM/RD whose user_branches includes that branch.
        """
        actor = _actor(user)

        if body.aspireBranchId is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, body.aspireBranchId)
            scope_type = "branch"
            scope_id = str(body.aspireBranchId)

        row_id = str(uuid.uuid4())
        await execute(
            """INSERT INTO licenses_certifications
                 (id, kind, name, issuing_body, identifier, holder_name,
                  aspire_branch_id, issued_date, expiry_date, object_key,
                  active, sort_order)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, %s)""",
            [
                row_id,
                body.kind,
                body.name,
                body.issuingBody,
                body.identifier,
                body.holderName,
                body.aspireBranchId,
                body.issuedDate,
                body.expiryDate,
                body.objectKey,
                body.sortOrder,
            ],
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"license.{row_id}.create",
            from_value=None,
            to_value=body.name,
            actor=actor,
        )
        return {
            "id": row_id,
            "kind": body.kind,
            "name": body.name,
            "issuingBody": body.issuingBody,
            "identifier": body.identifier,
            "holderName": body.holderName,
            "aspireBranchId": body.aspireBranchId,
            "issuedDate": body.issuedDate,
            "expiryDate": body.expiryDate,
            "objectKey": body.objectKey,
            "active": True,
            "sortOrder": body.sortOrder,
        }

    @app.patch("/api/settings/licenses/{license_id}")
    async def patch_license(
        license_id: str,
        body: LicensePatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Partial update of one licenses_certifications row.

        Scope is derived from the EXISTING row's aspire_branch_id — a body-supplied
        branch cannot widen scope. Company-wide rows (NULL) are admin-only.
        """
        rows = await query(
            "SELECT * FROM licenses_certifications WHERE id = %s", [license_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="License/certification not found")
        current = rows[0]

        row_branch = current.get("aspire_branch_id")
        if row_branch is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, int(row_branch))
            scope_type = "branch"
            scope_id = str(row_branch)

        updates = {
            camel: col
            for camel, col in _LC_UPDATABLE.items()
            if getattr(body, camel) is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No license fields to update")

        set_clause = ", ".join(f"{col} = %s" for col in updates.values())
        params: list[Any] = [getattr(body, camel) for camel in updates] + [license_id]
        await execute(
            f"UPDATE licenses_certifications SET {set_clause} WHERE id = %s", params
        )

        actor = _actor(user)
        for camel, col in updates.items():
            await _audit(
                scope_type=scope_type,
                scope_id=scope_id,
                setting_key=f"license.{license_id}.{col}",
                from_value=current.get(col),
                to_value=getattr(body, camel),
                actor=actor,
            )

        refreshed = await query(
            "SELECT * FROM licenses_certifications WHERE id = %s", [license_id]
        )
        r = refreshed[0] if refreshed else current
        return _license_settings_out(r)

    @app.delete("/api/settings/licenses/{license_id}")
    async def deactivate_license(
        license_id: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Soft-delete a licenses_certifications row (active=0). NEVER a hard DELETE.

        An expired license is a historical record referenced by past proposals.
        Setting active=0 removes it from proposal generation while preserving the
        audit trail. §6 AC — no DELETE SQL may ever be emitted for this table.
        """
        rows = await query(
            "SELECT * FROM licenses_certifications WHERE id = %s", [license_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="License/certification not found")
        current = rows[0]

        row_branch = current.get("aspire_branch_id")
        if row_branch is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, int(row_branch))
            scope_type = "branch"
            scope_id = str(row_branch)

        # Soft-delete: UPDATE active=0, never DELETE.
        await execute(
            "UPDATE licenses_certifications SET active = %s WHERE id = %s",
            [0, license_id],
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"license.{license_id}.active",
            from_value=current.get("active"),
            to_value=0,
            actor=_actor(user),
        )
        return {"id": license_id, "active": False}

    @app.post("/api/settings/licenses/{license_id}/scan", status_code=200)
    async def upload_license_scan(
        license_id: str,
        file: UploadFile = File(...),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Upload a scan PDF/image for a licenses_certifications row.

        Writes bytes through api.attachments.upload_bytes (the ONLY upload path
        — no parallel uploader is added). The GCS object key is constructed from
        the row id and file extension, then stored in the row's object_key column.
        The existing media-url signer (GET /api/proposals/config/media-url) is
        reused to serve the scan — no second signing route is added here.
        """
        rows = await query(
            "SELECT * FROM licenses_certifications WHERE id = %s", [license_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="License/certification not found")
        current = rows[0]

        # Scope guard mirrors the update path.
        row_branch = current.get("aspire_branch_id")
        if row_branch is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, int(row_branch))
            scope_type = "branch"
            scope_id = str(row_branch)

        # Build a deterministic key using the row id (path-traversal-safe — never
        # the user-supplied filename). Reuses the extension map from attachments.py.
        from api.attachments import upload_bytes as _upload_bytes
        _EXT_MAP = {
            "application/pdf": "pdf",
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
        }
        content_type = file.content_type or "application/pdf"
        ext = _EXT_MAP.get(content_type, "bin")
        object_key = f"credentials/licenses/{license_id}.{ext}"

        data = await file.read()
        # Upload via the ONLY upload path — no second GCS client or signing route.
        _upload_bytes(object_key, data, content_type)

        prior_key = current.get("object_key")
        await execute(
            "UPDATE licenses_certifications SET object_key = %s WHERE id = %s",
            [object_key, license_id],
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"license.{license_id}.object_key",
            from_value=prior_key,
            to_value=object_key,
            actor=_actor(user),
        )
        return {"id": license_id, "objectKey": object_key}

    # ── Slice 15a: insurance_certificates CRUD ────────────────────────────────
    #
    # Schema divergence vs licenses_certifications (noted in Amendment C.3 intent):
    #   - NO aspire_branch_id → company-wide only, admin-only writes (§C.5).
    #   - NO active column    → no soft-delete available without a migration.
    #                           Removal is a hard DELETE (same situation as
    #                           portfolio_properties). Flag for migration follow-up.
    #   - NO sort_order       → ordered by uploaded_at DESC.
    #   - object_key NOT NULL → required on creation (the cert IS the upload).
    #   - uploaded_at auto    → set by DB DEFAULT CURRENT_TIMESTAMP.

    @app.get("/api/settings/insurance")
    async def list_insurance(
        include_inactive: bool = False,
        user: dict = Depends(require_auth),
    ) -> list[dict]:
        """List insurance_certificates — admin-only, newest first.

        By default returns only active rows (active=1). include_inactive=true
        returns all rows for the admin management surface.
        Migration 023 added the active column; before that migration is applied
        every row has implicit active=1.
        """
        await _require_admin(user)
        where = "" if include_inactive else "WHERE active = 1"
        rows = await query(
            f"SELECT * FROM insurance_certificates {where} ORDER BY uploaded_at DESC",
        )
        return [_insurance_settings_out(r) for r in rows]

    @app.post("/api/settings/insurance", status_code=201)
    async def create_insurance(
        body: InsuranceCreate,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Create an insurance_certificates row — admin-only, company-scoped.

        object_key and expiryDate are required (both NOT NULL in the schema).
        The object_key should come from a prior call to the upload endpoint.
        """
        await _require_admin(user)
        actor = _actor(user)

        row_id = str(uuid.uuid4())
        await execute(
            """INSERT INTO insurance_certificates
                 (id, object_key, expiry_date, label)
               VALUES (%s, %s, %s, %s)""",
            [row_id, body.objectKey, body.expiryDate, body.label],
        )
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"insurance.{row_id}.create",
            from_value=None,
            to_value=body.objectKey,
            actor=actor,
        )
        return {
            "id": row_id,
            "objectKey": body.objectKey,
            "expiryDate": body.expiryDate,
            "label": body.label,
        }

    @app.patch("/api/settings/insurance/{cert_id}")
    async def patch_insurance(
        cert_id: str,
        body: InsurancePatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Partial update of an insurance_certificates row — admin-only."""
        await _require_admin(user)

        rows = await query(
            "SELECT * FROM insurance_certificates WHERE id = %s", [cert_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Insurance certificate not found")
        current = rows[0]

        updates = {
            camel: col
            for camel, col in _INS_UPDATABLE.items()
            if getattr(body, camel) is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No insurance certificate fields to update")

        set_clause = ", ".join(f"{col} = %s" for col in updates.values())
        params: list[Any] = [getattr(body, camel) for camel in updates] + [cert_id]
        await execute(
            f"UPDATE insurance_certificates SET {set_clause} WHERE id = %s", params
        )

        actor = _actor(user)
        for camel, col in updates.items():
            await _audit(
                scope_type="company",
                scope_id=None,
                setting_key=f"insurance.{cert_id}.{col}",
                from_value=current.get(col),
                to_value=getattr(body, camel),
                actor=actor,
            )

        refreshed = await query(
            "SELECT * FROM insurance_certificates WHERE id = %s", [cert_id]
        )
        r = refreshed[0] if refreshed else current
        return _insurance_settings_out(r)

    @app.delete("/api/settings/insurance/{cert_id}")
    async def deactivate_insurance(
        cert_id: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Soft-delete an insurance_certificates row (active=0) — admin-only.

        Migration 023 added insurance_certificates.active so this handler now
        mirrors team_members and client_references: never a hard DELETE.
        The cert record (object_key, expiry_date) must remain retrievable for
        historical proposal references after deactivation.
        """
        await _require_admin(user)

        rows = await query(
            "SELECT * FROM insurance_certificates WHERE id = %s", [cert_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Insurance certificate not found")
        current = rows[0]

        await execute(
            "UPDATE insurance_certificates SET active = %s WHERE id = %s",
            [0, cert_id],
        )
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"insurance.{cert_id}.active",
            from_value=current.get("active"),
            to_value=0,
            actor=_actor(user),
        )
        return {"id": cert_id, "active": False}

    @app.post("/api/settings/insurance/upload", status_code=201)
    async def upload_insurance_cert(
        file: UploadFile = File(...),
        expiryDate: str = Form(...),
        label: Optional[str] = Form(None),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Upload an insurance cert PDF, store key, and create the DB record.

        Combines upload + create in one request for the Settings UI flow. Bytes
        route through api.attachments.upload_bytes (the ONLY upload path). The
        existing media-url signer (GET /api/proposals/config/media-url) is reused
        to serve the cert — no second signing route is added here.
        """
        await _require_admin(user)
        actor = _actor(user)

        from api.attachments import upload_bytes as _upload_bytes
        _EXT_MAP = {
            "application/pdf": "pdf",
            "image/png": "png",
            "image/jpeg": "jpg",
        }
        content_type = file.content_type or "application/pdf"
        ext = _EXT_MAP.get(content_type, "bin")
        cert_id = str(uuid.uuid4())
        object_key = f"credentials/insurance/{cert_id}.{ext}"

        data = await file.read()
        # Upload via the ONLY upload path — no second GCS client or signing route.
        _upload_bytes(object_key, data, content_type)

        await execute(
            """INSERT INTO insurance_certificates
                 (id, object_key, expiry_date, label)
               VALUES (%s, %s, %s, %s)""",
            [cert_id, object_key, expiryDate, label],
        )
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"insurance.{cert_id}.create",
            from_value=None,
            to_value=object_key,
            actor=actor,
        )
        return {
            "id": cert_id,
            "objectKey": object_key,
            "expiryDate": expiryDate,
            "label": label,
        }


async def _replace_user_branches(
    user_id: str, branches: list[int], actor: str
) -> None:
    """Replace a user's user_branches rows with `branches` (replace-set) + audit.

    The whole set is rewritten in one shot: delete every existing row, then
    insert the new ids. A replace-set (not an incremental add/remove) keeps the
    endpoint idempotent — re-sending the same branches is a no-op. One audit row
    captures the new set; scope is company for user-admin writes (scope_id NULL).
    """
    await execute("DELETE FROM user_branches WHERE user_id = %s", [user_id])
    for aspire_branch_id in branches:
        await execute(
            "INSERT INTO user_branches (user_id, aspire_branch_id) VALUES (%s, %s)",
            [user_id, aspire_branch_id],
        )
    await _audit(
        scope_type="company",
        scope_id=None,
        setting_key=f"user.{user_id}.branches",
        from_value=None,
        to_value=branches,
        actor=actor,
    )


async def _require_resolved_sales_rep(email: str, current_rep_id: Any) -> int:
    """Return a resolved Aspire ContactID for a sales rep, or 422 with §2.8 copy.

    The hard-block (§2.8, prevent-don't-repair): a user with role='sales' must
    map to an Aspire contact so opportunity pushes stamp SalesRepID. If the row
    already carries an aspire_rep_id it is trusted; otherwise the email is
    resolved live against Aspire. An unresolved rep raises 422 with the EXACT
    §2.8 copy — no partial save.
    """
    if current_rep_id is not None:
        return int(current_rep_id)
    resolved = await aspire_sync.resolve_aspire_rep_id(email)
    if resolved is None:
        raise HTTPException(status_code=422, detail=SALES_ASPIRE_BLOCK_COPY)
    return resolved


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
