// ---------------------------------------------------------------------------
// Beam / Attentive takeoff — React Query layer.
//
// `generate` is billable, so it gets no optimistic update and no retry: the
// mutation either succeeded at Attentive or it did not, and the refetched
// server state is the only thing worth showing.
// ---------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { beamApi } from '@/api/estimating'
import type { BeamRequest } from '@/api/estimating'

export const BEAM_KEY = 'beam-takeoff'

/** The estimate's current takeoff request with its outputs, or null if none exists. */
export function useBeamTakeoff(estimateId: string) {
  return useQuery<BeamRequest | null>({
    queryKey: [BEAM_KEY, 'estimate', estimateId],
    queryFn: async () => {
      const latest = await beamApi.forEstimate(estimateId)
      return latest ? await beamApi.get(latest.id) : null
    },
  })
}

export function useCreateBeamDraft(estimateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (address: string) => beamApi.createDraft(estimateId, address),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BEAM_KEY, 'estimate', estimateId] }),
  })
}

export function useGenerateBeamTakeoff(estimateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (beamRequestId: string) => beamApi.generate(beamRequestId),
    retry: false,
    onSuccess: () => qc.invalidateQueries({ queryKey: [BEAM_KEY, 'estimate', estimateId] }),
  })
}

export function useAcceptBeamChanges(estimateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (beamRequestId: string) => beamApi.acceptChanges(beamRequestId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BEAM_KEY, 'estimate', estimateId] }),
  })
}
