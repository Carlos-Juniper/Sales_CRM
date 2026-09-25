import { apiClient } from './client'
import type { ApprovalTier, MarginBandRow } from '@/types/estimating'
import type { UserRole } from '@/types'

/**
 * A branch the current user may MANAGE (the Settings branch-picker source).
 *
 * The list is scoped and roster-filtered SERVER-side (GET /api/settings/branches):
 * admin sees every operating branch, a BM/RD only its `user_branches`, and every
 * response already excludes `active = 0` / `'%DO NOT USE%'` rows. The client
 * renders exactly what the endpoint returns — no client-side filtering.
 */
export interface ManageableBranch {
  aspireBranchId: number
  branchName: string
  city: string | null
}

/**
 * A branch's settings as returned by GET /api/settings/branch/{aspire_branch_id}
 * (Slice 5). NOTE (shape gap): this endpoint returns ONLY the crew rate — a
 * branch with no configured rate hands back `crewRateCentsPerHour: null` (the
 * §2.3 no-fallback contract: never an invented number). Material factors and
 * production rates are NOT on this payload; they are read from the estimating
 * config endpoints (material-calcs / catalog-items) and written back through
 * this endpoint's PATCH.
 */
export interface BranchProductionRate {
  catalogItemId: string
  description: string
  productionRate: number | null
  source: 'override' | 'inherited'
}

export interface BranchSettings {
  aspireBranchId: number
  /** Dollars-per-hour stored as cents; null ⇒ not configured (no fallback). */
  crewRateCentsPerHour: number | null
  productionRates?: BranchProductionRate[]
}

/**
 * Partial branch-settings update → PATCH /api/settings/branch/{aspire_branch_id}.
 * Scope is enforced server-side from `user_branches` (a BM patching a branch
 * outside its scope gets a 403); the `aspireBranchId` in the URL is authoritative.
 * Only the keys present are written.
 */
export interface BranchSettingsPatch {
  /** Crew rate in cents-per-hour (dollars converted client-side). */
  crewRateCentsPerHour?: number
  /** {catalogItemId: productionRate} — one row per changed kit. */
  productionRates?: Record<string, number>
  /** {materialKey: {factorName: value}} — FACTOR columns only, never unit_cost/sell. */
  materialFactors?: Record<string, Record<string, number | Record<string, number>>>
}

/**
 * The company_settings singleton (row id=1) as returned by
 * GET/PATCH /api/settings/company. Snake_case because the endpoint hands back
 * the raw DB row (migration 020 typed columns) — no camel-casing layer. Every
 * field is a distinct type with its own validation range.
 */
export interface CompanySettings {
  id: number
  /** SLA return window in days (whole days). */
  sla_return_window_days: number
  /** At-risk threshold in days (whole days). */
  sla_at_risk_threshold_days: number
  /** Discrepancy flag threshold as a DECIMAL fraction (0.10 = 10%). */
  discrepancy_threshold_pct: number
  /** Default intake target margin as a fraction (0.22 = 22%). */
  default_target_margin: number
  /** Default intake win probability as a fraction (0.20 = 20%). */
  default_win_probability: number
  /** Default intake priority label ('low' | 'medium' | 'high'). */
  default_priority: string
  /** Default "notify BM/RD on return" flag (stored 0/1). */
  default_notify_bm_rd_on_return: boolean | number
  updated_at?: string
}

/**
 * Partial company-settings update. Only the keys present are written; the
 * PATCH audits one row per changed key server-side.
 */
export type CompanySettingsPatch = Partial<
  Omit<CompanySettings, 'id' | 'updated_at'>
>

/** Partial approval-tier edit (dollars stored as cents). */
export type ApprovalTierPatch = Partial<{
  label: string
  min_value_cents: number
  max_value_cents: number
  tier_order: number
}>

/** Partial margin-band edit (fractions). */
export type MarginBandPatch = Partial<{
  good_min: number
  ok_min: number
}>

