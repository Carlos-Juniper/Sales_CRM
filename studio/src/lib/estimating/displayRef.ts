/**
 * displayRef — the SINGLE source of the user-facing estimate identifier.
 *
 * Number continuity, not replacement (Melissa): the Aspire opportunity number
 * stays the identifier everyone sees/searches/quotes. Owning it internally means
 * that if Aspire is ever retired we keep serving those same numbers. Every
 * component renders this instead of reading `aspireNumber` directly, so a
 * pending/failed push shows a consistent chip rather than a blank.
 */
import type { AspireSyncStatus } from '@/types/estimating'

/** The minimal estimate shape displayRef/matchesRef need. */
export interface RefLike {
  id: string
  aspireNumber: string | null
  aspireSyncStatus?: AspireSyncStatus
}

export interface DisplayRef {
  /** What to render. */
  text: string
  /** Drives chip styling. */
  state: 'synced' | 'pending' | 'failed'
}

export function displayRef(e: RefLike): DisplayRef {
  // A number, once assigned, is always shown — but we surface the live sync
  // state so a lagging re-sync can still be indicated.
  if (e.aspireNumber) {
    return { text: e.aspireNumber, state: e.aspireSyncStatus === 'pending' ? 'pending' : e.aspireSyncStatus === 'failed' ? 'failed' : 'synced' }
  }
  if (e.aspireSyncStatus === 'failed') {
    return { text: 'Sync failed', state: 'failed' }
  }
  return { text: 'Pending sync…', state: 'pending' }
}

/**
 * Search predicate — the identifier box matches BOTH the internal id and the
 * Aspire number (case-insensitive, whitespace-trimmed). Empty query = no filter.
 */
export function matchesRef(e: RefLike, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystacks = [e.id, e.aspireNumber ?? '']
  return haystacks.some((h) => h.toLowerCase().includes(q))
}
