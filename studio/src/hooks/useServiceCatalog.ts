// ---------------------------------------------------------------------------
// Handoff 55 §3 — the install service catalog (categories → services →
// default items), read-only config cached like useEstimatingConfig.
//
// GET /api/estimating/service-catalog (backend PR #40) returns only active
// rows, sorted; the shapes are the backend's ServiceCategory / CatalogService /
// ServiceDefaultItem in types/estimating.ts. There is deliberately NO literal
// fallback: an unreachable catalog shows an unavailable state in the picker
// rather than an invented section list.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query'
import { estimatingConfigApi } from '@/api/estimating'
import type { EstimateType } from '@/types/estimating'

export const SERVICE_CATALOG_KEY = 'estimating-service-catalog'

export function useServiceCatalog(estimateType: EstimateType) {
  return useQuery({
    queryKey: [SERVICE_CATALOG_KEY, estimateType],
    queryFn: () => estimatingConfigApi.serviceCatalog(estimateType),
    staleTime: 5 * 60_000,
  })
}
