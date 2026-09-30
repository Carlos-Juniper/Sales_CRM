// ---------------------------------------------------------------------------
// Handoff 55 §4 — add a catalog service to an install section, copying its
// default items (D2). Pure: no React, no I/O.
//
//   • Picking a service inserts ONE section_services line with `serviceId`
//     set and `serviceKitId` left null (the kit link no longer identifies a
//     line), plus one component per `service_default_items` row.
//   • Cost is resolved at copy time and SNAPSHOTTED: each component takes the
//     item's `resolvedUnitCostCents` (template cost, else the material's
//     current price, else null). A saved component is never re-resolved, so a
//     material price that moves next month cannot reprice a saved estimate.
//   • An unknown cost stays null (rendered "—"), never $0.
// ---------------------------------------------------------------------------

import type {
  CatalogService,
  EstimateSection,
  SectionService,
  SectionServiceComponent,
  ServiceCategory,
  ServiceDefaultItem,
} from '@/types/estimating'

let seq = 0
function localId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

/** One labelled group of services offered by a section's "Add service" picker. */
export interface ServiceOptionGroup {
  categoryId: string
  categoryName: string
  services: CatalogService[]
}

const bySortThenName = (a: CatalogService, b: CatalogService) =>
  a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName)

/**
 * The services a section's "Add service" picker offers: only the services
 * under that section's own category (the backend rejects a service from
 * another category, D9). Standard sections are created by the backend with
 * their serviceCategoryId set; the Optional Services section offers the
 * Optional Services category's services. A section with no category (legacy)
 * or a category the catalog no longer returns (inactive) offers nothing —
 * it still renders and saves.
 */
export function serviceOptionsForSection(
  section: Pick<EstimateSection, 'serviceCategoryId'>,
  categories: ServiceCategory[],
): ServiceOptionGroup[] {
  if (section.serviceCategoryId == null) return []
  const own = categories.find((c) => c.id === section.serviceCategoryId)
  if (!own || own.services.length === 0) return []
  return [{ categoryId: own.id, categoryName: own.name, services: [...own.services].sort(bySortThenName) }]
}

/** Find a service by id across the catalog. */
export function findCatalogService(
  categories: ServiceCategory[],
  serviceId: string,
): CatalogService | null {
  for (const c of categories) {
    const s = c.services.find((v) => v.id === serviceId)
    if (s) return s
  }
  return null
}

/**
 * Copy one default item into a component, snapshotting its resolved cost.
 * `resolvedUnitCostCents` null (no template cost, no current price) stays
 * null: the estimator sees "—" and must enter a cost.
 */
export function defaultItemToComponent(
  item: ServiceDefaultItem,
  sectionServiceId: string,
  sortOrder: number,
): SectionServiceComponent {
  return {
    id: localId('cmp'),
    sectionServiceId,
    kind: item.kind,
    label: item.label,
    inventoryId: item.inventoryId,
    qty: item.qty,
    unitCostCents: item.resolvedUnitCostCents,
    hours: item.hours,
    sortOrder,
  }
}

/**
 * A new install line for a catalog service, with its default items copied in
 * template order. It carries no kit (`serviceKitId` null) and no sell price
 * yet: the estimator prices it (U/P) like any other line.
 */
export function catalogServiceToLine(
  service: CatalogService,
  sectionId: string,
  sortOrder: number,
): SectionService {
  const id = localId('svc')
  const items = [...service.defaultItems].sort((a, b) => a.sortOrder - b.sortOrder)
  return {
    id,
    sectionId,
    serviceKitId: null,
    serviceId: service.id,
    label: service.displayName || service.name,
    qty: 1,
    uom: 'EA',
    complexityPct: 0,
    unitSellCents: null,
    embeddedCostCents: null,
    targetGm: null,
    hours: null,
    sortOrder,
    components: items.map((it, i) => defaultItemToComponent(it, id, i)),
  }
}

/** The section with `service` appended as a new line (immutable update). */
export function addCatalogService(section: EstimateSection, service: CatalogService): EstimateSection {
  return {
    ...section,
    services: [...section.services, catalogServiceToLine(service, section.id, section.services.length)],
  }
}

/** The section without line `serviceId` (one deleteService op on save). */
export function removeServiceLine(section: EstimateSection, serviceId: string): EstimateSection {
  return { ...section, services: section.services.filter((s) => s.id !== serviceId) }
}

/** The line without item `componentId` (one deleteComponent op on save). */
export function removeComponent(svc: SectionService, componentId: string): SectionService {
  return { ...svc, components: svc.components.filter((c) => c.id !== componentId) }
}
