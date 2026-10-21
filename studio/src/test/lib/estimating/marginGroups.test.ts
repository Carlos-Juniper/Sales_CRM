import { describe, expect, it } from 'vitest'
import { roundedSharePercents, resolveMarginGroup } from '@/lib/estimating/marginGroups'

describe('roundedSharePercents', () => {
  it('splits a three-way tie 34 / 33 / 33 so the integers sum to 100', () => {
    expect(roundedSharePercents([1, 1, 1], 3)).toEqual([34, 33, 33])
  })

  it('returns zeros when the contract is zero', () => {
    expect(roundedSharePercents([0, 0, 0, 0], 0)).toEqual([0, 0, 0, 0])
  })
})

describe('resolveMarginGroup', () => {
  it('maps small-area mowing onto Mowing', () => {
    expect(resolveMarginGroup('Small Area / Island Production Mowing')).toBe('Mowing')
    expect(resolveMarginGroup('Small Area Island Production Mowing')).toBe('Mowing')
  })

  it('does not invent a group for bed maintenance, irrigation, or seasonal color', () => {
    expect(resolveMarginGroup('Detail / Bed Maintenance')).toBeNull()
    expect(resolveMarginGroup('Irrigation Inspection')).toBeNull()
    expect(resolveMarginGroup('Seasonal Color Rotation')).toBeNull()
  })

  it('rejects an explicit group outside the four names', () => {
    expect(resolveMarginGroup('Mowing', null, 'Turf')).toBeNull()
  })
})
