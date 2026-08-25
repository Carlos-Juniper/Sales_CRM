import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MARGIN_BANDS,
  DISCREPANCY_THRESHOLD,
  APPROVAL_TIER_SEED,
  ITB_SCOPE_SEED,
  MATERIAL_FORMULA_ROWS,
  buildMaterialCalc,
  tiersForType,
} from '@/lib/estimating/config'
import { tierForValue, marginBand, isFlagged } from '@/lib/estimating/calc'
import type { ApprovalTier, MaterialCalcRow } from '@/types/estimating'

describe('margin bands config', () => {
  it('seeds the single canonical band set (good_min=0.20, ok_min=0.12 — pending Carlos confirmation)', () => {
    expect(DEFAULT_MARGIN_BANDS).toEqual({ goodMin: 0.2, okMin: 0.12 })
  })
  it('drives marginBand behavior entirely from the config row', () => {
    expect(marginBand(0.21, DEFAULT_MARGIN_BANDS)).toBe('good')
    expect(marginBand(0.13, DEFAULT_MARGIN_BANDS)).toBe('ok')
    expect(marginBand(0.11, DEFAULT_MARGIN_BANDS)).toBe('low')
  })
})

describe('discrepancy threshold config', () => {
  it('defaults to 10% with a 1–25% allowed range', () => {
    expect(DISCREPANCY_THRESHOLD.defaultPct).toBe(0.1)
    expect(DISCREPANCY_THRESHOLD.minPct).toBe(0.01)
    expect(DISCREPANCY_THRESHOLD.maxPct).toBe(0.25)
  })
  it('is consumed by isFlagged as a parameter, not baked in', () => {
    expect(isFlagged(115, 100, DISCREPANCY_THRESHOLD.defaultPct)).toBe(true)
    expect(isFlagged(115, 100, 0.25)).toBe(false)
  })
})

describe('approval tiers config', () => {
  it('seeds the maintenance ladder from BRD I-7 with the canonical role keys (Handoff 19): MGR <$100K, RD $100K–$250K, VP $250K–$1M, CEO >$1M', () => {
    const maint = tiersForType(APPROVAL_TIER_SEED, 'maintenance')
    expect(maint.map((t) => t.roleKey)).toEqual(['manager', 'regional_director', 'vice_president', 'ceo'])
    expect(tierForValue(9_999_900, maint)?.roleKey).toBe('manager')
    expect(tierForValue(20_000_000, maint)?.roleKey).toBe('regional_director')
    expect(tierForValue(50_000_000, maint)?.roleKey).toBe('vice_president')
    expect(tierForValue(200_000_000, maint)?.roleKey).toBe('ceo')
  })

  it('seeds an INSTALL ladder mirroring the maintenance $ bands (Handoff 19 §4)', () => {
    const maint = tiersForType(APPROVAL_TIER_SEED, 'maintenance')
    const install = tiersForType(APPROVAL_TIER_SEED, 'install')
    expect(install.map((t) => [t.roleKey, t.minValueCents, t.maxValueCents, t.order])).toEqual(
      maint.map((t) => [t.roleKey, t.minValueCents, t.maxValueCents, t.order]),
    )
    expect(tierForValue(50_000_000, install)?.roleKey).toBe('vice_president')
  })

  it('editing a config row changes behavior without code edits', () => {
    const installTier: ApprovalTier = {
      id: 'ti1',
      roleKey: 'manager',
      label: 'Manager (Install)',
      minValueCents: 0,
      maxValueCents: null,
      order: 1,
      estimateType: 'install',
    }
    // Replace the install ladder with a single all-values Manager tier.
    const withInstall = [
      ...APPROVAL_TIER_SEED.filter((t) => t.estimateType !== 'install'),
      installTier,
    ]
    const install = tiersForType(withInstall, 'install')
    expect(tierForValue(50_000_000, install)?.label).toBe('Manager (Install)')
    // maintenance ladder unaffected
    expect(tierForValue(50_000_000, tiersForType(withInstall, 'maintenance'))?.roleKey).toBe('vice_president')
  })
})

