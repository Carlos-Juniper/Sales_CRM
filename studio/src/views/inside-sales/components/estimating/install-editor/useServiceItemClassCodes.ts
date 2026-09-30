// Handoff 55 §5 — a service line's materials-search prefilter: the item class
// codes of its catalog service's category (else the section's category),
// read from the cached install service catalog.

import { useMemo } from 'react'
import { useServiceCatalog } from '@/hooks/useServiceCatalog'
import { serviceItemClassCodes } from '@/lib/estimating/materialSearch'

export function useServiceItemClassCodes(
  serviceId: string | null | undefined,
  sectionCategoryId: string | null,
): number[] | null {
  const { data } = useServiceCatalog('install')
  return useMemo(
    () => serviceItemClassCodes(serviceId, sectionCategoryId, data ?? []),
    [serviceId, sectionCategoryId, data],
  )
}
