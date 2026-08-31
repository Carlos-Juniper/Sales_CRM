
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
import { useUIStore } from '@/store/uiStore'
import type {
  BranchProfile,
  ClientReference,
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
  insurance: null,
  loaded: false,
}

async function fetchStaticConfig(): Promise<ProposalStaticConfig> {
  // Each endpoint catches independently — one failing call cannot blank the other.
  const [branches, insurance] = await Promise.all([
    proposalConfigApi.branches().catch(() => null),
    proposalConfigApi.insurance().catch(() => null),
  ])
  return {
    branches: branches ?? [],
    // insurance() returns null when no cert has been uploaded yet — treat
    // a fetch error the same way so the UI degrades gracefully.
    insurance: insurance ?? null,
    loaded: branches !== null || insurance !== null,
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
