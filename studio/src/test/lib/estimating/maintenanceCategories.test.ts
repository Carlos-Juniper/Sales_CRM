// Handoff 54 §3 — render-time grouping of maintenance lines into categories.
import { describe, it, expect } from 'vitest'
import type { SectionService } from '@/types/estimating'
import {
  OPTIONAL_GROUP_KEY,
  OTHER_GROUP_KEY,
  addableOptionalServices,
  appendService,
  catalogServiceLine,
  groupSectionServices,
  removeService,
} from '@/lib/estimating/maintenanceCategories'
import { COMPANY_DEFAULT_COMPLEXITY_PCT } from '@/lib/estimating/maintenance'
import { MAINTENANCE_CATALOG, MOW_KIT, MULCH_KIT } from '@/test/fixtures/maintenanceCatalog'

function svc(over: Partial<SectionService>): SectionService {
  return {
    id: over.label ?? 'x',
    sectionId: 'sec-1',
    serviceKitId: null,
    serviceId: null,
    label: 'x',
    qty: 1,
    uom: '/yr',
    complexityPct: 0,
    unitSellCents: null,
    embeddedCostCents: null,
    targetGm: null,
    hours: null,
    sortOrder: 0,
    components: [],
    ...over,
  }
}

const optionalService = (slug: string) =>
  MAINTENANCE_CATALOG.find((c) => c.isOptional)!.services.find((s) => s.id === `svc-m-${slug}`)!

describe('groupSectionServices', () => {
  it('places lines by catalog service, then by kit link, else Other', () => {
    const groups = groupSectionServices(
      [
        svc({ label: 'Pruning', serviceId: 'svc-m-pruning' }),
        svc({ label: 'Legacy mow', serviceKitId: MOW_KIT.id }),
        svc({ label: 'Mulch', serviceId: 'svc-m-mulch' }),
        svc({ label: 'Hand-entered' }),
      ],
      MAINTENANCE_CATALOG,
    )
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.services.map((s) => s.label)]))
    expect(byKey['cat-m-bed']).toEqual(['Pruning'])
    expect(byKey['cat-m-turf']).toEqual(['Legacy mow'])
    expect(byKey[OPTIONAL_GROUP_KEY]).toEqual(['Mulch'])
    expect(byKey[OTHER_GROUP_KEY]).toEqual(['Hand-entered'])
  })

  it('always returns every standard category plus Optional Services', () => {
    const groups = groupSectionServices([], MAINTENANCE_CATALOG)
    expect(groups.map((g) => g.label)).toEqual([
      'Turf', 'Bed Maint', 'Irrigation', 'Fertilizer', 'Pest Control', 'Optional Services',
    ])
    expect(groups.map((g) => g.kind)).toEqual([
      'standard', 'standard', 'standard', 'standard', 'standard', 'optional',
    ])
  })

  it('puts every line in Other services when the catalog is empty', () => {
    const groups = groupSectionServices([svc({ label: 'A', serviceId: 'svc-x' })], [])
    expect(groups.map((g) => g.key)).toEqual([OPTIONAL_GROUP_KEY, OTHER_GROUP_KEY])
  })

  it('keeps line order within a category', () => {
    const groups = groupSectionServices(
      [
        svc({ label: 'Turf Q1', serviceId: 'svc-m-fert-turf-q1' }),
        svc({ label: 'Shrub Q1', serviceId: 'svc-m-fert-shrub-q1' }),
      ],
      MAINTENANCE_CATALOG,
    )
    expect(groups.find((g) => g.key === 'cat-m-fert')!.services.map((s) => s.label)).toEqual([
      'Turf Q1',
      'Shrub Q1',
    ])
  })
})

describe('addableOptionalServices', () => {
  it('lists optional-category services not already in the section', () => {
    const choices = addableOptionalServices([svc({ serviceId: 'svc-m-mulch' })], MAINTENANCE_CATALOG)
    expect(choices).toHaveLength(1)
    expect(choices[0].category.name).toBe('Optional Services')
    expect(choices[0].services.map((s) => s.displayName)).toEqual(['Annuals'])
  })

  it('drops an optional category once all its services are present', () => {
    const all = [svc({ serviceId: 'svc-m-mulch' }), svc({ serviceId: 'svc-m-annuals' })]
    expect(addableOptionalServices(all, MAINTENANCE_CATALOG)).toEqual([])
  })
})

describe('catalogServiceLine', () => {
  const rates = [{ key: MULCH_KIT.id, label: 'Mulch', uom: '/yr' as const, basis: 'sqft' as const, rateCentsPer1000Sf: 500, defaultQty: 1 }]

  it('builds one priced line from the service and its kit rate', () => {
    const line = catalogServiceLine(optionalService('mulch'), 'sec-1', 4, rates)
    expect(line).toMatchObject({
      sectionId: 'sec-1',
      serviceId: 'svc-m-mulch',
      serviceKitId: MULCH_KIT.id,
      label: 'Mulch',
      qty: 2,
      uom: '/yr',
      complexityPct: COMPANY_DEFAULT_COMPLEXITY_PCT,
      unitSellCents: 500,
      hours: null,
      sortOrder: 4,
      components: [],
    })
  })

  it('leaves price empty when the service links no priced kit', () => {
    const line = catalogServiceLine(optionalService('annuals'), 'sec-1', 0, rates)
    expect(line.serviceKitId).toBeNull()
    expect(line.unitSellCents).toBeNull()
    expect(line.qty).toBe(0)
  })
})

describe('appendService / removeService', () => {
  it('adds and removes exactly one line', () => {
    const section = { id: 'sec-1', estimateId: 'e', name: 'S', squareFeet: 1, sortOrder: 0, serviceCategoryId: null, services: [svc({ id: 'a' })] }
    const added = appendService(section, svc({ id: 'b' }))
    expect(added.services.map((s) => s.id)).toEqual(['a', 'b'])
    expect(removeService(added, 'a').services.map((s) => s.id)).toEqual(['b'])
    expect(section.services).toHaveLength(1)
  })
})
