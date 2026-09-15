// ---------------------------------------------------------------------------
// useProposalDocument — shared loader for the two proposal document surfaces.
//
//   /proposals/:id/preview → ProposalPreviewRoute (full-screen, interactive)
//   /proposals/:id/print   → ProposalPrintRoute  (chrome-free, headless capture)
//
// Both surfaces need the same seven queries and the same
// ProposalRequest → ProposalFormState mapping. Holding that in one hook is what
// keeps them honest: the document a rep approves on screen and the document
// Chromium captures into the PDF are assembled from identical inputs, so they
// cannot drift apart.
//
// `ready` is deliberately stricter than "the proposal loaded". `lead` and
// `estimate` are fetched from ids carried *on* the proposal, so they resolve a
// round-trip later. Gating on the proposal alone previously let Chromium
// capture a hidden placeholder and ship a blank one-page PDF.
// ---------------------------------------------------------------------------

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useProposal,
  useProposalSigner,
  useTeamMembers,
  useClientReferences,
  usePortfolio,
} from './useProposals'
import { useLead } from './useLeads'
import { useEstimate } from './useEstimate'
import { estimatingApi } from '@/api/estimating'
import { COMPANY_INFO } from '@/lib/constants'
import type { Lead } from '@/types'
import type { Estimate } from '@/types/estimating'
import type {
  TeamMember,
  ClientReference,
  PortfolioProperty,
  ProposalSigner,
  ProposalSignerFacts,
} from '@/types/proposal'
import type {
  ProposalFormState,
  OptionalSection,
} from '@/views/inside-sales/components/estimating/ProposalBuilder'

/** The six section keys the rep can toggle; everything else is a required page. */
const OPTIONAL_SECTION_KEYS: OptionalSection[] = [
  'startup_plan_30_60_90',
  'juniper_sync',
  'juniper_mapping',
  'meet_our_team_executive',
  'irrigation_reporting_sample',
  'table_of_contents',
]

/**
 * Fill the signer block, falling back to the company line field by field.
 *
 * The per-user facts come from GET /api/proposals/:id/signer, which resolves
 * name, title, phone, email and the office address server-side — the office
 * needs a users -> user_branches -> branches join, and it returns null rather
 * than guessing when the signer covers several branches (§3.2).
 *
 * Nulls fall back here, not on the server, because COMPANY_INFO is a frontend
 * constant. The name fallback deliberately names nobody rather than echoing an
 * id: this previously rendered `Rep (user: usr-a1b2c3)` straight into a client
 * letter.
 *
 * 'Account Manager' is the flat default title — the old role→title map is gone.
 * Every sales-side role signed as Account Manager anyway, and a rep whose real
 * title differs now sets it in Settings → Mine.
 */
function resolveSigner(facts: ProposalSignerFacts | undefined): ProposalSigner {
  return {
    name: facts?.name ?? 'Your Juniper Representative',
    title: facts?.title ?? 'Account Manager',
    phone: facts?.phone ?? COMPANY_INFO.phone,
    email: facts?.email ?? COMPANY_INFO.email,
    branchAddress: facts?.branchAddress ?? COMPANY_INFO.address,
  }
}

/**
 * Delete a lead-scoped proposal document attachment (C1-1).
 * Invalidates ['lead-attachments', leadId] so the slot refetches immediately.
 */
export function useDeleteLeadAttachment(leadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (attachmentId: string) =>
      estimatingApi.deleteLeadAttachment(leadId, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-attachments', leadId] })
    },
  })
}

export interface ProposalDocumentResult {
  /** True only when every query needed to render a complete document has resolved. */
  ready: boolean
  /** True while any underlying query is still in flight. */
  loading: boolean
  /** The proposal could not be loaded (bad id, deleted, or not permitted). */
  notFound: boolean
  lead: Lead | undefined
  /** WS4: estimate is optional — proposals can exist without an approved estimate. */
  estimate: Estimate | null | undefined
  /** Null until `ready`. */
  formState: ProposalFormState | null
  /** Persisted chapter order (body chapters only). null = natural default order. */
  chapterOrder: string[] | null
  /** Resolved signer for the intro letter and thank-you page. */
  signer: ProposalSigner
  /** Unfiltered roster — the org chart resolves its nodes against this. */
  allTeamMembers: TeamMember[]
  /** Filtered to the rep's Meet Our Team picks. */
  teamMembers: TeamMember[]
  executiveTeamMembers: TeamMember[]
  clientReferences: ClientReference[]
  portfolioProperties: PortfolioProperty[]
}

