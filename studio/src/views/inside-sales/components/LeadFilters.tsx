import { X, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { useLeadsStore } from '@/store/leadsStore'
import { cn } from '@/lib/utils'
import { LEAD_TYPES } from '@/types'
import type { LeadType } from '@/types'
import { LEAD_TYPE_LABELS, LEAD_TYPE_COLORS } from '@/lib/constants'
const STATES = ['FL', 'TX', 'PA', 'NC', 'SC']

export function LeadFilters() {
  const { filters, setFilter, resetFilters } = useLeadsStore()

  const hasActiveFilters =
    filters.search ||
    filters.leadTypes.length > 0 ||
    filters.minScore > 0 ||
    filters.states.length > 0

  function toggleType(t: LeadType) {
    const next = filters.leadTypes.includes(t)
      ? filters.leadTypes.filter(x => x !== t)
      : [...filters.leadTypes, t]
    setFilter('leadTypes', next)
  }

  function toggleState(s: string) {
    const next = filters.states.includes(s)
      ? filters.states.filter(x => x !== s)
      : [...filters.states, s]
    setFilter('states', next)
  }

  return (
    <div className="space-y-3 p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-fg))]" />
        <Input
          placeholder="Search properties, cities…"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          className="pl-9 h-8 text-xs"
        />
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        {/* Lead type filter */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-fg))]">Type</Label>
          <div className="flex gap-1.5">
            {LEAD_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  'px-2.5 py-1 rounded-md border text-xs font-medium transition-colors cursor-pointer',
                  filters.leadTypes.includes(t)
                    ? `${LEAD_TYPE_COLORS[t].chip} bg-opacity-10 bg-current`
                    : 'border-[hsl(var(--border))] text-[hsl(var(--muted-fg))] hover:border-[hsl(var(--fg))]'
                )}
              >
                {LEAD_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* State filter */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-fg))]">State</Label>
          <div className="flex gap-1.5 flex-wrap">
            {STATES.map((s) => (
              <button
                key={s}
                onClick={() => toggleState(s)}
                className={cn(
                  'px-2 py-1 rounded border text-xs font-medium transition-colors cursor-pointer',
                  filters.states.includes(s)
                    ? 'border-[#2E7D52] text-[#2E7D52] bg-[#2E7D52]/10'
                    : 'border-[hsl(var(--border))] text-[hsl(var(--muted-fg))] hover:border-[hsl(var(--fg))]'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Min score */}
        <div className="space-y-1.5 min-w-[160px]">
          <Label className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-fg))]">
            Min score: <span className="text-[hsl(var(--fg))] font-semibold">{filters.minScore}</span>
          </Label>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[filters.minScore]}
            onValueChange={([v]) => setFilter('minScore', v)}
          />
        </div>

        {/* Reset */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-7 text-xs gap-1">
            <X className="h-3 w-3" /> Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}
