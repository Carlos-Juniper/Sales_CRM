// One category block inside a maintenance section (Handoff 54 §3): a header
// row with chevron, name, total hours (TH) and total price (TP), then its
// service rows when expanded. Rows are rendered by the caller.

import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { SectionService } from '@/types/estimating'
import type { ServiceGroup } from '@/lib/estimating/maintenanceCategories'
import { formatHours, type CategoryRollup } from '@/lib/estimating/maintenanceHours'
import { MAINTENANCE_LINE_GRID } from './cells'

export function CategoryBlock({
  group,
  rollup,
  expanded,
  onToggle,
  renderServices,
  addControl,
}: {
  group: ServiceGroup
  rollup: CategoryRollup
  expanded: boolean
  onToggle: () => void
  /**
   * Renders this category's service lines. Receives the whole services array so
   * the caller can roll method rows up by service (Handoff 59 §B4) rather than
   * rendering one flat row per `section_services` row.
   */
  renderServices: (services: SectionService[]) => ReactNode
  /** Rendered under the header whatever the collapse state (Optional Services' add). */
  addControl?: ReactNode
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div data-testid={`category-block-${group.label}`} data-kind={group.kind}>
      <div
        data-testid={`category-header-${group.label}`}
        className={cn(MAINTENANCE_LINE_GRID, 'py-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40')}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="col-span-4 flex items-center gap-1 text-left text-sm font-semibold text-[hsl(var(--fg))] cursor-pointer"
        >
          <Chevron className="h-4 w-4 shrink-0" aria-hidden />
          {group.label}
          <span className="ml-1 text-[11px] font-normal text-[hsl(var(--muted-fg))]">
            ({group.services.length})
          </span>
        </button>
        <span data-testid="category-total-hours" className="text-right text-sm font-semibold tabular-nums">
          {formatHours(rollup.totalHours)}
        </span>
        <span
          data-testid="category-total-price"
          className="col-start-9 text-right text-sm font-semibold tabular-nums"
        >
          {formatCents(rollup.totalCents)}
        </span>
      </div>
      {addControl && <div className="px-4 py-1.5 pl-9">{addControl}</div>}
      {expanded && renderServices(group.services)}
    </div>
  )
}
