import { describe, it, expect, beforeEach } from 'vitest'
import { useLeadsStore } from '@/store/leadsStore'

const defaultFilters = {
  search: '',
  leadTypes: [],
  minScore: 0,
  states: [],
  assignedOnly: false,
  unassignedOnly: false,
}

const defaultState = {
  filters: defaultFilters,
  sortBy: 'score' as const,
  sortDir: 'desc' as const,
  page: 1,
  optimisticUpdates: {},
}

beforeEach(() => {
  useLeadsStore.setState(defaultState)
})

describe('leadsStore — initial state', () => {
  it('has correct default filter values', () => {
    const { filters } = useLeadsStore.getState()
    expect(filters.search).toBe('')
    expect(filters.leadTypes).toEqual([])
    expect(filters.minScore).toBe(0)
    expect(filters.states).toEqual([])
    expect(filters.assignedOnly).toBe(false)
    expect(filters.unassignedOnly).toBe(false)
  })

  it('starts with sortBy=score, sortDir=desc, page=1', () => {
    const { sortBy, sortDir, page } = useLeadsStore.getState()
    expect(sortBy).toBe('score')
    expect(sortDir).toBe('desc')
    expect(page).toBe(1)
  })

  it('starts with empty optimisticUpdates', () => {
    expect(useLeadsStore.getState().optimisticUpdates).toEqual({})
  })
})

describe('leadsStore — setFilter', () => {
  it('setFilter(search) updates search', () => {
    useLeadsStore.getState().setFilter('search', 'tempe')
    expect(useLeadsStore.getState().filters.search).toBe('tempe')
  })

  it('setFilter(search) resets page to 1', () => {
    useLeadsStore.setState({ page: 5 })
    useLeadsStore.getState().setFilter('search', 'mesa')
    expect(useLeadsStore.getState().page).toBe(1)
  })

  it('setFilter(minScore) updates minScore', () => {
    useLeadsStore.getState().setFilter('minScore', 70)
    expect(useLeadsStore.getState().filters.minScore).toBe(70)
  })

  it('setFilter(leadTypes) replaces leadTypes array', () => {
    useLeadsStore.getState().setFilter('leadTypes', ['HOA'])
    expect(useLeadsStore.getState().filters.leadTypes).toEqual(['HOA'])
  })

  it('setFilter(leadTypes) with multiple types accumulates correctly', () => {
    useLeadsStore.getState().setFilter('leadTypes', ['HOA', 'commercial'])
    expect(useLeadsStore.getState().filters.leadTypes).toEqual(['HOA', 'commercial'])
  })

  it('setFilter(states) replaces states array', () => {
    useLeadsStore.getState().setFilter('states', ['FL', 'TX'])
    expect(useLeadsStore.getState().filters.states).toEqual(['FL', 'TX'])
  })

  it('setFilter(assignedOnly) sets assignedOnly', () => {
    useLeadsStore.getState().setFilter('assignedOnly', true)
    expect(useLeadsStore.getState().filters.assignedOnly).toBe(true)
  })

  it('setFilter(unassignedOnly) sets unassignedOnly', () => {
    useLeadsStore.getState().setFilter('unassignedOnly', true)
    expect(useLeadsStore.getState().filters.unassignedOnly).toBe(true)
  })

  it('setting assignedOnly does not automatically clear unassignedOnly', () => {
    useLeadsStore.getState().setFilter('unassignedOnly', true)
    useLeadsStore.getState().setFilter('assignedOnly', true)
    const { filters } = useLeadsStore.getState()
    expect(filters.assignedOnly).toBe(true)
    expect(filters.unassignedOnly).toBe(true)
  })

  it('does not mutate other filter fields', () => {
    useLeadsStore.getState().setFilter('minScore', 80)
    const { filters } = useLeadsStore.getState()
    expect(filters.search).toBe('')
    expect(filters.leadTypes).toEqual([])
    expect(filters.states).toEqual([])
  })
})

describe('leadsStore — resetFilters', () => {
  it('resets all filters to defaults', () => {
    useLeadsStore.getState().setFilter('search', 'abc')
    useLeadsStore.getState().setFilter('minScore', 75)
    useLeadsStore.getState().setFilter('leadTypes', ['HOA'])
    useLeadsStore.getState().setFilter('states', ['FL'])
    useLeadsStore.getState().resetFilters()
    expect(useLeadsStore.getState().filters).toEqual(defaultFilters)
  })

  it('resets page to 1', () => {
    useLeadsStore.setState({ page: 4 })
    useLeadsStore.getState().resetFilters()
    expect(useLeadsStore.getState().page).toBe(1)
  })

  it('does not reset sortBy or sortDir', () => {
    useLeadsStore.setState({ sortBy: 'created_at', sortDir: 'asc' })
    useLeadsStore.getState().resetFilters()
    const { sortBy, sortDir } = useLeadsStore.getState()
    expect(sortBy).toBe('created_at')
    expect(sortDir).toBe('asc')
  })
})

