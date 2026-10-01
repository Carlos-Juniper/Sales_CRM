// One service line of a maintenance category block (Handoff 54 §3):
// OCC · COMP · P/H · TH · Discipline · Billing · P/P · TP · remove.

import { TriangleAlert, Trash2 } from 'lucide-react'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { EstimateSection, SectionService, ServiceKit } from '@/types/estimating'
import {
  COMPLEXITY_OPTIONS,
  coerceQty,
  isComplexityOverridden,
  lineCentsPerSqft,
} from '@/lib/estimating/maintenance'
import { formatHours, maintenanceLineRead } from '@/lib/estimating/maintenanceHours'
import { messageForErrorCode, CREW_RATE_REQUIRED_CODE } from '@/lib/estimating/crewRateError'
import { DisciplineSelect } from '../DisciplineSelect'
import { BillingTypeSelect } from '../BillingTypeSelect'
import { BLUE_CELL, MAINTENANCE_LINE_GRID, cellInput } from './cells'

function complexityChoices(current: number): number[] {
  return COMPLEXITY_OPTIONS.includes(current)
    ? COMPLEXITY_OPTIONS
    : [...COMPLEXITY_OPTIONS, current].sort((a, b) => a - b)
}

const hoursCell = 'text-right text-sm tabular-nums text-[hsl(var(--fg))]'

export function MaintenanceServiceRow({
  section,
  svc,
  serviceKits,
  blocked,
  onChange,
  onRemove,
}: {
  section: EstimateSection
  svc: SectionService
  serviceKits: ServiceKit[]
  blocked: boolean
  onChange: (patch: Partial<SectionService>) => void
  onRemove: () => void
}) {
  const read = maintenanceLineRead(section, svc, serviceKits)
  const overridden = isComplexityOverridden(svc.complexityPct)

  return (
    <div
      data-testid={`service-row-${svc.label}`}
      data-crew-rate-blocked={blocked ? 'true' : 'false'}
      className={cn(
        MAINTENANCE_LINE_GRID,
        'gap-y-1 py-2 border-t border-[hsl(var(--border))]',
        blocked && 'bg-amber-50',
      )}
    >
      <div className="min-w-0 pl-5">
        <p className="text-sm text-[hsl(var(--fg))] truncate">{svc.label}</p>
        {blocked && (
          <p data-testid="crew-rate-blocked-line" className="m-0 mt-1 text-[11px] font-medium text-amber-800">
            {messageForErrorCode(CREW_RATE_REQUIRED_CODE)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          aria-label={`Occurrences for ${svc.label}`}
          className={cn(cellInput, BLUE_CELL, 'w-16 text-right')}
          value={svc.qty}
          onChange={(e) => onChange({ qty: coerceQty(e.target.value) })}
        />
        <span className="text-[11px] text-[hsl(var(--muted-fg))]">{svc.uom}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <select
          aria-label={`Complexity for ${svc.label}`}
          className={cn(
            cellInput,
            BLUE_CELL,
            'w-full min-w-0',
            overridden && 'border-amber-400 bg-amber-50 text-amber-800',
          )}
          value={String(svc.complexityPct)}
          onChange={(e) => onChange({ complexityPct: Number(e.target.value) })}
        >
          {complexityChoices(svc.complexityPct).map((c) => (
            <option key={c} value={String(c)}>
              +{Math.round(c * 100)}%
            </option>
          ))}
        </select>
        {overridden && (
          <span
            data-testid="complexity-override-flag"
            title="Complexity overridden from the company default"
            className="inline-flex shrink-0 items-center text-amber-600"
          >
            <TriangleAlert className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <span data-testid="line-per-hours" className={hoursCell}>
        {formatHours(read.perOccurrenceHours)}
      </span>
      <span data-testid="line-total-hours" className={hoursCell}>
        {formatHours(read.totalHours)}
      </span>

      <DisciplineSelect
        label={svc.label}
        value={svc.discipline ?? null}
        onChange={(discipline) => onChange({ discipline })}
        className={cn(cellInput, BLUE_CELL, 'w-full min-w-0')}
      />

      {/* Marks the exception to the 12-month contract bundle: a line billed
          once, when performed, rather than spread across the schedule. */}
      <BillingTypeSelect
        label={svc.label}
        value={svc.billingType ?? null}
        onChange={(billingType) => onChange({ billingType })}
        className={cn(cellInput, BLUE_CELL, 'w-full min-w-0')}
      />

      <span data-testid="line-per-price" className={hoursCell}>
        {read.perOccurrenceCents === null ? '—' : formatCents(read.perOccurrenceCents)}
      </span>

      <div className="text-right">
        <p data-testid="line-total-price" className="text-sm font-semibold tabular-nums text-[hsl(var(--fg))]">
          {formatCents(read.lineCents)}
        </p>
        <p className="text-[11px] tabular-nums text-[hsl(var(--muted-fg))]">
          {`$${(lineCentsPerSqft(read.lineCents, section.squareFeet) / 100).toFixed(4)} /SF`}
        </p>
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${svc.label}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--muted-fg))] hover:bg-red-50 hover:text-red-600 cursor-pointer"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
