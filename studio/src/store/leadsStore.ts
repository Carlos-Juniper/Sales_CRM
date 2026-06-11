import { create } from 'zustand'
import type { Lead, LeadType } from '@/types'

interface LeadFilters {
  search: string
  leadTypes: LeadType[]
  minScore: number
  states: string[]
  assignedOnly: boolean
  unassignedOnly: boolean
}

interface LeadsState {
  filters: LeadFilters
  sortBy: 'score' | 'created_at' | 'estimated_contract_value' | 'bid_deadline'
  sortDir: 'asc' | 'desc'
  page: number

  setFilter: <K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) => void
  resetFilters: () => void
  setSort: (field: LeadsState['sortBy']) => void
  setPage: (page: number) => void

  // Optimistic update cache
  optimisticUpdates: Record<string, Partial<Lead>>
  applyOptimistic: (id: string, patch: Partial<Lead>) => void
  clearOptimistic: (id: string) => void
}

const defaultFilters: LeadFilters = {
  search: '',
  leadTypes: [],
  minScore: 0,
  states: [],
  assignedOnly: false,
  unassignedOnly: false,
}

export const useLeadsStore = create<LeadsState>()((set) => ({
  filters: defaultFilters,
  sortBy: 'score',
  sortDir: 'desc',
  page: 1,
  optimisticUpdates: {},

  setFilter: (key, value) =>
    set((s) => ({ filters: { ...s.filters, [key]: value }, page: 1 })),

  resetFilters: () => set({ filters: defaultFilters, page: 1 }),

  setSort: (field) =>
    set((s) => ({
      sortBy: field,
      sortDir: s.sortBy === field && s.sortDir === 'desc' ? 'asc' : 'desc',
      page: 1,
    })),

  setPage: (page) => set({ page }),

  applyOptimistic: (id, patch) =>
    set((s) => ({ optimisticUpdates: { ...s.optimisticUpdates, [id]: { ...s.optimisticUpdates[id], ...patch } } })),

  clearOptimistic: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.optimisticUpdates
      return { optimisticUpdates: rest }
    }),
}))

export type { LeadFilters }
