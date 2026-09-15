// ---------------------------------------------------------------------------
// Proposal hooks — query keys under ['proposals', ...], mutations invalidate
// on success. No hand-rolled optimistic-state merging (CLAUDE.md §2).
//
// Config shape note: proposalConfigApi.teamMembers/clientReferences/portfolio
// all accept filter params (aspireBranchId, teamType, regionId), so they
// cannot be collapsed into a single parameterless Promise.all the way
// useEstimatingConfig does. Instead:
//   - useProposalConfig()  →  branches + insurance (parameter-free, combined)
//   - useTeamMembers(params?) / useClientReferences(params?) / usePortfolio(params?)
//     →  individual parameterized hooks so callers can scope by branch/region
// ---------------------------------------------------------------------------

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { proposalConfigApi, proposalsApi } from '@/api/proposals'
import { settingsApi } from '@/api/settings'
import type {
  TeamMemberCreateBody,
  TeamMemberPatchBody,
  ClientReferenceCreateBody,
  ClientReferencePatchBody,
  PortfolioPropertyCreateBody,
  PortfolioPropertyPatchBody,
} from '@/api/settings'
import { useUIStore } from '@/store/uiStore'
import type {
  BranchCoverageGroup,
  BranchProfile,
  ClientReference,
  LicenseCertificationGroups,
  PortfolioProperty,
  ProposalRender,
  ProposalRequest,
  TeamMember,
  TeamMemberType,
} from '@/types/proposal'
import type { CreateProposalPayload } from '@/api/proposals'

// ---------------------------------------------------------------------------
// Query-key constants
// ---------------------------------------------------------------------------

export const PROPOSAL_CONFIG_KEY = 'proposals-config'

// ---------------------------------------------------------------------------
// Config — static (no params)
// ---------------------------------------------------------------------------

export interface ProposalStaticConfig {
  branches: BranchProfile[]
  branchCoverage: BranchCoverageGroup[]
  insurance: {
    id: string
    objectKey: string
    expiryDate: string
    label: string | null
    uploadedAt: string
  } | null
  loaded: boolean
}

const FALLBACK_PROPOSAL_CONFIG: ProposalStaticConfig = {
  branches: [],
  branchCoverage: [],
  insurance: null,
  loaded: false,
}

async function fetchStaticConfig(): Promise<ProposalStaticConfig> {
  // Each endpoint catches independently — one failing call cannot blank the other.
  const [branches, branchCoverage, insurance] = await Promise.all([
    proposalConfigApi.branches().catch(() => null),
    proposalConfigApi.branchCoverage().catch(() => null),
    proposalConfigApi.insurance().catch(() => null),
  ])
  return {
    branches: branches ?? [],
    branchCoverage: branchCoverage ?? [],
    // insurance() returns null when no cert has been uploaded yet — treat
    // a fetch error the same way so the UI degrades gracefully.
    insurance: insurance ?? null,
    loaded: branches !== null || branchCoverage !== null || insurance !== null,
  }
}

/**
 * Branches + insurance certificate — no filter params, app-wide cached.
 * Follows the same placeholderData + staleTime pattern as useEstimatingConfig.
 * Invalidate with queryClient.invalidateQueries({ queryKey: [PROPOSAL_CONFIG_KEY] }).
 */
export function useProposalConfig(): ProposalStaticConfig {
  const { data } = useQuery({
    queryKey: [PROPOSAL_CONFIG_KEY],
    queryFn: fetchStaticConfig,
    staleTime: 5 * 60_000,
    placeholderData: FALLBACK_PROPOSAL_CONFIG,
  })
  return data ?? FALLBACK_PROPOSAL_CONFIG
}

// ---------------------------------------------------------------------------
// Config — parameterized (individual hooks, scoped by branch / region)
// ---------------------------------------------------------------------------

/**
 * Team members for a branch, optionally filtered by teamType.
 * When aspireBranchId is provided, null-branch (company-wide/executive) rows
 * are included in addition to branch matches (Amendment A null-branch-inclusion rule).
 * Query key: ['proposals', 'config', 'team-members', aspireBranchId, teamType]
 */
export function useTeamMembers(params?: {
  aspireBranchId?: number
  teamType?: TeamMemberType
}) {
  return useQuery<TeamMember[]>({
    queryKey: ['proposals', 'config', 'team-members', params?.aspireBranchId ?? null, params?.teamType ?? null],
    queryFn: () => proposalConfigApi.teamMembers(params),
    staleTime: 5 * 60_000,
  })
}

/**
 * Client references for a branch.
 * null-branch (company-wide) rows always included when aspireBranchId is set.
 * Query key: ['proposals', 'config', 'client-references', aspireBranchId]
 */
