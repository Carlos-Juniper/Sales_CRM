/**
 * Commission display helpers.
 * Currency formatting uses formatCents from the estimating module.
 */
import { formatCents } from '@/lib/estimating/maintenance'

/** Shown when a payout amount is still unknown. Never a guessed value. */
export const PENDING_BILLING_DATA_LABEL = 'Pending billing data'

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
export function getCommissionPeriodDates(period: Period, now = new Date()): { start_date: string; end_date: string } {
  if (period === 'all_time') {
    return { start_date: '1970-01-01', end_date: now.toISOString().slice(0, 10) }
  }
  const { start_date, end_date } = getPeriodDates(period, now)
  if (start_date === undefined || end_date === undefined) {
    throw new Error(`Missing commission period dates for ${period}`)
  }
  return { start_date, end_date }
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

/** `2026-Q1` → `Q1 2026`. Unknown shapes are shown as the API sent them. */
export function formatCloseQuarter(closeQuarter: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(closeQuarter)
  if (!match) return closeQuarter
  return `Q${match[2]} ${match[1]}`
}

/**
 * Dollar amount only when the API sent one.
 * A null total means every contributing amount is unknown.
 * `amount_partial` means the figure is the known part of a mixed group.
 * The check name is `payout_period_label` from the server, not this helper.
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
