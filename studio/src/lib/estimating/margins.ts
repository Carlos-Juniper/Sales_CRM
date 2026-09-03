// ---------------------------------------------------------------------------
// Margin Analysis logic — a manager gut-check BEFORE approval,
// not a pricing rule.
//
//   • Re-aggregates the open estimate BY SERVICE across all sections
//     (cost-basis). This is a PIVOT of the same single estimate model the
//     editors mutate — never a second data tree (the prototype's unsynced
//     copy is exactly what this replaces).
//   • Maintenance cost is HOURS-driven (hours × loaded crew rate);
//     install cost is MATERIALS-inclusive (embedded cost with a
//     labor/material component split, BRD II-9.7).
//   • Benchmark bands are CONFIG rows, clearly provisional — production
//     sources them from historical won-bid data (BRD III-6 auto-calculator).
//   • Margin classification always goes through calc.marginBand +
//     config.DEFAULT_MARGIN_BANDS — no local thresholds.
// ---------------------------------------------------------------------------

import type { CatalogItem, Estimate, EstimateSection, SectionService } from '@/types/estimating'
import {
  SQFT_PER_ACRE,
  contractTotal,
  groupMargin,
  installLineTotal,
  maintServiceLine,
} from './calc'

// ----- Benchmark config (provisional, BRD III-6) ------------------------------

export interface BenchmarkBand {
  /** Inclusive lower bound, integer cents. */
  minCents: number
  /** Inclusive upper bound, integer cents. */
  maxCents: number
  /** Display band, e.g. "$3,100–$3,900/ac". */
  bandLabel: string
  /** Comparable-set context, e.g. "120-ac govt parks · Desert region". */
  note: string
}

export interface MarginBenchmarkConfig {
  /**
   * PROVISIONAL: these are demo constants standing in for the BRD III-6
   * benchmark auto-calculator (compiled historical won-bid data). Kept as
   * config rows so swapping in the real source is a data change, not a code
   * change.
   */
  provisional: true
  region: string
  /** $/acre band for this bid vs comparable won bids. */
  perAcre: BenchmarkBand
  /** Annual contract $ band for comparable-size properties. */
  annualValue: BenchmarkBand
  /** Mowing $/occurrence vs peer median. */
  mowingPerOccurrence: BenchmarkBand & { medianCents: number }
  /** Last 10 tree-work sale prices, integer cents — median/range derived. */
  treeWorkSaleCents: number[]
}

// TODO(margin-benchmarks): these values are FABRICATED and must not ship as-is.
//
// Every number below is invented demo data, and `region: 'Desert'` is not even one of
// Juniper's regions — the real ones come from the `regions` config table (Handoff 37
// Amendment A.3). A wrong benchmark tells an approver a correctly-priced bid is
// out of band, or that an underpriced one is fine.
//
// These are explicitly OUT of the Settings page's scope, and deliberately so: the fix is
// NOT to make them admin-editable. BRD III-6 specifies a benchmark auto-calculator
// compiled from historical WON-BID data. A settings form would just be a hardcode with a
// nicer input box, and would ask someone to type numbers the database can derive.
//
// Implementation plan (own handoff, depends on the Settings-page branch migration):
//
//  1. SOURCE. Won bids are `estimates WHERE lifecycle = 'won'` — already persisted, with
//     `contract_value_cents`, `acreage`, `estimate_type`, `customer_type`, and (post-
//     migration) `aspire_branch_id`. `sections.square_feet` + `section_services` give the
//     per-service detail the mowing band needs. No new capture is required.
//
//  2. COHORT. A benchmark is only meaningful against comparables, which is what the fake
//     `note` fields ("120-ac govt parks · Desert region") were gesturing at. Define a
//     cohort as (region, estimate_type, customer_type, acreage bucket). Acreage buckets
//     want to come from the data, not be guessed — start with quartiles over won bids.
//
//  3. COMPUTE. Per cohort: p25/median/p75 of contract $/acre, of annual contract value,
//     and of mowing $/occurrence (derived from the mowing `section_services` line). Band
//     = p25..p75; median reported separately, as `mowingPerOccurrence.medianCents`
//     already expects. `treeWorkSaleCents` becomes the last N won tree-work line sale
//     prices for the cohort, not a literal array.
//
//  4. MINIMUM SAMPLE. Below a floor (start at n = 5) a cohort has no band. Render
//     "Not enough comparable won bids (n=2)" — never widen the cohort silently to
//     manufacture one, and never fall back to a company-wide number, which would
//     reintroduce exactly the confidently-wrong display this TODO exists to remove.
//
//  5. REFRESH. Nightly materialized rollup keyed on cohort, not a per-render query —
//     the panel reads one row. Recompute on `lifecycle -> 'won'` is optional.
//
//  6. PROVENANCE. Keep the `provisional` flag's spirit: the panel must always state the
//     cohort and sample size it is comparing against ("vs 14 won bids · 100-150ac ·
//     HOA · West Coast"), so an approver can weigh the comparison instead of trusting a
//     bare band. Until step 3 lands, the panel should show no bands at all rather than
//     these literals.
//
export const MARGIN_BENCHMARKS: MarginBenchmarkConfig = {
  provisional: true,
  region: 'Desert',
  perAcre: {
    minCents: 310_000,
    maxCents: 390_000,
    bandLabel: '$3,100–$3,900/ac',
    note: '120-ac govt parks · Desert region',
  },
  annualValue: {
    minCents: 34_000_000,
    maxCents: 46_000_000,
    bandLabel: '$340K–$460K',
    note: 'Won bids, 100–150 ac government',
  },
  mowingPerOccurrence: {
    minCents: 90_000,
    maxCents: 145_000,
    medianCents: 115_000,
    bandLabel: '$1,150 median',
    note: 'Peer median, large turf sites',
  },
  treeWorkSaleCents: [
    480_000, 210_000, 640_000, 320_000, 500_000, 290_000, 710_000, 380_000, 440_000, 560_000,
  ],
}

