// ---------------------------------------------------------------------------
// Handoff 17 — Line-Item Editor Persistence: diff-and-apply save.
//
// diffEstimateTree(saved, draft) reconciles the editor's local draft tree
// against the last server-loaded tree and emits the minimal CRUD op list:
// new nodes → create, changed nodes → update (changed fields only), removed
// nodes → delete — at all three levels (section / service / component),
// preserving sortOrder. persistEstimateTree executes the ops through the
// typed client, then callers re-fetch the estimate (server is authoritative).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { EstimateSection, SectionService, SectionServiceComponent } from '@/types/estimating'
import { estimatingApi } from '@/api/estimating'
import { diffEstimateTree, persistEstimateTree } from '@/lib/estimating/persistTree'

function component(id: string, over: Partial<SectionServiceComponent> = {}): SectionServiceComponent {
  return {
    id,
    sectionServiceId: 'svc-1',
    kind: 'labor',
    label: 'Install crew',
    qty: 8,
    unitCostCents: 4500,
    hours: 8,
    sortOrder: 0,
    ...over,
  }
}

function service(id: string, over: Partial<SectionService> = {}): SectionService {
  return {
    id,
    sectionId: 'sec-1',
    catalogItemId: null,
    label: 'Mowing',
    qty: 42,
    uom: '/yr',
    complexityPct: 0.1,
    unitSellCents: 450,
    embeddedCostCents: null,
    targetGm: null,
    hours: null,
    sortOrder: 0,
    components: [],
    ...over,
  }
}

