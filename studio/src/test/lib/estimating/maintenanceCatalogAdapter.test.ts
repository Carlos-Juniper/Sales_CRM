// Handoff 54 §3 — the isolated adapter over the catalog's kit links.
import { describe, it, expect } from 'vitest'
import {
  catalogServiceKitIds,
  catalogStatus,
  maintenanceCategories,
  primaryKitId,
} from '@/lib/estimating/maintenanceCatalogAdapter'
import { catalogService, MAINTENANCE_CATALOG, MOW_KIT } from '@/test/fixtures/maintenanceCatalog'
import { SERVICE_CATALOG_FIXTURE } from '@/mocks/serviceCatalogData'

describe('catalogServiceKitIds', () => {
  it('reads kit ids from defaultItems today', () => {
    const s = catalogService('c', 'mow', 'Mow', 0, { kitId: MOW_KIT.id })
    expect(catalogServiceKitIds(s)).toEqual([MOW_KIT.id])
    expect(primaryKitId(s)).toBe(MOW_KIT.id)
  })

  it("prefers §1's assumed nested kits when present", () => {
    const s = { ...catalogService('c', 'mow', 'Mow', 0, { kitId: 'kit-old' }), kits: [{ id: 'kit-a' }, { id: 'kit-b' }] }
    expect(catalogServiceKitIds(s)).toEqual(['kit-a', 'kit-b'])
    expect(primaryKitId(s)).toBe('kit-a')
  })

  it('is empty / null for a service with no kit link', () => {
    const s = catalogService('c', 'x', 'X', 0)
    expect(catalogServiceKitIds(s)).toEqual([])
    expect(primaryKitId(s)).toBeNull()
  })
})

describe('maintenanceCategories', () => {
  it('keeps maintenance categories only, in sort order', () => {
    const shuffled = [...MAINTENANCE_CATALOG].reverse()
    expect(maintenanceCategories([...SERVICE_CATALOG_FIXTURE, ...shuffled]).map((c) => c.code)).toEqual([
      'MOWING', 'turf', 'bed', 'irrigation', 'fert', 'pest', 'optional',
    ])
    expect(maintenanceCategories(undefined)).toEqual([])
  })
})

describe('catalogStatus', () => {
  it('maps the query state', () => {
    expect(catalogStatus({ isLoading: true, isError: false })).toBe('loading')
    expect(catalogStatus({ isLoading: false, isError: true })).toBe('unavailable')
    expect(catalogStatus({ isLoading: false, isError: false })).toBe('ready')
  })
})
