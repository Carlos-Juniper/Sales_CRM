// Handoff 54 §3 instant-add: picking an optional service adds that ONE line
// immediately (no select-then-Add step) and the select resets. Only services
// from optional categories that are not already in the section are listed.

import type { CatalogService } from '@/types/estimating'
import type { OptionalServiceChoice } from '@/lib/estimating/maintenanceCategories'
import type { CatalogStatus } from '@/lib/estimating/maintenanceCatalogAdapter'

function placeholder(status: CatalogStatus, empty: boolean): string {
  if (status === 'loading') return 'Loading optional services…'
  if (status === 'unavailable') return 'Service catalog unavailable'
  return empty ? 'No optional services to add' : '+ Add optional service…'
}

function serviceOption(s: CatalogService) {
  return (
    <option key={s.id} value={s.id}>
      {s.displayName || s.name}
    </option>
  )
}

export function AddOptionalServiceSelect({
  sectionName,
  choices,
  status,
  onAdd,
}: {
  sectionName: string
  choices: OptionalServiceChoice[]
  status: CatalogStatus
  onAdd: (service: CatalogService) => void
}) {
  const empty = choices.length === 0
  const grouped = choices.length > 1
  return (
    <select
      aria-label={`Add optional service to ${sectionName}`}
      className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 text-xs font-semibold text-[#2E7D52] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      value=""
      disabled={status !== 'ready' || empty}
      onChange={(e) => {
        const picked = choices.flatMap((c) => c.services).find((s) => s.id === e.target.value)
        if (picked) onAdd(picked)
      }}
    >
      <option value="">{placeholder(status, empty)}</option>
      {grouped
        ? choices.map((c) => (
            <optgroup key={c.category.id} label={c.category.name}>
              {c.services.map(serviceOption)}
            </optgroup>
          ))
        : choices.flatMap((c) => c.services).map(serviceOption)}
    </select>
  )
}
