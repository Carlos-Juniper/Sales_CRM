// ---------------------------------------------------------------------------
// Margin Analysis lib (margins.ts).
//
// Business rules under test:
//   groupMargin(price, cost) = (price − cost) / price     (via calc.ts)
//   $/acre = contractValue / acres
//   benchmarkStatus = value < min ? 'low' : value > max ? 'high' : 'ok'
//   • Re-aggregation BY SERVICE across sections, cost-basis, from the SAME
//     single estimate model the editors use (no second data tree).
//   • Maintenance cost is hours-driven; install cost is materials-inclusive
//     (embedded cost / labor+material component split).
//   • Benchmark bands are CONFIG values (provisional), never inline literals.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { buildInstallEstimate, buildMaintenanceEstimate } from '@/mocks/estimatingData'
import { contractTotal, groupMargin } from '@/lib/estimating/calc'
import {
  MARGIN_BENCHMARKS,
  barWidthPct,
  benchmarkStatus,
  estimateAcres,
  installLineCost,
  installLineCostSplit,
  maintenanceLineCost,
  medianCents,
  mowingPerOccurrenceCents,
  perAcreCents,
  resolveOccurrenceHours,
  serviceGroupMargins,
} from '@/lib/estimating/margins'
// Slice 11b: the crew-rate constant now lives in the pricing module
// (maintenance.ts), NOT margins.ts — margins.ts no longer owns a silent
// margin default. Callers must pass an explicit resolved rate.
import { MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR } from '@/lib/estimating/maintenance'
import type { CatalogItem } from '@/types/estimating'

// The rate the panel resolves and threads in; these lib tests pass it
// explicitly (there is no default anymore).
const RATE = MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR

const maint = buildMaintenanceEstimate()
const install = buildInstallEstimate()

/** A production-rated maintenance kit (mirrors the workbook seed rows). */
const MOWING_KIT: CatalogItem = {
  id: 'kit-maint-3422',
  description: 'Standard Production Mowing',
  uom: 'Sq. Ft.',
  unitCostCents: 1750,
  unitSellCents: 0,
  targetGm: 0.22,
  kitType: 'maintenance_hours',
  productionRate: 60_000, // sq ft per labor hour
  branch: 'All Branches',
  active: true,
  serviceType: 'Turf Area',
}

describe('maintenance cost basis (hours-driven)', () => {
  it('derives line cost from hours × qty × (1 + complexity) × loaded crew rate', () => {
    const s1 = maint.sections[0]
    const mowing = s1.services[0] // 1.6 h, 42/yr, +10%
    const expectedHours = 1.6 * 42 * 1.1 // 73.92 h/yr
    expect(maintenanceLineCost(s1, mowing, [], RATE)).toBe(
      Math.round(expectedHours * MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR),
    )
  })

  it('a null-hours line derives hours from its kit production rate (sqft ÷ rate)', () => {
    const s1 = maint.sections[0] // 120,000 SF
    const noHours = { ...s1.services[0], hours: null, catalogItemId: MOWING_KIT.id }
    // hours/occurrence = 120,000 / 60,000 = 2 h → 2 × 42 × 1.1 = 92.4 h/yr
    expect(resolveOccurrenceHours(s1, noHours, [MOWING_KIT])).toBeCloseTo(2, 10)
    expect(maintenanceLineCost(s1, noHours, [MOWING_KIT], RATE)).toBe(
      Math.round(2 * 42 * 1.1 * MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR),
    )
  })

  it('the circular price × (1 − targetMargin) fallback is GONE: an unresolvable line costs 0, never “priced at target”', () => {
    const s1 = maint.sections[0]
    const noHours = { ...s1.services[0], hours: null, catalogItemId: null }
    expect(resolveOccurrenceHours(s1, noHours)).toBeNull()
    // The old fallback would have returned round(2,494,800 × 0.78) — a number
    // that could never flag mispricing because it assumed target margin.
    expect(maintenanceLineCost(s1, noHours, [], RATE)).toBe(0)
    expect(maintenanceLineCost(s1, noHours, [], RATE)).not.toBe(Math.round(2_494_800 * 0.78))
  })

  it('a mispriced line now flags: cost from production rate diverges from price-at-target', () => {
    const s1 = maint.sections[0]
    // Same price either way; real cost = 92.4 h × $180/h = $16,632.
    const line = { ...s1.services[0], hours: null, catalogItemId: MOWING_KIT.id }
    const realCost = maintenanceLineCost(s1, line, [MOWING_KIT], RATE)
    const circular = Math.round(2_494_800 * 0.78)
    expect(realCost).not.toBe(circular) // over/under-pricing is now visible
  })
})

describe('install cost basis (materials-inclusive)', () => {
  it('uses qty × embedded cost for the line cost', () => {
    const trees = install.sections[0].services[0] // 24 × 68,750¢
    expect(installLineCost(trees)).toBe(24 * 68_750)
  })

  it('falls back to the component roll-up when embedded cost is missing', () => {
    const trees = install.sections[0].services[0]
    const noEmbedded = { ...trees, embeddedCostCents: null }
    // components per unit: 42,500 + 3.5×5,200 + 8,050 = 68,750
    expect(installLineCost(noEmbedded)).toBe(24 * 68_750)
  })

  it('splits cost into material / labor / unattributed from components', () => {
    const sod = install.sections[1].services[0] // 48 plt, embedded 26,900
    const split = installLineCostSplit(sod)
    expect(split.materialCents).toBe(48 * 19_500)
    expect(split.laborCents).toBe(48 * Math.round(1.1 * 5_200)) // 5,720/unit
    // Embedded (26,900) exceeds the component sum (25,220) → 1,680 unattributed.
    expect(split.unattributedCents).toBe(48 * (26_900 - 25_220))
    expect(split.materialCents + split.laborCents + split.unattributedCents).toBe(
      installLineCost(sod),
    )
  })
})

