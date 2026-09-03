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

  // 1. Attach distance to each branch.
  const withDistance = branches.map((b) => ({
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
    const key = branch.address.trim().toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(branch)
    }
    if (deduped.length === n) break
  }

  return deduped
}
