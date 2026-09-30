// ---------------------------------------------------------------------------
// MSW fixture for GET /api/estimating/service-catalog (Handoff 55 §3).
//
// TODO(h55-service-catalog): PROVISIONAL, MOCK-ONLY. This is NOT the seed —
// §1 seeds service_categories / services from
// scripts/data/aspire_install_service_catalog.json. Category names and item
// class codes follow the handoff's section → item-class table; service names
// follow its "IN:" examples. Ids are fixture ids, and aspireServiceId is
// deliberately null: a made-up Aspire id is invisible until someone reconciles
// against Aspire. Default items are empty — authoring them is §1 Step 3.
// ---------------------------------------------------------------------------

import type { CatalogService, ServiceCategory } from '@/types/estimating'

function svc(categoryId: string, slug: string, name: string, sortOrder: number): CatalogService {
  return {
    id: `svc-cat-${slug}`,
    serviceCategoryId: categoryId,
    name,
    displayName: name,
    sortOrder,
    defaultOccurrences: null,
    aspireServiceId: null,
    active: true,
    defaultItems: [],
  }
}

function category(
  slug: string,
  name: string,
  sortOrder: number,
  itemClassCodes: string[] | null,
  services: Array<[string, string]>,
  isOptional = false,
): ServiceCategory {
  const id = `cat-install-${slug}`
  return {
    id,
    code: slug.toUpperCase(),
    name,
    estimateType: 'install',
    sortOrder,
    isOptional,
    aspireServiceGroupName: null,
    itemClassCodes,
    active: true,
    services: services.map(([s, n], i) => svc(id, s, n, i)),
  }
}

export const SERVICE_CATALOG_FIXTURE: ServiceCategory[] = [
  category(
    'landscape',
    'Landscape',
    0,
    [
      '701-LAND-Aggregate',
      '702-LAND-Soil',
      '704-LAND-Mulch',
      '705-LAND-Geotextile',
      '706-LAND-Planters',
      '708-LAND-Hardscape/Pavers',
      '709-LAND-Lumber',
    ],
    [['landscape-install', 'IN: Landscape Install']],
  ),
  category(
    'irrigation',
    'Irrigation',
    1,
    ['601-IRR-Irrigation Parts', '602-IRR-Irrigation Consumables', '605-IRR-PVC Fittings', '606-IRR-PVC Pipe'],
    [['irrigation-install', 'IN: Irrigation Install']],
  ),
  category('sod', 'Sod', 2, ['703-LAND-Sod'], [['sod-install', 'IN: Sod Install']]),
  category('drainage', 'Drainage', 3, ['604-IRR-Drainage'], [['drainage-install', 'IN: Drainage Install']]),
  category('lighting', 'Lighting', 4, ['710-LAND-Lighting'], [['lighting-install', 'IN: Lighting Install']]),
  category('optional', 'Optional Services', 5, null, [], true),
  // An inactive row and a maintenance row prove the filters.
  { ...category('retired', 'Retired Category', 6, null, []), active: false },
  { ...category('mowing', 'Mowing', 0, null, []), id: 'cat-maint-mowing', estimateType: 'maintenance' },
]
