import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  settingsApi,
  type AdminUser,
  type AuthorizeUserBody,
  type DirectoryCandidate,
  type UserAdminPatch,
} from '@/api/settings'
import { ApiError } from '@/api/client'
import { useUIStore } from '@/store/uiStore'

// Query keys — module constants so mutations invalidate exactly what the reads
// populate (CLAUDE.md §2: React Query owns server state).
export const USER_ADMIN_LIST_KEY = 'user-admin-list'
export const USER_DIRECTORY_KEY = 'user-directory-search'

/** Current users for the §2.8 admin list (inactive rows retained, historical). */
export function useUserList() {
  return useQuery<AdminUser[]>({
    queryKey: [USER_ADMIN_LIST_KEY],
    queryFn: () => settingsApi.listUsers(),
    staleTime: 30_000,
  })
}

/**
 * M365 directory typeahead. Only fires for a query of >= 2 chars (mirrors the
 * server's blank/short-query short-circuit); the debouncing is the caller's —
 * React Query caches per distinct `q` so repeated picks don't re-hit Graph.
 */
export function useDirectorySearch(q: string) {
  const trimmed = q.trim()
  return useQuery<DirectoryCandidate[]>({
    queryKey: [USER_DIRECTORY_KEY, trimmed],
    queryFn: () => settingsApi.searchDirectory(trimmed),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  })
}

/**
 * Authorize a directory-picked person. The sales hard-block is a real 422 from
 * the server carrying the EXACT §2.8 copy — we do NOT toast it (the form renders
 * it inline next to the Link Aspire Rep action). onError surfaces the message via
 * onBlocked so the caller can branch on the 422; other failures toast generically.
 */
export function useAuthorizeUser(opts?: {
  onBlocked?: (message: string) => void
  onDone?: () => void
}) {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (body: AuthorizeUserBody) => settingsApi.authorizeUser(body),
    onError: (err) => {
      // 422 = the sales aspire_rep_id hard-block; hand the verbatim copy up.
      if (err instanceof ApiError && err.status === 422) {
        opts?.onBlocked?.(err.message)
        return
      }
      toast('Could not authorize user', { variant: 'error' })
    },
    onSuccess: () => {
      toast('User authorized', { variant: 'success' })
      opts?.onDone?.()
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [USER_ADMIN_LIST_KEY] }),
  })
}

/** Patch a user's role / branches / active flag; invalidate the list on settle. */
export function useUpdateUser(opts?: { onDone?: () => void }) {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: UserAdminPatch }) =>
      settingsApi.updateUser(userId, body),
    onError: (err) => {
      // A role→sales PATCH can also hit the §2.8 hard-block.
      const msg =
        err instanceof ApiError && err.status === 422
          ? err.message
          : 'Could not update user'
      toast(msg, { variant: 'error' })
    },
    onSuccess: () => {
      toast('User updated', { variant: 'success' })
      opts?.onDone?.()
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [USER_ADMIN_LIST_KEY] }),
  })
}

/**
 * Link a user's Aspire rep from their email (the action the §2.8 block copy
 * points at). A miss re-raises the same 422 copy through onBlocked.
 */
export function useLinkAspireRep(opts?: {
  onBlocked?: (message: string) => void
  onDone?: () => void
}) {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (userId: string) => settingsApi.linkAspireRep(userId),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        opts?.onBlocked?.(err.message)
        return
      }
      toast('Could not link Aspire rep', { variant: 'error' })
    },
    onSuccess: () => {
      toast('Aspire rep linked', { variant: 'success' })
      opts?.onDone?.()
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [USER_ADMIN_LIST_KEY] }),
  })
}