describe('ITB scopes config', () => {
  it('seeds scope rows with keys, labels, groups, and order', () => {
    expect(ITB_SCOPE_SEED.length).toBeGreaterThan(0)
    for (const scope of ITB_SCOPE_SEED) {
      expect(scope.key).toBeTruthy()
      expect(['estimating', 'outside_dept', 'vendor_only']).toContain(scope.group)
      expect(typeof scope.order).toBe('number')
    }
  })
  it('is admin-extensible: a new scope row is picked up as data', () => {
    const extended = [
      ...ITB_SCOPE_SEED,
      { id: 'sc-new', key: 'water_feature', label: 'Water Feature', group: 'vendor_only' as const, order: 99 },
    ]
    expect(extended.find((s) => s.key === 'water_feature')?.label).toBe('Water Feature')
  })
})

describe('material formulas config (formula engine)', () => {
  const byKey = (key: string) => {
    const row = MATERIAL_FORMULA_ROWS.find((r) => r.materialKey === key)
    if (!row) throw new Error(`missing material row: ${key}`)
    return buildMaterialCalc(row)
  }

  it('covers every material key from the handoff', () => {
    const keys = MATERIAL_FORMULA_ROWS.map((r) => r.materialKey)
    for (const k of ['edging', 'weed_barrier', 'aggregate', 'sod', 'mulch', 'fert', 'backfill', 'root_barrier']) {
      expect(keys).toContain(k)
    }
  })

  it('divPiece divides linear feet by piece length, rounding up', () => {
    const edging = byKey('edging')
    const result = edging.compute({ linearFt: 100 })
    // 100 LF / 16ft pieces = 6.25 -> 7
    expect(result.units).toBe(7)
    expect(result.uom).toBe(edging.uom)
  })

  it('divRoll divides square feet by roll coverage, rounding up', () => {
    const wb = byKey('weed_barrier')
    // 1000 SF / 300 SF rolls = 3.33 -> 4
    expect(wb.compute({ sqft: 1000 }).units).toBe(4)
  })

  it('sod divides square feet by pallet coverage, rounding up', () => {
    const sod = byKey('sod')
    // 2000 SF / 450 SF pallets = 4.44 -> 5
    expect(sod.compute({ sqft: 2000 }).units).toBe(5)
  })

  it('mulch converts area × depth to cubic yards, rounding up', () => {
    const mulch = byKey('mulch')
    // 972 SF at 2in: 972*2/324 = 6 cy exactly
    expect(mulch.compute({ sqft: 972, depthIn: 2 }).units).toBe(6)
  })

  it('aggregate reads its depth table from factors', () => {
    const agg = byKey('aggregate')
    const twoInch = agg.compute({ sqft: 1000, depthIn: 2 })
    expect(twoInch.units).toBeGreaterThan(0)
    const threeInch = agg.compute({ sqft: 1000, depthIn: 3 })
    expect(threeInch.units).toBeGreaterThanOrEqual(twoInch.units)
  })

  it('fert divides square feet by bag coverage, rounding up', () => {
    const fert = byKey('fert')
    expect(fert.compute({ sqft: 10000 }).units).toBeGreaterThan(0)
  })

  it('backfill converts area × depth to cubic yards with compaction factor', () => {
    const bf = byKey('backfill')
    const noDepthLessThanWithDepth =
      bf.compute({ sqft: 500, depthIn: 6 }).units <= bf.compute({ sqft: 500, depthIn: 12 }).units
    expect(noDepthLessThanWithDepth).toBe(true)
  })

  it('adding a brand-new material row works without code edits', () => {
    const newRow: MaterialCalcRow = {
      id: 'mc-new',
      materialKey: 'boulder_ring',
      label: 'Boulder Ring Edging',
      computeType: 'divPiece',
      factors: { pieceLengthFt: 4 },
      unitSellCents: 12500,
      unitCostCents: 8000,
      uom: 'pcs',
    }
    const calc = buildMaterialCalc(newRow)
    // 100 LF / 4ft = 25 pieces
    expect(calc.compute({ linearFt: 100 })).toEqual({ units: 25, uom: 'pcs' })
  })
})
