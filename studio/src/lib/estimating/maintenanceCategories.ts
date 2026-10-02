// ---------------------------------------------------------------------------
// Handoff 54 §3 — group a section's lines into category blocks at render
// time. The persisted shape (section.services[]) is untouched, so
// persistTree.ts's diff engine keeps working as-is.
//
//   standard category  every non-optional maintenance category, always shown
//   Optional Services  one block for lines from any optional category
//   Other services     lines the catalog can't place (pre-catalog kit lines)
// ---------------------------------------------------------------------------

import type {
  CatalogService,
  EstimateSection,
  SectionService,
  ServiceCategory,
} from '@/types/estimating'
import { catalogServiceKitIds, primaryKitId } from './maintenanceCatalogAdapter'
import {
  COMPANY_DEFAULT_COMPLEXITY_PCT,
  type MaintenanceCatalogService,
  newLocalId,
} from './maintenance'

export type ServiceGroupKind = 'standard' | 'optional' | 'other'

export interface ServiceGroup {
  key: string
  label: string
  kind: ServiceGroupKind
  services: SectionService[]
}

export const OPTIONAL_GROUP_KEY = 'optional'
export const OTHER_GROUP_KEY = 'other'

interface CategoryIndex {
  byServiceId: Map<string, ServiceCategory>
  byKitId: Map<string, ServiceCategory>
}

function indexCategories(categories: ServiceCategory[]): CategoryIndex {
  const index: CategoryIndex = { byServiceId: new Map(), byKitId: new Map() }
  for (const category of categories) {
    for (const service of category.services) {
      index.byServiceId.set(service.id, category)
      for (const kitId of catalogServiceKitIds(service)) {
        if (!index.byKitId.has(kitId)) index.byKitId.set(kitId, category)
      }
    }
  }
  return index
}

/** A line's category: its catalog service first, else its kit's link. */
function categoryOf(svc: SectionService, index: CategoryIndex): ServiceCategory | undefined {
  if (svc.serviceId && index.byServiceId.has(svc.serviceId)) {
    return index.byServiceId.get(svc.serviceId)
  }
  return svc.serviceKitId ? index.byKitId.get(svc.serviceKitId) : undefined
}

function groupKeyOf(category: ServiceCategory | undefined): string {
  if (!category) return OTHER_GROUP_KEY
  return category.isOptional ? OPTIONAL_GROUP_KEY : category.id
}

/**
 * Standard blocks in catalog order, then Optional Services, then Other
 * services only when some line has no category.
 */
export function groupSectionServices(
  services: SectionService[],
  categories: ServiceCategory[],
): ServiceGroup[] {
  const index = indexCategories(categories)
  const buckets = new Map<string, SectionService[]>()
  for (const svc of services) {
    const key = groupKeyOf(categoryOf(svc, index))
    buckets.set(key, [...(buckets.get(key) ?? []), svc])
  }
  const groups: ServiceGroup[] = categories
    .filter((c) => !c.isOptional)
    .map((c) => ({ key: c.id, label: c.name, kind: 'standard', services: buckets.get(c.id) ?? [] }))
  groups.push({
    key: OPTIONAL_GROUP_KEY,
    label: 'Optional Services',
    kind: 'optional',
    services: buckets.get(OPTIONAL_GROUP_KEY) ?? [],
  })
  const other = buckets.get(OTHER_GROUP_KEY)
  if (other) groups.push({ key: OTHER_GROUP_KEY, label: 'Other services', kind: 'other', services: other })
  return groups
}

export interface OptionalServiceChoice {
  category: ServiceCategory
  services: CatalogService[]
}

/** Optional-category services not yet in the section (one pick = one line). */
export function addableOptionalServices(
  services: SectionService[],
  categories: ServiceCategory[],
): OptionalServiceChoice[] {
  const present = new Set(services.map((s) => s.serviceId).filter(Boolean))
  return categories
    .filter((c) => c.isOptional)
    .map((category) => ({
      category,
      services: category.services.filter((s) => !present.has(s.id)),
    }))
    .filter((choice) => choice.services.length > 0)
}

/**
 * A new line for a catalog service, priced from its linked kit's resolved
 * rate. No resolvable kit leaves the price and hours empty: the line renders
 * "—" and the save guard blocks it until it has a rate.
 */
export function catalogServiceLine(
  service: CatalogService,
  sectionId: string,
  sortOrder: number,
  kitRates: MaintenanceCatalogService[],
): SectionService {
  const serviceKitId = primaryKitId(service)
  const rate = kitRates.find((r) => r.key === serviceKitId)
  return {
    id: newLocalId('svc'),
    sectionId,
    serviceKitId,
    serviceId: service.id,
    label: service.displayName || service.name,
    qty: service.defaultOccurrences ?? 0,
    uom: '/yr',
    complexityPct: COMPANY_DEFAULT_COMPLEXITY_PCT,
    unitSellCents: rate?.rateCentsPer1000Sf ?? null,
    embeddedCostCents: null,
    targetGm: null,
    hours: null,
    sortOrder,
    components: [],
  }
}

export function appendService(section: EstimateSection, svc: SectionService): EstimateSection {
  return { ...section, services: [...section.services, svc] }
}

/** Drops one line from the draft; Save's tree diff issues the deleteService. */
export function removeService(section: EstimateSection, serviceId: string): EstimateSection {
  return { ...section, services: section.services.filter((s) => s.id !== serviceId) }
}
