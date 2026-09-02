// ---------------------------------------------------------------------------
// Crew-rate resolution for the Margin Analysis panel (Slice 11b, §2.3 / §2.6).
//
// A loaded crew rate feeds maintenance margin DIRECTLY (hours × rate → cost →
// margin). A wrong-but-plausible rate produces a wrong-but-plausible margin an
// approver then approves — so the rule is LOUD FAILURE over a confident wrong
// number. There is NO invented default here: the old
// `MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR = 18_000` demo constant is gone as a
// silent source of truth.
//
// Resolution order (frozen wins → live → null):
//   1. `estimate.crewRateCentsPerHour` — the frozen snapshot captured at
//      submission (Slice 7). When present (review/pending_approval/approved),
//      it WINS: a later live branch-rate change must not move a frozen
//      estimate's displayed margin (§2.6 snapshot stability).
//   2. else the LIVE branch rate from GET /api/settings/branch/{aspireBranchId}.
//   3. else `null` → the panel refuses to show a number.
// ---------------------------------------------------------------------------

import type { Estimate } from '@/types/estimating'
import { useBranchSettings } from './useBranchSettings'

export type CrewRateSource = 'snapshot' | 'live' | 'none'

export interface ResolvedCrewRate {
  /** Loaded crew rate in cents/hr, or null when none is configured. */
  crewRateCents: number | null
  /** Where the rate came from — snapshot (frozen) > live (branch) > none. */
  source: CrewRateSource
  /** The live branch rate resolved for the estimate's branch (null if unset). */
  liveRateCents: number | null
  /** True while the live branch read is in flight (only fetched when no snapshot). */
  isLoading: boolean
}

/**
 * Resolve the crew rate the Margin Analysis panel should price with.
 *
 * The frozen snapshot short-circuits the live read: when the estimate already
 * carries a snapshot we do NOT enable the branch query at all, so the live rate
 * cannot leak into a frozen estimate's number even mid-fetch.
 */
export function useResolvedCrewRate(estimate: Estimate | null): ResolvedCrewRate {
  const snapshot =
    estimate && estimate.crewRateCentsPerHour != null ? estimate.crewRateCentsPerHour : null

  // Only read the live branch rate when there is no frozen snapshot to honor.
  const branchId =
    snapshot === null && estimate?.aspireBranchId != null ? estimate.aspireBranchId : undefined
  const { data: branch, isLoading } = useBranchSettings(branchId)
  const liveRateCents = branch?.crewRateCentsPerHour ?? null

  if (snapshot !== null) {
    return { crewRateCents: snapshot, source: 'snapshot', liveRateCents, isLoading: false }
  }
  if (liveRateCents !== null) {
    return { crewRateCents: liveRateCents, source: 'live', liveRateCents, isLoading }
  }
  return { crewRateCents: null, source: 'none', liveRateCents, isLoading }
}
