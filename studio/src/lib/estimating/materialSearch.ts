// ---------------------------------------------------------------------------
// Handoff 55 §5 — material search inside the install grid. Pure: no React.
//
//   • GET /api/estimating/materials?q=&itemClassCodes=&limit=&cursor= (backend
//     PR #41): keyset-paged, default 25, hard cap 100.
//   • The section's category `itemClassCodes` are a SOFT prefilter; the
//     estimator can switch to "All classes" (never a hard restriction).
//   • Picking a material fills label, inventoryId, uom and unitCostCents
//     (snapshotted). No current price → null cost ("—"), never $0.
// ---------------------------------------------------------------------------

import type {
  MaterialSearchItem,
  SectionServiceComponent,
  ServiceCategory,
} from '@/types/estimating'
import { ApiError } from '@/api/client'

export const MATERIAL_SEARCH_DEFAULT_LIMIT = 25
export const MATERIAL_SEARCH_MAX_LIMIT = 100
export const MATERIAL_SEARCH_DEBOUNCE_MS = 300

/** Page size clamped to 1…100 (the API caps at 100 too). */
export function clampMaterialLimit(limit: number = MATERIAL_SEARCH_DEFAULT_LIMIT): number {
  if (!Number.isFinite(limit)) return MATERIAL_SEARCH_DEFAULT_LIMIT
  return Math.min(MATERIAL_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

export interface MaterialSearchParams {
  q: string
  /** Section prefilter; null / empty = all classes. */
  itemClassCodes: number[] | null
  limit?: number
  cursor?: string | null
}

/** Query string for GET /estimating/materials (codes comma-separated). */
export function materialSearchQuery(p: MaterialSearchParams): string {
  const qs = new URLSearchParams()
  qs.set('q', p.q.trim())
  if (p.itemClassCodes && p.itemClassCodes.length > 0) {
    qs.set('itemClassCodes', p.itemClassCodes.join(','))
  }
  qs.set('limit', String(clampMaterialLimit(p.limit)))
  if (p.cursor) qs.set('cursor', p.cursor)
  return qs.toString()
}

/** The prefilter codes for a section: its category's `itemClassCodes`, else null (unfiltered). */
export function sectionItemClassCodes(
  serviceCategoryId: string | null,
  categories: ServiceCategory[],
): number[] | null {
  if (!serviceCategoryId) return null
  const codes = categories.find((c) => c.id === serviceCategoryId)?.itemClassCodes ?? null
  return codes && codes.length > 0 ? codes : null
}

/**
 * The prefilter codes for a service line. Services carry no codes of their
 * own, so this is the codes of the catalog category the line's service
 * (`serviceId`) belongs to; failing that (free-text / kit line, or a category
 * with no codes) the section's category codes; else null (unfiltered).
 */
export function serviceItemClassCodes(
  serviceId: string | null | undefined,
  sectionCategoryId: string | null,
  categories: ServiceCategory[],
): number[] | null {
  if (serviceId) {
    const own = categories.find((c) => c.services.some((v) => v.id === serviceId))
    if (own && own.itemClassCodes && own.itemClassCodes.length > 0) return own.itemClassCodes
  }
  return sectionItemClassCodes(sectionCategoryId, categories)
}

/** The codes actually sent: none when "All classes" is on. */
export function effectiveItemClassCodes(
  sectionCodes: number[] | null,
  allClasses: boolean,
): number[] | null {
  return allClasses ? null : sectionCodes
}

/**
 * Cost + unit a picked material brings. The component's `uom` is the unit its
 * `unitCostCents` is expressed in, so qty × cost is never mixed-unit:
 *   - a price with a `costUom` → that cost in `costUom`;
 *   - otherwise (no price) → null cost, in the material's `uom`.
 * Once the backend returns cost already in `uom` (costUom === uom) this is
 * simply the material's uom.
 */
export function materialCostAndUnit(m: MaterialSearchItem): {
  unitCostCents: number | null
  uom: string | null
} {
  if (m.unitCostCents === null) return { unitCostCents: null, uom: m.uom }
  return { unitCostCents: m.unitCostCents, uom: m.costUom ?? m.uom }
}

/** A new material item row from a search pick (inventoryId, label, uom, snapshotted cost). */
export function materialToComponent(
  m: MaterialSearchItem,
  sectionServiceId: string,
  sortOrder: number,
  id: string,
): SectionServiceComponent {
  const { unitCostCents, uom } = materialCostAndUnit(m)
  return {
    id,
    sectionServiceId,
    kind: 'material',
    label: m.description,
    inventoryId: m.inventoryId,
    uom,
    qty: 1,
    unitCostCents,
    hours: null,
    sortOrder,
  }
}

/** Items on the draft whose cost is unknown (rendered "—"). */
export function unknownCostItemCount(
  services: Array<{ components: SectionServiceComponent[] }>,
): number {
  return services.reduce((n, s) => n + s.components.filter((c) => c.unitCostCents === null).length, 0)
}

/**
 * A save rejected because a material has no current price. The backend has
 * not decided between storing null and a 422; both mean "unknown cost".
 */
export function isUnknownCostSaveError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 422) return false
  return /no (current )?price|missing (a )?price|unitCostCents.*(required|null|missing)/i.test(err.message)
}

export const UNKNOWN_COST_SAVE_MESSAGE =
  'Some items have no current price. Enter a unit cost for each item showing “—”, then save again.'