function section(id: string, over: Partial<EstimateSection> = {}): EstimateSection {
  return {
    id,
    estimateId: 'est-1',
    name: 'Common Area',
    squareFeet: 120_000,
    sortOrder: 0,
    services: [],
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('diffEstimateTree — sections', () => {
  it('returns no ops when the trees are identical', () => {
    const saved = [section('sec-1', { services: [service('svc-1')] })]
    expect(diffEstimateTree(saved, saved)).toEqual([])
  })

  it('emits createSection for a draft section unknown to the server', () => {
    const added = section('sec-local-99', { name: 'New region', sortOrder: 1 })
    const ops = diffEstimateTree([section('sec-1')], [section('sec-1'), added])
    expect(ops).toEqual([{ op: 'createSection', section: added }])
  })

  it('emits deleteSection for a saved section missing from the draft', () => {
    const ops = diffEstimateTree([section('sec-1'), section('sec-2', { sortOrder: 1 })], [section('sec-1')])
    expect(ops).toEqual([{ op: 'deleteSection', sectionId: 'sec-2' }])
  })

  it('emits updateSection with ONLY the changed fields (sortOrder preserved)', () => {
    const ops = diffEstimateTree(
      [section('sec-1')],
      [section('sec-1', { name: 'North Campus', squareFeet: 43_560 })],
    )
    expect(ops).toEqual([
      { op: 'updateSection', sectionId: 'sec-1', patch: { name: 'North Campus', squareFeet: 43_560 } },
    ])
  })
})

describe('diffEstimateTree — services', () => {
  it('emits createService (nested under its section) for a new line item', () => {
    const added = service('svc-local-9', { label: 'Bed detail', sortOrder: 1 })
    const ops = diffEstimateTree(
      [section('sec-1', { services: [service('svc-1')] })],
      [section('sec-1', { services: [service('svc-1'), added] })],
    )
    expect(ops).toEqual([{ op: 'createService', sectionId: 'sec-1', service: added }])
  })

  it('emits updateService with only the changed fields (qty / complexity / sortOrder)', () => {
    const ops = diffEstimateTree(
      [section('sec-1', { services: [service('svc-1')] })],
      [section('sec-1', { services: [service('svc-1', { qty: 21, complexityPct: 0.25, sortOrder: 3 })] })],
    )
    expect(ops).toEqual([
      {
        op: 'updateService',
        sectionId: 'sec-1',
        serviceId: 'svc-1',
        patch: { qty: 21, complexityPct: 0.25, sortOrder: 3 },
      },
    ])
  })

  it('emits deleteService for a removed line item', () => {
    const ops = diffEstimateTree(
      [section('sec-1', { services: [service('svc-1'), service('svc-2', { sortOrder: 1 })] })],
      [section('sec-1', { services: [service('svc-1')] })],
    )
    expect(ops).toEqual([{ op: 'deleteService', sectionId: 'sec-1', serviceId: 'svc-2' }])
  })
})

describe('diffEstimateTree — components', () => {
  const savedSvc = () => service('svc-1', { components: [component('cmp-1')] })

  it('emits createComponent for a new kit line', () => {
    const added = component('cmp-local-7', { kind: 'material', label: 'Mulch', sortOrder: 1 })
    const ops = diffEstimateTree(
      [section('sec-1', { services: [savedSvc()] })],
      [section('sec-1', { services: [service('svc-1', { components: [component('cmp-1'), added] })] })],
    )
    expect(ops).toEqual([
      { op: 'createComponent', sectionId: 'sec-1', serviceId: 'svc-1', component: added },
    ])
  })

  it('emits updateComponent with only the changed blue-cell fields', () => {
    const ops = diffEstimateTree(
      [section('sec-1', { services: [savedSvc()] })],
      [
        section('sec-1', {
          services: [service('svc-1', { components: [component('cmp-1', { qty: 16, unitCostCents: 5000 })] })],
        }),
      ],
    )
    expect(ops).toEqual([
      {
        op: 'updateComponent',
        sectionId: 'sec-1',
        serviceId: 'svc-1',
        componentId: 'cmp-1',
        patch: { qty: 16, unitCostCents: 5000 },
      },
    ])
  })

  it('emits deleteComponent for a removed kit line', () => {
    const ops = diffEstimateTree(
      [section('sec-1', { services: [savedSvc()] })],
      [section('sec-1', { services: [service('svc-1', { components: [] })] })],
    )
    expect(ops).toEqual([
      { op: 'deleteComponent', sectionId: 'sec-1', serviceId: 'svc-1', componentId: 'cmp-1' },
    ])
  })
})

describe('persistEstimateTree — applies the diff through the typed client', () => {
  it('issues create/update/delete calls for a mixed diff', async () => {
    const createSection = vi.spyOn(estimatingApi, 'createSection').mockResolvedValue({} as never)
    const updateService = vi.spyOn(estimatingApi, 'updateService').mockResolvedValue({} as never)
    const deleteComponent = vi.spyOn(estimatingApi, 'deleteComponent').mockResolvedValue()

    const savedSections = [
      section('sec-1', {
        services: [service('svc-1', { components: [component('cmp-1')] })],
      }),
    ]
    const draftSections = [
      section('sec-1', {
        services: [service('svc-1', { qty: 10, components: [] })],
      }),
      section('sec-local-2', { name: 'New region', sortOrder: 1, services: [service('svc-local-3')] }),
    ]

    await persistEstimateTree('est-1', savedSections, draftSections)

    expect(deleteComponent).toHaveBeenCalledWith('est-1', 'sec-1', 'svc-1', 'cmp-1')
    expect(updateService).toHaveBeenCalledWith('est-1', 'sec-1', 'svc-1', { qty: 10 })
    // new section posts WITHOUT local ids, nested services included
    expect(createSection).toHaveBeenCalledTimes(1)
    const [estId, body] = createSection.mock.calls[0]
    expect(estId).toBe('est-1')
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('estimateId')
    expect(body.name).toBe('New region')
    expect(body.sortOrder).toBe(1)
    expect(body.services).toHaveLength(1)
    expect(body.services![0]).not.toHaveProperty('id')
    expect(body.services![0]).not.toHaveProperty('sectionId')
  })

  it('is a no-op (zero API calls) when nothing changed', async () => {
    const createSection = vi.spyOn(estimatingApi, 'createSection').mockResolvedValue({} as never)
    const saved = [section('sec-1', { services: [service('svc-1')] })]
    await persistEstimateTree('est-1', saved, saved)
    expect(createSection).not.toHaveBeenCalled()
  })
})