/**
 * A user as the Users admin section (§2.8) consumes it.
 *
 * Sourced from `GET /api/users`. NOTE (Slice 6 shape gap): that endpoint returns
 * `id/name/email/role` plus the legacy `branch_id`/`avatar_initials`; it does NOT
 * yet return `active`, an `aspire_rep_id`, or a `branches[]` array. Those three
 * are typed OPTIONAL so the UI can consume the richer shape the mutations return
 * (and a future list endpoint) without lying about today's payload — a user with
 * no `active` field is treated as active, matching the "deactivate, never delete"
 * server contract (a missing flag can only mean an authorized/active row).
 */
export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  /** 1/true = active; 0/false = deactivated (still listed, historical). */
  active?: boolean | number
  /** Resolved Aspire ContactID; null/absent for a non-sales or unlinked user. */
  aspire_rep_id?: number | null
  /** aspire_branch_id replace-set. Absent until a list endpoint returns it. */
  branches?: number[]
}

/** A M365 directory candidate the admin PICKS (name+email autofill, §2.8). */
export interface DirectoryCandidate {
  name: string
  email: string
}

/** Authorize a directory-picked person (§2.8): email comes from the pick. */
export interface AuthorizeUserBody {
  name: string
  email: string
  role: UserRole
  /** Optional aspire_branch_id replace-set. */
  branches?: number[]
}

/** Partial user edit: role / branches (replace-set) / active toggle. */
export interface UserAdminPatch {
  role?: UserRole
  branches?: number[]
  active?: boolean
}

/** Optional `rep_id` query on roster writes. Portfolio paths never pass one. */
function rosterPath(path: string, repId?: string): string {
  if (!repId) return path
  const qIndex = path.indexOf('?')
  const base = qIndex === -1 ? path : path.slice(0, qIndex)
  const qs = new URLSearchParams(qIndex === -1 ? '' : path.slice(qIndex + 1))
  qs.set('rep_id', repId)
  return `${base}?${qs.toString()}`
}

