import { apiClient } from './client'
import type {
  BranchCoverageGroup,
  BranchProfile,
  ClientReference,
  InsuranceCert,
  LicenseCertificationGroups,
  PortfolioProperty,
  ProposalPackageSummary,
  ProposalRender,
  ProposalRequest,
  ProposalSignerFacts,
  TeamMember,
  TeamMemberType,
} from '@/types/proposal'

// ---------------------------------------------------------------------------
// Proposal API facade
//
// Thin wrapper over apiClient — mirrors the shape of api/estimating.ts exactly:
// one exported const per logical grouping, typed functions, URLSearchParams for
// query-param serialisation, snake_case param names matching what the backend
// expects (per Amendment A.6 + Slice 4 ledger).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config reads — GET /api/proposals/config/*
// ---------------------------------------------------------------------------

export interface RegionScopedList<T> {
  items: T[]
  /**
   * Value of `X-Region-Filter`, or null when the header is absent.
   * Cross-origin responses hide it unless Access-Control-Expose-Headers
   * lists it. The API CORS middleware does not, so a cross-origin caller
   * (VITE_API_URL pointing at another origin) gets null and the switcher
   * stays on "My region". Same-origin (the SPA served by this API, and the
   * Vite dev proxy) can read it.
   */
  regionFilter: string | null
}

function readRegionFilterHeader(headers: Headers): string | null {
  const raw = headers.get('X-Region-Filter')
  if (raw == null) return null
  const text = raw.trim()
  return text || null
}

export const proposalConfigApi = {
  /**
   * GET /api/proposals/config/branches?proposal_id=
   * Returns active non-"DO NOT USE" branches from crm.branches, projected as
   * BranchProfile read-models (includes lat/lng added by migration 014).
   * Without proposalId: only rows with lat/lng populated (proximity calc needs them).
   *
   * With proposalId: scoped to the proposal's signer's own branches
   * (proposal_requests.signer_user_id → user_branches) instead, lat/lng not
   * required — an unscoped branch like Corporate has no coordinates but must
   * still be able to appear once it's the rep's own office. Falls back to the
   * full geocoded roster if the signer holds no branches.
   */
  branches: (params?: { proposalId?: string }) => {
    const qs = new URLSearchParams()
    if (params?.proposalId) qs.set('proposal_id', params.proposalId)
    const q = qs.toString()
    return apiClient.get<BranchProfile[]>(`/proposals/config/branches${q ? `?${q}` : ''}`)
  },

  /**
   * GET /api/proposals/config/branch-coverage
   * Office names grouped by state for the coverage table. Unlike branches() this
   * does not require lat/lng, so it covers the whole operating roster.
   */
  branchCoverage: () => apiClient.get<BranchCoverageGroup[]>('/proposals/config/branch-coverage'),

  /**
   * GET /api/proposals/config/team-members?aspire_branch_id=&team_type=&region_id=
   * When aspire_branch_id is supplied, returns both branch-scoped rows AND
   * null-branch (company-wide/executive) rows — Amendment A, null-branch-inclusion rule.
   *
   * regionId omitted = the caller's own region(s). 'all' = no region filter.
   * A region id limits to that region. Rows with regionId null stay in every list.
   * The X-Region-Filter header is returned when the browser can read it.
   */
  teamMembers: async (params?: { aspireBranchId?: number; teamType?: TeamMemberType; regionId?: string }) => {
    const qs = new URLSearchParams()
    if (params?.aspireBranchId !== undefined) qs.set('aspire_branch_id', String(params.aspireBranchId))
    if (params?.teamType) qs.set('team_type', params.teamType)
    if (params?.regionId) qs.set('region_id', params.regionId)
    const q = qs.toString()
    const { data, headers } = await apiClient.getWithHeaders<TeamMember[]>(
      `/proposals/config/team-members${q ? `?${q}` : ''}`,
    )
    return { items: data, regionFilter: readRegionFilterHeader(headers) }
  },

  /**
   * GET /api/proposals/config/client-references?aspire_branch_id=&region_id=
   * When aspire_branch_id is supplied, null-branch (company-wide) rows are included
   * in addition to branch matches — same OR-IS-NULL pattern as team-members.
   * regionId behaves the same as on team-members.
   */
  clientReferences: async (params?: { aspireBranchId?: number; regionId?: string }) => {
    const qs = new URLSearchParams()
    if (params?.aspireBranchId !== undefined) qs.set('aspire_branch_id', String(params.aspireBranchId))
    if (params?.regionId) qs.set('region_id', params.regionId)
    const q = qs.toString()
    const { data, headers } = await apiClient.getWithHeaders<ClientReference[]>(
      `/proposals/config/client-references${q ? `?${q}` : ''}`,
    )
    return { items: data, regionFilter: readRegionFilterHeader(headers) }
  },

  /**
   * GET /api/proposals/config/portfolio?region_id=
   * Omitting region_id returns all portfolio properties.
   */
  portfolio: (params?: { regionId?: string }) => {
    const qs = new URLSearchParams()
    if (params?.regionId) qs.set('region_id', params.regionId)
    const q = qs.toString()
    return apiClient.get<PortfolioProperty[]>(`/proposals/config/portfolio${q ? `?${q}` : ''}`)
  },

  /**
   * GET /api/proposals/config/insurance
   * Returns the current insurance certificate metadata (object key + expiry),
   * or null when no certificate has been uploaded yet. Insurance is always
   * company-wide — no branch scoping.
   */
  insurance: () => {
    return apiClient.get<InsuranceCert | null>('/proposals/config/insurance')
  },

  /**
   * GET /api/proposals/config/licenses?aspire_branch_id=&include_expired=
   * When aspire_branch_id is supplied, company-wide rows are included in addition
   * to branch matches. Expired credentials are excluded unless include_expired.
   */
  licenses: (params?: { aspireBranchId?: number; includeExpired?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.aspireBranchId !== undefined) qs.set('aspire_branch_id', String(params.aspireBranchId))
    if (params?.includeExpired) qs.set('include_expired', 'true')
    const q = qs.toString()
    return apiClient.get<LicenseCertificationGroups>(`/proposals/config/licenses${q ? `?${q}` : ''}`)
  },

  /**
   * GET /api/proposals/config/media-url?key=
   * Returns a short-lived (~10 min) signed GET URL for a GCS object key.
   * Use for headshots, portfolio photos, and the insurance certificate PDF.
   */
  mediaUrl: (objectKey: string) => {
    const qs = new URLSearchParams({ key: objectKey })
    return apiClient.get<{ url: string }>(`/proposals/config/media-url?${qs.toString()}`)
  },
}

