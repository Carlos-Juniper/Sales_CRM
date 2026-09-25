/**
 * Commission display helpers.
 * Currency formatting uses formatCents from the estimating module.
 */
import { formatCents } from '@/lib/estimating/maintenance'
import type { CommissionPayoutBucket } from '@/types/commissions'

/** Shown wherever a payout amount is still unknown. Never a guessed value. */
export const PENDING_BILLING_DATA_LABEL = 'Pending billing data'

/** Known dollars with no payout date. Kept apart from unknown amounts. */
export const UNSCHEDULED_AMOUNT_KNOWN_LABEL = 'Unscheduled (amount known)'

export type Period = 'this_year' | 'this_quarter' | 'last_quarter' | 'this_month' | 'last_month' | 'all_time'

/**
 * Derive start_date/end_date ISO strings for a named period.
 * All arithmetic is UTC-based to avoid timezone-shifted boundaries
 * (the same class of bug fixed in commit 5f7ac8a for the contract generator).
 */
export function getPeriodDates(period: Period, now = new Date()): { start_date?: string; end_date?: string } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()          // 0-indexed
  const quarter = Math.floor(month / 3)   // 0-indexed
  const today = now.toISOString().slice(0, 10)
  const ymd = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  switch (period) {
    case 'this_year':
      return { start_date: `${year}-01-01`, end_date: today }

    case 'this_quarter': {
      const qStartMonth = quarter * 3   // 0-indexed
      return { start_date: ymd(year, qStartMonth + 1, 1), end_date: today }
    }

    case 'last_quarter': {
      const lqIdx = quarter === 0 ? 3 : quarter - 1
      const lqYear = quarter === 0 ? year - 1 : year
      const lqStartMonth = lqIdx * 3
      // Day 0 of the current quarter's first month = last day of previous quarter
      const lqEnd = new Date(Date.UTC(year, quarter * 3, 0))
      return {
        start_date: ymd(lqYear, lqStartMonth + 1, 1),
        end_date: lqEnd.toISOString().slice(0, 10),
      }
    }

    case 'this_month':
      return { start_date: ymd(year, month + 1, 1), end_date: today }

    case 'last_month': {
      const lmYear = month === 0 ? year - 1 : year
      const lm = month === 0 ? 12 : month   // 1-indexed
      // Day 0 of the current month = last day of last month
      const lmEnd = new Date(Date.UTC(year, month, 0))
      return {
        start_date: ymd(lmYear, lm, 1),
        end_date: lmEnd.toISOString().slice(0, 10),
      }
    }

    case 'all_time':
      return {}
  }
}

/**
 * Date window for the commissions page.
 *
 * `all_time` sends an explicit start. Omitting dates makes
 * GET /commissions/summary default to the current calendar year, so the
 * All Time label would otherwise show year-to-date totals. The list
 * endpoint treats a missing window as unbounded; the explicit start
 * keeps the two responses on the same deals.
 *
 * Month and quarter values still bound deal close dates (`created_at`),
 * not the month a check is paid.
 */
export function getCommissionPeriodDates(period: Period, now = new Date()): { start_date?: string; end_date?: string } {
  if (period === 'all_time') {
    return { start_date: '1970-01-01', end_date: now.toISOString().slice(0, 10) }
  }
  return getPeriodDates(period, now)
}

/**
 * Close year for GET /commissions/payout-schedule.
 * The schedule endpoint takes a close year, not a month.
 */
export function closeYearForPeriod(period: Period, now = new Date()): number {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  if (period === 'last_quarter' && month < 3) return year - 1
  if (period === 'last_month' && month === 0) return year - 1
  return year
}

export function scheduleScopeNote(period: Period, year: number): string {
  if (period === 'this_month' || period === 'last_month') {
    return `The month filter applies to the deal list and close totals. This schedule is every deal closed in ${year}.`
  }
  if (period === 'all_time') {
    return `All Time includes every close in the deal list. This schedule is only ${year}.`
  }
  if (period === 'last_quarter' || period === 'this_quarter') {
    return `Deals closed in ${year}. The quarter filter narrows the deal list and close totals; this schedule is the full close year.`
  }
  return `Deals closed in ${year}. A check can fall in a later month. Blank amounts and dates stay blank until billing data is on file.`
}

