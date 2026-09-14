import { useQuery } from '@tanstack/react-query'
import { propertiesApi } from '@/api/estimating'
import type { Property } from '@/types/estimating'

/**
 * Fetch a single property by id.
 *
 * Returns null when id is null/undefined (disabled query).
 * Used by intake modals to pre-select a property when a crmLead carries a
 * property_id (WS1 lead ↔ property linkage).
 */
export function useProperty(id: string | null | undefined) {
  return useQuery<Property | null>({
    queryKey: ['property', id],
    queryFn: async () => {
      if (!id) return null
      // propertiesApi.list returns all properties matching a search term.
      // For a direct id lookup, search by id and find the exact match.
      const results = await propertiesApi.list(id)
      return results.find((p) => p.id === id) ?? null
    },
    enabled: !!id,
    staleTime: 5 * 60_000,
  })
}
