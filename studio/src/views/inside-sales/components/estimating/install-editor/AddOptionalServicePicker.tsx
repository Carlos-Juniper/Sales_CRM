// ---------------------------------------------------------------------------
// Handoff 55 §3 (revised) — "Add Optional Services", the ONLY section-level
// add in the install editor. Standard sections are created by the backend
// with the estimate; this lists just the services under the Optional Services
// category and inserts on pick (no select-then-click-Add).
// ---------------------------------------------------------------------------

import { useMemo } from 'react'
import type { CatalogService, ServiceCategory } from '@/types/estimating'
import { useServiceCatalog } from '@/hooks/useServiceCatalog'
import { optionalServicesCategory } from '@/lib/estimating/install'

export function AddOptionalServicePicker({
  onAdd,
}: {
  onAdd: (category: ServiceCategory, service: CatalogService) => void
}) {
  const { data: categories, isLoading, isError } = useServiceCatalog('install')
  const category = useMemo(() => optionalServicesCategory(categories ?? []), [categories])
  const services = useMemo(
    () =>
      [...(category?.services ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName),
      ),
    [category],
  )
  const unavailable = isError || (!isLoading && categories === undefined)
  const empty = !category || services.length === 0

  return (
    <div data-testid="install-add-optional" className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Add Optional Services"
        className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 text-xs font-semibold text-[#2E7D52] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        value=""
        disabled={isLoading || unavailable || empty}
        onChange={(e) => {
          const svc = services.find((s) => s.id === e.target.value)
          if (svc && category) onAdd(category, svc)
        }}
      >
        <option value="">
          {isLoading
            ? 'Loading optional services…'
            : unavailable
              ? 'Service catalog unavailable'
              : empty
                ? 'No optional services in the catalog yet'
                : '+ Add Optional Services…'}
        </option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName || s.name}
          </option>
        ))}
      </select>
    </div>
  )
}
