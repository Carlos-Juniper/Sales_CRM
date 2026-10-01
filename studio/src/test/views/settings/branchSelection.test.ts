// H54 §7 — pure selection helpers behind BranchMultiSelect.
import { describe, it, expect } from 'vitest'
import {
  clearBranches,
  countSelected,
  filterBranches,
  headerState,
  selectBranches,
  toggleBranch,
} from '@/views/settings/company/users/branchSelection'

const BRANCHES = [
  { aspireBranchId: 1, branchName: 'Naples', city: null },
  { aspireBranchId: 2, branchName: 'North Port', city: null },
  { aspireBranchId: 3, branchName: 'Sarasota', city: null },
]

describe('filterBranches', () => {
  it('keeps every branch for a blank or whitespace query', () => {
    expect(filterBranches(BRANCHES, '')).toBe(BRANCHES)
    expect(filterBranches(BRANCHES, '   ')).toBe(BRANCHES)
  })

  it('matches a trimmed, case-insensitive substring of the branch name', () => {
    expect(filterBranches(BRANCHES, ' N ').map((b) => b.aspireBranchId)).toEqual([1, 2])
    expect(filterBranches(BRANCHES, 'SOTA').map((b) => b.aspireBranchId)).toEqual([3])
    expect(filterBranches(BRANCHES, 'zzz')).toEqual([])
  })
})

describe('toggleBranch', () => {
  it('adds a missing id and removes a present one', () => {
    expect(toggleBranch([1], 2)).toEqual([1, 2])
    expect(toggleBranch([1, 2], 1)).toEqual([2])
  })
})

describe('selectBranches / clearBranches', () => {
  it('selects only the given ids, keeping order and never duplicating', () => {
    expect(selectBranches([3], [1, 3])).toEqual([3, 1])
  })

  it('returns the same set when nothing new is added', () => {
    const selected = [1, 2]
    expect(selectBranches(selected, [2])).toBe(selected)
  })

  it('clears only the given ids, leaving hidden selections intact', () => {
    expect(clearBranches([1, 2, 3, 99], [1, 2])).toEqual([3, 99])
  })
})

describe('countSelected / headerState', () => {
  it('counts only selections within the given ids', () => {
    expect(countSelected([1, 99], [1, 2, 3])).toBe(1)
  })

  it('is none / some / all over the given ids', () => {
    expect(headerState([], [1, 2])).toBe('none')
    expect(headerState([3], [1, 2])).toBe('none')
    expect(headerState([1], [1, 2])).toBe('some')
    expect(headerState([1, 2, 3], [1, 2])).toBe('all')
  })

  it('is none for an empty visible set', () => {
    expect(headerState([1], [])).toBe('none')
  })
})
