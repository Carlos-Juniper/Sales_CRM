import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import type { AccountTab } from '@/types/accounts'
import type { FilterState } from '@/hooks/useAccountFilters'

interface AccountsToolbarProps {
  tab: AccountTab
  onTabChange: (tab: AccountTab) => void
  hoaCount: number
  pmCount: number
  search: string
  onSearchChange: (s: string) => void
  filters: { hoa: FilterState; pm: FilterState }
  onUpdateFilter: (tab: AccountTab, key: keyof FilterState, value: Set<string>) => void
  onClearAll: () => void
  activeFilterCount: number
  onAdd: () => void
  filterOptions: {
    reps: string[]
    branches: string[]
    cities: string[]
    statuses: string[]
  }
}

const TABS = [
  { value: 'hoa' as const, label: 'HOA' },
  { value: 'pm' as const, label: 'Property Management' },
] satisfies { value: AccountTab; label: string }[]

export function AccountsToolbar({
  tab,
  onTabChange,
  hoaCount,
  pmCount,
  search,
  onSearchChange,
  filters,
  onUpdateFilter,
  onClearAll,
  activeFilterCount,
  onAdd,
  filterOptions,
}: AccountsToolbarProps) {
  const counts: Record<AccountTab, number> = { hoa: hoaCount, pm: pmCount }
  const currentFilters = filters[tab]
  const addLabel = tab === 'hoa' ? 'Add property' : 'Add company'

  return (
    <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] flex-shrink-0">
      {/* Tab row */}
      <div className="px-4 pt-2.5 pb-2 flex items-center gap-3 flex-wrap">
        {/* Tab switcher */}
        <div className="inline-flex bg-[hsl(var(--muted))] rounded-lg p-0.5 gap-0.5">
          {TABS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                onTabChange(value)
                onSearchChange('')
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                tab === value
                  ? 'bg-[hsl(var(--card))] text-[hsl(var(--fg))] shadow-sm'
                  : 'text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]'
              }`}
            >
              {label}
              {tab === value && (
                <span className="text-[10px] font-bold tabular-nums rounded px-1 bg-[#2E7D52]/10 text-[#2E7D52]">
                  {counts[value]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="ml-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={tab === 'hoa' ? 'Search properties...' : 'Search companies...'}
            className="h-8 w-52 px-2.5 text-xs border border-[hsl(var(--border))] rounded-md bg-[hsl(var(--muted))] text-[hsl(var(--fg))] placeholder:text-[hsl(var(--muted-fg))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]/50 focus:bg-[hsl(var(--card))]"
          />
        </div>

        {/* Add button */}
        <Button size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {addLabel}
        </Button>
      </div>

      {/* Filter row */}
      <div className="px-4 pb-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] mr-1">
          Filter
        </span>

        <MultiSelectFilter
          label="Status"
          options={filterOptions.statuses}
          selected={currentFilters.status}
          onChange={(next) => onUpdateFilter(tab, 'status', next)}
        />

        {tab === 'hoa' && (
          <MultiSelectFilter
            label="Branch"
            options={filterOptions.branches}
            selected={currentFilters.branch}
            onChange={(next) => onUpdateFilter(tab, 'branch', next)}
          />
        )}

        <MultiSelectFilter
          label="City"
          options={filterOptions.cities}
          selected={currentFilters.city}
          onChange={(next) => onUpdateFilter(tab, 'city', next)}
        />

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1 h-[30px] px-2 rounded-lg text-xs font-semibold text-[#2E7D52] hover:bg-[#2E7D52]/10 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  )
}
