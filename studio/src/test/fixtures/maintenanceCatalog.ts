// ---------------------------------------------------------------------------
// Handoff 54 §3 test fixture: a maintenance service catalog shaped like
// GET /api/estimating/service-catalog?estimateType=maintenance. Category and
// service names follow the handoff's Aspire screenshots; ids are fixture ids.
// Kit links use the existing `defaultItems[].serviceKitId` except where a
// test opts into the assumed §1 `kits` array.
// ---------------------------------------------------------------------------

import type { CatalogService, ServiceCategory, ServiceKit } from '@/types/estimating'

export const MOW_KIT: ServiceKit = {
  id: 'kit-maint-3422',
  description: 'Standard Production Mowing',
  uom: 'Sq. Ft.',
  unitCostCents: 1750,
  unitSellCents: 0,
  targetGm: 0.22,
  kitType: 'maintenance_hours',
  productionRate: 60000,
  aspireBranchId: null,
  active: true,
  serviceType: 'Turf Area',
}

/** A priced optional kit: catalog unit sell, so no crew rate is needed. */
export const MULCH_KIT: ServiceKit = {
  ...MOW_KIT,
  id: 'kit-maint-mulch',
  description: 'Mulch Install',
  unitSellCents: 500,
  productionRate: 20000,
  serviceType: 'Mulch',
}

export function catalogService(
  categoryId: string,
  slug: string,
  displayName: string,
  sortOrder: number,
  opts: { kitId?: string; defaultOccurrences?: number } = {},
): CatalogService {
  const id = `svc-m-${slug}`
  return {
    id,
    serviceCategoryId: categoryId,
    name: `MC: ${displayName}`,
    displayName,
    sortOrder,
    defaultOccurrences: opts.defaultOccurrences ?? null,
    aspireServiceId: null,
    active: true,
    defaultItems: opts.kitId
      ? [
          {
            id: `sdi-${slug}`,
            serviceId: id,
            kind: 'labor',
            label: displayName,
            inventoryId: null,
            serviceKitId: opts.kitId,
            qty: 1,
            unitCostCents: null,
            resolvedUnitCostCents: null,
            hours: null,
            sortOrder: 0,
          },
        ]
      : [],
  }
}

function category(
  code: string,
  name: string,
  sortOrder: number,
  services: (id: string) => CatalogService[],
  isOptional = false,
): ServiceCategory {
  const id = `cat-m-${code}`
  return {
    id,
    code,
    name,
    estimateType: 'maintenance',
    sortOrder,
    isOptional,
    aspireServiceGroupName: name,
    itemClassCodes: null,
    active: true,
    services: services(id),
  }
}

export const MAINTENANCE_CATALOG: ServiceCategory[] = [
  category('turf', 'Turf', 0, (id) => [
    catalogService(id, 'mowing', 'Mowing Service', 0, { kitId: MOW_KIT.id, defaultOccurrences: 40 }),
  ]),
  category('bed', 'Bed Maint', 1, (id) => [catalogService(id, 'pruning', 'Pruning', 0)]),
  category('irrigation', 'Irrigation', 2, (id) => [catalogService(id, 'wet-check', 'Wet Check', 0)]),
  category('fert', 'Fertilizer', 3, (id) => [
    catalogService(id, 'fert-shrub-q1', 'Fertilizer Shrub – Q1', 0),
    catalogService(id, 'fert-turf-q1', 'Fertilizer Turf – Q1', 1),
  ]),
  category('pest', 'Pest Control', 4, (id) => [
    catalogService(id, 'fungus', 'Fungus and Turf Weed Control', 0),
    catalogService(id, 'insect', 'Insect and Disease Control', 1),
  ]),
  category(
    'optional',
    'Optional Services',
    5,
    (id) => [
      catalogService(id, 'mulch', 'Mulch', 0, { kitId: MULCH_KIT.id, defaultOccurrences: 2 }),
      catalogService(id, 'annuals', 'Annuals', 1),
    ],
    true,
  ),
]

export const STANDARD_CATEGORY_NAMES = ['Turf', 'Bed Maint', 'Irrigation', 'Fertilizer', 'Pest Control']
