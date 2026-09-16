// ---------------------------------------------------------------------------
// SectionCard — one self-contained service-region box of the
// maintenance Line-Item Editor. Blue cells (#eff6ff / #bfdbfe) mark the
// estimator-editable inputs; complexity overrides away from the company
// default are visually flagged (I-9.7). All pricing math flows through
// lib/estimating/calc — this component only renders.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { Copy, Plus, TriangleAlert, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DisciplineSelect } from './DisciplineSelect'
import { BillingTypeSelect } from './BillingTypeSelect'
import type { EstimateSection, SectionService } from '@/types/estimating'
import {
  acresFromSqft,
  maintServiceLine,
  per1000SfRead,
  sectionTotal,
} from '@/lib/estimating/calc'
import {
  COMPLEXITY_OPTIONS,
  MAINTENANCE_SERVICE_CATALOG,
  type MaintenanceCatalogService,
  coerceQty,
  formatCents,
  granularityFor,
  isComplexityOverridden,
  lineCentsPerSqft,
} from '@/lib/estimating/maintenance'

/** Blue-cell convention: estimator-editable inputs (legacy Excel language). */
const BLUE_CELL = 'bg-[#eff6ff] border-[#bfdbfe] focus-visible:ring-[#2E7D52]'

const cellInput =
  'h-8 rounded-md border px-2 text-sm text-[hsl(var(--fg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors'

export interface SectionCardProps {
  section: EstimateSection
  onRename: (name: string) => void
  onSqftChange: (sqft: number) => void
  onServiceChange: (serviceId: string, patch: Partial<SectionService>) => void
  onAddLineItem: (catalogKey: string) => void
  onDuplicate: () => void
  onRemoveRequest: () => void
  /**
   * The addable-service catalog, sourced from GET /catalog-items
   * by the parent editor. Defaults to the literal (offline fallback).
   */
  catalog?: MaintenanceCatalogService[]
  /** UI-only kit granularity selections (open item: persist to kit config). */
  granularity: Record<string, string>
  onGranularityChange: (serviceId: string, value: string) => void
}

