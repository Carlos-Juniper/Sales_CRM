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
export interface BranchSettings {
  aspireBranchId: number
  /** Dollars-per-hour stored as cents; null ⇒ not configured (no fallback). */
  crewRateCentsPerHour: number | null
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
}
