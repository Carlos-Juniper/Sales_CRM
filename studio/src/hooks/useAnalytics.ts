import { useQuery } from '@tanstack/react-query'
import { analyticsApi } from '@/api/analytics'

export const ANALYTICS_KEY = 'analytics'

export function useRevenueAnalytics() {
  return useQuery({
    queryKey: [ANALYTICS_KEY, 'revenue'],
    queryFn: analyticsApi.getRevenueAnalytics,
    staleTime: 60_000,
  })
}