describe('leadsStore — setSort', () => {
  it('setSort to a new field sets that field and dir=desc', () => {
    useLeadsStore.getState().setSort('created_at')
    const { sortBy, sortDir } = useLeadsStore.getState()
    expect(sortBy).toBe('created_at')
    expect(sortDir).toBe('desc')
  })

  it('setSort to same field when dir=desc toggles to asc', () => {
    useLeadsStore.setState({ sortBy: 'score', sortDir: 'desc' })
    useLeadsStore.getState().setSort('score')
    expect(useLeadsStore.getState().sortDir).toBe('asc')
    expect(useLeadsStore.getState().sortBy).toBe('score')
  })

  it('setSort to same field when dir=asc sets dir back to desc', () => {
    useLeadsStore.setState({ sortBy: 'score', sortDir: 'asc' })
    useLeadsStore.getState().setSort('score')
    expect(useLeadsStore.getState().sortDir).toBe('desc')
  })

  it('setSort resets page to 1', () => {
    useLeadsStore.setState({ page: 3 })
    useLeadsStore.getState().setSort('estimated_contract_value')
    expect(useLeadsStore.getState().page).toBe(1)
  })

  it('toggle cycle: desc → asc → desc', () => {
    useLeadsStore.setState({ sortBy: 'score', sortDir: 'desc' })
    useLeadsStore.getState().setSort('score')
    expect(useLeadsStore.getState().sortDir).toBe('asc')
    useLeadsStore.getState().setSort('score')
    expect(useLeadsStore.getState().sortDir).toBe('desc')
  })

  it('switching from one field to another resets direction to desc', () => {
    useLeadsStore.setState({ sortBy: 'score', sortDir: 'asc' })
    useLeadsStore.getState().setSort('bid_deadline')
    expect(useLeadsStore.getState().sortBy).toBe('bid_deadline')
    expect(useLeadsStore.getState().sortDir).toBe('desc')
  })
})

describe('leadsStore — setPage', () => {
  it('setPage(3) sets page to 3', () => {
    useLeadsStore.getState().setPage(3)
    expect(useLeadsStore.getState().page).toBe(3)
  })

  it('setPage(0) sets page to 0 (no bounds enforced)', () => {
    useLeadsStore.getState().setPage(0)
    expect(useLeadsStore.getState().page).toBe(0)
  })
})

describe('leadsStore — optimistic updates', () => {
  it('applyOptimistic merges patch into cache', () => {
    useLeadsStore.getState().applyOptimistic('l1', { score: 99 })
    expect(useLeadsStore.getState().optimisticUpdates['l1']).toEqual({ score: 99 })
  })

  it('applyOptimistic with multiple calls merges (later wins on conflict)', () => {
    useLeadsStore.getState().applyOptimistic('l1', { score: 80, status: 'new' })
    useLeadsStore.getState().applyOptimistic('l1', { score: 95 })
    expect(useLeadsStore.getState().optimisticUpdates['l1']).toEqual({ score: 95, status: 'new' })
  })

  it('applyOptimistic for different leads are stored independently', () => {
    useLeadsStore.getState().applyOptimistic('l1', { score: 80 })
    useLeadsStore.getState().applyOptimistic('l2', { score: 90 })
    expect(useLeadsStore.getState().optimisticUpdates['l1']?.score).toBe(80)
    expect(useLeadsStore.getState().optimisticUpdates['l2']?.score).toBe(90)
  })

  it('clearOptimistic removes the entry', () => {
    useLeadsStore.getState().applyOptimistic('l1', { score: 99 })
    useLeadsStore.getState().clearOptimistic('l1')
    expect(useLeadsStore.getState().optimisticUpdates['l1']).toBeUndefined()
  })

  it('clearOptimistic does not affect other entries', () => {
    useLeadsStore.getState().applyOptimistic('l1', { score: 80 })
    useLeadsStore.getState().applyOptimistic('l2', { score: 90 })
    useLeadsStore.getState().clearOptimistic('l1')
    expect(useLeadsStore.getState().optimisticUpdates['l2']).toEqual({ score: 90 })
  })

  it('clearOptimistic on non-existent id is a no-op', () => {
    expect(() => useLeadsStore.getState().clearOptimistic('nonexistent')).not.toThrow()
    expect(useLeadsStore.getState().optimisticUpdates).toEqual({})
  })
})
