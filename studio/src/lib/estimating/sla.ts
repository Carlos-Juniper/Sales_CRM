// ---------------------------------------------------------------------------
// SLA helpers (Handoff 02 — BRD I-6.2).
//
// Estimating requests a MINIMUM 14-calendar-day return window; the clock
// starts at estimate creation/intake and `dueBackDate` marks its end. The
// "at risk" threshold is CONFIG (open item — confirm the day count with
// Carlos; the prototype's risk flag was a static demo attribute, never
// computed). Every view reads SLA_CONFIG — no view hardcodes day counts.
// ---------------------------------------------------------------------------

export interface SlaConfig {
  /** BRD I-6.2 — minimum calendar-day return window. */
  returnWindowDays: number
  /** Days-left at or below which an estimate counts as "SLA at risk". */
  atRiskThresholdDays: number
}

/** TODO(carlos): confirm the at-risk threshold (Handoff 02 §4 open item). */
export const SLA_CONFIG: SlaConfig = {
  returnWindowDays: 14,
  atRiskThresholdDays: 4,
}

export type SlaState = 'ok' | 'at_risk' | 'breached'

const DAY_MS = 86400000

/**
 * Format a Date (or date-input string) as 'YYYY-MM-DD'. The backend's
 * due_back_date / anticipated_close_date / service_start_date columns are
 * SQL DATE, not DATETIME — a full `toISOString()` timestamp (with time +
 * 'Z') fails the insert with "Incorrect date value".
 */
export function toDateOnly(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  return iso.split('T')[0]
}

/**
 * Whole calendar days from `now` until the due-back date (midnight-normalized
 * so time of day never shifts the count). 0 = due today; negative = overdue.
 */
export function slaDaysLeft(dueBackDate: string, now: Date = new Date()): number {
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  const to = new Date(dueBackDate)
  to.setHours(0, 0, 0, 0)
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

/** Classify days-left against the config threshold (inclusive). */
export function slaStateFor(daysLeft: number, config: SlaConfig = SLA_CONFIG): SlaState {
  if (daysLeft < 0) return 'breached'
  if (daysLeft <= config.atRiskThresholdDays) return 'at_risk'
  return 'ok'
}

/** Card countdown text: "Xd left" → "Xd left — SLA risk" → "Xd overdue — SLA breached". */
export function slaCountdownLabel(daysLeft: number, state: SlaState): string {
  if (state === 'breached') return `${Math.abs(daysLeft)}d overdue — SLA breached`
  if (state === 'at_risk') {
    return daysLeft === 0 ? 'Due today — SLA risk' : `${daysLeft}d left — SLA risk`
  }
  return `${daysLeft}d left`
}
