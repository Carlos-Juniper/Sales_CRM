import { apiClient } from './client'
import type { ApprovalTier, MarginBandRow } from '@/types/estimating'

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

export const settingsApi = {
  /** Operating branches the caller may manage, sorted by branch name. */
  branches: () => apiClient.get<ManageableBranch[]>('/settings/branches'),

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
}
