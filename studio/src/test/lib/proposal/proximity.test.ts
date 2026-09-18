// ---------------------------------------------------------------------------
// proximity.test.ts — unit tests for the haversine + dedupe helper
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { haversineDistanceMiles, nearestBranches, localBranchPicks } from '@/lib/proposal/proximity'
import type { BranchProfile } from '@/types/proposal'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fort Myers Install (1403) — 5880 Staley Road */
const FORT_MYERS_INSTALL: BranchProfile = {
  aspireBranchId: 1403,
  branchName: 'Fort Myers Install',
  city: 'Fort Myers',
  regionId: 'west-coast',
  address: '5880 Staley Road, Fort Myers, FL 33905',
  lat: 26.6519,
  lng: -81.7718,
}

/** Fort Myers Maintenance (3696) — same physical address as 1403 */
const FORT_MYERS_MAINTENANCE: BranchProfile = {
  aspireBranchId: 3696,
  branchName: 'Fort Myers Maintenance',
  city: 'Fort Myers',
  regionId: 'west-coast',
  address: '5880 Staley Road, Fort Myers, FL 33905',
  lat: 26.6519,
  lng: -81.7718,
}

/** Naples branch — ~35 miles south of Fort Myers */
const NAPLES: BranchProfile = {
  aspireBranchId: 2001,
  branchName: 'Naples',
  city: 'Naples',
  regionId: 'west-coast',
  address: '1234 Naples Way, Naples, FL 34103',
  lat: 26.1424,
  lng: -81.7948,
}

/** Sarasota branch — ~80 miles north of Fort Myers */
const SARASOTA: BranchProfile = {
  aspireBranchId: 2002,
  branchName: 'Sarasota',
  city: 'Sarasota',
  regionId: 'west-coast',
  address: '5678 Sarasota Blvd, Sarasota, FL 34230',
  lat: 27.3364,
  lng: -82.5307,
}

/** Orlando branch — ~100 miles east of Fort Myers */
const ORLANDO: BranchProfile = {
  aspireBranchId: 2003,
  branchName: 'Orlando',
  city: 'Orlando',
  regionId: 'central',
  address: '100 Orange Ave, Orlando, FL 32801',
  lat: 28.5383,
  lng: -81.3792,
}

/** Property in Fort Myers (same city as the two FM branches) */
const PROPERTY_FORT_MYERS = { lat: 26.6, lng: -81.8 }

// ---------------------------------------------------------------------------
// haversineDistanceMiles
// ---------------------------------------------------------------------------

describe('haversineDistanceMiles', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistanceMiles(26.6519, -81.7718, 26.6519, -81.7718)).toBe(0)
  })

  it('Fort Myers → Naples is roughly 35 miles', () => {
    const d = haversineDistanceMiles(
      FORT_MYERS_INSTALL.lat,
      FORT_MYERS_INSTALL.lng,
      NAPLES.lat,
      NAPLES.lng,
    )
    // Accepting ±10 miles tolerance given real geography
    expect(d).toBeGreaterThan(25)
    expect(d).toBeLessThan(45)
  })

  it('Fort Myers → Sarasota is roughly 80 miles', () => {
    const d = haversineDistanceMiles(
      FORT_MYERS_INSTALL.lat,
      FORT_MYERS_INSTALL.lng,
      SARASOTA.lat,
      SARASOTA.lng,
    )
    expect(d).toBeGreaterThan(65)
    expect(d).toBeLessThan(100)
  })

  it('distance is symmetric', () => {
    const d1 = haversineDistanceMiles(26.0, -80.0, 27.0, -81.0)
    const d2 = haversineDistanceMiles(27.0, -81.0, 26.0, -80.0)
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001)
  })
})

// ---------------------------------------------------------------------------
// nearestBranches
// ---------------------------------------------------------------------------