export function useClientReferences(params?: { aspireBranchId?: number }) {
  return useQuery<ClientReference[]>({
    queryKey: ['proposals', 'config', 'client-references', params?.aspireBranchId ?? null],
    queryFn: () => proposalConfigApi.clientReferences(params),
    staleTime: 5 * 60_000,
  })
}

/**
 * Portfolio properties for a region. Omit regionId to fetch all.
 * Query key: ['proposals', 'config', 'portfolio', regionId]
 */
export function usePortfolio(params?: { regionId?: string }) {
  return useQuery<PortfolioProperty[]>({
    queryKey: ['proposals', 'config', 'portfolio', params?.regionId ?? null],
    queryFn: () => proposalConfigApi.portfolio(params),
    staleTime: 5 * 60_000,
  })
}

/**
 * Licenses and certifications for a branch, company-wide rows always included.
 * Expired credentials are omitted — the proposal page shows a prose line rather
 * than an empty table, so an empty result is a valid render, not an error.
 * Query key: ['proposals', 'config', 'licenses', aspireBranchId]
 */
export function useProposalLicenses(params?: { aspireBranchId?: number }) {
  return useQuery<LicenseCertificationGroups>({
    queryKey: ['proposals', 'config', 'licenses', params?.aspireBranchId ?? null],
    queryFn: () => proposalConfigApi.licenses(params),
    staleTime: 5 * 60_000,
  })
}

// ---------------------------------------------------------------------------
// Proposal CRUD
// ---------------------------------------------------------------------------

/**
 * Single proposal by id. Disabled until id is non-null.
 * Query key: ['proposals', id]
 */
export function useProposal(id: string | null) {
  return useQuery<ProposalRequest>({
    queryKey: ['proposals', id],
    queryFn: () => proposalsApi.get(id!),
    enabled: !!id,
    staleTime: 30_000,
  })
}

/**
 * All saved proposals for a lead, ordered createdAt DESC.
 * Query key: ['proposals', 'list', leadId]
 */
export function useProposalsByLead(leadId: string | null) {
  return useQuery<ProposalRequest[]>({
    queryKey: ['proposals', 'list', leadId],
    queryFn: () => proposalsApi.list({ leadId: leadId! }),
    enabled: !!leadId,
    staleTime: 30_000,
  })
}

/**
 * Create a new proposal. On success invalidates the lead's proposal list.
 * Callers must supply leadId for targeted invalidation.
 */
export function useCreateProposal() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (body: CreateProposalPayload) => proposalsApi.create(body),
    onSuccess: (created) => {
      // Invalidate the lead-scoped list so BidTab picks up the new row.
      qc.invalidateQueries({ queryKey: ['proposals', 'list', created.leadId] })
      toast('Proposal generated', { variant: 'success' })
    },
    onError: () => toast('Failed to generate proposal', { variant: 'error' }),
  })
}

/**
 * Short-lived signed URL for a GCS object key (headshot / portfolio photo /
 * insurance cert PDF). Disabled when objectKey is null or empty.
 * Query key: ['proposals', 'config', 'media-url', objectKey]
 *
 * The URL expires in ~10 minutes; staleTime is set to 8 minutes so TanStack
 * Query will re-sign before expiry if the component stays mounted.
 */
export function useProposalMediaUrl(objectKey: string | null) {
  return useQuery<{ url: string }>({
    queryKey: ['proposals', 'config', 'media-url', objectKey],
    queryFn: () => proposalConfigApi.mediaUrl(objectKey!),
    enabled: !!objectKey,
    staleTime: 8 * 60_000,
  })
}

/**
 * Update an existing proposal. On success invalidates both the single-proposal
 * cache entry and the lead-scoped list.
 */
export function useUpdateProposal() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateProposalPayload> }) =>
      proposalsApi.update(id, patch),
    onSuccess: (updated) => {
      // Keep the single-proposal cache fresh for the ProposalBuilder re-open flow.
      qc.invalidateQueries({ queryKey: ['proposals', updated.id] })
      // Keep the lead list consistent so the saved-proposals count stays accurate.
      qc.invalidateQueries({ queryKey: ['proposals', 'list', updated.leadId] })
    },
    onError: () => toast('Failed to save proposal', { variant: 'error' }),
  })
}

/**
 * Trigger a server-side PDF render for a proposal.
 * On success invalidates the renders list for the proposal.
 * Query key for renders list: ['proposals', id, 'renders']
 */
export function useRenderProposal() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation<ProposalRender, Error, string>({
    mutationFn: (proposalId: string) => proposalsApi.render(proposalId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['proposals', result.proposalId, 'renders'] })
      toast('PDF generated successfully', { variant: 'success' })
    },
    onError: () => toast('Failed to generate PDF — please try again', { variant: 'error' }),
  })
}

