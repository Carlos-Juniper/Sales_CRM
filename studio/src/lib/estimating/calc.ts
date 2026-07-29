// ---------------------------------------------------------------------------
// Pure calculation helpers for the Estimating tab (Handoff 00 §5).
//
// Both editor engines (maintenance hours-driven, install quantity-driven) and
// every analysis view share these implementations — there is exactly one.
//
// Money math is integer cents; rounding happens here (to the cent) and at
// display, never in between. Percentages are decimals (0.22 = 22%).
// ---------------------------------------------------------------------------

import type {
  ApprovalTier,
  Estimate,
  EstimateSection,
  EstimateType,
  MarginBandLabel,
  MarginBands,
} from '@/types/estimating'

export const SQFT_PER_ACRE = 43560

/** Acreage is always derived from square feet, never stored. */
export function acresFromSqft(sqft: number): number {
  return sqft / SQFT_PER_ACRE
}

/**
 * Maintenance line total in integer cents.
 * (sqft/1000) × rate-per-1000sf (cents) × occurrences/yr × (1 + complexity).
 * Complexity adjusts hours (and therefore price) — never adjust hours to hit
 * a price; margin is the commercial lever.
 */
export function maintServiceLine(
  sqft: number,
  rateCentsPer1000Sf: number,
  qty: number,
  complexityPct: number,
): number {
  return Math.round((sqft / 1000) * rateCentsPer1000Sf * qty * (1 + complexityPct))
}

/** Install line total in integer cents: QTY × unit sell price. */
export function installLineTotal(qty: number, unitSellCents: number): number {
  return Math.round(qty * unitSellCents)
}

/** Kit component cost in integer cents: QTY × unit cost. */
export function componentCost(qty: number, unitCostCents: number): number {
  return Math.round(qty * unitCostCents)
}

/**
 * Section total in integer cents. The engine is keyed off the parent
 * estimate's `estimateType` — never a per-section mode.
 */
export function sectionTotal(section: EstimateSection, estimateType: EstimateType): number {
  return section.services.reduce((sum, svc) => {
    const rate = svc.unitSellCents ?? 0
    return (
      sum +
      (estimateType === 'maintenance'
        ? maintServiceLine(section.squareFeet, rate, svc.qty, svc.complexityPct)
        : installLineTotal(svc.qty, rate))
    )
  }, 0)
}

/** Contract total in integer cents: Σ section totals. */
export function contractTotal(estimate: Estimate): number {
  return estimate.sections.reduce(
    (sum, section) => sum + sectionTotal(section, estimate.estimateType),
    0,
  )
}

/** Display read: cents per 1,000 sqft. Returns 0 when sqft is 0. */
export function per1000SfRead(sectionTotalCents: number, sqft: number): number {
  if (sqft === 0) return 0
  return sectionTotalCents / (sqft / 1000)
}

/**
 * Takeoff bid quantity: plan qty inflated by the add %, rounded up.
 * Snaps to 9 decimals before ceiling so float artifacts (100 × 1.1 =
 * 110.00000000000001) don't inflate the bid by a whole unit.
 */
export function bidQty(planQty: number, addPct: number): number {
  return Math.ceil(Math.round(planQty * (1 + addPct) * 1e9) / 1e9)
}

/**
 * Discrepancy flag: |measured − plan| / plan strictly exceeds the threshold.
 * The threshold is a config value (see DISCREPANCY_THRESHOLD) — never baked in.
 * A zero plan qty never flags.
 */
export function isFlagged(measuredQty: number, planQty: number, threshold: number): boolean {
  if (planQty === 0) return false
  return Math.abs(measuredQty - planQty) / planQty > threshold
}

/** Gross margin as a decimal: (price − cost) / price. Returns 0 when price is 0. */
export function groupMargin(priceCents: number, costCents: number): number {
  if (priceCents === 0) return 0
  return (priceCents - costCents) / priceCents
}

/**
 * Config-driven approval routing: the first tier (by `order`) where
 * min ≤ value < max (max null = unbounded). Returns null when no tier
 * matches — e.g. install, which has no approval matrix yet.
 */
export function tierForValue(valueCents: number, tiers: ApprovalTier[]): ApprovalTier | null {
  const ordered = [...tiers].sort((a, b) => a.order - b.order)
  return (
    ordered.find(
      (t) =>
        valueCents >= t.minValueCents &&
        (t.maxValueCents === null || valueCents < t.maxValueCents),
    ) ?? null
  )
}

/** Classify a margin against the single canonical band config. */
export function marginBand(marginPct: number, bands: MarginBands): MarginBandLabel {
  if (marginPct >= bands.goodMin) return 'good'
  if (marginPct >= bands.okMin) return 'ok'
  return 'low'
}
