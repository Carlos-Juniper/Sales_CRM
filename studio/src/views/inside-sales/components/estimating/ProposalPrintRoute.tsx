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
import { useParams } from 'react-router-dom'
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

  // Mark <body> so print-specific global CSS can target this route.
  useEffect(() => {
    document.body.dataset.printRoute = 'true'
    return () => {
      delete document.body.dataset.printRoute
    }
  }, [])

  const { data: proposal, isLoading } = useProposal(id ?? null)
  const { data: lead } = useLead(proposal?.leadId ?? null)
  const { data: estimate } = useEstimate(proposal?.estimateId ?? null)

  // Config data needed by ProposalPreview
  const { data: allTeamMembers = [] } = useTeamMembers()
  const { data: executiveTeamMembers = [] } = useTeamMembers({ teamType: 'executive' })
  const { data: allClientRefs = [] } = useClientReferences()
  const { data: allPortfolio = [] } = usePortfolio()

  // Readiness gate — fires after proposal + lead + estimate are loaded
  useEffect(() => {
    if (!proposal || isLoading) return
    let cancelled = false
    const settle = async () => {
      await document.fonts.ready
      const imgs = Array.from(document.querySelectorAll('#proposal-preview img'))
      await Promise.all(
        imgs.map((img) =>
          (img as HTMLImageElement).decode().catch(() => undefined),
        ),
      )
      if (!cancelled) (window as unknown as { __PROPOSAL_READY__?: boolean }).__PROPOSAL_READY__ = true
    }
    void settle()
    return () => {
      cancelled = true
    }
  }, [proposal, isLoading])

  if (!proposal || !lead || !estimate) {
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