export function useProposalDocument(id: string | null): ProposalDocumentResult {
  const { data: proposal, isLoading: loadingProposal, isError } = useProposal(id)
  const { data: lead, isLoading: loadingLead } = useLead(proposal?.leadId ?? null)
  const { data: estimate, isLoading: loadingEstimate } = useEstimate(
    proposal?.estimateId ?? null,
  )

  const { data: allTeamMembers = [], isLoading: loadingTeam } = useTeamMembers()
  const { data: executiveRoster = [], isLoading: loadingExec } = useTeamMembers({
    teamType: 'executive',
  })
  const { data: allClientRefs = [], isLoading: loadingRefs } = useClientReferences()
  const { data: allPortfolio = [], isLoading: loadingPortfolio } = usePortfolio()

  // Part of the readiness gate on purpose. The signer's name is printed on the
  // letter; if Chromium captured before this resolved, the PDF would go out
  // signed "Your Juniper Representative" instead of the rep who sent it.
  //
  // This is proposal-scoped rather than a lookup into GET /api/users because
  // the render-scoped token is admitted only on this proposal's own routes —
  // reading the user directory from the print route 403s.
  const { data: signerFacts, isLoading: loadingSigner } = useProposalSigner(id)

  const loading =
    loadingProposal ||
    loadingLead ||
    loadingEstimate ||
    loadingTeam ||
    loadingExec ||
    loadingRefs ||
    loadingPortfolio ||
    loadingSigner

  // W4: estimate is optional — a proposal without an approved estimate is valid.
  // Gating on !!estimate blocked estimate-less proposals from ever rendering.
  const ready = !!proposal && !!lead && !loading
  const signer = resolveSigner(signerFacts)

  if (!ready || !proposal) {
    return {
      ready: false,
      loading,
      notFound: isError || (!loadingProposal && !!id && !proposal),
      lead,
      estimate,
      formState: null,
      chapterOrder: null,
      signer,
      allTeamMembers,
      teamMembers: [],
      executiveTeamMembers: [],
      clientReferences: [],
      portfolioProperties: [],
    }
  }

  const formState: ProposalFormState = {
    sections: proposal.sections.filter((s): s is OptionalSection =>
      (OPTIONAL_SECTION_KEYS as string[]).includes(s),
    ),
    orgChart: proposal.orgChart,
    startupPlan: proposal.startupPlan,
    teamMemberIds: proposal.teamMemberIds,
    executiveTeamMemberIds: proposal.executiveTeamMemberIds,
    clientReferenceIds: proposal.clientReferenceIds,
    portfolioPropertyIds: proposal.portfolioPropertyIds,
    signerUserId: proposal.signerUserId,
  }

  const teamMemberIdSet = new Set(proposal.teamMemberIds)
  const executiveIdSet = new Set(proposal.executiveTeamMemberIds)
  const clientRefIdSet = new Set(proposal.clientReferenceIds)
  const portfolioIdSet = new Set(proposal.portfolioPropertyIds)

  return {
    ready: true,
    loading: false,
    notFound: false,
    lead,
    estimate,
    formState,
    chapterOrder: proposal.chapterOrder,
    signer,
    allTeamMembers,
    teamMembers: allTeamMembers.filter((m) => teamMemberIdSet.has(m.id)),
    executiveTeamMembers: executiveRoster.filter((m) => executiveIdSet.has(m.id)),
    clientReferences: allClientRefs.filter((r) => clientRefIdSet.has(r.id)),
    portfolioProperties: allPortfolio.filter((p) => portfolioIdSet.has(p.id)),
  }
}
