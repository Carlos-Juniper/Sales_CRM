// Generic id-set helpers (shared by CheckboxList, ProposalBuilder and
// MultiSelectFilter). Results are compared as sets, not by order or identity.
import { describe, it, expect } from 'vitest'
import {
  checkState,
  clearIds,
  countSelected,
  filterByText,
  selectIds,
  toggleId,
} from '@/lib/selection'

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b)

const ITEMS = [
  { id: 1, name: 'Naples' },
  { id: 2, name: 'North Port' },
  { id: 3, name: 'Sarasota' },
]
const byName = (i: { name: string }) => i.name

describe('filterByText', () => {
  it('keeps every item for a blank or whitespace query', () => {
    expect(filterByText(ITEMS, '', byName)).toEqual(ITEMS)
    expect(filterByText(ITEMS, '   ', byName)).toEqual(ITEMS)
  })

  it('matches a trimmed, case-insensitive substring', () => {
    expect(sorted(filterByText(ITEMS, ' N ', byName).map((i) => i.id))).toEqual([1, 2])
    expect(filterByText(ITEMS, 'SOTA', byName).map((i) => i.id)).toEqual([3])
    expect(filterByText(ITEMS, 'zzz', byName)).toEqual([])
  })
})

describe('toggleId', () => {
  it('adds a missing id and removes a present one', () => {
    expect(sorted(toggleId([1], 2))).toEqual([1, 2])
    expect(toggleId([1, 2], 1)).toEqual([2])
  })

  it('works for string ids', () => {
    expect(toggleId(['a'], 'b').sort()).toEqual(['a', 'b'])
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('selectIds / clearIds', () => {
  it('selects the given ids without duplicating existing ones', () => {
    expect(sorted(selectIds([3], [1, 3]))).toEqual([1, 3])
    expect(sorted(selectIds([1, 2], [2]))).toEqual([1, 2])
  })

  it('clears only the given ids, leaving hidden selections intact', () => {
    expect(sorted(clearIds([1, 2, 3, 99], [1, 2]))).toEqual([3, 99])
  })
})

describe('countSelected / checkState', () => {
  it('counts only selections within the given ids', () => {
    expect(countSelected([1, 99], [1, 2, 3])).toBe(1)
  })

  it('is none / some / all over the given ids', () => {
    expect(checkState([], [1, 2])).toBe('none')
    expect(checkState([3], [1, 2])).toBe('none')
    expect(checkState([1], [1, 2])).toBe('some')
    expect(checkState([1, 2, 3], [1, 2])).toBe('all')
  })

  it('is none for an empty id set', () => {
    expect(checkState([1], [])).toBe('none')
  })
})
