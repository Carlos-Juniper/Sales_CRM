/**
 * Integer cents as $1,234.56.
 * Distinct from formatCurrency in lib/utils, which abbreviates dollar amounts.
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
