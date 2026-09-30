// ---------------------------------------------------------------------------
// Install engine pure logic (lib/estimating/install.ts).
//
// Fixture math (buildInstallEstimate, all integer cents):
//   Phase 1 — Streetscape:
//     Mahogany   TP 24 × 125,000 = 3,000,000 · unit basis Σcomponents =
//                42,500 + 3.5×5,200 + 8,050 = 68,750 · sub 24×68,750 = 1,650,000
//                GM (3,000,000 − 1,650,000)/3,000,000 = 0.45
//     Irrigation TP 1,400 × 250 = 350,000 · basis 62 + 0.02×3,800 = 138 ·
//                sub 193,200 · GM 0.448
//     group      TP 3,350,000 · sub 1,843,200 · GM 0.449791…
//   Phase 2 — Amenity Center:
//     Sod        TP 48 × 41,500 = 1,992,000 · basis 19,500 + 1.1×5,200 = 25,220
//                (components override the stale embedded 26,900) ·
//                sub 1,210,560 · GM 0.392289…
//   Estimate    TP 5,342,000 · sub 3,053,760 · GM 0.428349…
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import type { SectionServiceComponent } from '@/types/estimating'
import { buildInstallEstimate } from '@/mocks/estimatingData'
import {
  INSTALL_SERVICE_KITS,
  averagedVendorCostCents,
  installServiceKitsFromItems,
  buildComponent,
  coerceNum,
  estimateGm,
  estimateHours,
  estimateSubCostCents,
  formatGmPct,
  groupSameRateLabor,
  kitToService,
  sectionGm,
  sectionHours,
  sectionSubCostCents,
  serviceGm,
  serviceSubCostCents,
  serviceTotalCents,
  unitCostBasisCents,
  componentRollups,
  estimateRollup,
  formatGmPctOrDash,
  rollupGm,
  sectionRollup,
  serviceCostOrNull,
  serviceRollup,
  availableInstallCategories,
  buildInstallSection,
  normalizeSectionSuffix,
  sectionNameFor,
} from '@/lib/estimating/install'
import { SERVICE_CATALOG_FIXTURE } from '@/mocks/serviceCatalogData'

function fixture() {
  return buildInstallEstimate()
}

describe('unit cost basis (II-6.8 embedded cost / II-6.5 component feed)', () => {
  it('uses Σ component qty × unit cost when components exist', () => {
    const trees = fixture().sections[0].services[0]
    expect(unitCostBasisCents(trees)).toBe(68_750)
  })

  it('components override a stale embedded cost (live cost basis)', () => {
    const sod = fixture().sections[1].services[0]
    // embeddedCostCents is 26,900 but components sum to 25,220
    expect(unitCostBasisCents(sod)).toBe(25_220)
  })

  it('falls back to embeddedCostCents without components, and 0 when null', () => {
    const svc = fixture().sections[0].services[0]
    expect(unitCostBasisCents({ ...svc, components: [] })).toBe(68_750)
    expect(
      unitCostBasisCents({ ...svc, components: [], embeddedCostCents: null }),
    ).toBe(0)
  })
})

describe('quantity-driven pricing (TP = QTY × U/P) and GM', () => {
  it('line total, sub cost, and GM for a kit line', () => {
    const trees = fixture().sections[0].services[0]
    expect(serviceTotalCents(trees)).toBe(3_000_000)
    expect(serviceSubCostCents(trees)).toBe(1_650_000)
    expect(serviceGm(trees)).toBeCloseTo(0.45, 10)
  })

  it('HOURS NEVER DRIVE PRICE — changing hours leaves TP, sub cost, GM identical', () => {
    const trees = fixture().sections[0].services[0]
    const rehoured = { ...trees, hours: 999 }
    expect(serviceTotalCents(rehoured)).toBe(serviceTotalCents(trees))
    expect(serviceSubCostCents(rehoured)).toBe(serviceSubCostCents(trees))
    expect(serviceGm(rehoured)).toBe(serviceGm(trees))
  })

  it('section roll-up: TP, sub cost, GM', () => {
    const s1 = fixture().sections[0]
    expect(sectionSubCostCents(s1)).toBe(1_843_200)
    expect(sectionGm(s1)).toBeCloseTo(1_506_800 / 3_350_000, 10)
  })

  it('estimate roll-up: sub cost and blended GM', () => {
    const est = fixture()
    expect(estimateSubCostCents(est)).toBe(3_053_760)
    expect(estimateGm(est)).toBeCloseTo(2_288_240 / 5_342_000, 10)
  })

  it('GM is 0 when price is 0 (never divide by zero)', () => {
    const svc = { ...fixture().sections[0].services[0], unitSellCents: 0 }
    expect(serviceGm(svc)).toBe(0)
  })
})

