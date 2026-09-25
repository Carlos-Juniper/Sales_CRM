import { apiClient } from './client'
import type {
  Commission,
  CommissionSummary,
  CommissionRep,
  CommissionFilters,
  CommissionPayoutSchedule,
} from '@/types/commissions'

export const commissionsApi = {
  getSummary: (filters?: CommissionFilters) => {
    const qs = new URLSearchParams()
    if (filters?.user_id) qs.set('user_id', filters.user_id)
    if (filters?.start_date) qs.set('start_date', filters.start_date)
    if (filters?.end_date) qs.set('end_date', filters.end_date)
    const q = qs.toString()
    return apiClient.get<CommissionSummary>(`/commissions/summary${q ? `?${q}` : ''}`)
  },

  list: (filters?: CommissionFilters) => {
    const qs = new URLSearchParams()
    if (filters?.user_id) qs.set('user_id', filters.user_id)
    if (filters?.status) qs.set('status', filters.status)
    if (filters?.estimate_type) qs.set('estimate_type', filters.estimate_type)
    if (filters?.start_date) qs.set('start_date', filters.start_date)
    if (filters?.end_date) qs.set('end_date', filters.end_date)
    const q = qs.toString()
    return apiClient.get<Commission[]>(`/commissions/list${q ? `?${q}` : ''}`)
  },

  markPaid: (commissionId: string, paymentPeriod: string) =>
    apiClient.post<{ success: boolean }>(`/commissions/${commissionId}/mark-paid`, {
      payment_period: paymentPeriod,
    }),

  markInstallmentPaid: (installmentId: string) =>
    apiClient.post<{ success: boolean }>(`/commissions/installments/${installmentId}/mark-paid`, {}),

  // start_date/end_date select deals by close date. When either is set, the
  // API skips the close-year clip, so this client does not send year.
  getPayoutSchedule: (params?: { user_id?: string; start_date?: string; end_date?: string }) => {
    const qs = new URLSearchParams()
    if (params?.user_id) qs.set('user_id', params.user_id)
    if (params?.start_date) qs.set('start_date', params.start_date)
    if (params?.end_date) qs.set('end_date', params.end_date)
    const q = qs.toString()
    return apiClient.get<CommissionPayoutSchedule>(`/commissions/payout-schedule${q ? `?${q}` : ''}`)
  },

  getReps: () => apiClient.get<CommissionRep[]>('/commissions/reps'),
}
