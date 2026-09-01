// ---------------------------------------------------------------------------
// ProposalPrintRoute — bare shell for headless PDF rendering
//
// Rendered at /proposals/:id/print (no auth guard — the API endpoints gate
// access via session or render token). No nav, no toolbar, no Back button.
//
// Readiness gate: sets window.__PROPOSAL_READY__ = true once fonts and all
// <img> elements inside #proposal-preview have decoded. Chromium's headless
// renderer (or any PDF service) polls this flag before capturing.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  useProposal,
  useTeamMembers,
  useClientReferences,
  usePortfolio,
} from '@/hooks/useProposals'
import { useLead } from '@/hooks/useLeads'
import { useEstimate } from '@/hooks/useEstimate'
import { ProposalPreview } from './ProposalPreview'
import type { ProposalFormState } from './ProposalBuilder'
import type { OptionalSection } from '@/types/proposal'

const OPTIONAL_SECTION_KEYS: OptionalSection[] = [
  'startup_plan_30_60_90',
  'juniper_sync',
  'juniper_mapping',
  'meet_our_team_executive',
]

export default function ProposalPrintRoute(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  // ?autoprint=1 is set by the in-app "Print" button. The headless renderer
  // never sets it — it polls __PROPOSAL_READY__ and calls page.pdf() instead.
  const autoPrint = searchParams.get('autoprint') === '1'

  // Mark <body> so print-specific global CSS can target this route.
  useEffect(() => {
    document.body.dataset.printRoute = 'true'
    return () => {
      delete document.body.dataset.printRoute
    }
  }, [])

  const { data: proposal, isLoading: loadingProposal } = useProposal(id ?? null)
  const { data: lead, isLoading: loadingLead } = useLead(proposal?.leadId ?? null)
  const { data: estimate, isLoading: loadingEstimate } = useEstimate(proposal?.estimateId ?? null)

  // Config data needed by ProposalPreview
  const { data: allTeamMembers = [], isLoading: loadingTeam } = useTeamMembers()
  const { data: executiveTeamMembers = [], isLoading: loadingExec } = useTeamMembers({ teamType: 'executive' })
  const { data: allClientRefs = [], isLoading: loadingRefs } = useClientReferences()
  const { data: allPortfolio = [], isLoading: loadingPortfolio } = usePortfolio()

  // Everything ProposalPreview needs before it renders anything but a hidden
  // placeholder. `proposal` alone is NOT enough: lead and estimate are fetched
  // from ids *on* the proposal, so they resolve a round-trip later. Gating the
  // readiness flag on `proposal` alone let Chromium capture — and the autoprint
  // path print — the hidden placeholder, producing a blank one-page PDF.
  const dataReady =
    !!proposal && !!lead && !!estimate &&
    !loadingProposal && !loadingLead && !loadingEstimate &&
    !loadingTeam && !loadingExec && !loadingRefs && !loadingPortfolio

  // Readiness gate
  useEffect(() => {
    if (!dataReady) return
    let cancelled = false
    const settle = async () => {
      // The effect runs after commit, but wait one frame so layout has settled
      // and #proposal-preview's images are attached before we enumerate them.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const root = document.querySelector('#proposal-preview')
      if (!root) return
      await document.fonts.ready
      const imgs = Array.from(root.querySelectorAll('img'))
      await Promise.all(
        imgs.map((img) => img.decode().catch(() => undefined)),
      )
      if (cancelled) return
      ;(window as unknown as { __PROPOSAL_READY__?: boolean }).__PROPOSAL_READY__ = true
      if (autoPrint) {
        // rAF so the browser has committed a paint before the modal print
        // dialog freezes rendering.
        requestAnimationFrame(() => window.print())
      }
    }
    void settle()
    return () => {
      cancelled = true
    }
  }, [dataReady, autoPrint])

  if (!dataReady || !proposal || !lead || !estimate) {
    return <div style={{ display: 'none' }} />
  }

  // Map ProposalRequest → ProposalFormState
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

  // Resolve picks from config data
  const teamMemberIdSet = new Set(proposal.teamMemberIds)
  const executiveIdSet = new Set(proposal.executiveTeamMemberIds)
  const clientRefIdSet = new Set(proposal.clientReferenceIds)
  const portfolioIdSet = new Set(proposal.portfolioPropertyIds)

  const teamMembers = allTeamMembers.filter((m) => teamMemberIdSet.has(m.id))
  const resolvedExecutiveMembers = executiveTeamMembers.filter((m) => executiveIdSet.has(m.id))
  const clientReferences = allClientRefs.filter((r) => clientRefIdSet.has(r.id))
  const portfolioProperties = allPortfolio.filter((p) => portfolioIdSet.has(p.id))

  return (
    <ProposalPreview
      formState={formState}
      lead={lead}
      estimate={estimate}
      onBack={() => undefined}
      allTeamMembers={allTeamMembers}
      teamMembers={teamMembers}
      executiveTeamMembers={resolvedExecutiveMembers}
      clientReferences={clientReferences}
      portfolioProperties={portfolioProperties}
    />
  )
}
