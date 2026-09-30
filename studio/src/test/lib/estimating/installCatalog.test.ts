// ---------------------------------------------------------------------------
// Handoff 55 §4 — add a catalog service, copying its default items.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { EstimateSection, ServiceCategory } from '@/types/estimating'
import { estimatingApi } from '@/api/estimating'
import { diffEstimateTree, persistEstimateTree } from '@/lib/estimating/persistTree'
import {
  addCatalogService,
  catalogServiceToLine,
  defaultItemToComponent,
  findCatalogService,
  removeComponent,
  removeServiceLine,
  serviceOptionsForSection,
} from '@/lib/estimating/installCatalog'
import { componentRollups, serviceRollup } from '@/lib/estimating/install'
import { SERVICE_CATALOG_FIXTURE } from '@/mocks/serviceCatalogData'

const install = SERVICE_CATALOG_FIXTURE.filter((c) => c.estimateType === 'install')
const irrigationInstall = findCatalogService(install, 'svc-cat-irrigation-install')!
const sodInstall = findCatalogService(install, 'svc-cat-sod-install')!

function section(over: Partial<EstimateSection> = {}): EstimateSection {
  return {
    id: 'sec-1',
    estimateId: 'est-1',
    name: 'Irrigation',
    squareFeet: 0,
    sortOrder: 0,
    serviceCategoryId: 'cat-install-irrigation',
    services: [],
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('serviceOptionsForSection', () => {
  it("offers only the section's own category services, in sort order", () => {
    const groups = serviceOptionsForSection(section(), install)
    expect(groups).toHaveLength(1)
    expect(groups[0].categoryName).toBe('Irrigation')
    expect(groups[0].services.map((s) => s.id)).toEqual([
      'svc-cat-irrigation-install',
      'svc-cat-sleeving',
    ])
  })

  it('offers nothing for a legacy section with no category', () => {
    expect(serviceOptionsForSection(section({ serviceCategoryId: null }), install)).toEqual([])
  })

  it('offers nothing for a category with no services (Optional Services in the seed)', () => {
    expect(serviceOptionsForSection(section({ serviceCategoryId: 'cat-install-optional' }), install)).toEqual([])
  })

  it('offers nothing for a category the catalog no longer returns', () => {
    expect(serviceOptionsForSection(section({ serviceCategoryId: 'cat-gone' }), install)).toEqual([])
  })
})

describe('catalogServiceToLine / defaultItemToComponent', () => {
  it('builds one line with serviceId set, no kit, and one component per default item', () => {
    const line = catalogServiceToLine(irrigationInstall, 'sec-1', 3)
    expect(line).toMatchObject({
      sectionId: 'sec-1',
      serviceId: 'svc-cat-irrigation-install',
      serviceKitId: null,
      label: 'Irrigation Install',
      qty: 1,
      sortOrder: 3,
      embeddedCostCents: null,
    })
    expect(line.components).toHaveLength(2)
    expect(line.components.map((c) => c.sectionServiceId)).toEqual([line.id, line.id])
    expect(line.components[0]).toMatchObject({
      kind: 'labor',
      label: 'Irrigation install labor',
      inventoryId: null,
      qty: 8,
      unitCostCents: 4500,
      hours: 8,
      sortOrder: 0,
    })
  })

  it('snapshots resolvedUnitCostCents; an unknown cost stays null (never $0)', () => {
    const line = catalogServiceToLine(irrigationInstall, 'sec-1', 0)
    const pipe = line.components[1]
    expect(pipe.inventoryId).toBe('IRR-PVC-100-CL200')
    expect(pipe.unitCostCents).toBeNull()
    // item and line cost render "—", not $0.00
    expect(componentRollups(line)[1].costCents).toBeNull()
    expect(serviceRollup(line).costCents).toBeNull()
  })

  it('the snapshot does not move when the catalog price changes afterwards', () => {
    const catalog: ServiceCategory[] = structuredClone(install)
    const svc = findCatalogService(catalog, 'svc-cat-irrigation-install')!
    const line = catalogServiceToLine(svc, 'sec-1', 0)
    svc.defaultItems[0].resolvedUnitCostCents = 9999
    svc.defaultItems[1].resolvedUnitCostCents = 123
    expect(line.components[0].unitCostCents).toBe(4500)
    expect(line.components[1].unitCostCents).toBeNull()
  })

  it('copies all five cost kinds verbatim (no collapsing into material)', () => {
    for (const kind of ['labor', 'material', 'equipment', 'subcontractor', 'other'] as const) {
      const c = defaultItemToComponent({ ...irrigationInstall.defaultItems[0], kind }, 'svc-x', 0)
      expect(c.kind).toBe(kind)
    }
  })

  it('a service with no default items inserts cleanly with zero items, costing 0 (not "—")', () => {
    const line = catalogServiceToLine(sodInstall, 'sec-1', 0)
    expect(line.components).toEqual([])
    expect(serviceRollup(line).costCents).toBe(0)
  })
})

describe('save ops (§4 acceptance)', () => {
  it('adding a service issues exactly one createService carrying one component per default item', async () => {
    const saved = [section()]
    const draft = [addCatalogService(saved[0], irrigationInstall)]
    const ops = diffEstimateTree(saved, draft)
    expect(ops.map((o) => o.op)).toEqual(['createService'])

    const createService = vi.spyOn(estimatingApi, 'createService').mockResolvedValue({} as never)
    const createComponent = vi.spyOn(estimatingApi, 'createComponent').mockResolvedValue({} as never)
    await persistEstimateTree('est-1', saved, draft)
    expect(createService).toHaveBeenCalledTimes(1)
    expect(createComponent).not.toHaveBeenCalled()
    const body = createService.mock.calls[0][2]
    expect(body).toMatchObject({ serviceId: 'svc-cat-irrigation-install', serviceKitId: null })
    expect(body.components).toEqual([
      expect.objectContaining({ kind: 'labor', unitCostCents: 4500, inventoryId: null }),
      expect.objectContaining({ kind: 'material', unitCostCents: null, inventoryId: 'IRR-PVC-100-CL200' }),
    ])
  })

  it('deleting a line issues exactly one deleteService op', () => {
    const saved = [addCatalogService(section(), irrigationInstall)]
    const svcId = saved[0].services[0].id
    const ops = diffEstimateTree(saved, [removeServiceLine(saved[0], svcId)])
    expect(ops).toEqual([{ op: 'deleteService', sectionId: 'sec-1', serviceId: svcId }])
  })

  it('deleting an item issues exactly one deleteComponent op', () => {
    const saved = [addCatalogService(section(), irrigationInstall)]
    const svc = saved[0].services[0]
    const cmpId = svc.components[0].id
    const draft = [{ ...saved[0], services: [removeComponent(svc, cmpId)] }]
    expect(diffEstimateTree(saved, draft)).toEqual([
      { op: 'deleteComponent', sectionId: 'sec-1', serviceId: svc.id, componentId: cmpId },
    ])
  })
})