/**
 * List all PDF renders for a proposal, ordered by version DESC.
 * Polls every 5 seconds when any render has status 'pending'.
 * Disabled when id is null.
 * Query key: ['proposals', id, 'renders']
 */
export function useProposalRenders(id: string | null) {
  return useQuery<ProposalRender[]>({
    queryKey: ['proposals', id, 'renders'],
    queryFn: () => proposalsApi.listRenders(id!),
    enabled: !!id,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const renders = query.state.data
      if (Array.isArray(renders) && renders.some((r) => r.status === 'pending')) {
        return 5_000
      }
      return false
    },
  })
}

// ---------------------------------------------------------------------------
// Slice 13b: H37 config mutations (settings write path)
//
// All mutations invalidate their matching list query key so the section
// re-fetches after a successful create/edit/deactivate.
// ---------------------------------------------------------------------------

// ── Team Members ─────────────────────────────────────────────────────────────

/**
 * Creates a team member. aspireBranchId is accepted so callers can scope the
 * mutation to a branch (used for cache invalidation via the query key prefix).
 */
export function useCreateTeamMember(_aspireBranchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TeamMemberCreateBody) => settingsApi.createTeamMember(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'team-members'] })
    },
  })
}

export function useUpdateTeamMember(_aspireBranchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ memberId, body }: { memberId: string; body: TeamMemberPatchBody }) =>
      settingsApi.updateTeamMember(memberId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'team-members'] })
    },
  })
}

export function useDeactivateTeamMember(_aspireBranchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) => settingsApi.deactivateTeamMember(memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'team-members'] })
    },
  })
}

// ── Client References ─────────────────────────────────────────────────────────

export function useCreateClientReference(_aspireBranchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ClientReferenceCreateBody) =>
      settingsApi.createClientReference(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'client-references'] })
    },
  })
}

export function useUpdateClientReference(_aspireBranchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ refId, body }: { refId: string; body: ClientReferencePatchBody }) =>
      settingsApi.updateClientReference(refId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'client-references'] })
    },
  })
}

export function useDeactivateClientReference(_aspireBranchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (refId: string) => settingsApi.deactivateClientReference(refId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'client-references'] })
    },
  })
}

// ── Portfolio Properties ──────────────────────────────────────────────────────

export function useCreatePortfolioProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PortfolioPropertyCreateBody) =>
      settingsApi.createPortfolioProperty(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'portfolio'] })
    },
  })
}

export function useUpdatePortfolioProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ propertyId, body }: { propertyId: string; body: PortfolioPropertyPatchBody }) =>
      settingsApi.updatePortfolioProperty(propertyId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'portfolio'] })
    },
  })
}

export function useDeletePortfolioProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (propertyId: string) => settingsApi.deletePortfolioProperty(propertyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'portfolio'] })
    },
  })
}

// ── Proposal imagery (Handoff 43 §2) ──────────────────────────────────────────
//
// Uploads are multipart POSTs, so there is no optimistic path worth having: the
// cache key would need the object key the server is about to mint. Each hook
// invalidates its list instead, and the field shows its own pending state while
// the request is in flight.

/** Upload (replace) one team member's headshot. */
export function useUploadTeamMemberHeadshot() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)
  return useMutation({
    mutationFn: ({ memberId, file }: { memberId: string; file: File }) =>
      settingsApi.uploadTeamMemberHeadshot(memberId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'team-members'] })
    },
    onError: (err: Error) => toast(err.message || 'Headshot upload failed', { variant: 'error' }),
  })
}

/** Remove a team member's headshot (clears the column and deletes the object). */
export function useDeleteTeamMemberHeadshot() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)
  return useMutation({
    mutationFn: (memberId: string) => settingsApi.deleteTeamMemberHeadshot(memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'team-members'] })
    },
    onError: (err: Error) => toast(err.message || 'Could not remove headshot', { variant: 'error' }),
  })
}

/** Append one photo to a portfolio property. */
export function useUploadPortfolioPhoto() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)
  return useMutation({
    mutationFn: ({ propertyId, file }: { propertyId: string; file: File }) =>
      settingsApi.uploadPortfolioPhoto(propertyId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'portfolio'] })
    },
    onError: (err: Error) => toast(err.message || 'Photo upload failed', { variant: 'error' }),
  })
}

/** Remove one photo from a portfolio property. */
export function useDeletePortfolioPhoto() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)
  return useMutation({
    mutationFn: ({ propertyId, objectKey }: { propertyId: string; objectKey: string }) =>
      settingsApi.deletePortfolioPhoto(propertyId, objectKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'portfolio'] })
    },
    onError: (err: Error) => toast(err.message || 'Could not remove photo', { variant: 'error' }),
  })
}