export type BenchmarkStatus = 'low' | 'ok' | 'high'

/** value < min → 'low' · value > max → 'high' · otherwise 'ok'. */
export function benchmarkStatus(
  valueCents: number,
  band: Pick<BenchmarkBand, 'minCents' | 'maxCents'>,
): BenchmarkStatus {
  if (valueCents < band.minCents) return 'low'
  if (valueCents > band.maxCents) return 'high'
  return 'ok'
}

/** Median of a cents series (average of the middle pair when even). */
export function medianCents(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return 0
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ----- Line cost bases ---------------------------------------------------------

/**
 * Per-occurrence hours for a maintenance line. The line's own
 * hours win; a null-hours line derives them from its kit's production rate
 * (units per labor hour → section sqft ÷ rate). Null when neither resolves —
 * a state the save guard (frontend + backend 422) prevents from persisting.
 */
export function resolveOccurrenceHours(
  section: EstimateSection,
  svc: SectionService,
  catalogItems: CatalogItem[] = [],
): number | null {
  if (svc.hours !== null) return svc.hours
  const kit = svc.catalogItemId
    ? catalogItems.find((k) => k.id === svc.catalogItemId)
    : undefined
  if (kit?.productionRate) return section.squareFeet / kit.productionRate
  return null
}

/** Annualized maintenance labor hours: hours/occurrence × qty × (1 + complexity). */
export function maintenanceLineHours(
  svc: SectionService,
  occurrenceHours: number = svc.hours ?? 0,
): number {
  return occurrenceHours * svc.qty * (1 + svc.complexityPct)
}

/**
 * Maintenance line cost, integer cents — ALWAYS hours × loaded crew rate.
 * Hours resolve from the line or its kit's production rate; the
 * old `price × (1 − targetMargin)` fallback is GONE — it was circular (it
 * assumed the line was priced exactly at target, so over/under-pricing could
 * never flag). An unresolvable line (blocked from saving by the guard) costs
 * 0 rather than inventing a number.
 *
 * Slice 11b: `crewRateCents` is REQUIRED — there is deliberately NO default.
 * A silent 18_000 fallback here would feed the Margin Analysis panel a
 * plausible-but-WRONG margin an approver then approves. Callers resolve the
 * rate (snapshot→live→null) and skip cost entirely when null (§2.3).
 */
export function maintenanceLineCost(
  section: EstimateSection,
  svc: SectionService,
  catalogItems: CatalogItem[],
  crewRateCents: number,
): number {
  const occurrenceHours = resolveOccurrenceHours(section, svc, catalogItems) ?? 0
  return Math.round(maintenanceLineHours(svc, occurrenceHours) * crewRateCents)
}

export interface InstallCostSplit {
  materialCents: number
  laborCents: number
  /** Embedded cost not explained by the component roll-up. */
  unattributedCents: number
}

/** Per-unit component cost, integer cents. */
function unitComponentCost(svc: SectionService, kind: 'labor' | 'material'): number {
  return svc.components
    .filter((c) => c.kind === kind)
    .reduce((sum, c) => sum + Math.round(c.qty * c.unitCostCents), 0)
}

/**
 * Install line cost, integer cents — qty × embedded cost, falling back to the
 * kit-component roll-up when no embedded cost is stored.
 */
export function installLineCost(svc: SectionService): number {
  const unitCost =
    svc.embeddedCostCents ??
    unitComponentCost(svc, 'material') + unitComponentCost(svc, 'labor')
  return Math.round(svc.qty * unitCost)
}

/** Materials-inclusive split of an install line's cost (BRD II-9.7). */
export function installLineCostSplit(svc: SectionService): InstallCostSplit {
  const materialCents = Math.round(svc.qty * unitComponentCost(svc, 'material'))
  const laborCents = Math.round(svc.qty * unitComponentCost(svc, 'labor'))
  const unattributedCents = Math.max(0, installLineCost(svc) - materialCents - laborCents)
  return { materialCents, laborCents, unattributedCents }
}

// ----- Service-group pivot -------------------------------------------------------

export interface ServiceGroupMargin {
  /** Group key — the service label, merged across sections. */
  label: string
  priceCents: number
  costCents: number
  /** Install only (0 for maintenance). */
  materialCostCents: number
  laborCostCents: number
  unattributedCostCents: number
  /** Maintenance only (0 for install): annualized labor hours. */
  hoursPerYear: number
  /** Decimal gross margin: (price − cost) / price. */
  marginPct: number
  /** Decimal share of the contract total. */
  shareOfContract: number
  /** Max occurrences/yr across the group's lines (an occurrence = one visit). */
  maxQty: number
}

/**
 * Re-aggregate the section-organized estimate BY
 * SERVICE across all sections, on a cost basis. Reads the same live model the
 * editors mutate — editing a line flows straight into these numbers.
 *
 * Slice 11b: `crewRateCents` is REQUIRED for a maintenance estimate — the
 * caller resolves it (snapshot→live) and must NOT call this at all when the
 * rate is null (the panel refuses a number instead, §2.3). Install estimates
 * ignore it (their cost is materials-inclusive), so it may be 0 there.
 */
export function serviceGroupMargins(
  estimate: Estimate,
  crewRateCents: number,
  catalogItems: CatalogItem[] = [],
): ServiceGroupMargin[] {
  const contract = contractTotal(estimate)
  const groups = new Map<string, ServiceGroupMargin>()

  for (const section of estimate.sections) {
    for (const svc of section.services) {
      let g = groups.get(svc.label)
      if (!g) {
        g = {
          label: svc.label,
          priceCents: 0,
          costCents: 0,
          materialCostCents: 0,
          laborCostCents: 0,
          unattributedCostCents: 0,
          hoursPerYear: 0,
          marginPct: 0,
          shareOfContract: 0,
          maxQty: 0,
        }
        groups.set(svc.label, g)
      }
      if (estimate.estimateType === 'maintenance') {
        g.priceCents += maintServiceLine(
          section.squareFeet,
          svc.unitSellCents ?? 0,
          svc.qty,
          svc.complexityPct,
        )
        g.costCents += maintenanceLineCost(section, svc, catalogItems, crewRateCents)
        g.hoursPerYear += maintenanceLineHours(
          svc,
          resolveOccurrenceHours(section, svc, catalogItems) ?? 0,
        )
      } else {
        const split = installLineCostSplit(svc)
        g.priceCents += installLineTotal(svc.qty, svc.unitSellCents ?? 0)
        g.costCents += installLineCost(svc)
        g.materialCostCents += split.materialCents
        g.laborCostCents += split.laborCents
        g.unattributedCostCents += split.unattributedCents
      }
      g.maxQty = Math.max(g.maxQty, svc.qty)
    }
  }

  return [...groups.values()].map((g) => ({
    ...g,
    marginPct: groupMargin(g.priceCents, g.costCents),
    shareOfContract: contract === 0 ? 0 : g.priceCents / contract,
  }))
}

// ----- Benchmark reads --------------------------------------------------------------

/** Acres: stored acreage when present, else derived from Σ section sqft. */
export function estimateAcres(estimate: Estimate): number {
  if (estimate.acreage !== null && estimate.acreage > 0) return estimate.acreage
  const sqft = estimate.sections.reduce((s, sec) => s + sec.squareFeet, 0)
  return sqft / SQFT_PER_ACRE
}

/** $/acre in cents: contract value ÷ acres (0 when acres is 0). */
export function perAcreCents(estimate: Estimate): number {
  const acres = estimateAcres(estimate)
  if (acres === 0) return 0
  return contractTotal(estimate) / acres
}

/**
 * Mowing $/occurrence in cents: the mowing group's aggregated price ÷ the
 * occurrence count (max qty — one occurrence is one site visit that covers
 * every section). Null when the estimate has no mowing group.
 */
export function mowingPerOccurrenceCents(
  estimate: Estimate,
  catalogItems: CatalogItem[] = [],
): number | null {
  // Price-basis read only (occurrence price ÷ max qty) — the crew rate never
  // enters here, so 0 is safe: it touches cost, which this ignores.
  const mowing = serviceGroupMargins(estimate, 0, catalogItems).find((g) => /mow/i.test(g.label))
  if (!mowing || mowing.maxQty === 0) return null
  return mowing.priceCents / mowing.maxQty
}

// ----- Display scaling ----------------------------------------------------------------

/** Group bar width %: margin scaled to a 40% full-scale, clamped 0–100. */
export function barWidthPct(marginPct: number): number {
  return Math.min(100, Math.max(0, (marginPct / 0.4) * 100))
}