export function closedCommissionLabel(period: Period): string {
  if (period === 'this_year') return 'Closed this year'
  if (period === 'all_time') return 'All closed commission'
  return 'Closed in period'
}

/** Format a commission rate decimal as a percentage string (0.05 → "5.00%"). */
export function formatRate(decimal: number): string {
  return `${(decimal * 100).toFixed(2)}%`
}

/** Format a Date as a payment period label ("January 2024"). */
export function formatPaymentPeriod(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** Format a contract number: Aspire number if present, otherwise "JN-{estimateNumber}". */
export function formatContractNumber(
  aspireNumber: string | null | undefined,
  estimateNumber: string | number | null | undefined,
): string {
  return aspireNumber ?? `JN-${estimateNumber}`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** `2026-Q1` → `Q1 2026`. Unknown shapes are shown as the API sent them. */
export function formatCloseQuarter(closeQuarter: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(closeQuarter)
  if (!match) return closeQuarter
  return `Q${match[2]} ${match[1]}`
}

/**
 * Check month from the API label. A known payout date can supply the month
 * when the label is blank. A missing date stays pending — it is not inferred
 * from the installment number or the close quarter.
 */
export function payoutMonthLabel(row: {
  payout_period: string | null
  payout_date: string | null
}): string {
  const period = row.payout_period?.trim()
  if (period) return period
  const iso = row.payout_date?.slice(0, 10)
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const monthIndex = Number(iso.slice(5, 7)) - 1
    const year = iso.slice(0, 4)
    const month = MONTHS[monthIndex]
    if (month) return `${month} ${year}`
  }
  return PENDING_BILLING_DATA_LABEL
}

/**
 * Dollar amount only when the API sent one.
 * A null total means every contributing amount is unknown.
 * `amount_partial` means the figure is the known part of a mixed group.
 */
export function payoutAmountLabel(row: {
  amount_cents: number | null
  amount_partial?: boolean
}): string {
  if (row.amount_cents == null) return PENDING_BILLING_DATA_LABEL
  const money = formatCents(row.amount_cents)
  if (row.amount_partial) return `${money} + pending`
  return money
}

export type PayoutDescription =
  | { kind: 'pending' }
  | { kind: 'known'; month: string; amount: number | null }

/**
 * One description for a check or installment row.
 * A null amount is pending. A known amount keeps its month label and cents.
 */
export function describePayout(row: {
  bucket?: CommissionPayoutBucket | null
  payout_period: string | null
  payout_date: string | null
  amount_cents: number | null
}): PayoutDescription {
  if (row.amount_cents == null) return { kind: 'pending' }
  return {
    kind: 'known',
    month: payoutGroupLabel(row),
    amount: row.amount_cents,
  }
}

/**
 * Heading for a schedule or check row.
 * Undated buckets use their own labels. A single installment has no bucket:
 * a known amount with no date is unscheduled, and a null amount stays pending.
 */
export function payoutGroupLabel(row: {
  bucket?: CommissionPayoutBucket | null
  payout_period: string | null
  payout_date: string | null
  amount_cents: number | null
}): string {
  if (row.bucket === 'unscheduled') return UNSCHEDULED_AMOUNT_KNOWN_LABEL
  if (row.bucket === 'pending_billing_data') return PENDING_BILLING_DATA_LABEL
  if (row.bucket === 'dated' || row.payout_date) return payoutMonthLabel(row)
  if (row.amount_cents == null && !row.payout_period) return PENDING_BILLING_DATA_LABEL
  if (!row.payout_date && row.amount_cents != null && !row.payout_period) {
    return UNSCHEDULED_AMOUNT_KNOWN_LABEL
  }
  return payoutMonthLabel(row)
}

/** Calendar date for a known payout_date. Do not call this with null. */
export function formatPayoutDate(isoDate: string): string {
  const iso = isoDate.slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return isoDate
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