describe('nearestBranches', () => {
  it('returns empty array when no branches are provided', () => {
    expect(nearestBranches(26.6, -81.8, [], 3)).toEqual([])
  })

  it('returns the closest branch when n=1', () => {
    const result = nearestBranches(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [FORT_MYERS_INSTALL, NAPLES, SARASOTA, ORLANDO],
      1,
    )
    expect(result).toHaveLength(1)
    expect(result[0].aspireBranchId).toBe(1403) // Fort Myers Install is closest
  })

  it('returns 2–3 closest branches in order', () => {
    const result = nearestBranches(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [ORLANDO, SARASOTA, NAPLES, FORT_MYERS_INSTALL],
      3,
    )
    expect(result).toHaveLength(3)
    // Sorted by proximity: Fort Myers → Naples → Sarasota
    expect(result[0].aspireBranchId).toBe(1403)
    expect(result[1].aspireBranchId).toBe(2001) // Naples
    expect(result[2].aspireBranchId).toBe(2002) // Sarasota
  })

  // ── Key acceptance test: shared-address deduplication ──────────────────
  it('dedupes Fort Myers Install (1403) and Fort Myers Maintenance (3696) — same address → one entry', () => {
    const result = nearestBranches(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [FORT_MYERS_INSTALL, FORT_MYERS_MAINTENANCE, NAPLES, SARASOTA],
      3,
    )
    // Despite 4 input branches, 1403+3696 share "5880 Staley Road, Fort Myers, FL 33905"
    // so the result must have at most 3 entries and must NOT include both FM branches.
    const fmIds = result
      .filter((b) => [1403, 3696].includes(b.aspireBranchId))
      .map((b) => b.aspireBranchId)
    expect(fmIds).toHaveLength(1)
    // The lower aspireBranchId (1403) wins the tiebreaker
    expect(fmIds[0]).toBe(1403)
    // Total result is dedupe-capped at n=3, but we only have 3 unique addresses
    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('returns all branches when n > number of unique addresses', () => {
    const result = nearestBranches(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [FORT_MYERS_INSTALL, FORT_MYERS_MAINTENANCE, NAPLES],
      3,
    )
    // Two unique addresses → at most 2 results
    expect(result).toHaveLength(2)
  })

  it('address deduplication is case-insensitive', () => {
    const lowerCase: BranchProfile = {
      ...FORT_MYERS_MAINTENANCE,
      aspireBranchId: 9999,
      address: '5880 staley road, fort myers, fl 33905', // all lowercase
    }
    const result = nearestBranches(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [FORT_MYERS_INSTALL, lowerCase, NAPLES],
      3,
    )
    // Both have the same normalised address → only one should appear
    const fm = result.filter((b) => [1403, 9999].includes(b.aspireBranchId))
    expect(fm).toHaveLength(1)
  })

  it('handles a single branch correctly', () => {
    const result = nearestBranches(26.6, -81.8, [NAPLES], 3)
    expect(result).toHaveLength(1)
    expect(result[0].aspireBranchId).toBe(2001)
  })
})

// ---------------------------------------------------------------------------
// localBranchPicks
// ---------------------------------------------------------------------------

/** Corporate — no coordinates, like the real ungeocoded row. */
const CORPORATE: BranchProfile = {
  aspireBranchId: 9001,
  branchName: 'Corporate',
  city: 'Fort Myers',
  regionId: 'corporate',
  address: '100 Corporate Way, Fort Myers, FL 33912',
  lat: null,
  lng: null,
}

/** Bonita Springs — near Fort Myers. */
const BONITA_SPRINGS: BranchProfile = {
  aspireBranchId: 1500,
  branchName: 'Bonita Springs',
  city: 'Bonita Springs',
  regionId: 'west-coast',
  address: '200 Bonita Blvd, Bonita Springs, FL 34135',
  lat: 26.34,
  lng: -81.78,
}

describe('localBranchPicks', () => {
  it('falls back to plain proximity when the rep has no assigned branches', () => {
    const result = localBranchPicks(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [],
      [ORLANDO, SARASOTA, NAPLES, FORT_MYERS_INSTALL],
      3,
    )
    expect(result.map((b) => b.aspireBranchId)).toEqual([1403, 2001, 2002])
  })

  it("Angela G case: three assigned branches (incl. ungeocoded Corporate) all show, nearest-first, Corporate last", () => {
    const result = localBranchPicks(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [CORPORATE, FORT_MYERS_INSTALL, BONITA_SPRINGS],
      [ORLANDO, SARASOTA, NAPLES, FORT_MYERS_INSTALL, BONITA_SPRINGS, CORPORATE],
      3,
    )
    expect(result.map((b) => b.aspireBranchId)).toEqual([1403, 1500, 9001])
  })

  it('pads out to n with the nearest other branches when the rep holds fewer', () => {
    const result = localBranchPicks(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [FORT_MYERS_INSTALL],
      [ORLANDO, SARASOTA, NAPLES, FORT_MYERS_INSTALL, BONITA_SPRINGS],
      3,
    )
    expect(result).toHaveLength(3)
    // The rep's own branch always leads, then nearest fill picks.
    expect(result[0].aspireBranchId).toBe(1403)
    const fillIds = result.slice(1).map((b) => b.aspireBranchId)
    expect(fillIds).toEqual([1500, 2001]) // Bonita Springs, then Naples
  })

  it("doesn't duplicate an assigned branch when it also appears in the fill pool", () => {
    const result = localBranchPicks(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [FORT_MYERS_INSTALL],
      [FORT_MYERS_INSTALL, BONITA_SPRINGS, NAPLES],
      3,
    )
    const ids = result.map((b) => b.aspireBranchId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(1403)
  })

  it('caps at n when the rep is assigned more branches than the footer shows', () => {
    const result = localBranchPicks(
      PROPERTY_FORT_MYERS.lat,
      PROPERTY_FORT_MYERS.lng,
      [ORLANDO, SARASOTA, NAPLES, FORT_MYERS_INSTALL, BONITA_SPRINGS, CORPORATE],
      [],
      3,
    )
    expect(result).toHaveLength(3)
    // Nearest three of the rep's own branches win; the two furthest (Sarasota,
    // Orlando) and Corporate (ungeocoded, sorted after all geocoded ones) drop.
    expect(result.map((b) => b.aspireBranchId)).toEqual([1403, 1500, 2001])
  })
})
