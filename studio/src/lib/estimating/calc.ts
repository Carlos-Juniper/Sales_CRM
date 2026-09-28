// ---------------------------------------------------------------------------
// Pure calculation helpers for the Estimating tab.
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
 * Square-foot catalog units. Compared after stripping spaces and periods, so
 * "Sq. Ft.", "sq ft", and "SF" all match. Every other catalog unit (EA, CT,
 * LF, HR, "3CF Bag", …) is a flat unit price.
 *
 * Paired with api/estimating.py `_is_flat_catalog_uom` — keep the two in step.
 */
const AREA_CATALOG_UOMS = new Set(['sqft', 'sf'])

/** Catalog UOM, comparable: lowercase, no spaces or periods. */
export function normalizeCatalogUom(uom: string | null | undefined): string {
  if (!uom) return ''
  return uom.toLowerCase().replace(/[\s.]/g, '')
}

/**
 * Flat unit price when the catalog item's UOM is present and is not a
 * square-foot unit. A missing catalog UOM is not flat — a hand-entered line
 * has no catalog item, and the line's own `uom` is not a pricing signal
 * (the contract seed stores `/yr` on flat-priced lines).
 */
export function isFlatCatalogUom(uom: string | null | undefined): boolean {
  const normalized = normalizeCatalogUom(uom)
  if (!normalized) return false
  return !AREA_CATALOG_UOMS.has(normalized)
}

/**
 * Area-priced maintenance line total in integer cents.
 * (sqft/1000) × rate-per-1000sf (cents) × occurrences/yr × (1 + complexity).
 * Complexity adjusts hours (and therefore price) — never adjust hours to hit
 * a price; margin is the commercial lever.
 *
 * Callers price a line through `lineSellCents`. This is only the per-1,000-sf
 * engine.
 */
export function maintServiceLine(
  sqft: number,
  rateCentsPer1000Sf: number,
  qty: number,
  complexityPct: number,
): number {
  return Math.round((sqft / 1000) * rateCentsPer1000Sf * qty * (1 + complexityPct))
}

/** Quantity × unit price in integer cents. Install lines, and flat maintenance lines. */
export function installLineTotal(qty: number, unitSellCents: number): number {
  return Math.round(qty * unitSellCents)
}

/**
 * Sell price of one line, integer cents. The only line-pricing decision.
 *
 * Install is always qty × unitSellCents. Maintenance uses the per-1,000-sf
 * engine when the catalog UOM is square feet (or when the line has no catalog
 * UOM). A non-area catalog UOM is a flat unit price: qty × unitSellCents,
 * with no section-area multiplier and no complexity adder.
 */
export function lineSellCents(
  estimateType: EstimateType,
  sqft: number,
  unitSellCents: number,
  qty: number,
  complexityPct: number,
  catalogUom: string | null | undefined,
): number {
  if (estimateType !== 'maintenance' || isFlatCatalogUom(catalogUom)) {
    return installLineTotal(qty, unitSellCents)
  }
  return maintServiceLine(sqft, unitSellCents, qty, complexityPct)
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
      lineSellCents(estimateType, section.squareFeet, rate, svc.qty, svc.complexityPct, svc.catalogUom)
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
 * Takeoff bid quantity: plan qty inflated by the add %, rounded to the
 * NEAREST whole unit (locked decision: round, not ceil — pending
 * the Project Summary Template walkthrough confirmation).
 */
export function bidQty(planQty: number, addPct: number): number {
  return Math.round(planQty * (1 + addPct))
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
 * matches (an empty/misconfigured ladder).
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
