/**
 * Commission display helpers.
 *
 * For currency formatting, import formatCents from @/lib/estimating/maintenance directly.
 */

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