export const settingsApi = {
  /** Operating branches the caller may manage, sorted by branch name. */
  branches: () => apiClient.get<ManageableBranch[]>('/settings/branches'),

  /**
   * Read one branch's settings (crew rate only — see BranchSettings). Scoped
   * server-side; an out-of-scope branch 403s.
   */
  branchSettings: (aspireBranchId: number) =>
    apiClient.get<BranchSettings>(`/settings/branch/${aspireBranchId}`),

  /**
   * Patch a branch's crew rate / production rates / material factors. The
   * BranchSettingsPatch (Slice 5) model expects snake_case keys, so the camel
   * body is mapped to the wire shape here — the UI/hooks stay camelCase.
   */
  updateBranchSettings: (aspireBranchId: number, body: BranchSettingsPatch) => {
    const wire: Record<string, unknown> = {}
    if (body.crewRateCentsPerHour !== undefined)
      wire.crew_rate_cents_per_hour = body.crewRateCentsPerHour
    if (body.productionRates !== undefined)
      wire.production_rates = body.productionRates
    if (body.materialFactors !== undefined)
      wire.material_factors = body.materialFactors
    return apiClient.patch<BranchSettings>(
      `/settings/branch/${aspireBranchId}`,
      wire,
    )
  },

  /** Read the company_settings singleton (any authed role). */
  company: () => apiClient.get<CompanySettings>('/settings/company'),
  /** Partial update of the company_settings singleton (admin-only server-side). */
  updateCompany: (body: CompanySettingsPatch) =>
    apiClient.patch<CompanySettings>('/settings/company', body),

  /**
   * Approval-tier ladder rows. Read comes from the estimating config endpoint
   * (camelCase via _approval_tier_out); the write PATCHes the company route.
   */
  approvalTiers: () =>
    apiClient.get<ApprovalTier[]>('/estimating/config/approval-tiers'),
  updateApprovalTier: (tierId: string, body: ApprovalTierPatch) =>
    apiClient.patch<unknown>(`/settings/company/approval-tiers/${tierId}`, body),

  /** Margin-band rows (read camelCase; write PATCHes the company route). */
  marginBands: () =>
    apiClient.get<MarginBandRow[]>('/estimating/config/margin-bands'),
  updateMarginBand: (bandId: string, body: MarginBandPatch) =>
    apiClient.patch<unknown>(`/settings/company/margin-bands/${bandId}`, body),

  // ── Slice 6: user administration (§2.8) ────────────────────────────────────

  /** Current users (name/email/role/active). Plain listing keeps inactive rows. */
  listUsers: () => apiClient.get<AdminUser[]>('/users'),

  /**
   * M365 directory typeahead — the admin PICKS a person so the email is exact
   * (typo-proof). A blank/short query returns [] server-side.
   */
  searchDirectory: (q: string) =>
    apiClient.get<DirectoryCandidate[]>(
      `/settings/users/directory?q=${encodeURIComponent(q)}`,
    ),

  /**
   * Authorize a picked person into `users`. 422 (with the exact §2.8 copy) when
   * role='sales' has no resolvable aspire_rep_id — surfaced verbatim by the UI.
   */
  authorizeUser: (body: AuthorizeUserBody) =>
    apiClient.post<AdminUser>('/settings/users', body),

  /** Patch role / branches (replace-set) / active toggle. */
  updateUser: (userId: string, body: UserAdminPatch) =>
    apiClient.patch<AdminUser>(`/settings/users/${userId}`, body),

  /**
   * Resolve + persist a user's Aspire ContactID from their email. 422 (same
   * §2.8 copy) when Aspire still has no matching contact.
   */
  linkAspireRep: (userId: string) =>
    apiClient.post<{ id: string; aspire_rep_id: number }>(
      `/settings/users/${userId}/link-aspire-rep`,
      {},
    ),

  // ── Slice 13b: H37 config table write paths ─────────────────────────────────
  // Read paths live in proposalConfigApi (proposals.ts) under /proposals/config/*.
  // Write paths live here under /settings/* (server-side scoped by role).
  //
  // Client references and team members are owned by a sales rep. Marketing and
  // admin pass that rep; a sales rep passes their own id (omitting it is the
  // same on the server). Portfolio writes stay unscoped — no rep_id.

  /** POST /api/settings/team-members — body repId, optional query rep_id */
  createTeamMember: (body: TeamMemberCreateBody, repId?: string) =>
    apiClient.post<TeamMemberRow>(
      rosterPath('/settings/team-members', repId),
      repId ? { ...body, repId } : body,
    ),

  /** PATCH /api/settings/team-members/:id — optional query rep_id */
  updateTeamMember: (memberId: string, body: TeamMemberPatchBody, repId?: string) =>
    apiClient.patch<TeamMemberRow>(
      rosterPath(`/settings/team-members/${memberId}`, repId),
      body,
    ),

  /** DELETE /api/settings/team-members/:id — soft-delete (active=0) */
  deactivateTeamMember: (memberId: string, repId?: string) =>
    apiClient.delete<void>(rosterPath(`/settings/team-members/${memberId}`, repId)),

  /** POST /api/settings/client-references — body repId, optional query rep_id */
  createClientReference: (body: ClientReferenceCreateBody, repId?: string) =>
    apiClient.post<ClientReferenceRow>(
      rosterPath('/settings/client-references', repId),
      repId ? { ...body, repId } : body,
    ),

  /** PATCH /api/settings/client-references/:id — optional query rep_id */
  updateClientReference: (refId: string, body: ClientReferencePatchBody, repId?: string) =>
    apiClient.patch<ClientReferenceRow>(
      rosterPath(`/settings/client-references/${refId}`, repId),
      body,
    ),

  /** DELETE /api/settings/client-references/:id — soft-delete */
  deactivateClientReference: (refId: string, repId?: string) =>
    apiClient.delete<void>(rosterPath(`/settings/client-references/${refId}`, repId)),

  /** POST /api/settings/portfolio — admin-only */
  createPortfolioProperty: (body: PortfolioPropertyCreateBody) =>
    apiClient.post<PortfolioPropertyRow>('/settings/portfolio', body),

  /** PATCH /api/settings/portfolio/:id — admin-only */
  updatePortfolioProperty: (propertyId: string, body: PortfolioPropertyPatchBody) =>
    apiClient.patch<PortfolioPropertyRow>(`/settings/portfolio/${propertyId}`, body),

  /**
   * DELETE /api/settings/portfolio/:id — hard delete until migration adds active column
   * (backend follow-up #18: add portfolio_properties.active + convert to soft-delete).
   */
  deletePortfolioProperty: (propertyId: string) =>
    apiClient.delete<void>(`/settings/portfolio/${propertyId}`),

  // ── Slice 15b: licenses/certifications CRUD (settings write path) ───────────

  /**
   * GET /api/settings/licenses?aspire_branch_id=&include_expired=
   * Returns licenses_certifications rows visible to the caller. Admin sees all;
   * BM/RD sees only their branch scope. include_expired=true returns inactive rows.
   * NOTE: this endpoint does NOT return isExpired — use /proposals/config/licenses
   * for the server-computed isExpired flag (used by the expiry banner).
   */
  listLicenses: (params?: { aspireBranchId?: number; includeExpired?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.aspireBranchId !== undefined) qs.set('aspire_branch_id', String(params.aspireBranchId))
    if (params?.includeExpired) qs.set('include_expired', 'true')
    const q = qs.toString()
    return apiClient.get<LicenseSettingsRow[]>(`/settings/licenses${q ? `?${q}` : ''}`)
  },

  /** POST /api/settings/licenses — creates a new license/certification row. */
  createLicense: (body: LicenseCreateBody) =>
    apiClient.post<LicenseSettingsRow>('/settings/licenses', body),

  /** PATCH /api/settings/licenses/:id — partial update. */
  updateLicense: (licenseId: string, body: LicensePatchBody) =>
    apiClient.patch<LicenseSettingsRow>(`/settings/licenses/${licenseId}`, body),

  /**
   * DELETE /api/settings/licenses/:id — soft-delete (active=0).
   * An expired or deactivated license is a historical record; it is never hard-deleted.
   */
  deactivateLicense: (licenseId: string) =>
    apiClient.delete<{ id: string; active: boolean }>(`/settings/licenses/${licenseId}`),

  /**
   * POST /api/settings/licenses/:id/scan — upload a scan PDF/image.
   * Sends a multipart/form-data request. The GCS object key is returned so the
   * caller can store it and build a view link via the media-url signer.
   */
  uploadLicenseScan: (licenseId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.postForm<{ id: string; objectKey: string }>(
      `/settings/licenses/${licenseId}/scan`,
      form,
    )
  },

  // ── Handoff 43 §3.1: the caller's own profile ───────────────────────────────
  // users.phone / users.title feed the signer block on a client-facing proposal.
  // Self-service: no user id in the path, so these can only ever touch own row.

  /** GET /api/settings/me — the caller's own row, read live (not from the JWT). */
  getMyProfile: () => apiClient.get<MyProfile>('/settings/me'),

  /** PATCH /api/settings/me — set/clear own phone and title. '' clears to null. */
  updateMyProfile: (body: MyProfilePatchBody) =>
    apiClient.patch<MyProfile>('/settings/me', body),

  // ── Handoff 43 §2: proposal imagery upload ──────────────────────────────────
  // Multipart through the API, the same path uploadLicenseScan uses. The server
  // derives every object key from the row id — a client-supplied key would be a
  // path traversal into the renderer's own proposal/generated/ prefix.

  /** POST /api/settings/team-members/:id/headshot — replaces any existing headshot. */
  uploadTeamMemberHeadshot: (memberId: string, file: File, repId?: string) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.postForm<{ id: string; headshotObjectKey: string }>(
      rosterPath(`/settings/team-members/${memberId}/headshot`, repId),
      form,
    )
  },

  /** DELETE /api/settings/team-members/:id/headshot — clears the column and the object. */
  deleteTeamMemberHeadshot: (memberId: string, repId?: string) =>
    apiClient.delete<{ id: string; headshotObjectKey: null }>(
      rosterPath(`/settings/team-members/${memberId}/headshot`, repId),
    ),

  /** POST /api/settings/portfolio/:id/photos — appends; returns the full new array. */
  uploadPortfolioPhoto: (propertyId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.postForm<{ id: string; photoObjectKeys: string[] }>(
      `/settings/portfolio/${propertyId}/photos`,
      form,
    )
  },

  /**
   * DELETE /api/settings/portfolio/:id/photos?key= — drops one photo.
   * The key must already belong to this property; the server 404s otherwise,
   * which is what stops this from deleting arbitrary objects by name.
   */
  deletePortfolioPhoto: (propertyId: string, objectKey: string) =>
    apiClient.delete<{ id: string; photoObjectKeys: string[] }>(
      `/settings/portfolio/${propertyId}/photos?key=${encodeURIComponent(objectKey)}`,
    ),

}

