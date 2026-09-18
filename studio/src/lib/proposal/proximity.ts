// ---------------------------------------------------------------------------
// proximity.ts — branch-office proximity helpers for the
// "Your Local Landscape Experts" page (§2, page 3).
//
// Pure functions only — no React, no API calls — so they are unit-testable
// without any rendering setup.
// ---------------------------------------------------------------------------

import type { BranchProfile } from '@/types/proposal'

/**
 * Haversine distance between two lat/lng points, in miles.
 * Accuracy is sufficient for branch-proximity ranking (±0.1%).
 */
export function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3_958.8 // Earth radius in miles
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function addressKey(b: BranchProfile): string {
  return b.address.trim().toLowerCase()
}

/**
 * Return the `n` nearest BranchProfile entries to a given lat/lng,
 * deduped by address (case-insensitive trim) so that install/maintenance
 * branch pairs sharing one street address (e.g. 1403 + 3696 at 5880 Staley
 * Road) appear only once.
 *
 * When two branches share an address, the one with the lower
 * aspireBranchId wins (stable, deterministic sort).
 *
 * @param lat     Lead.lat (the property's latitude)
 * @param lng     Lead.lng (the property's longitude)
 * @param branches Active branches from useProposalConfig — already filtered
 *                 by the API to active + non-DO-NOT-USE + lat/lng populated.
 * @param n       How many to return (default 3).
 */
export function nearestBranches(
  lat: number,
  lng: number,
  branches: BranchProfile[],
  n = 3,
): BranchProfile[] {
  if (branches.length === 0) return []

  // 1. Attach distance to each branch. Ungeocoded offices (lat/lng null, e.g.
  //    a proposalId-scoped Corporate row) have no distance to rank by, so
  //    they're excluded here rather than passed to haversineDistanceMiles.
  const geocoded = branches.filter(
    (b): b is BranchProfile & { lat: number; lng: number } => b.lat != null && b.lng != null,
  )
  const withDistance = geocoded.map((b) => ({
    branch: b,
    distanceMiles: haversineDistanceMiles(lat, lng, b.lat, b.lng),
  }))

  // 2. Sort by distance ascending, then aspireBranchId ascending as a
  //    tiebreaker so deduplication below is deterministic.
  withDistance.sort((a, b) => {
    const diff = a.distanceMiles - b.distanceMiles
    if (diff !== 0) return diff
    return a.branch.aspireBranchId - b.branch.aspireBranchId
  })

  // 3. Dedupe by normalised address — keep the first occurrence (closest /
  //    lowest id) for each unique address.
  const seen = new Set<string>()
  const deduped: BranchProfile[] = []
  for (const { branch } of withDistance) {
    const key = addressKey(branch)
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(branch)
    }
    if (deduped.length === n) break
  }

  return deduped
}

/**
 * "Local Branches" footer picks for a proposal whose signer holds their own
 * assigned branches (via user_branches) — the footer should always show the
 * rep's own offices, not just whichever happen to be nearest the property.
 *
 * The footer always shows `n` offices:
 *  - The rep's assigned branches always appear, geocoded ones ordered
 *    nearest-to-farthest and any ungeocoded one (e.g. Corporate, which has no
 *    lat/lng) placed last since it has no distance to rank by.
 *  - If the rep is assigned fewer than `n`, the remaining slots are filled
 *    with the nearest other branches by distance to the property — e.g. a
 *    rep assigned to just one branch still fills out to 3 with their
 *    nearest neighboring offices, not a bare single-item footer.
 *  - Assigned branches beyond `n` are capped (nearest ones win); a rep
 *    covering eight branches still gets a 3-office footer, not eight.
 *
 * @param assignedBranches The signer's own branches (proposalId-scoped
 *                          /config/branches). Empty when there's no signer
 *                          yet or they hold none — the whole result then
 *                          falls back to a plain nearestBranches search.
 * @param allBranches      The full geocoded company roster, used only to
 *                          fill remaining slots.
 */
export function localBranchPicks(
  lat: number,
  lng: number,
  assignedBranches: BranchProfile[],
  allBranches: BranchProfile[],
  n = 3,
): BranchProfile[] {
  if (assignedBranches.length === 0) return nearestBranches(lat, lng, allBranches, n)

  const byAddress = new Map<string, BranchProfile>()
  for (const b of [...assignedBranches].sort((a, c) => a.aspireBranchId - c.aspireBranchId)) {
    const key = addressKey(b)
    if (!byAddress.has(key)) byAddress.set(key, b)
  }
  const geocoded: BranchProfile[] = []
  const ungeocoded: BranchProfile[] = []
  for (const b of byAddress.values()) {
    if (b.lat != null && b.lng != null) {
      geocoded.push(b)
    } else {
      ungeocoded.push(b)
    }
  }
  geocoded.sort(
    (a, b) =>
      haversineDistanceMiles(lat, lng, a.lat as number, a.lng as number) -
      haversineDistanceMiles(lat, lng, b.lat as number, b.lng as number),
  )

  const ordered = [...geocoded, ...ungeocoded].slice(0, n)
  if (ordered.length >= n) return ordered

  const shown = new Set(ordered.map(addressKey))
  const fillPool = allBranches.filter((b) => !shown.has(addressKey(b)))
  const fill = nearestBranches(lat, lng, fillPool, n - ordered.length)
  return [...ordered, ...fill]
}
