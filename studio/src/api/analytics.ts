import { apiClient } from './client'
import type { MonthlyRevenue } from '@/types'

export const analyticsApi = {
  getRevenueAnalytics: () => apiClient.get<MonthlyRevenue[]>('/analytics/revenue'),
}
