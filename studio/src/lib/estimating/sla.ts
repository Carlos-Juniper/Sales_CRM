// ---------------------------------------------------------------------------
// SLA helpers (BRD I-6.2).
//
// The clock starts at estimate creation/intake and `dueBackDate` marks its
// end. The return window (company_settings.sla_return_window_days, seeded
// at 14) is no longer a minimum lead time: a date inside the window is
// accepted and the server flags the estimate `isRush`. SLA_CONFIG is the
// client fallback for that window when company settings have not loaded,
// and the at-risk countdown still reads `atRiskThresholdDays` from here.
// Views do not hardcode day counts.
// ---------------------------------------------------------------------------

export interface SlaConfig {
  /**
   * Calendar-day return window. Fallback when
   * company_settings.sla_return_window_days is not loaded yet. A needed-back
   * date from today through this many days minus one is a rush job.
   */
  returnWindowDays: number
  /** Days-left at or below which an estimate counts as "SLA at risk". */
  atRiskThresholdDays: number
}

/** TODO(carlos): confirm the at-risk threshold (open item). */
export const SLA_CONFIG: SlaConfig = {
  returnWindowDays: 14,
  atRiskThresholdDays: 4,
}

/** Server 400 detail when dueBackDate is before today. */
export const DUE_BACK_PAST_MESSAGE = 'dueBackDate cannot be in the past'

/**
 * Juniper's business calendar. company_settings has no timezone column, and
 * the API uses this same zone for "today" so an evening same-day date is not
 * compared against UTC.
 */
export const BUSINESS_TIME_ZONE = 'America/New_York'

/** Calendar date in the business timezone, as YYYY-MM-DD. */
export function businessDateOnly(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

/** Calendar date `days` after a YYYY-MM-DD string. */
export function addCalendarDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDateOnly(new Date(y, m - 1, d + days))
}

/**
 * Blank needed-back / internal deadline.
 *
 * Business today plus the SLA return window (fallback 14). That date is on
 * the window boundary, so the estimate is not a rush.
 */
export function defaultDueBackDate(
  windowDays: number = SLA_CONFIG.returnWindowDays,
  today: string = businessDateOnly(),
): string {
  const days =
    Number.isFinite(windowDays) && windowDays >= 0
      ? Math.trunc(windowDays)
      : SLA_CONFIG.returnWindowDays
  return addCalendarDays(today, days)
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

/**
 * The user's local calendar date as YYYY-MM-DD.
 *
 * Date inputs and `min` compare this string. `toISOString()` is UTC and
 * shifts the day for anyone not on UTC (evening in the US is already
 * tomorrow in UTC; early morning ahead of UTC is still yesterday).
 */
export function localDateOnly(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Leading YYYY-MM-DD of a date-only string or an ISO timestamp. */
export function calendarDatePrefix(value: string): string | null {
  const day = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/**
 * Whole calendar days from `today` (local YYYY-MM-DD) until `value`.
 * 0 = due today; negative = before today. Date-only strings are compared
 * as calendar dates, not parsed with `new Date('YYYY-MM-DD')` (that is
 * UTC midnight and lands on the previous local day west of UTC).
 */
export function calendarDaysOut(value: string, today: string = localDateOnly()): number | null {
  const day = calendarDatePrefix(value)
  const from = calendarDatePrefix(today)
  if (!day || !from) return null
  const [y, m, d] = day.split('-').map(Number)
  const [ty, tm, td] = from.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / DAY_MS)
}

/** True when the calendar date is strictly before the user's local today. */
export function isPastCalendarDate(value: string, today: string = localDateOnly()): boolean {
  const days = calendarDaysOut(value, today)
  return days !== null && days < 0
}

/**
 * Form-hint only: the chosen date falls in today .. windowDays-1.
 *
 * The Rush badge must NOT call this. The server owns `isRush`; a missing
 * date, a date on/after the window, or a date already past is not a rush.
 */
export function isRushWindowDate(
  value: string,
  windowDays: number,
  today: string = localDateOnly(),
): boolean {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return false
  const days = calendarDaysOut(value, today)
  return days !== null && days >= 0 && days < windowDays
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
