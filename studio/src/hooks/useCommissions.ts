import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { commissionsApi } from '@/api/commissions'
import { useRole } from '@/hooks/useRole'
import { useUIStore } from '@/store/uiStore'
import type { CommissionFilters } from '@/types/commissions'

export const COMMISSIONS_KEY = 'commissions'

export function useCommissionSummary(filters?: CommissionFilters) {
  return useQuery({
    queryKey: [COMMISSIONS_KEY, 'summary', filters],
    queryFn: () => commissionsApi.getSummary(filters),
    staleTime: 30_000,
  })
}

export function useCommissionsList(filters?: CommissionFilters) {
  return useQuery({
    queryKey: [COMMISSIONS_KEY, 'list', filters],
    queryFn: () => commissionsApi.list(filters),
    staleTime: 30_000,
  })
}

export function useCommissionPayoutSchedule(params?: {
  user_id?: string
  start_date?: string
  end_date?: string
}) {
  return useQuery({
    queryKey: [
      COMMISSIONS_KEY,
      'payout-schedule',
      params?.user_id ?? null,
      params?.start_date ?? null,
      params?.end_date ?? null,
    ],
    queryFn: () => commissionsApi.getPayoutSchedule(params),
    staleTime: 30_000,
  })
}

export function useCommissionReps() {
  // GET /api/commissions/reps is 403 outside REP_SELECTOR_ROLES
  // (api/authz.py REP_VIEWER_ROLES). Leave the query disabled so non-viewers
  // never issue the request; summary and list auto-scope with no rep param.
  const { canViewRepSelector } = useRole()
  return useQuery({
    queryKey: [COMMISSIONS_KEY, 'reps'],
    queryFn: () => commissionsApi.getReps(),
    staleTime: 300_000,
    enabled: canViewRepSelector,
  })
}

export function useMarkCommissionPaid() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ commissionId, paymentPeriod }: { commissionId: string; paymentPeriod: string }) =>
      commissionsApi.markPaid(commissionId, paymentPeriod),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [COMMISSIONS_KEY] })
      toast('Commission marked as paid', { variant: 'success' })
    },
    onError: () => toast('Failed to mark commission as paid', { variant: 'error' }),
  })
}

export function useMarkInstallmentPaid() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (installmentId: string) => commissionsApi.markInstallmentPaid(installmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [COMMISSIONS_KEY] })
      toast('Installment marked as paid', { variant: 'success' })
    },
    onError: () => toast('Failed to mark installment as paid', { variant: 'error' }),
  })
}