// ── H37 request/response shapes ──────────────────────────────────────────────
// These mirror the Pydantic models in api/settings.py (Slice 13a).
// Read-path response types live in types/proposal.ts; the write endpoints return
// the same camelCase shape so we re-export them under the settings names.

import type { TeamMember, ClientReference, PortfolioProperty } from '@/types/proposal'
export type TeamMemberRow = TeamMember
export type ClientReferenceRow = ClientReference
export type PortfolioPropertyRow = PortfolioProperty

export interface MyProfile {
  id: string
  name: string
  email: string
  role: UserRole
  /** null until the rep sets it — the signer block falls back to the company line. */
  phone: string | null
  /** null until the rep sets it — the signer block defaults to 'Account Manager'. */
  title: string | null
}

/** Omit a field to leave it untouched; send '' to clear it back to null. */
export interface MyProfilePatchBody {
  phone?: string
  title?: string
}

export interface TeamMemberCreateBody {
  name: string
  title: string
  teamType: string
  aspireBranchId: number | null
  /** Owning sales rep. Same meaning as the rep_id query parameter. */
  repId?: string
  userId?: string | null
  location?: string | null
  bio?: string
  headshotObjectKey?: string | null
  sortOrder?: number
}

export type TeamMemberPatchBody = Partial<Omit<TeamMemberCreateBody, 'aspireBranchId'>>

