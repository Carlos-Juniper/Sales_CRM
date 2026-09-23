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
import logging
import uuid
from typing import Any, Literal, Optional

log = logging.getLogger(__name__)

from fastapi import Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from db import execute, query
import api.attachments as _att_mod
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


# ── Branch settings helpers ──────────────────────────────────────────────────

def _parse_factors(raw: Any) -> Any:
    """Deserialise the material_calcs.factors JSON column to a Python dict.

    The column is stored as TEXT (JSON blob). aiomysql may return it as either
    a str or already-parsed dict depending on the driver version. Always returns
    a dict (possibly empty) so callers don't need to handle None/str themselves.
    """
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}


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


# ── Marketing-asset guard (Handoff 50 §3) ────────────────────────────────────

async def _require_marketing_manager(user: dict) -> None:
    """403 unless the LIVE users row may manage company-wide proposal assets.

    Portfolio pages, client references and team bios/headshots are company-wide
    resources gated on the `marketing` role (Carlos's §5.1 call), with `admin`
    retaining super-role access. Re-reads role+active from the users table (B.2)
    so a demoted/deactivated token cannot widen scope — mirrors _require_admin.
    """
    live_role = await authz._live_role(user)
    if not authz.is_marketing_manager(live_role):
        raise HTTPException(
            status_code=403,
            detail="Marketing or admin role required: portfolio, client "
            "references and team bios are company-wide proposal assets.",
        )


async def _require_marketing_or_branch_scope(
    user: dict, aspire_branch_id: Optional[int]
) -> tuple[str, Optional[str]]:
    """Authorize a write to a team_members / client_references row (§3).

    These are company-wide marketing assets, so marketing/admin may write ANY
    row (company-wide OR any branch). A branch manager keeps write access to
    its own branch's rows — that pre-existing path is left EXACTLY as it was,
    tried FIRST so a BM never triggers the extra live-role read.

      * Branch row (aspire_branch_id set): try branch scope first (unchanged BM
        behaviour); if out of scope, allow only marketing/admin (a live-role
        re-read, B.2, on this fallback only).
      * Company-wide row (aspire_branch_id=None): marketing/admin only, via a
        live-role re-read — the same guarantee _require_admin gave before,
        widened to marketing.

    Returns the (scope_type, scope_id) pair for the audit row.
    """
    if aspire_branch_id is not None:
        try:
            await _require_branch_write_scope(user, aspire_branch_id)
        except HTTPException:
            # Out of the caller's branch scope — permitted only for the
            # cross-branch marketing/admin owners of these company-wide assets.
            if not authz.is_marketing_manager(await authz._live_role(user)):
                raise
        return "branch", str(aspire_branch_id)
    # Company-wide row: marketing/admin only (live re-read, B.2).
    if not authz.is_marketing_manager(await authz._live_role(user)):
        raise HTTPException(
            status_code=403,
            detail="Marketing or admin role required for company-wide entries.",
        )
    return "company", None


async def _require_marketing_or_branch_scope_for_row(
    user: dict, row_branch: Any
) -> tuple[str, Optional[str]]:
    """Same rule as _require_marketing_or_branch_scope, keyed on an EXISTING
    row's stored aspire_branch_id (int or None). A body/path-supplied branch can
    never widen scope — the row itself decides which branch is in play.
    """
    branch_id = int(row_branch) if row_branch is not None else None
    return await _require_marketing_or_branch_scope(user, branch_id)


# ── Proposal imagery helpers (Handoff 43 §2) ─────────────────────────────────
#
# Headshots and portfolio photography are uploaded as multipart to the API,
# which validates the real bytes and writes them through
# api.attachments.upload_bytes — the same single upload path the license/
# certification scan endpoint uses.
#
# This deliberately diverges from Handoff 43 §2.1, which specified a signed-PUT
# URL for the browser to PUT straight to GCS. Handoff 42 had just established
# the opposite convention one surface over ("the ONLY upload path — no parallel
# uploader is added ... no second signing route is added here"), and for files
# of this size proxying is strictly better: the content type and the size cap
# are enforced against the actual bytes rather than a client-declared number,
# no bucket CORS rule for PUT is needed, and there is no window in which a
# signed URL exists but no row references the object. The 2 GiB intake
# attachment keeps its browser-direct resumable session — that one is proxying
# bandwidth we should not pay for.


