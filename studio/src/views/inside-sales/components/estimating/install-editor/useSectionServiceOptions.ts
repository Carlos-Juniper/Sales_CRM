// ---------------------------------------------------------------------------
// Handoff 55 §4 — the services a section's "Add service" picker offers, read
// from the cached install service catalog (GET /api/estimating/service-catalog).
// ---------------------------------------------------------------------------

import { useMemo } from 'react'
import type { EstimateSection } from '@/types/estimating'
import { useServiceCatalog } from '@/hooks/useServiceCatalog'
import { serviceOptionsForSection } from '@/lib/estimating/installCatalog'

export function useSectionServiceOptions(section: Pick<EstimateSection, 'serviceCategoryId'>) {
  const { data: categories, isLoading, isError } = useServiceCatalog('install')
  const categoryId = section.serviceCategoryId
  const groups = useMemo(
    () => serviceOptionsForSection({ serviceCategoryId: categoryId }, categories ?? []),
    [categoryId, categories],
  )
  const unavailable = isError || (!isLoading && categories === undefined)
  return { groups, isLoading, unavailable }
}
