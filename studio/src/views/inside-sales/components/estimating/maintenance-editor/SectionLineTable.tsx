// The category-grouped line table of one maintenance section (Handoff 54 §3).
// Lines are grouped at render time; the persisted section.services[] shape is
// unchanged.

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type {
  CatalogService,
  EstimateSection,
  SectionService,
  ServiceCategory,
  ServiceKit,
} from '@/types/estimating'
import {
  OPTIONAL_GROUP_KEY,
  addableOptionalServices,
  groupSectionServices,
  type ServiceGroup,
} from '@/lib/estimating/maintenanceCategories'
import { groupByService } from '@/lib/estimating/maintenanceEditor'
import { categoryRollup } from '@/lib/estimating/maintenanceHours'
import type { CatalogStatus } from '@/lib/estimating/maintenanceCatalogAdapter'
import { AddOptionalServiceSelect } from './AddOptionalServiceSelect'
import { CategoryBlock } from './CategoryBlock'
import { ServiceRollupRow } from './ServiceRollupRow'
import { MAINTENANCE_LINE_GRID, MAINTENANCE_LINE_MIN_WIDTH } from './cells'
import { useCategoryCollapse } from './useCategoryCollapse'

const COLUMNS: { label: string; title?: string; right?: boolean }[] = [
  { label: 'Service' },
  { label: 'Occurrences', title: 'OCC — occurrences per year' },
  { label: 'Complexity', title: 'COMP — hours adder' },
  { label: 'P/H', title: 'Hours per occurrence', right: true },
  { label: 'TH', title: 'Total hours per year', right: true },
  { label: 'Discipline' },
  { label: 'Billing' },
  { label: 'P/P', title: 'Price per occurrence', right: true },
  { label: 'Line total', title: 'TP — total price per year', right: true },
  { label: '' },
]

export interface SectionLineTableProps {
  section: EstimateSection
  categories: ServiceCategory[]
  catalogStatus: CatalogStatus
  serviceKits: ServiceKit[]
  blockedServiceIds?: ReadonlySet<string>
  onServiceChange: (serviceId: string, patch: Partial<SectionService>) => void
  onRemoveService: (svc: SectionService) => void
  onAddOptionalService: (service: CatalogService) => void
}

export function SectionLineTable({
  section,
  categories,
  catalogStatus,
  serviceKits,
  blockedServiceIds,
  onServiceChange,
  onRemoveService,
  onAddOptionalService,
}: SectionLineTableProps) {
  const groups = useMemo(
    () => groupSectionServices(section.services, categories),
    [section.services, categories],
  )
  const collapse = useCategoryCollapse(groups, catalogStatus !== 'loading')

  // Per-service-line expand state (Handoff 59 §B4), keyed by serviceId. This is
  // the SECOND level of the hierarchy: the category block (above) governs which
  // service lines show; this governs which of a line's method rows show. Lines
  // start collapsed — the estimator opens one to edit its methods.
  const [expandedServices, setExpandedServices] = useState<Record<string, boolean>>({})
  const toggleService = (serviceId: string) =>
    setExpandedServices((prev) => ({ ...prev, [serviceId]: !prev[serviceId] }))

  // Resolve a method id back to its row so the delete callback can keep the
  // existing `onRemoveService(svc)` contract (it toasts with svc.label).
  const byId = useMemo(
    () => new Map(section.services.map((s) => [s.id, s])),
    [section.services],
  )

  const addControl = (group: ServiceGroup) =>
    group.kind !== 'optional' ? undefined : (
      <AddOptionalServiceSelect
        sectionName={section.name}
        choices={addableOptionalServices(section.services, categories)}
        status={catalogStatus}
        onAdd={(service) => {
          onAddOptionalService(service)
          collapse.expand(OPTIONAL_GROUP_KEY)
        }}
      />
    )

  // Roll a category's method rows up into service lines (one line per serviceId)
  // and render each as a ServiceRollupRow. Grouping is render-time only — the
  // persisted section.services[] shape is untouched, so the Save tree diff and
  // the category rollup totals above keep working as-is.
  const renderServices = (services: SectionService[]) =>
    groupByService(services).map((group) => (
      <ServiceRollupRow
        key={group.serviceId}
        group={{ ...group, isExpanded: expandedServices[group.serviceId] ?? false }}
        sectionSquareFeet={section.squareFeet}
        onToggle={toggleService}
        onUpdate={(methodId, patch) => onServiceChange(methodId, patch)}
        onGmChange={(methodId, gm) => onServiceChange(methodId, { targetGm: gm })}
        onRemove={(methodId) => {
          const svc = byId.get(methodId)
          if (svc) onRemoveService(svc)
        }}
      />
    ))

  return (
    <div className="overflow-x-auto">
      <div className={MAINTENANCE_LINE_MIN_WIDTH}>
        <div
          data-testid="maintenance-line-columns"
          className={cn(
            MAINTENANCE_LINE_GRID,
            'py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))]',
          )}
        >
          {COLUMNS.map((c, i) => (
            <span key={i} title={c.title} className={cn('whitespace-nowrap', c.right && 'text-right')}>
              {c.label}
            </span>
          ))}
        </div>

        {groups.map((group) => (
          <CategoryBlock
            key={group.key}
            group={group}
            rollup={categoryRollup(section, group.services, serviceKits)}
            expanded={collapse.isExpanded(group.key)}
            onToggle={() => collapse.toggle(group.key)}
            renderServices={renderServices}
            addControl={addControl(group)}
          />
        ))}
      </div>
    </div>
  )
}
