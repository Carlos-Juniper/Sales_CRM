import { describe, expect, it } from 'vitest'
import {
  echoedRegionChoice,
  nextRegionSelection,
  regionsFromCoverage,
} from '@/lib/proposal/regionFilter'
import type { BranchCoverageGroup } from '@/types/proposal'

const COVERAGE: BranchCoverageGroup[] = [
  {
    state: 'FL',
    stateName: 'Florida',
    regions: [
      { regionId: 'east-coast', regionName: 'East Coast', branches: ['Jupiter'] },
      { regionId: 'west-coast', regionName: 'West Coast', branches: ['Fort Myers'] },
      { regionId: '', regionName: '', branches: ['Houston'] },
    ],
  },
  {
    state: 'TX',
    stateName: 'Texas',
    regions: [{ regionId: 'west-coast', regionName: 'West Coast', branches: ['Austin'] }],
  },
]

const REGIONS = regionsFromCoverage(COVERAGE)

describe('regionsFromCoverage', () => {
  it('keeps named regions once, in first-seen order, and skips the blank bucket', () => {
    expect(REGIONS).toEqual([
      { regionId: 'east-coast', regionName: 'East Coast' },
      { regionId: 'west-coast', regionName: 'West Coast' },
    ])
  })

  it('returns nothing when coverage has not loaded', () => {
    expect(regionsFromCoverage(undefined)).toEqual([])
  })
})

describe('echoedRegionChoice', () => {
  it('preselects a single known region', () => {
    expect(echoedRegionChoice('west-coast', REGIONS)).toBe('west-coast')
  })

  it('leaves the switcher alone when the header is missing, all, or several ids', () => {
    expect(echoedRegionChoice(null, REGIONS)).toBeNull()
    expect(echoedRegionChoice('all', REGIONS)).toBeNull()
    expect(echoedRegionChoice('central,west-coast', REGIONS)).toBeNull()
  })

  it('waits until the region name is in the coverage list', () => {
    expect(echoedRegionChoice('west-coast', [])).toBeNull()
  })
})

describe('nextRegionSelection', () => {
  it('applies a readable single-region echo once', () => {
    expect(nextRegionSelection(false, null, 'west-coast', REGIONS)).toEqual({
      choice: 'west-coast',
      appliedEcho: 'west-coast',
    })
    expect(nextRegionSelection(false, 'west-coast', 'west-coast', REGIONS)).toBeNull()
  })

  it('does not override a choice the user already made', () => {
    expect(nextRegionSelection(true, null, 'west-coast', REGIONS)).toBeNull()
  })
})
