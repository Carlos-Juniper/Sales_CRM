// ---------------------------------------------------------------------------
// Handoff 55 §4 — "Add service" under an install section, listing the
// services of that section's category. Picking a service inserts it
// immediately, with its default items (no select-then-click-Add;
// Handoff 54 §3 follows the same pattern on the maintenance side).
// ---------------------------------------------------------------------------

import type { CatalogService, EstimateSection } from '@/types/estimating'
import { useSectionServiceOptions } from './useSectionServiceOptions'

export function AddServicePicker({
  section,
  onAdd,
}: {
  section: Pick<EstimateSection, 'id' | 'name' | 'serviceCategoryId'>
  onAdd: (sectionId: string, service: CatalogService) => void
}) {
  const { groups, isLoading, unavailable } = useSectionServiceOptions(section)
  const empty = groups.length === 0
  const placeholder = isLoading
    ? 'Loading services…'
    : unavailable
      ? 'Service catalog unavailable'
      : empty
        ? 'No catalog services for this section'
        : '+ Add service…'

  function pick(serviceId: string) {
    for (const g of groups) {
      const svc = g.services.find((s) => s.id === serviceId)
      if (svc) {
        onAdd(section.id, svc)
        return
      }
    }
  }

  const option = (s: CatalogService) => (
    <option key={s.id} value={s.id}>
      {s.displayName || s.name}
      {s.defaultItems.length > 0 ? ` (${s.defaultItems.length} default items)` : ''}
    </option>
  )

  return (
    <select
      aria-label={`Add service to ${section.name}`}
      data-testid={`install-add-service-${section.id}`}
      className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1.5 text-[11px] font-semibold text-[#2E7D52] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      value=""
      disabled={isLoading || unavailable || empty}
      onChange={(e) => e.target.value && pick(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {groups.flatMap((g) => g.services).map(option)}
    </select>
  )
}
