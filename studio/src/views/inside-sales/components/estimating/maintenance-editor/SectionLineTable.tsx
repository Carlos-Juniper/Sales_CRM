// The category-grouped line table of one maintenance section (Handoff 54 §3).
// Lines are grouped at render time; the persisted section.services[] shape is
// unchanged.

import { useMemo } from 'react'
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
import { categoryRollup } from '@/lib/estimating/maintenanceHours'
import type { CatalogStatus } from '@/lib/estimating/maintenanceCatalogAdapter'
import { AddOptionalServiceSelect } from './AddOptionalServiceSelect'
import { CategoryBlock } from './CategoryBlock'
import { MaintenanceServiceRow } from './MaintenanceServiceRow'
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

  const renderRow = (svc: SectionService) => (
    <MaintenanceServiceRow
      key={svc.id}
      section={section}
      svc={svc}
      serviceKits={serviceKits}
      blocked={blockedServiceIds?.has(svc.id) ?? false}
      onChange={(patch) => onServiceChange(svc.id, patch)}
      onRemove={() => onRemoveService(svc)}
    />
  )

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
            renderRow={renderRow}
            addControl={addControl(group)}
          />
        ))}
      </div>
    </div>
  )
}
