import { create } from 'zustand'
import type { LeadType } from '@/types'

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
}))

export type { LeadFilters }
