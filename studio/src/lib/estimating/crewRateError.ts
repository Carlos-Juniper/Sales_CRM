// ---------------------------------------------------------------------------
// Structured no-crew-rate save error.
//
// Confirmed in api/maintenance_pricing.py (`CREW_RATE_REQUIRED`):
//
//   HTTP 422
//   {
//     "detail": {
//       "code": "crew_rate_required",
//       "blockedLines": [
//         { "serviceId": "<section_services.id>", "sectionId"?: "<estimate_sections.id>" }
//       ]
//     }
//   }
//
// The 422 is raised before any insert, so a rejected save persists nothing.
// POST create / section / service has no section_services id yet, so
// blockedLines is []. PATCH stamps the saved id, so blockedLines names those
// rows. The list holds only crew-rate-derived lines. User-facing wording
// lives in CREW_RATE_ERROR_MESSAGES, never in the API payload.
// ---------------------------------------------------------------------------

import { ApiError } from '@/api/client'
import { sellRateCentsPer1000Sf } from '@/lib/estimating/maintenance'

export const CREW_RATE_REQUIRED_CODE = 'crew_rate_required'

export interface CrewRateBlockedLine {
  serviceId: string
  sectionId?: string
}

export interface CrewRateRequiredError {
  code: typeof CREW_RATE_REQUIRED_CODE
  blockedLines: CrewRateBlockedLine[]
}

/** Frontend-owned wording, keyed by the API error code. */
export const CREW_RATE_ERROR_MESSAGES: Record<string, string> = {
  [CREW_RATE_REQUIRED_CODE]:
    'Set a crew rate for this branch in Settings before saving maintenance prices that are calculated from it.',
}

export function messageForErrorCode(code: string): string | null {
  return CREW_RATE_ERROR_MESSAGES[code] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function parseBlockedLine(value: unknown): CrewRateBlockedLine | null {
  if (!isRecord(value)) return null
  if (typeof value.serviceId !== 'string' || value.serviceId === '') return null
  const line: CrewRateBlockedLine = { serviceId: value.serviceId }
  if (value.sectionId != null) {
    if (typeof value.sectionId !== 'string' || value.sectionId === '') return null
    line.sectionId = value.sectionId
  }
  return line
}

/**
 * Recognize the structured crew-rate 422. Any other body — including the old
 * plain-text detail — returns null so the caller can keep its own message.
 */
export function parseCrewRateRequiredError(err: unknown): CrewRateRequiredError | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null
  if (!isRecord(err.detail)) return null
  if (err.detail.code !== CREW_RATE_REQUIRED_CODE) return null
  if (!Array.isArray(err.detail.blockedLines)) return null
  const blockedLines: CrewRateBlockedLine[] = []
  for (const item of err.detail.blockedLines) {
    const line = parseBlockedLine(item)
    if (!line) return null
    blockedLines.push(line)
  }
  return { code: CREW_RATE_REQUIRED_CODE, blockedLines }
}

/** Kit fields the derived-price rule reads. Catalog unit sell > 0 is a catalog price. */
export interface CrewRateKitPrice {
  productionRate: number | null
  unitSellCents: number | null
  targetGm: number | null
}

export interface CrewRateLinePrice {
  unitSellCents: number | null
  catalogItemId: string | null
}

/**
 * Mirrors api/maintenance_pricing.py: a line is crew-rate-derived when its kit
 * has productionRate > 0 and no catalog unit sell (null or 0), AND the line's
 * unitSellCents is null, 0, or equal to sellRateCentsPer1000Sf at the live
 * branch rate. A positive sell that is not that formula is hand-entered. A kit
 * with unitSellCents > 0 is catalog-priced. Neither is derived.
 *
 * Use this only to interpret a 422 whose blockedLines is empty. Do not call it
 * to refuse a save before the request.
 */
export function isCrewRateDerivedLine(
  line: CrewRateLinePrice,
  kit: CrewRateKitPrice | null | undefined,
  liveCrewRateCents: number | null,
): boolean {
  if (!kit || kit.productionRate == null || kit.productionRate <= 0) return false
  if (kit.unitSellCents != null && kit.unitSellCents !== 0) return false
  if (line.unitSellCents == null || line.unitSellCents === 0) return true
  if (liveCrewRateCents == null) return false
  const computed = sellRateCentsPer1000Sf(
    kit.productionRate,
    kit.targetGm ?? 0,
    liveCrewRateCents,
  )
  return line.unitSellCents === computed
}

interface DraftSectionPrices {
  id: string
  services: readonly (CrewRateLinePrice & { id: string })[]
}

/**
 * Unsaved lines to mark when a create 422 returns blockedLines: [].
 * Saved rows are left to the server's list — a PATCH names them by id.
 */
export function unsavedCrewRateDerivedLines(
  savedSections: readonly { services: readonly { id: string }[] }[],
  draftSections: readonly DraftSectionPrices[],
  catalogItems: readonly (CrewRateKitPrice & { id: string })[],
  liveCrewRateCents: number | null,
): CrewRateBlockedLine[] {
  const savedIds = new Set(savedSections.flatMap((section) => section.services.map((svc) => svc.id)))
  const kits = new Map(catalogItems.map((kit) => [kit.id, kit]))
  const blocked: CrewRateBlockedLine[] = []
  for (const section of draftSections) {
    for (const svc of section.services) {
      if (savedIds.has(svc.id)) continue
      const kit = svc.catalogItemId ? kits.get(svc.catalogItemId) : undefined
      if (!isCrewRateDerivedLine(svc, kit, liveCrewRateCents)) continue
      blocked.push({ serviceId: svc.id, sectionId: section.id })
    }
  }
  return blocked
}

/** True when this line is one of the lines the server refused to price. */
export function isCrewRateBlockedLine(
  sectionId: string,
  serviceId: string,
  blockedLines: readonly CrewRateBlockedLine[],
): boolean {
  return blockedLines.some((line) => {
    if (line.serviceId !== serviceId) return false
    if (line.sectionId != null && line.sectionId !== sectionId) return false
    return true
  })
}
