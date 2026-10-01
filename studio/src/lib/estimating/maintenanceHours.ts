// ---------------------------------------------------------------------------
// Handoff 54 §3 — per-line and per-category hours/price reads for the
// maintenance editor (Aspire columns OCC · COMP · P/H · TH · P/P · TP).
// Hours reuse resolveOccurrenceHours / maintenanceLineHours from margins.ts
// and price reuses maintServiceLine from calc.ts — nothing is reimplemented.
// Unresolvable hours are null and render "—", never 0.
// ---------------------------------------------------------------------------

import type { EstimateSection, SectionService, ServiceKit } from '@/types/estimating'
import { maintServiceLine } from './calc'
import { maintenanceLineHours, resolveOccurrenceHours } from './margins'

export interface MaintenanceLineRead {
  /** P/H: hours per occurrence, complexity applied. */
  perOccurrenceHours: number | null
  /** TH: annual hours. */
  totalHours: number | null
  /** P/P: price per occurrence, integer cents (null with no occurrences). */
  perOccurrenceCents: number | null
  /** TP: annual line price, integer cents. */
  lineCents: number
}

export function maintenanceLineRead(
  section: EstimateSection,
  svc: SectionService,
  serviceKits: ServiceKit[],
): MaintenanceLineRead {
  const occurrenceHours = resolveOccurrenceHours(section, svc, serviceKits)
  const lineCents = maintServiceLine(
    section.squareFeet,
    svc.unitSellCents ?? 0,
    svc.qty,
    svc.complexityPct,
  )
  return {
    perOccurrenceHours:
      occurrenceHours === null ? null : maintenanceLineHours({ ...svc, qty: 1 }, occurrenceHours),
    totalHours: occurrenceHours === null ? null : maintenanceLineHours(svc, occurrenceHours),
    perOccurrenceCents: svc.qty > 0 ? Math.round(lineCents / svc.qty) : null,
    lineCents,
  }
}

export interface CategoryRollup {
  /** Σ TH; null when any line's hours are unresolvable. */
  totalHours: number | null
  /** Σ TP, integer cents. */
  totalCents: number
}

export function categoryRollup(
  section: EstimateSection,
  services: SectionService[],
  serviceKits: ServiceKit[],
): CategoryRollup {
  const reads = services.map((svc) => maintenanceLineRead(section, svc, serviceKits))
  const unresolved = reads.some((r) => r.totalHours === null)
  return {
    totalHours: unresolved ? null : reads.reduce((sum, r) => sum + (r.totalHours ?? 0), 0),
    totalCents: reads.reduce((sum, r) => sum + r.lineCents, 0),
  }
}

/** A category with no occurrences starts collapsed. */
export function hasOccurrences(services: SectionService[]): boolean {
  return services.some((s) => s.qty > 0)
}

/** Hours to 2 decimals with grouping; null renders the em dash. */
export function formatHours(hours: number | null): string {
  if (hours === null) return '—'
  return hours.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
