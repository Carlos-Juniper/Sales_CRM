// ---------------------------------------------------------------------------
// Handoff 59 §B4 — ServiceRollupRow
//
// One collapsed "service line" in the maintenance editor's two-level
// hierarchy. Shows: label + rolled-up $/yr. Expand → method rows, each with:
//   • Editable squareFeet input (placeholder = section sqft when null)
//   • Unit label (uom from the service row)
//   • GM% field (derived from laborMarkupPct or stored targetGm)
//   • Delete button per method row
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { SectionService } from '@/types/estimating'
import type { ServiceRollupGroup } from '@/lib/estimating/maintenanceEditor'
import { deriveGm } from '@/lib/estimating/maintenanceEditor'
import { BLUE_CELL, cellInput } from './cells'

// ---------------------------------------------------------------------------
// GmField — the GM% display + editable input for one method row
// ---------------------------------------------------------------------------

function GmField({
  svc,
  onGmChange,
}: {
  svc: SectionService
  onGmChange: (serviceId: string, gm: number) => void
}) {
  const derived = deriveGm(svc)
  const displayPct = derived !== null ? Math.round(derived * 100) : null

  return (
    <div
      data-testid={`gm-field-${svc.id}`}
      className="flex items-center gap-1"
      aria-label={`GM for ${svc.label}: ${displayPct !== null ? `${displayPct}%` : '—'}`}
    >
      <input
        data-testid={`gm-input-${svc.id}`}
        type="number"
        min={0}
        max={100}
        aria-label={`GM% for ${svc.label}`}
        className={cn(cellInput, BLUE_CELL, 'w-16 text-right')}
        value={displayPct ?? ''}
        placeholder="—"
        onChange={(e) => {
          const raw = Number(e.target.value)
          if (!isNaN(raw) && raw >= 0 && raw <= 100) {
            onGmChange(svc.id, raw / 100)
          }
        }}
      />
      {/* Visible percentage suffix — this is what toHaveTextContent matches */}
      <span className="text-[11px] text-[hsl(var(--muted-fg))]">
        {displayPct !== null ? `${displayPct}%` : '—'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SquareFeetInput — per-method sqft override; placeholder = section sqft
// ---------------------------------------------------------------------------

function SquareFeetInput({
  svc,
  sectionSquareFeet,
  onUpdate,
}: {
  svc: SectionService
  sectionSquareFeet: number
  onUpdate: (serviceId: string, patch: Partial<SectionService>) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        data-testid={`sqft-input-${svc.id}`}
        type="number"
        min={0}
        aria-label={`Square feet for ${svc.label}`}
        className={cn(cellInput, BLUE_CELL, 'w-24 text-right')}
        value={svc.squareFeet ?? ''}
        placeholder={sectionSquareFeet.toLocaleString('en-US')}
        onChange={(e) => {
          const raw = e.target.value === '' ? null : Number(e.target.value)
          onUpdate(svc.id, { squareFeet: raw })
        }}
      />
      <span className="text-[11px] text-[hsl(var(--muted-fg))]">{svc.uom}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MethodRow — one section_services row when the service is expanded
// ---------------------------------------------------------------------------

function MethodRow({
  svc,
  sectionSquareFeet,
  onUpdate,
  onGmChange,
  onRemove,
}: {
  svc: SectionService
  sectionSquareFeet: number
  onUpdate: (serviceId: string, patch: Partial<SectionService>) => void
  onGmChange: (serviceId: string, gm: number) => void
  onRemove: (serviceId: string) => void
}) {
  return (
    <div
      data-testid={`method-row-${svc.id}`}
      className="flex items-center gap-3 py-1.5 pl-9 pr-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]"
    >
      <span className="min-w-0 flex-1 text-sm text-[hsl(var(--muted-fg))] truncate">
        {svc.label}
      </span>

      <SquareFeetInput svc={svc} sectionSquareFeet={sectionSquareFeet} onUpdate={onUpdate} />

      <GmField svc={svc} onGmChange={onGmChange} />

      <button
        type="button"
        onClick={() => onRemove(svc.id)}
        aria-label={`Remove method ${svc.label}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--muted-fg))] hover:bg-red-50 hover:text-red-600 cursor-pointer"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ServiceRollupRow — the collapsed/expanded service-level rollup
// ---------------------------------------------------------------------------

export interface ServiceRollupRowProps {
  group: ServiceRollupGroup
  sectionSquareFeet: number
  onToggle: (serviceId: string) => void
  onUpdate: (methodId: string, patch: Partial<SectionService>) => void
  onGmChange: (methodId: string, gm: number) => void
  onRemove: (methodId: string) => void
  /** Optional peak/off-peak toggle rendered inline on the header (Mowing only). */
  peakToggle?: ReactNode
}

export function ServiceRollupRow({
  group,
  sectionSquareFeet,
  onToggle,
  onUpdate,
  onGmChange,
  onRemove,
  peakToggle,
}: ServiceRollupRowProps) {
  const Chevron = group.isExpanded ? ChevronDown : ChevronRight

  return (
    <div data-testid={`service-rollup-${group.serviceId}`}>
      {/* Collapsed header — shows label + rolled-up $/yr */}
      <div
        data-testid={`service-rollup-header-${group.serviceId}`}
        data-expanded={group.isExpanded ? 'true' : 'false'}
        className="flex items-center gap-2 py-1.5 pl-9 pr-4 border-t border-[hsl(var(--border))]"
      >
        <button
          type="button"
          onClick={() => onToggle(group.serviceId)}
          aria-expanded={group.isExpanded}
          aria-label={`Toggle ${group.label} methods`}
          className="flex items-center gap-1 text-left text-sm text-[hsl(var(--fg))] cursor-pointer"
        >
          <Chevron className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="font-medium">{group.label}</span>
          <span className="ml-1 text-[11px] text-[hsl(var(--muted-fg))]">
            ({group.methods.length})
          </span>
        </button>

        {peakToggle && <div className="ml-2">{peakToggle}</div>}

        <span className="ml-auto text-sm font-semibold tabular-nums text-[hsl(var(--fg))]">
          {formatCents(group.totalYearlyCents)}
        </span>
      </div>

      {/* Expanded: one MethodRow per section_services row */}
      {group.isExpanded &&
        group.methods.map((svc) => (
          <MethodRow
            key={svc.id}
            svc={svc}
            sectionSquareFeet={sectionSquareFeet}
            onUpdate={onUpdate}
            onGmChange={onGmChange}
            onRemove={onRemove}
          />
        ))}
    </div>
  )
}
