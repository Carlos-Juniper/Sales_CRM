import { describe, it, expect } from 'vitest'
import {
  acresFromSqft,
  maintServiceLine,
  installLineTotal,
  componentCost,
  sectionTotal,
  contractTotal,
  per1000SfRead,
  bidQty,
  isFlagged,
  groupMargin,
  tierForValue,
  marginBand,
} from '@/lib/estimating/calc'
import type { ApprovalTier, EstimateSection, MarginBands } from '@/types/estimating'
import { buildMaintenanceEstimate, buildInstallEstimate } from '@/mocks/estimatingData'

function section(overrides: Partial<EstimateSection> = {}): EstimateSection {
  return {
    id: 's1',
    estimateId: 'e1',
    name: 'Common Area',
    squareFeet: 10000,
    sortOrder: 0,
    services: [],
    ...overrides,
  }
}

describe('acresFromSqft', () => {
  it('converts 43,560 sqft to exactly 1 acre', () => {
    expect(acresFromSqft(43560)).toBe(1)
  })
  it('converts 0 sqft to 0 acres', () => {
    expect(acresFromSqft(0)).toBe(0)
  })
  it('converts fractional acreage', () => {
    expect(acresFromSqft(21780)).toBeCloseTo(0.5)
  })
})

describe('maintServiceLine', () => {
  it('computes (sqft/1000) * rate * qty * (1 + complexity) in integer cents', () => {
    // 10 units of 1000sf * 450c * 42 occurrences * 1.10 = 207,900c
    expect(maintServiceLine(10000, 450, 42, 0.1)).toBe(207900)
  })
  it('applies zero complexity as no adder', () => {
    expect(maintServiceLine(10000, 450, 42, 0)).toBe(189000)
  })
  it('rounds fractional cents to the nearest integer cent', () => {
    // 1.5 * 333 * 1 * 1 = 499.5 -> 500
    expect(maintServiceLine(1500, 333, 1, 0)).toBe(500)
  })
  it('returns 0 for zero sqft', () => {
    expect(maintServiceLine(0, 450, 42, 0.1)).toBe(0)
  })
})

describe('installLineTotal', () => {
  it('computes qty * unit sell in integer cents', () => {
    expect(installLineTotal(3, 125050)).toBe(375150)
  })
  it('rounds fractional quantities to integer cents', () => {
    expect(installLineTotal(2.5, 101)).toBe(253)
  })
  it('returns 0 for zero qty', () => {
    expect(installLineTotal(0, 125050)).toBe(0)
  })
})

describe('componentCost', () => {
  it('computes qty * unit cost in integer cents', () => {
    expect(componentCost(4, 6875)).toBe(27500)
  })
  it('rounds fractional results', () => {
    expect(componentCost(1.5, 333)).toBe(500)
  })
})

describe('sectionTotal', () => {
  it('sums maintenance service lines with the hours-driven engine', () => {
    const s = section({
      squareFeet: 10000,
      services: [
        {
          id: 'sv1', sectionId: 's1', catalogItemId: null, label: 'Mowing',
          qty: 42, uom: '/yr', complexityPct: 0.1, unitSellCents: 450,
          embeddedCostCents: null, targetGm: null, hours: null, sortOrder: 0, components: [],
        },
        {
          id: 'sv2', sectionId: 's1', catalogItemId: null, label: 'Detail',
          qty: 12, uom: '/yr', complexityPct: 0, unitSellCents: 300,
          embeddedCostCents: null, targetGm: null, hours: null, sortOrder: 1, components: [],
        },
      ],
    })
    // 207900 + (10 * 300 * 12) = 207900 + 36000
    expect(sectionTotal(s, 'maintenance')).toBe(243900)
  })

  it('sums install service lines with the quantity-driven engine', () => {
    const s = section({
      services: [
        {
          id: 'sv1', sectionId: 's1', catalogItemId: null, label: 'Mahogany 10-12 — Installed',
          qty: 3, uom: 'ea', complexityPct: 0, unitSellCents: 125050,
          embeddedCostCents: 68750, targetGm: 0.45, hours: null, sortOrder: 0, components: [],
        },
        {
          id: 'sv2', sectionId: 's1', catalogItemId: null, label: 'Irrigation lateral',
          qty: 100, uom: 'FT', complexityPct: 0, unitSellCents: 250,
          embeddedCostCents: 138, targetGm: 0.45, hours: null, sortOrder: 1, components: [],
        },
      ],
    })
    expect(sectionTotal(s, 'install')).toBe(375150 + 25000)
  })

  it('returns 0 for a section with no services', () => {
    expect(sectionTotal(section(), 'maintenance')).toBe(0)
    expect(sectionTotal(section(), 'install')).toBe(0)
  })

  it('treats a null unit sell as 0', () => {
    const s = section({
      services: [{
        id: 'sv1', sectionId: 's1', catalogItemId: null, label: 'TBD',
        qty: 5, uom: 'ea', complexityPct: 0, unitSellCents: null,
        embeddedCostCents: null, targetGm: null, hours: null, sortOrder: 0, components: [],
      }],
    })
    expect(sectionTotal(s, 'install')).toBe(0)
  })
})

