// Yearly maintenance visit counts (mowing, pruning, turf fert, shrub fert,
// IPM, irrigation). Shared by the intake form and the MSW handlers so the
// client and the mock agree with the API: JSON integers 0–366, or null.
// 366 is every day of a leap year. Null means unanswered; 0 means the
// service is not in the contract.

export const MAX_YEARLY_OCCURRENCES = 366

export const OCCURRENCE_COUNT_FIELDS = [
  { key: 'mowingOccurrences', label: 'Mowing' },
  { key: 'pruningOccurrences', label: 'Pruning' },
  { key: 'turfFertOccurrences', label: 'Turf Fert' },
  { key: 'shrubFertOccurrences', label: 'Shrub Fert' },
  { key: 'ipmOccurrences', label: 'IPM' },
  { key: 'irrigationOccurrences', label: 'Irrigation' },
] as const

export type OccurrenceCountKey = (typeof OCCURRENCE_COUNT_FIELDS)[number]['key']

export type OccurrenceCounts = Record<OccurrenceCountKey, number | null>

/** Blank inputs for a fresh maintenance intake. */
export function emptyOccurrenceInputs(): Record<OccurrenceCountKey, string> {
  return {
    mowingOccurrences: '',
    pruningOccurrences: '',
    turfFertOccurrences: '',
    shrubFertOccurrences: '',
    ipmOccurrences: '',
    irrigationOccurrences: '',
  }
}

/** Nulls for estimates that never captured the counts (install, legacy rows). */
export function emptyOccurrenceCounts(): OccurrenceCounts {
  return {
    mowingOccurrences: null,
    pruningOccurrences: null,
    turfFertOccurrences: null,
    shrubFertOccurrences: null,
    ipmOccurrences: null,
    irrigationOccurrences: null,
  }
}

export function isOccurrenceCountKey(value: string): value is OccurrenceCountKey {
  return OCCURRENCE_COUNT_FIELDS.some((field) => field.key === value)
}

/** Server 422 `detail` for a bad count. The field name is the camelCase key. */
export function occurrenceCountDetail(field: string): string {
  return `${field} must be an integer from 0 to ${MAX_YEARLY_OCCURRENCES}, or null`
}

/**
 * Validate a JSON value already parsed from a request body.
 * Absent keys are the caller's concern (create stores null; PATCH leaves
 * the column unchanged). `null` is valid. Floats, numeric strings, and
 * booleans are not.
 */
export function occurrenceCountError(field: string, value: unknown): string | null {
  if (value === null) return null
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_YEARLY_OCCURRENCES
  ) {
    return null
  }
  return occurrenceCountDetail(field)
}

/**
 * Map one intake input to the integer the API stores.
 * `''` → null. `'0'` → 0. Decimals, signs, and values above 366 → invalid.
 */
export function parseOccurrenceInput(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return 'invalid'
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n > MAX_YEARLY_OCCURRENCES) return 'invalid'
  return n
}
