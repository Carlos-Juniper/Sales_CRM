// ---------------------------------------------------------------------------
// MSW fixture for GET /api/estimating/service-catalog (Handoff 55 §1/§3/§4).
//
// MOCK-ONLY. This is NOT the seed — §1 seeds service_categories / services
// from scripts/data/aspire_install_service_catalog.json. The shapes are the
// backend's (types/estimating.ts ServiceCategory / CatalogService /
// ServiceDefaultItem, from backend PR #40). `itemClassCodes` are
// `item_classes.code` integers (e.g. 601), exactly as the API returns them.
// Ids are fixture ids, and aspireServiceId is deliberately null: a made-up
// Aspire id is invisible until someone reconciles against Aspire.
//
// Default items: the real seed ships ZERO (§1 Step 3, open item 1). The two
// on "IN: Irrigation Install" exist only so the §4 copy path is exercised —
// one priced labor line and one material with no current price
// (resolvedUnitCostCents null → the editor shows "—", never $0.00).
// Like the real endpoint, only active install/maintenance rows for the
// requested estimateType are served.
// ---------------------------------------------------------------------------

import type { CatalogService, ServiceCategory, ServiceDefaultItem } from '@/types/estimating'

function svc(
  categoryId: string,
  slug: string,
  name: string,
  sortOrder: number,
  defaultItems: ServiceDefaultItem[] = [],
): CatalogService {
  return {
    id: `svc-cat-${slug}`,
    serviceCategoryId: categoryId,
    name,
    displayName: name.replace(/^IN:\s*/, ''),
    sortOrder,
    defaultOccurrences: null,
    aspireServiceId: null,
    active: true,
    defaultItems,
  }
}

function category(
  slug: string,
  name: string,
  sortOrder: number,
  itemClassCodes: number[] | null,
  services: (categoryId: string) => CatalogService[],
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
    services: services(id),
  }
}

const IRRIGATION_DEFAULTS: ServiceDefaultItem[] = [
  {
    id: 'sdi-irr-labor',
    serviceId: 'svc-cat-irrigation-install',
    kind: 'labor',
    label: 'Irrigation install labor',
    inventoryId: null,
    serviceKitId: null,
    qty: 8,
    unitCostCents: 4500,
    resolvedUnitCostCents: 4500,
    hours: 8,
    sortOrder: 0,
  },
  {
    id: 'sdi-irr-pipe',
    serviceId: 'svc-cat-irrigation-install',
    kind: 'material',
    label: '1" CL200 PVC Pipe',
    inventoryId: 'IRR-PVC-100-CL200',
    serviceKitId: null,
    qty: 100,
    unitCostCents: null,
    // No current material_prices row: the cost is unknown, not $0.
    resolvedUnitCostCents: null,
    hours: null,
    sortOrder: 1,
  },
]

export const SERVICE_CATALOG_FIXTURE: ServiceCategory[] = [
  category('landscape', 'Landscape', 0, [701, 702, 704, 705, 706, 708, 709, 801, 802, 803, 804, 805, 806], (id) => [
    svc(id, 'landscape-install', 'IN: Landscape Install', 0),
  ]),
  category('irrigation', 'Irrigation', 1, [601, 602, 605, 606], (id) => [
    svc(id, 'irrigation-install', 'IN: Irrigation Install', 0, IRRIGATION_DEFAULTS),
    svc(id, 'sleeving', 'IN: Sleeving', 1),
  ]),
  category('sod', 'Sod', 2, [703], (id) => [svc(id, 'sod-install', 'IN: Sod Install', 0)]),
  category('drainage', 'Drainage', 3, [604], (id) => [svc(id, 'drainage-install', 'IN: Drainage Install', 0)]),
  category('lighting', 'Lighting', 4, [710], (id) => [svc(id, 'lighting-install', 'IN: Lighting Install', 0)]),
  // Aspire's Optional Services group owns no services of its own.
  category('optional', 'Optional Services', 5, null, () => [], true),
  { ...category('mowing', 'Mowing', 0, null, () => []), id: 'cat-maint-mowing', estimateType: 'maintenance' },
]