describe('hours are production-planning reads only', () => {
  it('section and estimate hours sum svc.hours, null-safe', () => {
    const est = fixture()
    expect(sectionHours(est.sections[0])).toBeCloseTo(3.52, 10)
    expect(sectionHours(est.sections[1])).toBeCloseTo(1.1, 10)
    expect(estimateHours(est)).toBeCloseTo(4.62, 10)
  })
})

describe('groupSameRateLabor (II-9.7 — one labor line per production rate)', () => {
  const base = (over: Partial<SectionServiceComponent>): SectionServiceComponent => ({
    id: 'c1',
    sectionServiceId: 's1',
    kind: 'labor',
    label: 'Install labor',
    qty: 1,
    unitCostCents: 5200,
    hours: 1,
    sortOrder: 0,
    ...over,
  })

  it('merges labor lines sharing a unit cost (production rate) into one, summing qty and hours', () => {
    const merged = groupSameRateLabor([
      base({ id: 'a', qty: 3, hours: 3 }),
      base({ id: 'b', qty: 2.5, hours: 2.5, sortOrder: 1 }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].qty).toBeCloseTo(5.5, 10)
    expect(merged[0].hours).toBeCloseTo(5.5, 10)
    expect(merged[0].kind).toBe('labor')
  })

  it('keeps material lines separate and labor at different rates unmerged', () => {
    const comps = [
      base({ id: 'a', qty: 1 }),
      base({ id: 'b', kind: 'material', label: '30g tree', unitCostCents: 5200, sortOrder: 1 }),
      base({ id: 'c', kind: 'material', label: '30g shrub', unitCostCents: 5200, sortOrder: 2 }),
      base({ id: 'd', unitCostCents: 3800, sortOrder: 3 }),
    ]
    const merged = groupSameRateLabor(comps)
    expect(merged).toHaveLength(4)
  })

  it('null hours stay null-safe when merging', () => {
    const merged = groupSameRateLabor([
      base({ id: 'a', hours: null }),
      base({ id: 'b', hours: 2, sortOrder: 1 }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].hours).toBe(2)
  })
})

describe('install kit catalog (II-6.5 live-goods volatility, II-9.5 config not code)', () => {
  it('averages multiple vendor prices into the cost basis', () => {
    expect(averagedVendorCostCents([25, 75])).toBe(50)
    expect(averagedVendorCostCents([100])).toBe(100)
    expect(averagedVendorCostCents([])).toBe(0)
  })

  it('every catalog row is an install_quantity kit', () => {
    expect(INSTALL_SERVICE_KITS.length).toBeGreaterThan(0)
    for (const kit of INSTALL_SERVICE_KITS) {
      expect(kit.kitType).toBe('install_quantity')
      expect(kit.productionRate).toBeNull()
    }
  })

  it('kitToService seeds a service from the kit with averaged vendor cost', () => {
    const kit = INSTALL_SERVICE_KITS[0]
    const svc = kitToService(kit, 'sec-1', 3)
    expect(svc.sectionId).toBe('sec-1')
    expect(svc.sortOrder).toBe(3)
    expect(svc.serviceKitId).toBe(kit.id)
    expect(svc.unitSellCents).toBe(kit.unitSellCents)
    expect(svc.embeddedCostCents).toBe(averagedVendorCostCents(kit.vendorPricesCents))
    expect(svc.targetGm).toBe(kit.targetGm)
    expect(svc.qty).toBe(1)
  })

  it('refuses to seed from a maintenance (hours-driven) kit — engines stay independent', () => {
    const kit = { ...INSTALL_SERVICE_KITS[0], kitType: 'maintenance_hours' as const }
    expect(() => kitToService(kit, 'sec-1', 0)).toThrow(/install_quantity/)
  })
})

describe('buildComponent / coerceNum / formatGmPct', () => {
  it('builds labor and material defaults for "+ Add labor / cost line"', () => {
    const labor = buildComponent('svc-1', 'labor')
    expect(labor.kind).toBe('labor')
    expect(labor.qty).toBe(1)
    expect(labor.sectionServiceId).toBe('svc-1')
    const material = buildComponent('svc-1', 'material')
    expect(material.kind).toBe('material')
    expect(material.hours).toBeNull()
  })

  it('coerces blank/invalid/negative input to 0', () => {
    expect(coerceNum('')).toBe(0)
    expect(coerceNum('abc')).toBe(0)
    expect(coerceNum('-4')).toBe(0)
    expect(coerceNum('4.5')).toBe(4.5)
  })

  it('formats GM as a two-decimal percent', () => {
    expect(formatGmPct(0.45)).toBe('45.00%')
    expect(formatGmPct(1_506_800 / 3_350_000)).toBe('44.98%')
    expect(formatGmPct(0)).toBe('0.00%')
  })
})

// ---------------------------------------------------------------------------
// The editor reads install kits from GET /service-kits; the
// INSTALL_SERVICE_KITS literal is only the offline fallback.
// ---------------------------------------------------------------------------

describe('installServiceKitsFromItems (API catalog adapter)', () => {
  it('falls back to the literal when the API returned no install kits', () => {
    expect(installServiceKitsFromItems([])).toBe(INSTALL_SERVICE_KITS)
    // maintenance kits alone don't count
    const maintOnly = [{ ...INSTALL_SERVICE_KITS[0], kitType: 'maintenance_hours' as const }]
    expect(installServiceKitsFromItems(maintOnly)).toBe(INSTALL_SERVICE_KITS)
  })

  it('adapts install_quantity items, using the blended unit cost as the single vendor quote', () => {
    const { vendorPricesCents: _v, ...item } = INSTALL_SERVICE_KITS[0]
    const kits = installServiceKitsFromItems([item])
    expect(kits).toHaveLength(1)
    expect(kits[0].id).toBe(item.id)
    expect(kits[0].vendorPricesCents).toEqual([item.unitCostCents])
    expect(averagedVendorCostCents(kits[0].vendorPricesCents)).toBe(item.unitCostCents)
  })

  it('drops inactive kits', () => {
    const { vendorPricesCents: _v, ...item } = INSTALL_SERVICE_KITS[0]
    const kits = installServiceKitsFromItems([{ ...item, active: false }, { ...item, id: 'kit-x' }])
    expect(kits.map((k) => k.id)).toEqual(['kit-x'])
  })
})

// ----- Handoff 55 §6: three-level roll-ups ------------------------------------

describe('three-level roll-ups (item → service → section → estimate)', () => {
  it('service roll-up reports cost, price and GM', () => {
    const trees = fixture().sections[0].services[0]
    expect(serviceRollup(trees)).toEqual({ costCents: 1_650_000, priceCents: 3_000_000, gm: 0.45 })
  })

  it('cost is null (unresolvable) with no components and no embedded cost; GM follows', () => {
    const svc = { ...fixture().sections[0].services[0], components: [], embeddedCostCents: null }
    expect(serviceCostOrNull(svc)).toBeNull()
    expect(serviceRollup(svc).gm).toBeNull()
    // legacy helper still reads it as 0 (unchanged behaviour)
    expect(serviceSubCostCents(svc)).toBe(0)
  })

  it('GM is null when price is 0', () => {
    expect(rollupGm(0, 100)).toBeNull()
    expect(rollupGm(1000, null)).toBeNull()
    expect(rollupGm(1000, 600)).toBeCloseTo(0.4, 10)
  })

  it('item roll-ups: extended cost, prices apportioned to sum exactly to the line TP', () => {
    const trees = fixture().sections[0].services[0]
    const items = componentRollups(trees)
    expect(items.map((i) => i.costCents)).toEqual([24 * 42_500, 24 * 18_200, 24 * 8_050])
    expect(items.reduce((s, i) => s + (i.priceCents ?? 0), 0)).toBe(serviceTotalCents(trees))
    expect(items[0].priceCents).toBe(1_854_545)
    for (const i of items) expect(i.gm).toBeCloseTo(0.45, 5)
  })

  it('item price / GM are null when the line has zero component cost', () => {
    const trees = fixture().sections[0].services[0]
    const zero = { ...trees, components: trees.components.map((c) => ({ ...c, unitCostCents: 0 })) }
    expect(componentRollups(zero).every((i) => i.priceCents === null && i.gm === null)).toBe(true)
  })

  it('section and estimate roll-ups sum children; one unresolvable child nulls the cost', () => {
    const est = fixture()
    expect(sectionRollup(est.sections[0]).costCents).toBe(1_843_200)
    expect(sectionRollup(est.sections[0]).priceCents).toBe(3_350_000)
    expect(estimateRollup(est).costCents).toBe(3_053_760)
    expect(estimateRollup(est).gm).toBeCloseTo(estimateGm(est), 12)
    est.sections[1].services[0] = {
      ...est.sections[1].services[0],
      components: [],
      embeddedCostCents: null,
    }
    expect(sectionRollup(est.sections[1]).costCents).toBeNull()
    expect(estimateRollup(est).costCents).toBeNull()
    expect(estimateRollup(est).priceCents).toBe(5_342_000)
  })

  it('formatGmPctOrDash renders "—" for null', () => {
    expect(formatGmPctOrDash(null)).toBe('—')
    expect(formatGmPctOrDash(0.4498)).toBe('44.98%')
  })
})

// ----- Handoff 55 §3: sections from the service catalog ------------------------

describe('section picker helpers', () => {
  it('names a section "Category - suffix", tolerating a typed leading dash', () => {
    expect(sectionNameFor('Landscape')).toBe('Landscape')
    expect(sectionNameFor('Landscape', '   ')).toBe('Landscape')
    expect(sectionNameFor('Landscape', 'Amenity Center')).toBe('Landscape - Amenity Center')
    expect(sectionNameFor('Landscape', '- Amenity Center')).toBe('Landscape - Amenity Center')
    expect(normalizeSectionSuffix(' — Entry Median ')).toBe('Entry Median')
  })

  it('offers only active install categories not already present', () => {
    const est = fixture()
    est.sections[0].name = 'Irrigation' // unlinked takeoff section, exact name
    est.sections[1].serviceCategoryId = 'cat-install-lighting'
    const names = availableInstallCategories(SERVICE_CATALOG_FIXTURE, est.sections).map((c) => c.name)
    expect(names).toEqual(['Landscape', 'Sod', 'Drainage', 'Optional Services'])
  })

  it('a suffixed or differently-cased takeoff name does not hide the category', () => {
    const est = fixture()
    est.sections[0].name = 'IRRIGATION'
    const names = availableInstallCategories(SERVICE_CATALOG_FIXTURE, est.sections).map((c) => c.name)
    expect(names).toContain('Irrigation')
  })

  it('builds an empty, category-linked section', () => {
    const cat = SERVICE_CATALOG_FIXTURE[0]
    const sec = buildInstallSection('est-1', cat, 'Amenity Center', 2)
    expect(sec).toMatchObject({
      estimateId: 'est-1',
      name: 'Landscape - Amenity Center',
      serviceCategoryId: cat.id,
      sortOrder: 2,
      squareFeet: 0,
      services: [],
    })
  })
})
