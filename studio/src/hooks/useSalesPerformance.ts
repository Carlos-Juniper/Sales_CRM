import { useQuery } from '@tanstack/react-query'
import { salesPerformanceApi } from '@/api/salesPerformance'
import type { SalesPerformanceFilters } from '@/types/sales-performance'

export const SALES_PERFORMANCE_KEY = 'sales-performance'

export function useSalesPerformanceSummary(filters?: SalesPerformanceFilters) {
  return useQuery({
    queryKey: [SALES_PERFORMANCE_KEY, 'summary', filters],
    queryFn: () => salesPerformanceApi.getSummary(filters),
    staleTime: 30_000,
  })
}

export function useWonDeals(filters?: SalesPerformanceFilters) {
  return useQuery({
    queryKey: [SALES_PERFORMANCE_KEY, 'won', filters],
    queryFn: () => salesPerformanceApi.getWonDeals(filters),
    staleTime: 30_000,
  })
}

export function useLostDeals(filters?: SalesPerformanceFilters) {
  return useQuery({
    queryKey: [SALES_PERFORMANCE_KEY, 'lost', filters],
    queryFn: () => salesPerformanceApi.getLostDeals(filters),
    staleTime: 30_000,
  })
}