function ServiceRow({
  section,
  svc,
  onServiceChange,
  granularity,
  onGranularityChange,
}: {
  section: EstimateSection
  svc: SectionService
  onServiceChange: SectionCardProps['onServiceChange']
  granularity: Record<string, string>
  onGranularityChange: SectionCardProps['onGranularityChange']
}) {
  const lineCents = maintServiceLine(
    section.squareFeet,
    svc.unitSellCents ?? 0,
    svc.qty,
    svc.complexityPct,
  )
  const overridden = isComplexityOverridden(svc.complexityPct)
  const gran = granularityFor(svc.label)
  const complexityChoices = COMPLEXITY_OPTIONS.includes(svc.complexityPct)
    ? COMPLEXITY_OPTIONS
    : [...COMPLEXITY_OPTIONS, svc.complexityPct].sort((a, b) => a - b)

  return (
    <div
      data-testid={`service-row-${svc.label}`}
      className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-x-3 gap-y-1 px-4 py-2 border-t border-[hsl(var(--border))]"
    >
      <div className="min-w-0">
        <p className="text-sm text-[hsl(var(--fg))] truncate">{svc.label}</p>
        {gran && (
          <label className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-fg))]">
            {gran.label}
            <select
              aria-label={`${gran.label} for ${svc.label}`}
              className={cn(cellInput, BLUE_CELL, 'h-6 text-[11px] px-1')}
              value={granularity[svc.id] ?? gran.defaultOption}
              onChange={(e) => onGranularityChange(svc.id, e.target.value)}
            >
              {gran.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          aria-label={`Occurrences for ${svc.label}`}
          className={cn(cellInput, BLUE_CELL, 'w-16 text-right')}
          value={svc.qty}
          onChange={(e) => onServiceChange(svc.id, { qty: coerceQty(e.target.value) })}
        />
        <span className="text-[11px] text-[hsl(var(--muted-fg))]">{svc.uom}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <select
          aria-label={`Complexity for ${svc.label}`}
          className={cn(
            cellInput,
            BLUE_CELL,
            overridden && 'border-amber-400 bg-amber-50 text-amber-800',
          )}
          value={String(svc.complexityPct)}
          onChange={(e) =>
            onServiceChange(svc.id, { complexityPct: Number(e.target.value) })
          }
        >
          {complexityChoices.map((c) => (
            <option key={c} value={String(c)}>
              +{Math.round(c * 100)}%
            </option>
          ))}
        </select>
        {overridden && (
          <span
            data-testid="complexity-override-flag"
            title="Complexity overridden from the company default"
            className="inline-flex items-center text-amber-600"
          >
            <TriangleAlert className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <DisciplineSelect
        label={svc.label}
        value={svc.discipline ?? null}
        onChange={(discipline) => onServiceChange(svc.id, { discipline })}
        className={cn(cellInput, BLUE_CELL)}
      />

      {/* Marks the exception to the 12-month contract bundle: a line billed
          once, when performed, rather than spread across the schedule. */}
      <BillingTypeSelect
        label={svc.label}
        value={svc.billingType ?? null}
        onChange={(billingType) => onServiceChange(svc.id, { billingType })}
        className={cn(cellInput, BLUE_CELL)}
      />

      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-[hsl(var(--fg))]">
          {formatCents(lineCents)}
        </p>
        <p className="text-[11px] tabular-nums text-[hsl(var(--muted-fg))]">
          {`$${(lineCentsPerSqft(lineCents, section.squareFeet) / 100).toFixed(4)} /SF`}
        </p>
      </div>
    </div>
  )
}

export function SectionCard({
  section,
  onRename,
  onSqftChange,
  onServiceChange,
  onAddLineItem,
  onDuplicate,
  onRemoveRequest,
  catalog = MAINTENANCE_SERVICE_CATALOG,
  granularity,
  onGranularityChange,
}: SectionCardProps) {
  const [pendingAdd, setPendingAdd] = useState('')
  const totalCents = sectionTotal(section, 'maintenance')
  const acres = acresFromSqft(section.squareFeet)
  const existingLabels = new Set(section.services.map((s) => s.label))
  const addable = catalog.filter((r) => !existingLabels.has(r.label))

  return (
    <Card
      data-testid="section-card"
      className="transition-shadow hover:shadow-md hover:border-[#2E7D52]/30"
    >
      <CardContent className="p-0">
        {/* Header: name + actions */}
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
          <input
            aria-label={`Section name for ${section.name}`}
            className={cn(
              cellInput,
              'flex-1 min-w-40 border-transparent bg-transparent font-semibold text-[15px] hover:border-[hsl(var(--border))] focus-visible:ring-[#2E7D52]',
            )}
            value={section.name}
            onChange={(e) => onRename(e.target.value)}
          />
          <span className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] rounded px-1.5 py-0.5">
            Maintenance · hours-driven
          </span>
          <Button variant="outline" size="sm" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700"
            onClick={onRemoveRequest}
            aria-label={`Remove section ${section.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        </div>

        {/* Region square footage */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <label
            className="text-xs text-[hsl(var(--muted-fg))]"
            htmlFor={`sqft-${section.id}`}
          >
            Region square footage
          </label>
          <input
            id={`sqft-${section.id}`}
            type="number"
            min={0}
            className={cn(cellInput, BLUE_CELL, 'w-32 text-right')}
            value={section.squareFeet}
            onChange={(e) => onSqftChange(coerceQty(e.target.value))}
          />
          <span className="text-[11px] text-[hsl(var(--muted-fg))]">SF</span>
          <span className="inline-flex items-center rounded-full bg-[var(--color-brand-50,#ecfdf3)] border border-[#2E7D52]/25 px-2 py-0.5 text-[11px] font-medium text-[#2E7D52]">
            ≈ {acres.toFixed(1)} ac
          </span>
          <span className="text-[11px] text-[hsl(var(--muted-fg))]">
            Sq ft drives every hours-based kit in this region — never acres.
          </span>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))]">
          <span>Service</span>
          <span>Occurrences</span>
          <span>Complexity</span>
          <span>Discipline</span>
          <span>Billing</span>
          <span className="text-right">Line total</span>
        </div>

        {section.services.map((svc) => (
          <ServiceRow
            key={svc.id}
            section={section}
            svc={svc}
            onServiceChange={onServiceChange}
            granularity={granularity}
            onGranularityChange={onGranularityChange}
          />
        ))}

        {/* Add line item (I-9.7 — services outside the original sales spec) */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-dashed border-[hsl(var(--border))]">
          <select
            aria-label={`Add line item to ${section.name}`}
            className={cn(cellInput, 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-xs')}
            value={pendingAdd}
            onChange={(e) => setPendingAdd(e.target.value)}
          >
            <option value="">Select a service…</option>
            {addable.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            disabled={pendingAdd === ''}
            onClick={() => {
              onAddLineItem(pendingAdd)
              setPendingAdd('')
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add line item
          </Button>
        </div>

        {/* Footer: unit read + section total */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50">
          <p className="text-xs text-[hsl(var(--muted-fg))]">
            Unit read{' '}
            <span className="font-medium text-[hsl(var(--fg))] tabular-nums">
              {formatCents(Math.round(per1000SfRead(totalCents, section.squareFeet)))} / 1,000 SF
            </span>
          </p>
          <p className="text-sm text-[hsl(var(--muted-fg))]">
            Section total{' '}
            <span className="font-bold text-[hsl(var(--fg))] tabular-nums">
              {formatCents(totalCents)}
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
