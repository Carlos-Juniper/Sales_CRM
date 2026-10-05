// ---------------------------------------------------------------------------
// Handoff 54 §3 — the ONE place the maintenance editor reads the service
// catalog's kit links. Everything else in the editor sees plain kit ids.
//
// BACKEND ASSUMPTION (Handoff 54 §1 is not on main yet): §1 says
// GET /api/estimating/service-catalog returns "categories → services → kits
// nested". The response today (api/service_catalog.py) nests only
// `defaultItems`. This adapter reads the assumed `kits` array first (only
// `id`, a service_kits.id, is read) and falls back to the existing
// `defaultItems[].serviceKitId`. When §1's final field name lands, change
// ONLY this file.
// ---------------------------------------------------------------------------

import type { CatalogService, ServiceCategory } from '@/types/estimating'

/** §1's assumed nested kit link (service_kit_links → service_kits). */
export interface CatalogKitLink {
  id: string
}

/** The catalog service as §1 is expected to serve it for maintenance. */
export type MaintenanceCatalogServiceWire = CatalogService & { kits?: CatalogKitLink[] }

/** Every service_kits id that prices `service`, in catalog order. */
export function catalogServiceKitIds(service: CatalogService): string[] {
  const { kits } = service as MaintenanceCatalogServiceWire
  if (kits && kits.length > 0) return kits.map((k) => k.id)
  return service.defaultItems.flatMap((d) => (d.serviceKitId ? [d.serviceKitId] : []))
}

/**
 * The kit a new line is priced from. A section_services row carries ONE
 * service_kit_id, so a multi-kit service prices from its first link.
 */
export function primaryKitId(service: CatalogService): string | null {
  return catalogServiceKitIds(service)[0] ?? null
}

/** The maintenance categories of a catalog response, in display order. */
export function maintenanceCategories(categories: ServiceCategory[] | undefined): ServiceCategory[] {
  return (categories ?? [])
    .filter((c) => c.estimateType === 'maintenance')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export type CatalogStatus = 'loading' | 'unavailable' | 'ready'

/** The add-control state for a catalog query. */
export function catalogStatus(query: { isLoading: boolean; isError: boolean }): CatalogStatus {
  if (query.isLoading) return 'loading'
  return query.isError ? 'unavailable' : 'ready'
}
