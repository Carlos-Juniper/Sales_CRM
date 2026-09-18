/**
 * Commission display helpers.
 *
 * For currency formatting, import formatCents from @/lib/estimating/maintenance directly.
 */

export type Period = 'this_year' | 'this_quarter' | 'last_quarter' | 'this_month' | 'last_month' | 'all_time'

/**
 * Derive start_date/end_date ISO strings for a named period.
 * All arithmetic is UTC-based to avoid timezone-shifted boundaries
 * (the same class of bug fixed in commit 5f7ac8a for the contract generator).
 */
export function getPeriodDates(period: Period): { start_date?: string; end_date?: string } {
  const now = new Date()
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