// ---------------------------------------------------------------------------
// Proposal CRUD — POST/GET/PATCH /api/proposals
// ---------------------------------------------------------------------------

/** Body for POST /api/proposals. Server assigns id, createdAt, updatedAt. */
export type CreateProposalPayload = Omit<ProposalRequest, 'id' | 'createdAt' | 'updatedAt'>

export const proposalsApi = {
  /**
   * POST /api/proposals
   * Validates that estimateId belongs to leadId and estimate.status === 'approved'
   * before persisting. Returns the full ProposalRequest (201).
   */
  create: (body: CreateProposalPayload) =>
    apiClient.post<ProposalRequest>('/proposals', body),

  /**
   * GET /api/proposals/:id
   * Reopens a previously generated proposal for editing.
   */
  get: (id: string) => apiClient.get<ProposalRequest>(`/proposals/${id}`),

  /**
   * PATCH /api/proposals/:id
   * Partial update of any mutable field. id/leadId/estimateId/createdBy/createdAt
   * are immutable and must not be included in the patch body.
   */
  update: (id: string, patch: Partial<CreateProposalPayload>) =>
    apiClient.patch<ProposalRequest>(`/proposals/${id}`, patch),

  /**
   * GET /api/proposals/:id/signer
   * The signer's per-user facts (name, title, phone, email, office address),
   * resolved server-side because the office needs a users -> user_branches ->
   * branches join. Nulls mean "unknown" — the caller applies the company-level
   * fallback. Reachable with a render-scoped token, unlike GET /api/users.
   */
  signer: (id: string) => apiClient.get<ProposalSignerFacts>(`/proposals/${id}/signer`),

  /**
   * GET /api/proposals?leadId=
   * Lists all saved proposals for a lead, ordered by createdAt DESC.
   */
  list: (params: { leadId: string }) => {
    const qs = new URLSearchParams({ leadId: params.leadId })
    return apiClient.get<ProposalRequest[]>(`/proposals?${qs.toString()}`)
  },

  /**
   * GET /api/proposals/packages?exclude_status=won,lost
   * Saved proposals for the Proposals list. Closed leads (won, lost) are
   * excluded by the server from this request, not after the response arrives.
   */
  packages: () => {
    const qs = new URLSearchParams({ exclude_status: 'won,lost' })
    return apiClient.get<ProposalPackageSummary[]>(`/proposals/packages?${qs.toString()}`)
  },

  /**
   * POST /api/proposals/:id/render
   * Triggers a server-side headless Chromium PDF render.
   * Returns the render result with a signed download URL.
   */
  render: (id: string) =>
    apiClient.post<ProposalRender>(`/proposals/${id}/render`, {}),

  /**
   * GET /api/proposals/:id/renders
   * Lists all PDF renders for a proposal, ordered by version DESC.
   */
  listRenders: (id: string) =>
    apiClient.get<ProposalRender[]>(`/proposals/${id}/renders`),

  /**
   * Constructs the redirect URL for downloading a specific render version.
   * The API returns 302 → signed GCS URL; open directly in new tab.
   */
  renderDownloadUrl: (id: string, version: number) =>
    `/api/proposals/${id}/renders/${version}/download`,
}
