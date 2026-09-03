import { useQuery } from '@tanstack/react-query'
import { settingsApi, type ManageableBranch } from '@/api/settings'

export const BRANCH_LIST_KEY = 'settings-branches'

/**
 * The operating branches the current user may manage (branch-picker source).
 *
 * Server state only — TanStack Query owns caching/synchronisation; the list is
 * scoped + roster-filtered server-side, so consumers render whatever comes back.
 */
export function useBranchList() {
  return useQuery<ManageableBranch[]>({
    queryKey: [BRANCH_LIST_KEY],
    queryFn: settingsApi.branches,
    staleTime: 5 * 60_000,
  })
}
