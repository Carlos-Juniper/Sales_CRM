// ---------------------------------------------------------------------------
// React Query hooks for individual estimates + the queue list.
//
// This is the ONE source of server-state truth for "the estimate open in the
// Estimating workspace" — the shell (useEstimatingShell) reads it by id from
// the URL and never holds a detached snapshot in local state. See
// EstimatingPage.tsx / useEstimatingShell.ts for how the shell wires this in.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query'
import { estimatingApi, type ListEstimatesParams } from '@/api/estimating'

export const ESTIMATES_KEY = 'estimates'

/** One estimate, by id. `null`/`undefined` id means "nothing open" — the query stays disabled. */
export function useEstimate(estimateId: string | null | undefined) {
  return useQuery({
    queryKey: [ESTIMATES_KEY, estimateId],
    queryFn: () => estimatingApi.get(estimateId!),
    enabled: !!estimateId,
  })
}

/** The Estimate Queue's worklist — branch/role scope is enforced server-side (BRD I-9.5). */
export function useEstimates(params?: ListEstimatesParams) {
  return useQuery({
    queryKey: [ESTIMATES_KEY, 'list', params ?? null],
    queryFn: () => estimatingApi.list(params),
  })
}
