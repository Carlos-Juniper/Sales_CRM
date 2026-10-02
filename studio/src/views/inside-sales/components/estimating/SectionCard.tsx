// ---------------------------------------------------------------------------
// SectionCard — one self-contained service-region box of the
// maintenance Line-Item Editor. Blue cells (#eff6ff / #bfdbfe) mark the
// estimator-editable inputs; complexity overrides away from the company
// default are visually flagged (I-9.7). Lines render grouped into category
// blocks (Handoff 54 §3, SectionLineTable). All pricing math flows through
// lib/estimating/calc — this component only renders.
// ---------------------------------------------------------------------------

import { Copy, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { acresFromSqft, per1000SfRead, sectionTotal } from '@/lib/estimating/calc'
import { coerceQty } from '@/lib/estimating/maintenance'
import { BLUE_CELL, cellInput } from './maintenance-editor/cells'
import { SectionLineTable, type SectionLineTableProps } from './maintenance-editor/SectionLineTable'

export interface SectionCardProps extends SectionLineTableProps {
  onRename: (name: string) => void
  onSqftChange: (sqft: number) => void
  onDuplicate: () => void
  onRemoveRequest: () => void
}

export function SectionCard({
  onRename,
  onSqftChange,
  onDuplicate,
  onRemoveRequest,
  ...table
}: SectionCardProps) {
  const { section } = table
  const totalCents = sectionTotal(section, 'maintenance')
  const acres = acresFromSqft(section.squareFeet)

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

        {/* Category blocks (Handoff 54 §3): grouped at render time. */}
        <SectionLineTable {...table} />

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
            <span data-testid="section-total" className="font-bold text-[hsl(var(--fg))] tabular-nums">
              {formatCents(totalCents)}
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
