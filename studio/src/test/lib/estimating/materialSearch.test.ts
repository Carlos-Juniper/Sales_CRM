// Handoff 55 §5 — material search pure helpers.

import { describe, it, expect } from 'vitest'
import type { MaterialSearchItem } from '@/types/estimating'
import { ApiError } from '@/api/client'
import {
  UNKNOWN_COST_SAVE_MESSAGE,
  clampMaterialLimit,
  effectiveItemClassCodes,
  isUnknownCostSaveError,
  materialCostAndUnit,
  materialSearchQuery,
  materialToComponent,
  sectionItemClassCodes,
  serviceItemClassCodes,
  unknownCostItemCount,
} from '@/lib/estimating/materialSearch'
import { SERVICE_CATALOG_FIXTURE } from '@/mocks/serviceCatalogData'
import { MATERIALS_FIXTURE, searchMaterialsFixture } from '@/mocks/materialsData'

const byId = (id: string) => MATERIALS_FIXTURE.find((m) => m.inventoryId === id)!

describe('clampMaterialLimit / materialSearchQuery', () => {
  it('clamps the page size to 1…100 (default 25)', () => {
    expect(clampMaterialLimit()).toBe(25)
    expect(clampMaterialLimit(500)).toBe(100)
    expect(clampMaterialLimit(0)).toBe(1)
    expect(clampMaterialLimit(Number.NaN)).toBe(25)
  })

  it('builds q / comma-separated codes / limit / cursor', () => {
    const qs = new URLSearchParams(
      materialSearchQuery({ q: '  pvc ', itemClassCodes: [601, 606], limit: 250, cursor: 'abc' }),
    )
    expect(qs.get('q')).toBe('pvc')
    expect(qs.get('itemClassCodes')).toBe('601,606')
    expect(qs.get('limit')).toBe('100')
    expect(qs.get('cursor')).toBe('abc')
  })

  it('omits the codes and cursor when unfiltered / first page', () => {
    const qs = new URLSearchParams(materialSearchQuery({ q: 'pvc', itemClassCodes: null }))
    expect(qs.has('itemClassCodes')).toBe(false)
    expect(qs.has('cursor')).toBe(false)
    expect(new URLSearchParams(materialSearchQuery({ q: 'x', itemClassCodes: [] })).has('itemClassCodes')).toBe(false)
  })
})

describe('item class prefilter', () => {
  it("a section's codes are its category's; none for no / code-less category", () => {
    expect(sectionItemClassCodes('cat-install-irrigation', SERVICE_CATALOG_FIXTURE)).toEqual([601, 602, 605, 606])
    expect(sectionItemClassCodes('cat-install-optional', SERVICE_CATALOG_FIXTURE)).toBeNull()
    expect(sectionItemClassCodes(null, SERVICE_CATALOG_FIXTURE)).toBeNull()
  })

  it("a service line uses its catalog service's category codes, else the section's", () => {
    // Sod Install sits in a (hypothetical) Irrigation section: the service wins.
    expect(serviceItemClassCodes('svc-cat-sod-install', 'cat-install-irrigation', SERVICE_CATALOG_FIXTURE)).toEqual([703])
    // Free-text / kit line (no serviceId) → the section's codes.
    expect(serviceItemClassCodes(null, 'cat-install-irrigation', SERVICE_CATALOG_FIXTURE)).toEqual([601, 602, 605, 606])
    // Unknown service id → the section's codes.
    expect(serviceItemClassCodes('svc-gone', 'cat-install-sod', SERVICE_CATALOG_FIXTURE)).toEqual([703])
    // Nothing known → unfiltered.
    expect(serviceItemClassCodes(undefined, null, SERVICE_CATALOG_FIXTURE)).toBeNull()
  })

  it('"All classes" sends no codes', () => {
    expect(effectiveItemClassCodes([606], false)).toEqual([606])
    expect(effectiveItemClassCodes([606], true)).toBeNull()
  })
})

describe('materialCostAndUnit / materialToComponent', () => {
  it('a priced material brings its cost in costUom', () => {
    const m: MaterialSearchItem = { ...byId('IRR-PVC-100-CL200'), uom: 'FT', costUom: 'RL', unitCostCents: 9900 }
    expect(materialCostAndUnit(m)).toEqual({ unitCostCents: 9900, uom: 'RL' })
  })

  it('no current price → unknown (null) cost in the material uom, never 0', () => {
    expect(materialCostAndUnit(byId('IRR-VLV-1IN'))).toEqual({ unitCostCents: null, uom: 'EA' })
  })

  it('fills label, inventoryId, uom and the snapshotted cost', () => {
    expect(materialToComponent(byId('IRR-SPR-4IN'), 'svc-1', 3, 'cmp-x')).toEqual({
      id: 'cmp-x',
      sectionServiceId: 'svc-1',
      kind: 'material',
      label: '4" Pop-up Spray Head',
      inventoryId: 'IRR-SPR-4IN',
      uom: 'EA',
      qty: 1,
      unitCostCents: 389,
      hours: null,
      sortOrder: 3,
    })
  })

  it('counts unknown-cost items', () => {
    const a = materialToComponent(byId('IRR-VLV-1IN'), 's', 0, 'a')
    const b = materialToComponent(byId('IRR-SPR-4IN'), 's', 1, 'b')
    expect(unknownCostItemCount([{ components: [a, b] }, { components: [a] }])).toBe(2)
  })
})

describe('isUnknownCostSaveError', () => {
  it('matches a 422 about a missing price only', () => {
    expect(isUnknownCostSaveError(new ApiError(422, 'Material IRR-VLV-1IN has no current price'))).toBe(true)
    expect(isUnknownCostSaveError(new ApiError(422, 'unitCostCents is required'))).toBe(true)
    expect(isUnknownCostSaveError(new ApiError(422, 'Only Optional Services sections can be added'))).toBe(false)
    expect(isUnknownCostSaveError(new ApiError(400, 'no current price'))).toBe(false)
    expect(isUnknownCostSaveError(new Error('no current price'))).toBe(false)
    expect(UNKNOWN_COST_SAVE_MESSAGE).toMatch(/no current price/)
  })
})

describe('MSW materials fixture (contract mirror)', () => {
  it('filters by q and codes and keyset-pages', () => {
    const url = (qs: string) => new URL(`http://x/estimating/materials?${qs}`)
    expect(searchMaterialsFixture(url('q=pvc')).items.map((m) => m.inventoryId)).toEqual([
      'IRR-PVC-100-CL200',
      'IRR-PVC-075-CL200',
      'LND-PVC-EDGE',
    ])
    expect(searchMaterialsFixture(url('q=pvc&itemClassCodes=606')).items).toHaveLength(2)
    const p1 = searchMaterialsFixture(url('q=pvc&limit=2'))
    expect(p1.items).toHaveLength(2)
    expect(p1.nextCursor).toBe('2')
    const p2 = searchMaterialsFixture(url(`q=pvc&limit=2&cursor=${p1.nextCursor}`))
    expect(p2.items.map((m) => m.inventoryId)).toEqual(['LND-PVC-EDGE'])
    expect(p2.nextCursor).toBeNull()
  })
})
