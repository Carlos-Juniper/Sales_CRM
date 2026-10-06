// ---------------------------------------------------------------------------
// Handoff 59 §B4 — service-level rollup grouping for the maintenance editor
// redesign.
//
// The redesign collapses the flat list of `section_services` rows (each a
// "method row") into a two-level hierarchy that mirrors Aspire:
//
//   Category (CategoryBlock, unchanged)
//     └── Service line (ServiceRollupRow — NEW, this file)
//           └── Method rows (expanded on demand)
//
// A "service line" is a computed rollup of all `section_services` rows that
// share the same `serviceId`. No schema change: the persisted rows stay
// method-level; grouping is a render-time concern only.
// ---------------------------------------------------------------------------

import type { SectionService } from '@/types/estimating'

// ---------------------------------------------------------------------------
// ServiceRollupGroup — a collapsed service line in the hierarchy
// ---------------------------------------------------------------------------

export interface ServiceRollupGroup {
  /** The catalog `services.id` shared by all method rows. */
  serviceId: string
  /**
   * Display label: the label of the first method row (they share a catalog
   * service so the label is stable). Falls back to serviceId for ungrouped
   * hand-entered rows.
   */
  label: string
  /** All `section_services` rows that belong to this service. */
  methods: SectionService[]
  /**
   * Σ (unitSellCents × qty) across all method rows. Null unitSellCents counts
   * as 0. This is the rolled-up $/yr displayed on the collapsed line.
   */
  totalYearlyCents: number
  /** UI state: whether the method rows are currently visible. */
  isExpanded: boolean
}

// ---------------------------------------------------------------------------
// groupByService — the grouping primitive
// ---------------------------------------------------------------------------

/**
 * Group an array of `SectionService` rows by their `serviceId` into
 * `ServiceRollupGroup` entries. Order is preserved: the first method row
 * in each group determines the group's position in the output array.
 *
 * Rows with a null/undefined `serviceId` are placed in their own singleton
 * group keyed by their `id` (hand-entered lines with no catalog link).
 *
 * All groups start with `isExpanded: false` — the caller controls expand
 * state via the `onToggle` prop.
 */
export function groupByService(services: SectionService[]): ServiceRollupGroup[] {
  const order: string[] = []
  const buckets = new Map<string, SectionService[]>()

  for (const svc of services) {
    const key = svc.serviceId ?? svc.id
    if (!buckets.has(key)) {
      order.push(key)
      buckets.set(key, [])
    }
    buckets.get(key)!.push(svc)
  }

  return order.map((key) => {
    const methods = buckets.get(key)!
    const totalYearlyCents = methods.reduce(
      (sum, m) => sum + (m.unitSellCents ?? 0) * m.qty,
      0,
    )
    return {
      serviceId: key,
      label: methods[0].label,
      methods,
      totalYearlyCents,
      isExpanded: false,
    }
  })
}

// ---------------------------------------------------------------------------
// GM% derivation — derive gross margin when targetGm is not stored
// ---------------------------------------------------------------------------

/**
 * Derive a gross-margin percentage from a method row's sell/cost relationship.
 *
 * When `targetGm` is set, it is returned as-is. Otherwise the GM is derived
 * from the sell price and an implied cost using the labor markup factor:
 *
 *   cost = sell / (1 + laborMarkupPct)    [laborMarkupPct as a markup ratio]
 *   GM   = (sell - cost) / sell
 *          = 1 - 1/(1 + laborMarkupPct)
 *
 * The simpler form used by the initial implementation reads GM directly from
 * (sell - cost) / sell when both unitSellCents and a cost signal are available.
 *
 * Returns null when there is insufficient data to derive a GM.
 */
export function deriveGm(svc: Pick<SectionService, 'targetGm' | 'unitSellCents' | 'laborMarkupPct'>): number | null {
  if (svc.targetGm !== null && svc.targetGm !== undefined) {
    return svc.targetGm
  }
  // No targetGm — derive from the laborMarkupPct if available
  if (svc.laborMarkupPct !== undefined && svc.laborMarkupPct !== null) {
    // markup = sell/cost - 1  →  cost = sell/(1+markup)  →  GM = 1 - 1/(1+markup)
    const markup = svc.laborMarkupPct
    if (markup < 0) return null
    return 1 - 1 / (1 + markup)
  }
  // Fallback: derive from sell/cost ratio if sell is known
  if (svc.unitSellCents !== null && svc.unitSellCents !== undefined && svc.unitSellCents > 0) {
    // Without a cost signal we cannot derive a meaningful GM — return null
    return null
  }
  return null
}
