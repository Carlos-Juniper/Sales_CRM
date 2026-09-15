// ---------------------------------------------------------------------------
// useApprovedEstimate — fetches any approved estimate for a lead and exposes
// canGenerateProposal, which is true whenever a lead exists (WS2: no estimate
// required to generate a proposal — the API no longer gates on estimate status).
//
// The hook still fetches the approved estimate so ProposalBuilder can display
// estimate-derived fields (pricing, line items) when one exists. It simply no
// longer gates canGenerateProposal on the estimate's presence.
//
// Two callers share one query key — the Generate Proposal button in
// LeadDetailPanel's action bar and BidTab's proposal section — so React Query
// dedupes them into a single request.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query'
import { estimatingApi } from '@/api/estimating'
import type { Lead } from '@/types'
import type { Estimate } from '@/types/estimating'

export interface ApprovedEstimateResult {
  estimate: Estimate | null
  isLoading: boolean
  /** True whenever a lead exists and its data is no longer loading (WS2). */
  canGenerateProposal: boolean
}

export function useApprovedEstimate(lead: Lead | null | undefined): ApprovedEstimateResult {
  // Always fetch when we have a lead — the estimate is optional but displayed
  // in ProposalBuilder when present.
  const { data, isLoading } = useQuery({
    queryKey: ['estimates', 'approved', lead?.id],
    queryFn: () => estimatingApi.list({ leadId: lead!.id, status: 'approved' }),
    enabled: !!lead?.id,
    staleTime: 30_000,
  })

  const estimate = data?.[0] ?? null

  return {
    estimate,
    isLoading: lead?.id ? isLoading : false,
    // WS2: any lead can generate a proposal — no estimate required.
    canGenerateProposal: !!lead && !isLoading,
  }
}
