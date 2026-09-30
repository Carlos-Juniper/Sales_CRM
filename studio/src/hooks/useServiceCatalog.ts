// ---------------------------------------------------------------------------
// Handoff 55 §3 — the install service catalog (categories → services →
// default items), read-only config cached like useEstimatingConfig.
//
// TODO(h55-service-catalog): PROVISIONAL. GET /api/estimating/service-catalog
// is not built yet; the response shape (ServiceCategory in
// types/estimating.ts) is transcribed from the handoff and must be reconciled
// with the backend serializer when it lands. There is deliberately NO literal
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
