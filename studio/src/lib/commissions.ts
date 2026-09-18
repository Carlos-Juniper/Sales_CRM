/**
 * Commission display helpers.
 *
 * Reuses formatCents from lib/estimating/maintenance.ts for currency
 * formatting rather than reimplementing Intl.NumberFormat.
 */

import { formatCents } from '@/lib/estimating/maintenance'

/** Format commission amount from integer cents to dollar string. */
export function formatCommission(cents: number): string {
  return formatCents(cents)
}

/** Format a commission rate decimal as a percentage string (0.05 → "5.00%"). */
export function formatRate(decimal: number): string {
  return `${(decimal * 100).toFixed(2)}%`
}

/** Format a Date as a payment period label ("January 2024"). */
export function formatPaymentPeriod(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