async def _read_validated_image(file: UploadFile) -> tuple[bytes, str, str]:
    """Read an uploaded image, validating type and size. -> (bytes, ext, content_type).

    Both checks are 400s, not 415/413: the browser form is the only caller and
    it pre-filters by accept=, so reaching here with a bad file means the client
    check was bypassed, and a single status keeps the field's error handling
    simple. The extension comes from the VALIDATED content type — never from
    file.filename, which is attacker-controlled and would be a path traversal
    into the renderer's own proposal/generated/ prefix.
    """
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in _att_mod.IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Images must be JPEG, PNG, or WebP.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(data) > _att_mod.GCS_MAX_IMAGE_BYTES:
        mib = _att_mod.GCS_MAX_IMAGE_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"Image exceeds the {mib} MiB limit.",
        )
    return data, _att_mod.ext_for_content_type(content_type), content_type


def _delete_object_quietly(key: Optional[str]) -> None:
    """Best-effort GCS delete for an object no row references any more.

    Swallows failures on purpose: the row has already been updated, and a
    leaked object costs pennies while a 500 here would tell the user their
    edit failed when it did not. The miss is logged by the storage client.
    """
    if not key:
        return
    try:
        _att_mod.delete(key)
    except Exception as exc:
        log.warning("_delete_object_quietly: failed to delete GCS object %r: %s", key, exc)


def _portfolio_row_out(r: dict) -> dict:
    """Map a portfolio_properties row to its camelCase API shape.

    photo_object_keys is a TEXT column holding a JSON array, and aiomysql hands
    it back as a string. Malformed JSON degrades to an empty list rather than
    raising — a bad key blob must not take down the whole Settings section.
    """
    photo_keys = r.get("photo_object_keys") or "[]"
    if isinstance(photo_keys, (str, bytes, bytearray)):
        try:
            photo_keys = json.loads(photo_keys)
        except (ValueError, TypeError):
            photo_keys = []
    return {
        "id": r["id"],
        "name": r["name"],
        "cityState": r["city_state"],
        "regionId": r["region_id"],
        "photoObjectKeys": photo_keys if isinstance(photo_keys, list) else [],
        "sortOrder": r["sort_order"],
        "active": bool(r.get("active", 1)),
    }


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


class MyProfilePatch(BaseModel):
    """Self-service update of the caller's own contact fields (Handoff 43 §3.1).

    Only phone and title, and only ever on the caller's own row — no user_id
    parameter exists, so this endpoint cannot be pointed at anyone else. Role,
    branches and the active flag stay admin-only on
    PATCH /api/settings/users/{id}.

    An empty string clears the field back to NULL: a rep who mistyped their
    direct line must be able to remove it, and a blank line under their name is
    better than a wrong number on a client document.
    """
    phone: Optional[str] = None
    title: Optional[str] = None


# ── Slice 13a: H37 config table bodies ───────────────────────────────────────

# Mirrors studio/src/types/proposal.ts TEAM_MEMBER_BIO_MAX_LENGTH — keeps a
# rep-authored bio inside the Meet Our Team page's 12-line clamp
# (proposal-print.css .team-card .bi) so it can't render cut off mid-sentence.
TEAM_MEMBER_BIO_MAX_LENGTH = 700


class TeamMemberCreate(BaseModel):
    """Create body for a team_members row (branch-scoped or company-wide).

    aspireBranchId=None means company-wide / executive roster — only admin may
    write those rows. A BM/RD may create rows for a branch in their scope only.
    bio is NOT NULL in the DB but TEXT cannot carry a DEFAULT in MySQL, so callers
    must supply it (or pass an empty string).
    """
    name: str
    title: str
    teamType: Literal["branch", "executive"]
    aspireBranchId: Optional[int] = None
    userId: Optional[str] = None
    location: Optional[str] = None
    bio: str = Field(default="", max_length=TEAM_MEMBER_BIO_MAX_LENGTH)
    headshotObjectKey: Optional[str] = None
    sortOrder: int = 0