export interface ClientReferenceCreateBody {
  propertyName: string
  servicesProvided: string
  contactName: string
  contactTitle?: string | null
  phone: string
  email: string
  address: string
  clientSinceYear: number
  aspireBranchId: number | null
  /** Owning sales rep. Same meaning as the rep_id query parameter. */
  repId?: string
}

export type ClientReferencePatchBody = Partial<Omit<ClientReferenceCreateBody, 'aspireBranchId'>>

export interface PortfolioPropertyCreateBody {
  name: string
  cityState: string
  regionId: string
  photoObjectKeys?: string[]
  sortOrder?: number
}

export type PortfolioPropertyPatchBody = Partial<PortfolioPropertyCreateBody>

// ── Documents (unified licenses/certifications/insurance) shapes ──────────────
// All three kinds share one endpoint: GET/POST/PATCH/DELETE /api/settings/licenses
// (alias /api/settings/documents). The `kind` field distinguishes them.
// expiryDate is REQUIRED by the backend for all kinds.
// isExpired is NOT present — only /proposals/config/licenses computes it.

export type DocumentKind = 'license' | 'certification' | 'insurance'

export interface LicenseSettingsRow {
  id: string
  kind: DocumentKind
  name: string
  issuingBody: string | null
  identifier: string | null
  holderName: string | null
  /** null = company-wide (admin-only create; BM sees read-only). */
  aspireBranchId: number | null
  issuedDate: string | null
  /** Required by the backend — always present on a valid row. */
  expiryDate: string
  objectKey: string | null
  active: boolean
  sortOrder: number
  updatedAt: string | null
}

export interface LicenseCreateBody {
  kind: DocumentKind
  name: string
  /** Required by the backend. */
  expiryDate: string
  issuingBody?: string | null
  identifier?: string | null
  holderName?: string | null
  aspireBranchId?: number | null
  issuedDate?: string | null
  objectKey?: string | null
  sortOrder?: number
}

export type LicensePatchBody = Partial<Omit<LicenseCreateBody, 'aspireBranchId'>>
