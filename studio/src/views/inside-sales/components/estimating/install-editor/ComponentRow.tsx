// ---------------------------------------------------------------------------
// One item (component) row of the install grid: level 3 of
// section → service → items (Handoff 55 §4/§5/§6).
//
// The unit cost is a blue cell. A null cost (a material with no current
// price) renders as an empty input with a "—" placeholder, never $0.00;
// typing a value sets it, clearing the cell sets it back to unknown.
// ---------------------------------------------------------------------------

import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarginBands, SectionServiceComponent } from '@/types/estimating'
import {
  COMPONENT_KIND_LABELS,
  type ItemRollup,
  UNRESOLVED,
  coerceNum,
  formatGmPctOrDash,
} from '@/lib/estimating/install'
import { BLUE_CELL, GRID, cellInput, centsOrDash, gmCellClass, parseUnitCostInput } from './grid'

const KIND_BADGE: Record<SectionServiceComponent['kind'], string> = {
  labor: 'bg-[#fef3c7] text-[#b45309]',
  material: 'bg-[#e0f2fe] text-[#0369a1]',
  equipment: 'bg-[#ede9fe] text-[#6d28d9]',
  subcontractor: 'bg-[#fce7f3] text-[#be185d]',
  other: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-fg))]',
}

/** Qty unit for an item: its own uom (a picked material's), else HR for labor / EA. */
function componentUnit(component: SectionServiceComponent): string {
  if (component.uom) return component.uom
  return component.kind === 'labor' ? 'HR' : 'EA'
}

export function ComponentRow({
  component,
  rollup,
  bands,
  onChange,
  onDelete,
}: {
  component: SectionServiceComponent
  /** Extended item cost / apportioned price / GM (install.componentRollups). */
  rollup: ItemRollup
  bands: MarginBands
  onChange: (patch: Partial<SectionServiceComponent>) => void
  onDelete: () => void
}) {
  return (
    <div
      data-testid={`install-component-${component.label}`}
      className={cn(GRID, 'py-1 pl-12 pr-3 border-t border-[hsl(var(--border))]/40 bg-[hsl(var(--muted))]/30 text-[11px]')}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span
          data-testid={`install-component-kind-${component.label}`}
          className={cn(
            'text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded flex-shrink-0',
            KIND_BADGE[component.kind],
          )}
        >
          {COMPONENT_KIND_LABELS[component.kind]}
        </span>
        <span className="text-[#1d4ed8] truncate" title={component.inventoryId ?? undefined}>
          {component.label}
        </span>
        <button
          type="button"
          aria-label={`Delete item ${component.label}`}
          onClick={onDelete}
          className="ml-auto inline-flex items-center text-[hsl(var(--muted-fg))] hover:text-red-600 cursor-pointer flex-shrink-0"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
      <span className="flex items-center justify-center gap-1">
        <input
          type="number"
          min={0}
          step="any"
          aria-label={`Component qty for ${component.label}`}
          className={cn(cellInput, BLUE_CELL, 'w-14 text-right')}
          value={component.qty}
          onChange={(e) => onChange({ qty: coerceNum(e.target.value) })}
        />
        <span className="text-[10px] text-[hsl(var(--muted-fg))]">{componentUnit(component)}</span>
      </span>
      <span />
      <span className="text-right text-[hsl(var(--muted-fg))] tabular-nums">
        {component.hours !== null ? component.hours.toFixed(2) : UNRESOLVED}
      </span>
      <span className="text-right">
        <input
          type="number"
          min={0}
          step="any"
          aria-label={`Unit cost for ${component.label}`}
          placeholder={UNRESOLVED}
          title={component.unitCostCents === null ? 'Unknown cost — enter one' : undefined}
          className={cn(cellInput, BLUE_CELL, 'w-20 text-right')}
          value={component.unitCostCents === null ? '' : component.unitCostCents / 100}
          onChange={(e) => onChange({ unitCostCents: parseUnitCostInput(e.target.value) })}
        />
      </span>
      <span
        data-testid={`install-component-price-${component.label}`}
        className="text-right font-semibold tabular-nums"
        title="Share of the line price (items carry no sell price of their own)"
      >
        {centsOrDash(rollup.priceCents)}
      </span>
      <span className="text-right text-[hsl(var(--muted-fg))]">{UNRESOLVED}</span>
      <span
        data-testid={`install-component-cost-${component.label}`}
        className="text-right text-[hsl(var(--muted-fg))] tabular-nums"
      >
        {centsOrDash(rollup.costCents)}
      </span>
      <span
        data-testid={`install-component-gm-${component.label}`}
        className={cn('text-right tabular-nums', gmCellClass(rollup.gm, bands))}
      >
        {formatGmPctOrDash(rollup.gm)}
      </span>
    </div>
  )
}
