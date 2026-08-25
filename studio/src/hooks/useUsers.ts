import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersApi } from '@/api/bids'
import type { User } from '@/types'

// Matches USERS_KEY in useBids.ts — shares the TanStack Query cache.
const USERS_KEY = 'users'

export function useUsers(filters?: { role?: string; branch_id?: string }) {
  const query = useQuery({
    queryKey: [USERS_KEY, filters],
    queryFn: () => usersApi.list(filters?.role, filters?.branch_id),
    staleTime: 300_000,
  })

  const findUser = useCallback(
    (id: string | null | undefined): User | undefined =>
      id ? query.data?.find((u) => u.id === id) : undefined,
    [query.data],
  )

  return { ...query, findUser }
}

export function resetUsersCache(): void {
  // No-op — TanStack Query owns the cache. Kept as a test-seam stub.
}
