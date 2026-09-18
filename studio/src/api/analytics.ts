import { apiClient } from './client'
import type { MonthlyRevenue, CrmAnalytics } from '@/types'

export const analyticsApi = {
  getRevenueAnalytics: () => apiClient.get<MonthlyRevenue[]>('/analytics/revenue'),
  getCrmAnalytics: (crmId: string) => apiClient.get<CrmAnalytics>(`/analytics/crm/${crmId}`),
}