class TeamMemberPatch(BaseModel):
    """Partial update for team_members. Every field optional."""
    name: Optional[str] = None
    title: Optional[str] = None
    teamType: Optional[str] = None
    userId: Optional[str] = None
    location: Optional[str] = None
    bio: Optional[str] = Field(default=None, max_length=TEAM_MEMBER_BIO_MAX_LENGTH)
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
    serialise before writing.
    """
    name: str
    cityState: str
    regionId: str
    photoObjectKeys: list[str] = []
    sortOrder: int = 0


class PortfolioPropertyPatch(BaseModel):
    """Partial update for portfolio_properties."""
    name: Optional[str] = None
    cityState: Optional[str] = None
    regionId: Optional[str] = None
    photoObjectKeys: Optional[list[str]] = None
    sortOrder: Optional[int] = None


# Updatable columns for portfolio_properties PATCH (camelCase -> DB).
_PP_UPDATABLE: dict[str, str] = {
    "name": "name",
    "cityState": "city_state",
    "regionId": "region_id",
    "photoObjectKeys": "photo_object_keys",
    "sortOrder": "sort_order",
}
# portfolio_properties columns that hold JSON and must be serialised before write.
_PP_JSON_COLS: frozenset[str] = frozenset({"photoObjectKeys"})


# ── Slice 15a: licenses_certifications + insurance_certificates bodies ────────

class LicenseCreate(BaseModel):
    """Create body for a licenses_certifications row.

    aspireBranchId=None = company-wide (admin-only). A BM/RD may create rows
    only for branches in their user_branches scope. kind must be 'license',
    'certification', or 'insurance'. expiryDate is REQUIRED for all kinds —
    the settings surface shows a renewal warning; pass '9999-12-31' for
    credentials that never expire. issuedDate is optional.
    """
    kind: str  # 'license' | 'certification' | 'insurance'
    name: str
    expiryDate: str  # ISO YYYY-MM-DD — required for all kinds
    issuingBody: Optional[str] = None
    identifier: Optional[str] = None
    holderName: Optional[str] = None
    aspireBranchId: Optional[int] = None
    issuedDate: Optional[str] = None  # ISO YYYY-MM-DD
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
# NOTE: "kind" is intentionally excluded — kind is immutable after creation.
# Allowing a PATCH to change kind would bypass the insurance single-global
# invariant (a BM could convert their branch license into an insurance row,
# or an admin could create a second active insurance doc by re-typing an
# inactive one). Create a new row with the correct kind instead.
_LC_UPDATABLE: dict[str, str] = {
    "name": "name",
    "issuingBody": "issuing_body",
    "identifier": "identifier",
    "holderName": "holder_name",
    "issuedDate": "issued_date",
    "expiryDate": "expiry_date",
    "objectKey": "object_key",
    "sortOrder": "sort_order",
}


# InsuranceCreate / InsurancePatch / _INS_UPDATABLE removed — insurance documents
# are now managed through the unified /api/settings/licenses endpoints with
# kind='insurance'. See migration 033 and Handoff 42.


# ── My-profile row helper ─────────────────────────────────────────────────────

async def _my_profile_row(user_id: str) -> dict:
    """Fetch the caller's own live profile row, or 404 if missing.

    Both GET /api/settings/me and PATCH /api/settings/me return the same shape;
    this helper runs the shared SELECT so both handlers stay in sync and the
    patch endpoint reads the POST-update row instead of reconstructing it from
    stale locals.
    """
    rows = await query(
        "SELECT id, name, email, role, phone, title FROM users WHERE id = %s",
        [user_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")
    r = rows[0]
    return {
        "id": r["id"],
        "name": r["name"],
        "email": r["email"],
        "role": r["role"],
        "phone": r.get("phone"),
        "title": r.get("title"),
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


# _insurance_settings_out removed — insurance rows now use _license_settings_out
# (all columns are present in licenses_certifications; kind='insurance' rows
# will have issuing_body/identifier/holder_name/issued_date as NULL). See
# migration 033 and Handoff 42.


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
        """Read one branch's settings, enriched with materialFactors and productionRates.

        Scope guard matches the write path (resolve_branch_scope; admin sees any).

        crew_rate_cents_per_hour has NO fallback (migration 020 §2): an
        unconfigured branch returns crewRateCentsPerHour=None so the UI shows
        "no crew rate configured", never an invented number.

        materialFactors: the effective set of material_calcs rows for this branch,
        each with source='override' (branch-specific row) or source='inherited'
        (company-wide NULL row shown because the branch has no override). Branch
        rows take precedence; for any material_key not overridden the company-wide
        row is returned flagged inherited.

        productionRates: catalog_items production_rate values. No per-branch
        production-rate table exists (catalog_items.production_rate is a single
        company-wide value written by PATCH /api/settings/branch/{id}), so all
        items are returned flagged source='inherited' (no branch-level override
        is distinguishable from the DB schema alone).
        """
        await _require_branch_write_scope(user, aspire_branch_id)

        # ── crew rate ─────────────────────────────────────────────────────────
        bs_rows = await query(
            "SELECT * FROM branch_settings WHERE aspire_branch_id = %s",
            [aspire_branch_id],
        )
        crew_rate = bs_rows[0].get("crew_rate_cents_per_hour") if bs_rows else None

        # ── material factors — effective set (override | inherited) ───────────
        # 1. Load all branch override rows.
        branch_factor_rows = await query(
            """SELECT material_key, factors, aspire_branch_id
                 FROM material_calcs
                WHERE aspire_branch_id = %s""",
            [aspire_branch_id],
        )
        # 2. Load company-wide rows (aspire_branch_id IS NULL).
        company_factor_rows = await query(
            """SELECT material_key, factors, aspire_branch_id
                 FROM material_calcs
                WHERE aspire_branch_id IS NULL""",
        )

        # Build effective set: branch overrides win; company-wide fills the rest.
        overridden_keys: set[str] = {r["material_key"] for r in branch_factor_rows}
        effective_factors: list[dict] = []
        for r in branch_factor_rows:
            effective_factors.append({
                "materialKey": r["material_key"],
                "factors": _parse_factors(r.get("factors")),
                "source": "override",
            })
        for r in company_factor_rows:
            if r["material_key"] not in overridden_keys:
                effective_factors.append({
                    "materialKey": r["material_key"],
                    "factors": _parse_factors(r.get("factors")),
                    "source": "inherited",
                })

        # ── production rates — catalog_items (company-wide; no per-branch table)
        # All items are flagged source='inherited': catalog_items.production_rate
        # is the single company-wide value; per-branch overrides are not stored
        # in a separate column so the distinction doesn't apply here.
        catalog_rows = await query(
            """SELECT id, description, production_rate
                 FROM catalog_items
                WHERE active = 1 AND production_rate IS NOT NULL""",
        )
        production_rates: list[dict] = [
            {
                "catalogItemId": r["id"],
                "description": r.get("description"),
                "productionRate": float(r["production_rate"]),
                "source": "inherited",
            }
            for r in catalog_rows
        ]

        return {
            "aspireBranchId": aspire_branch_id,
            "crewRateCentsPerHour": None if crew_rate is None else int(crew_rate),
            "materialFactors": effective_factors,
            "productionRates": production_rates,
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

    # ── Handoff 43 §3.1: the caller's own profile ────────────────────────────
    # users.phone and users.title back the signer block on a client-facing
    # proposal (see GET /api/proposals/:id/signer). Self-service and not
    # admin-gated: a rep's own direct line and job title are theirs to set, and
    # routing them through an admin is how the field stays empty forever.

    @app.get("/api/settings/me")
    async def get_my_profile(user: dict = Depends(require_auth)) -> dict:
        """The caller's own row. Read live, not from the JWT.

        /api/auth/me echoes the token claims, which carry no phone or title —
        and a token minted before the rep set them would keep reporting them
        empty until the session rolled over.
        """
        return await _my_profile_row(user["id"])

    @app.patch("/api/settings/me")
    async def patch_my_profile(
        body: MyProfilePatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Update the caller's own phone and/or title. Audited like any config write."""
        user_id = user["id"]

        # Read the current row for audit from_value (404s if user is missing).
        current = await _my_profile_row(user_id)

        # A supplied-but-blank value clears the column; an omitted field is
        # untouched. `is not None` is the distinction, so "" must not be
        # normalised to None before this point.
        updates: dict[str, Optional[str]] = {}
        for field in ("phone", "title"):
            value = getattr(body, field)
            if value is not None:
                trimmed = value.strip()
                updates[field] = trimmed or None
        if not updates:
            raise HTTPException(status_code=400, detail="No profile fields to update")

        set_clause = ", ".join(f"{col} = %s" for col in updates)
        await execute(
            f"UPDATE users SET {set_clause} WHERE id = %s",
            [*updates.values(), user_id],
        )

        actor = _actor(user)
        for col, value in updates.items():
            await _audit(
                scope_type="company",
                scope_id=None,
                setting_key=f"user.{user_id}.{col}",
                from_value=current.get(col),
                to_value=value,
                actor=actor,
            )

        # Re-fetch the fresh row instead of reconstructing from stale locals.
        return await _my_profile_row(user_id)

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
        """Return the enriched branch settings payload after a PATCH.

        Reuses the same enrichment logic as GET /api/settings/branch/{id}: crew
        rate, materialFactors (override/inherited), productionRates. The PATCH
        return value and the GET response are therefore always in sync.
        """
        bs_rows = await query(
            "SELECT * FROM branch_settings WHERE aspire_branch_id = %s",
            [aspire_branch_id],
        )
        crew_rate = bs_rows[0].get("crew_rate_cents_per_hour") if bs_rows else None

        branch_factor_rows = await query(
            "SELECT material_key, factors, aspire_branch_id FROM material_calcs WHERE aspire_branch_id = %s",
            [aspire_branch_id],
        )
        company_factor_rows = await query(
            "SELECT material_key, factors, aspire_branch_id FROM material_calcs WHERE aspire_branch_id IS NULL",
        )
        overridden_keys: set[str] = {r["material_key"] for r in branch_factor_rows}
        effective_factors: list[dict] = []
        for r in branch_factor_rows:
            effective_factors.append({
                "materialKey": r["material_key"],
                "factors": _parse_factors(r.get("factors")),
                "source": "override",
            })
        for r in company_factor_rows:
            if r["material_key"] not in overridden_keys:
                effective_factors.append({
                    "materialKey": r["material_key"],
                    "factors": _parse_factors(r.get("factors")),
                    "source": "inherited",
                })

        catalog_rows = await query(
            "SELECT id, description, production_rate FROM catalog_items WHERE active = 1 AND production_rate IS NOT NULL",
        )
        production_rates: list[dict] = [
            {
                "catalogItemId": r["id"],
                "description": r.get("description"),
                "productionRate": float(r["production_rate"]),
                "source": "inherited",
            }
            for r in catalog_rows
        ]

        return {
            "aspireBranchId": aspire_branch_id,
            "crewRateCentsPerHour": None if crew_rate is None else int(crew_rate),
            "materialFactors": effective_factors,
            "productionRates": production_rates,
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

        # Handoff 50 §3: team_members is a company-wide marketing asset —
        # marketing/admin may write any row (company-wide OR any branch); a
        # branch manager keeps write access to its own branch's rows.
        scope_type, scope_id = await _require_marketing_or_branch_scope(
            user, body.aspireBranchId
        )

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

        # Handoff 50 §3: marketing/admin may edit any row (company-wide or
        # any branch); a branch manager keeps its own branch. Scope comes
        # from the EXISTING row, never a body/path-supplied branch id.
        scope_type, scope_id = await _require_marketing_or_branch_scope_for_row(
            user, current.get("aspire_branch_id")
        )

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

    # ── Handoff 43 §2: team headshot upload ──────────────────────────────────
    # Before this, `headshotObjectKey` was writable only by typing a GCS object
    # key into a text field, so in practice every proposal rendered initials
    # instead of a face. Scope guard mirrors patch_team_member exactly: the
    # row's own aspire_branch_id decides, never the path or body.

    @app.post("/api/settings/team-members/{member_id}/headshot")
    async def upload_team_member_headshot(
        member_id: str,
        file: UploadFile = File(...),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Upload (or replace) one team member's headshot.

        The object key is derived from the row id, so re-uploading replaces the
        object in place and cannot orphan a key the row still points at. The
        extension follows the validated content type, which means a JPEG
        replaced by a PNG leaves the old object behind — that one is deleted
        explicitly below.
        """
        rows = await query("SELECT * FROM team_members WHERE id = %s", [member_id])
        if not rows:
            raise HTTPException(status_code=404, detail="Team member not found")
        current = rows[0]

        # Handoff 50 §3: marketing/admin may edit any row (company-wide or
        # any branch); a branch manager keeps its own branch. Scope comes
        # from the EXISTING row, never a body/path-supplied branch id.
        scope_type, scope_id = await _require_marketing_or_branch_scope_for_row(
            user, current.get("aspire_branch_id")
        )

        data, ext, content_type = await _read_validated_image(file)
        object_key = f"proposal/headshots/{member_id}.{ext}"
        _att_mod.upload_bytes(object_key, data, content_type)

        prior_key = current.get("headshot_object_key")
        await execute(
            "UPDATE team_members SET headshot_object_key = %s WHERE id = %s",
            [object_key, member_id],
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"team_member.{member_id}.headshot_object_key",
            from_value=prior_key,
            to_value=object_key,
            actor=_actor(user),
        )
        # A format change moves the key; the superseded object is now
        # unreferenced. Same-key replacement is a no-op here by design.
        if prior_key and prior_key != object_key:
            _delete_object_quietly(prior_key)

        return {"id": member_id, "headshotObjectKey": object_key}

    @app.delete("/api/settings/team-members/{member_id}/headshot")
    async def delete_team_member_headshot(
        member_id: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Clear a team member's headshot and delete the stored object.

        A hard delete of the object is right here, unlike the row soft-deletes
        elsewhere in this module: nothing historical references a headshot — a
        past proposal stores team member ids, and the photo is looked up live
        at render time.
        """
        rows = await query("SELECT * FROM team_members WHERE id = %s", [member_id])
        if not rows:
            raise HTTPException(status_code=404, detail="Team member not found")
        current = rows[0]

        # Handoff 50 §3: marketing/admin may edit any row (company-wide or
        # any branch); a branch manager keeps its own branch. Scope comes
        # from the EXISTING row, never a body/path-supplied branch id.
        scope_type, scope_id = await _require_marketing_or_branch_scope_for_row(
            user, current.get("aspire_branch_id")
        )

        prior_key = current.get("headshot_object_key")
        await execute(
            "UPDATE team_members SET headshot_object_key = NULL WHERE id = %s",
            [member_id],
        )
        await _audit(
            scope_type=scope_type,
            scope_id=scope_id,
            setting_key=f"team_member.{member_id}.headshot_object_key",
            from_value=prior_key,
            to_value=None,
            actor=_actor(user),
        )
        _delete_object_quietly(prior_key)
        return {"id": member_id, "headshotObjectKey": None}

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

        # Handoff 50 §3: marketing/admin may edit any row (company-wide or
        # any branch); a branch manager keeps its own branch. Scope comes
        # from the EXISTING row, never a body/path-supplied branch id.
        scope_type, scope_id = await _require_marketing_or_branch_scope_for_row(
            user, current.get("aspire_branch_id")
        )

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

        # Handoff 50 §3: client_references is a company-wide marketing asset —
        # marketing/admin may write any row; a branch manager keeps its branch.
        scope_type, scope_id = await _require_marketing_or_branch_scope(
            user, body.aspireBranchId
        )

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

        # Handoff 50 §3: marketing/admin may edit any row (company-wide or
        # any branch); a branch manager keeps its own branch. Scope comes
        # from the EXISTING row, never a body/path-supplied branch id.
        scope_type, scope_id = await _require_marketing_or_branch_scope_for_row(
            user, current.get("aspire_branch_id")
        )

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

        # Handoff 50 §3: marketing/admin may edit any row (company-wide or
        # any branch); a branch manager keeps its own branch. Scope comes
        # from the EXISTING row, never a body/path-supplied branch id.
        scope_type, scope_id = await _require_marketing_or_branch_scope_for_row(
            user, current.get("aspire_branch_id")
        )

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
        await _require_marketing_manager(user)

        where = "" if include_inactive else "WHERE active = 1"
        rows = await query(
            f"SELECT * FROM portfolio_properties {where} ORDER BY sort_order, name",
        )
        return [_portfolio_row_out(r) for r in rows]

    @app.post("/api/settings/portfolio", status_code=201)
    async def create_portfolio_property(
        body: PortfolioPropertyCreate,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Create a portfolio_properties row — admin-only, company-scoped."""
        await _require_marketing_manager(user)
        actor = _actor(user)

        row_id = str(uuid.uuid4())
        await execute(
            """INSERT INTO portfolio_properties
                 (id, name, city_state, region_id, photo_object_keys, sort_order)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            [
                row_id,
                body.name,
                body.cityState,
                body.regionId,
                json.dumps(body.photoObjectKeys),
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
            "sortOrder": body.sortOrder,
        }

    @app.patch("/api/settings/portfolio/{property_id}")
    async def patch_portfolio_property(
        property_id: str,
        body: PortfolioPropertyPatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Partial update of a portfolio_properties row — admin-only."""
        await _require_marketing_manager(user)

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
        return _portfolio_row_out(refreshed[0] if refreshed else current)

    # ── Handoff 43 §2: portfolio photography upload ──────────────────────────
    # photo_object_keys is an ORDERED array — the Portfolio page lays photos out
    # in array order, so append-at-end is the upload semantic and reordering is
    # a PATCH of the whole array (already supported). Admin-only, matching every
    # other portfolio write: the portfolio is company-scoped.

    @app.post("/api/settings/portfolio/{property_id}/photos")
    async def upload_portfolio_photo(
        property_id: str,
        file: UploadFile = File(...),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Append one photo to a portfolio property. Returns the full new array.

        The key carries a random suffix rather than an array index: an index
        would collide with itself the moment a photo in the middle is removed
        and another uploaded, silently overwriting a live photo.
        """
        await _require_marketing_manager(user)

        rows = await query(
            "SELECT * FROM portfolio_properties WHERE id = %s", [property_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Portfolio property not found")
        current = _portfolio_row_out(rows[0])

        data, ext, content_type = await _read_validated_image(file)
        object_key = f"proposal/portfolio/{property_id}/{uuid.uuid4().hex[:12]}.{ext}"
        _att_mod.upload_bytes(object_key, data, content_type)

        keys = [*current["photoObjectKeys"], object_key]
        await execute(
            "UPDATE portfolio_properties SET photo_object_keys = %s WHERE id = %s",
            [json.dumps(keys), property_id],
        )
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"portfolio_property.{property_id}.photo_object_keys",
            from_value=current["photoObjectKeys"],
            to_value=keys,
            actor=_actor(user),
        )
        return {"id": property_id, "photoObjectKeys": keys}

    @app.delete("/api/settings/portfolio/{property_id}/photos")
    async def delete_portfolio_photo(
        property_id: str,
        key: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Remove one photo from a portfolio property and delete the object.

        `key` must already appear in this row's photo_object_keys. That check is
        the whole security boundary: without it this endpoint would delete any
        object in the bucket by name, including a rendered proposal PDF.
        """
        await _require_marketing_manager(user)

        rows = await query(
            "SELECT * FROM portfolio_properties WHERE id = %s", [property_id]
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Portfolio property not found")
        current = _portfolio_row_out(rows[0])

        if key not in current["photoObjectKeys"]:
            raise HTTPException(
                status_code=404, detail="That photo does not belong to this property."
            )

        keys = [k for k in current["photoObjectKeys"] if k != key]
        await execute(
            "UPDATE portfolio_properties SET photo_object_keys = %s WHERE id = %s",
            [json.dumps(keys), property_id],
        )
        await _audit(
            scope_type="company",
            scope_id=None,
            setting_key=f"portfolio_property.{property_id}.photo_object_keys",
            from_value=current["photoObjectKeys"],
            to_value=keys,
            actor=_actor(user),
        )
        _delete_object_quietly(key)
        return {"id": property_id, "photoObjectKeys": keys}

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
        await _require_marketing_manager(user)

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

    # ── Handoff 42: Documents (licenses_certifications) CRUD ─────────────────
    #
    # Single API for all document kinds: 'license', 'certification', 'insurance'.
    # Branch-scoped (aspire_branch_id NULL = company-wide, admin-only).
    # SOFT-DELETE ONLY (active=0) — an expired document is a historical record
    # that past proposals referenced. NEVER issue a DELETE. §6 AC.
    # Scope derivation follows the same pattern as team_members / client_references:
    # the writable branch comes from resolve_branch_scope, never the body.
    # Insurance-kind rows are branch-scoped like licenses — no admin-only guard.

    @app.get("/api/settings/licenses")
    @app.get("/api/settings/documents")
    async def list_licenses(
        include_expired: bool = False,
        user: dict = Depends(require_auth),
    ) -> list[dict]:
        """List licenses_certifications rows visible to the caller.

        Returns all document kinds (license, certification, insurance). Admin
        sees all rows (any branch + company-wide). BM/RD see only rows for
        their branches plus company-wide rows. include_expired=true includes
        deactivated and past-expiry rows (for the Settings management surface).
        Accessible at both /api/settings/licenses and /api/settings/documents.
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
    @app.post("/api/settings/documents", status_code=201)
    async def create_license(
        body: LicenseCreate,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Create a licenses_certifications row with branch-scope or company-wide guard.

        Accepts kind='license', 'certification', or 'insurance'. expiryDate is
        required for all kinds. Company-wide rows (aspireBranchId=None) require
        admin. Branch rows require admin or a BM/RD with write scope for that branch.
        Insurance-kind rows follow the same branch-scoping rules as licenses.
        Accessible at both /api/settings/licenses and /api/settings/documents.
        """
        _VALID_KINDS = {"license", "certification", "insurance"}
        if body.kind not in _VALID_KINDS:
            raise HTTPException(
                status_code=422,
                detail=f"kind must be one of: {', '.join(sorted(_VALID_KINDS))}",
            )

        # Insurance is always a single company-wide document — branch scoping is
        # not permitted. Reject before auth so the structural rule is clear.
        if body.kind == "insurance" and body.aspireBranchId is not None:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Insurance documents must be company-wide "
                    "(aspireBranchId must be null)"
                ),
            )

        actor = _actor(user)

        if body.aspireBranchId is None:
            await _require_admin(user)
            scope_type = "company"
            scope_id = None
        else:
            await _require_branch_write_scope(user, body.aspireBranchId)
            scope_type = "branch"
            scope_id = str(body.aspireBranchId)

        # For insurance, enforce the single-global-document invariant after auth
        # so only authorised callers can even trigger this check.
        if body.kind == "insurance":
            existing = await query(
                "SELECT id FROM licenses_certifications "
                "WHERE kind = 'insurance' AND active = 1 AND aspire_branch_id IS NULL "
                "LIMIT 1",
            )
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "An active insurance document already exists. "
                        "Edit or replace the existing one."
                    ),
                )

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
    @app.patch("/api/settings/documents/{license_id}")
    async def patch_license(
        license_id: str,
        body: LicensePatch,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Partial update of one licenses_certifications row (any kind).

        Scope is derived from the EXISTING row's aspire_branch_id — a body-supplied
        branch cannot widen scope. Company-wide rows (NULL) are admin-only.
        Accessible at both /api/settings/licenses/{id} and /api/settings/documents/{id}.
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
    @app.delete("/api/settings/documents/{license_id}")
    async def deactivate_license(
        license_id: str,
        user: dict = Depends(require_auth),
    ) -> dict:
        """Soft-delete a licenses_certifications row (any kind) — active=0. NEVER hard DELETE.

        An expired/deactivated document is a historical record referenced by past
        proposals. Setting active=0 removes it from proposal generation while
        preserving the audit trail. §6 AC — no DELETE SQL may ever be emitted.
        Accessible at both /api/settings/licenses/{id} and /api/settings/documents/{id}.
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
    @app.post("/api/settings/documents/{license_id}/scan", status_code=200)
    async def upload_license_scan(
        license_id: str,
        file: UploadFile = File(...),
        user: dict = Depends(require_auth),
    ) -> dict:
        """Upload a file (PDF or image) for any licenses_certifications row.

        Accepts any document kind (license, certification, insurance). Writes
        bytes through api.attachments.upload_bytes (the ONLY upload path — no
        parallel uploader is added). The GCS object key is constructed from the
        row id and file extension, then stored in the row's object_key column.
        The existing media-url signer (GET /api/proposals/config/media-url) is
        reused to serve the file — no second signing route is added here.
        Accessible at both /api/settings/licenses/{id}/scan and
        /api/settings/documents/{id}/scan.
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
        from api.attachments import upload_bytes as _upload_bytes, GCS_CREDENTIALS_BUCKET
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
        # Credentials always land in GCS_CREDENTIALS_BUCKET (prod bucket in all
        # deployed envs) so documents only need updating once, not per environment.
        _upload_bytes(object_key, data, content_type, bucket=GCS_CREDENTIALS_BUCKET)

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

    # ── Handoff 42: insurance_certificates endpoints removed ──────────────────
    #
    # The /api/settings/insurance GET/POST/PATCH/DELETE endpoints and the
    # /api/settings/insurance/upload endpoint have been removed. Insurance
    # documents are now managed through the unified /api/settings/licenses
    # (or /api/settings/documents) endpoints with kind='insurance'. See
    # migration 033 for the data migration from insurance_certificates.


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
