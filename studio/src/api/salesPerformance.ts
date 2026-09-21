import { apiClient } from './client'
import type {
  SalesPerformanceSummary,
  WonDeal,
  LostDeal,
  SalesPerformanceFilters,
} from '@/types/sales-performance'

function buildQuery(filters?: SalesPerformanceFilters): string {
  const qs = new URLSearchParams()
  if (filters?.user_id) qs.set('user_id', filters.user_id)
  if (filters?.start_date) qs.set('start_date', filters.start_date)
  if (filters?.end_date) qs.set('end_date', filters.end_date)
  const q = qs.toString()
  return q ? `?${q}` : ''
}

export const salesPerformanceApi = {
  getReps: () =>
    apiClient.get<{ id: string; name: string; email: string }[]>('/sales-performance/reps'),

  getSummary: (filters?: SalesPerformanceFilters) =>
    apiClient.get<SalesPerformanceSummary>(`/sales-performance/summary${buildQuery(filters)}`),

  getWonDeals: (filters?: SalesPerformanceFilters) =>
    apiClient.get<WonDeal[]>(`/sales-performance/won-deals${buildQuery(filters)}`),

  getLostDeals: (filters?: SalesPerformanceFilters) =>
    apiClient.get<LostDeal[]>(`/sales-performance/lost-deals${buildQuery(filters)}`),
}
