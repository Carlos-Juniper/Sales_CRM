import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { bidsApi, usersApi, dashboardApi, type CreateBidPayload } from '@/api/bids'
import { useUIStore } from '@/store/uiStore'
import type { Bid } from '@/types'

export const BIDS_KEY = 'bids'
export const USERS_KEY = 'users'
export const DASHBOARD_KEY = 'dashboard'

export function useBids() {
  return useQuery({
    queryKey: [BIDS_KEY],
    queryFn: () => bidsApi.list(),
    staleTime: 60_000,
  })
}

export function useBidByLeadId(leadId: string | null) {
  return useQuery({
    queryKey: [BIDS_KEY, 'lead', leadId],
    queryFn: async () => {
      const results = await bidsApi.list(undefined, leadId!)
      return results[0] ?? null
    },
    enabled: !!leadId,
    staleTime: 30_000,
  })
}

export function useCreateBid() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (body: CreateBidPayload) => bidsApi.create(body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: [BIDS_KEY] })
      if (variables.lead_id) {
        qc.invalidateQueries({ queryKey: [BIDS_KEY, 'lead', variables.lead_id] })
      }
      toast('Bid created', { variant: 'success' })
    },
    onError: () => toast('Failed to create bid', { variant: 'error' }),
  })
}

export function useUpdateBid() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Bid> }) => bidsApi.patch(id, body),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: [BIDS_KEY] })
      if (updated.lead_id) {
        qc.invalidateQueries({ queryKey: [BIDS_KEY, 'lead', updated.lead_id] })
      }
      toast('Bid updated', { variant: 'success' })
    },
    onError: () => toast('Update failed', { variant: 'error' }),
  })
}

export function useUsers(role?: string, branchId?: string) {
  return useQuery({
    queryKey: [USERS_KEY, role, branchId],
    queryFn: () => usersApi.list(role, branchId),
    staleTime: 300_000,
  })
}

export function useInsideSalesDashboard() {
  return useQuery({
    queryKey: [DASHBOARD_KEY, 'inside-sales'],
    queryFn: dashboardApi.insideSales,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}
