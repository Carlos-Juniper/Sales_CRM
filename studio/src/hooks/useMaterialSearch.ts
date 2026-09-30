// ---------------------------------------------------------------------------
// Handoff 55 §5 — materials search for the install grid's Add item combobox.
// Query-key model: useManagementCompanySearch (hooks/useManagementCompanies).
// Keyset-paged via `nextCursor`; page size clamped to 100; the caller passes
// an already-debounced term (useDebouncedValue below, 300 ms).
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { estimatingConfigApi } from '@/api/estimating'
import {
  MATERIAL_SEARCH_DEBOUNCE_MS,
  MATERIAL_SEARCH_DEFAULT_LIMIT,
  clampMaterialLimit,
} from '@/lib/estimating/materialSearch'

export const MATERIALS_KEY = 'estimating-materials'

export function useMaterialSearch(
  term: string,
  itemClassCodes: number[] | null,
  limit: number = MATERIAL_SEARCH_DEFAULT_LIMIT,
) {
  const q = term.trim()
  const pageSize = clampMaterialLimit(limit)
  return useInfiniteQuery({
    queryKey: [MATERIALS_KEY, 'search', q, itemClassCodes?.join(',') ?? 'all', pageSize],
    queryFn: ({ pageParam }) =>
      estimatingConfigApi.searchMaterials({ q, itemClassCodes, limit: pageSize, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: q.length >= 1,
    staleTime: 30_000,
  })
}

/** `value`, settled for `delayMs` (default 300 ms) before it updates. */
export function useDebouncedValue<T>(value: T, delayMs: number = MATERIAL_SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return settled
}
