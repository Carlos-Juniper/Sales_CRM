// ---------------------------------------------------------------------------
// Structured no-crew-rate save error.
//
// ASSUMPTION — not confirmed in api/estimating.py yet. As of the branch tip
// this file was written against, the gate still raises
// HTTPException(status_code=422, detail=<plain sentence>). The backend is
// replacing that sentence with an error code. Until that lands, the frontend
// parses exactly this shape and nothing else:
//
//   HTTP 422
//   {
//     "detail": {
//       "code": "crew_rate_required",
//       "blockedLines": [
//         { "serviceId": "<section_services.id>", "sectionId": "<estimate_sections.id>" }
//       ]
//     }
//   }
//
// `serviceId` is the line id the editor already has. `sectionId` is optional;
// when the server sends it, both must match. The server lists only lines whose
// price is calculated from the crew rate. Catalog prices and hand-entered
// prices are omitted. User-facing wording lives in CREW_RATE_ERROR_MESSAGES,
// never in the API payload.
// ---------------------------------------------------------------------------

import { ApiError } from '@/api/client'

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