describe('serviceGroupMargins — pivot by service across sections', () => {
  it('merges same-label services from every section into one group', () => {
    const groups = serviceGroupMargins(maint, RATE)
    // Mowing appears in both sections; the other three labels once each.
    expect(groups.map((g) => g.label)).toEqual([
      'Mowing',
      'Detail / Bed Maintenance',
      'Irrigation Inspection',
      'Seasonal Color Rotation',
    ])
    const mowing = groups[0]
    // Section 1: 2,494,800¢ · Section 2: (45,000/1000)×450×42×1.15 = 978,075¢
    expect(mowing.priceCents).toBe(2_494_800 + 978_075)
    // Hours: 73.92 + 0.7×42×1.15 = 107.73 h/yr × rate
    expect(mowing.costCents).toBe(
      Math.round(1.6 * 42 * 1.1 * MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR) +
        Math.round(0.7 * 42 * 1.15 * MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR),
    )
    expect(mowing.marginPct).toBeCloseTo(groupMargin(mowing.priceCents, mowing.costCents), 10)
  })

  it('computes each group share of contract from the same contract total the editor uses', () => {
    const groups = serviceGroupMargins(maint, RATE)
    const contract = contractTotal(maint)
    const shareSum = groups.reduce((s, g) => s + g.shareOfContract, 0)
    expect(shareSum).toBeCloseTo(1, 10)
    expect(groups[0].shareOfContract).toBeCloseTo(groups[0].priceCents / contract, 10)
  })

  it('aggregates the install estimate materials-inclusively', () => {
    const groups = serviceGroupMargins(install, 0)
    expect(groups).toHaveLength(3)
    const trees = groups.find((g) => g.label.startsWith('Mahogany'))!
    expect(trees.priceCents).toBe(24 * 125_000)
    expect(trees.costCents).toBe(24 * 68_750)
    expect(trees.materialCostCents).toBe(24 * (42_500 + 8_050))
    expect(trees.laborCostCents).toBe(24 * Math.round(3.5 * 5_200))
  })
})

describe('benchmarks (config-driven, provisional)', () => {
  it('classifies below / in / above the band', () => {
    const band = MARGIN_BENCHMARKS.perAcre // $3,100–$3,900/ac
    expect(benchmarkStatus(band.minCents - 1, band)).toBe('low')
    expect(benchmarkStatus(band.minCents, band)).toBe('ok')
    expect(benchmarkStatus(band.maxCents, band)).toBe('ok')
    expect(benchmarkStatus(band.maxCents + 1, band)).toBe('high')
  })

  it('is flagged provisional (future III-6 historical auto-calculator)', () => {
    expect(MARGIN_BENCHMARKS.provisional).toBe(true)
  })

  it('derives acres from section square footage when acreage is not stored', () => {
    // 120,000 + 45,000 sqft = 165,000 / 43,560
    expect(estimateAcres(maint)).toBeCloseTo(165_000 / 43_560, 10)
    // Install fixture stores acreage explicitly.
    expect(estimateAcres(install)).toBe(2.1)
  })

  it('computes $/acre from contract value and acres', () => {
    expect(perAcreCents(maint)).toBeCloseTo(contractTotal(maint) / (165_000 / 43_560), 6)
  })

  it('computes mowing $/occurrence from the mowing group price ÷ occurrences', () => {
    const groups = serviceGroupMargins(maint, RATE)
    const mowing = groups.find((g) => g.label === 'Mowing')!
    // Both mowing lines are 42/yr — an occurrence is one site visit.
    expect(mowingPerOccurrenceCents(maint)).toBeCloseTo(mowing.priceCents / 42, 6)
  })

  it('returns null mowing $/occurrence when the estimate has no mowing group', () => {
    expect(mowingPerOccurrenceCents(install)).toBeNull()
  })

  it('computes the tree-work median from the config strip, not a literal', () => {
    const sorted = [...MARGIN_BENCHMARKS.treeWorkSaleCents].sort((a, b) => a - b)
    expect(MARGIN_BENCHMARKS.treeWorkSaleCents).toHaveLength(10)
    expect(medianCents(MARGIN_BENCHMARKS.treeWorkSaleCents)).toBe(
      (sorted[4] + sorted[5]) / 2,
    )
    // Design reference: median $4.6K, range $2.1K–$7.1K.
    expect(medianCents(MARGIN_BENCHMARKS.treeWorkSaleCents)).toBe(460_000)
    expect(sorted[0]).toBe(210_000)
    expect(sorted[9]).toBe(710_000)
  })
})

describe('bar scaling', () => {
  it('scales the group bar to margin/40 and caps at 100', () => {
    expect(barWidthPct(0.2)).toBeCloseTo(50, 10)
    expect(barWidthPct(0.44)).toBe(100)
    expect(barWidthPct(-0.1)).toBe(0)
  })
})