describe('contractTotal', () => {
  it('sums section totals across a maintenance estimate', () => {
    const est = buildMaintenanceEstimate()
    const expected = est.sections.reduce((sum, s) => sum + sectionTotal(s, 'maintenance'), 0)
    expect(contractTotal(est)).toBe(expected)
    expect(contractTotal(est)).toBeGreaterThan(0)
  })
  it('sums section totals across an install estimate', () => {
    const est = buildInstallEstimate()
    const expected = est.sections.reduce((sum, s) => sum + sectionTotal(s, 'install'), 0)
    expect(contractTotal(est)).toBe(expected)
    expect(contractTotal(est)).toBeGreaterThan(0)
  })
  it('keys the engine off estimateType — same sections price differently per type', () => {
    const maint = buildMaintenanceEstimate()
    const asInstallSections = maint.sections.reduce(
      (sum, s) => sum + sectionTotal(s, 'install'), 0)
    expect(contractTotal(maint)).not.toBe(asInstallSections)
  })
})

describe('per1000SfRead', () => {
  it('divides section total by (sqft/1000)', () => {
    expect(per1000SfRead(207900, 10000)).toBeCloseTo(20790)
  })
  it('returns 0 when sqft is 0 (no division by zero)', () => {
    expect(per1000SfRead(207900, 0)).toBe(0)
  })
})

describe('bidQty', () => {
  it('rounds up plan qty inflated by add pct', () => {
    expect(bidQty(100, 0.1)).toBe(110)
    expect(bidQty(101, 0.1)).toBe(112) // 111.1 -> 112
  })
  it('returns plan qty when add pct is 0', () => {
    expect(bidQty(100, 0)).toBe(100)
  })
  it('returns 0 for zero plan qty', () => {
    expect(bidQty(0, 0.25)).toBe(0)
  })
})

describe('isFlagged', () => {
  it('flags when |measured - plan| / plan exceeds threshold', () => {
    expect(isFlagged(115, 100, 0.1)).toBe(true)
    expect(isFlagged(85, 100, 0.1)).toBe(true)
  })
  it('does not flag when deviation equals threshold exactly', () => {
    expect(isFlagged(110, 100, 0.1)).toBe(false)
  })
  it('never flags when plan qty is 0', () => {
    expect(isFlagged(500, 0, 0.1)).toBe(false)
  })
})

describe('groupMargin', () => {
  it('computes (price - cost) / price', () => {
    expect(groupMargin(100000, 78000)).toBeCloseTo(0.22)
  })
  it('returns 0 when price is 0', () => {
    expect(groupMargin(0, 78000)).toBe(0)
  })
})

describe('tierForValue', () => {
  const tiers: ApprovalTier[] = [
    { id: 't1', roleKey: 'branch_manager', label: 'Branch Manager', minValueCents: 0, maxValueCents: 10_000_000, order: 1, estimateType: 'maintenance' },
    { id: 't2', roleKey: 'regional_director', label: 'Regional Director', minValueCents: 10_000_000, maxValueCents: 25_000_000, order: 2, estimateType: 'maintenance' },
    { id: 't3', roleKey: 'bp', label: 'Business Partner', minValueCents: 25_000_000, maxValueCents: 100_000_000, order: 3, estimateType: 'maintenance' },
    { id: 't4', roleKey: 'coo', label: 'COO', minValueCents: 100_000_000, maxValueCents: null, order: 4, estimateType: 'maintenance' },
  ]

  it('returns the first tier where min <= value < max', () => {
    expect(tierForValue(5_000_000, tiers)?.roleKey).toBe('branch_manager')
    expect(tierForValue(15_000_000, tiers)?.roleKey).toBe('regional_director')
  })
  it('treats min as inclusive and max as exclusive', () => {
    expect(tierForValue(10_000_000, tiers)?.roleKey).toBe('regional_director')
    expect(tierForValue(9_999_999, tiers)?.roleKey).toBe('branch_manager')
  })
  it('treats a null max as unbounded', () => {
    expect(tierForValue(500_000_000, tiers)?.roleKey).toBe('coo')
  })
  it('returns null when no tier matches', () => {
    expect(tierForValue(5_000_000, [])).toBeNull()
  })
  it('respects tier order, not array order', () => {
    const shuffled = [tiers[3], tiers[1], tiers[0], tiers[2]]
    expect(tierForValue(5_000_000, shuffled)?.roleKey).toBe('branch_manager')
  })
})

describe('marginBand', () => {
  const bands: MarginBands = { goodMin: 0.2, okMin: 0.12 }

  it('classifies margin >= goodMin as good (inclusive)', () => {
    expect(marginBand(0.25, bands)).toBe('good')
    expect(marginBand(0.2, bands)).toBe('good')
  })
  it('classifies okMin <= margin < goodMin as ok', () => {
    expect(marginBand(0.15, bands)).toBe('ok')
    expect(marginBand(0.12, bands)).toBe('ok')
  })
  it('classifies margin < okMin as low', () => {
    expect(marginBand(0.1, bands)).toBe('low')
    expect(marginBand(-0.05, bands)).toBe('low')
  })
  it('is fully driven by the bands config, not literals', () => {
    expect(marginBand(0.15, { goodMin: 0.34, okMin: 0.28 })).toBe('low')
    expect(marginBand(0.3, { goodMin: 0.34, okMin: 0.28 })).toBe('ok')
  })
})
