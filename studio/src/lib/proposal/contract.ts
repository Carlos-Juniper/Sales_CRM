// ---------------------------------------------------------------------------
// Contract generator — pure calculation layer for Landscape Maintenance
// Agreement pages (scope narrative, CONTRACT SUMMARY, PAYMENT SCHEDULE).
//
// Follows the same convention as lib/proposal/chapters.ts: dependency-free of
// React/JSX, so it can be tested in isolation and its output cached/memoized
// without coupling to component lifecycle.
// ---------------------------------------------------------------------------

import { priceEachCents, maintServiceLine } from '@/lib/estimating/calc'
import type { Estimate } from '@/types/estimating'

export interface ContractRow {
  /** Service label from section_services.label (verbatim, including units) */
  label: string
  /** Occurrences per year, or null for items explicitly marked one-time */
  occurs: number | null
  /** Price per occurrence in cents */
  priceEachCents: number
  /**
   * Annual price shown on the first-page services table, in cents.
   * Null when the service has no unit sell price in the data — the cell
   * stays blank rather than inventing or splitting an amount.
   * When set, this is extPriceCents (the same figure that feeds the
   * Annual Maintenance Price), not a per-occurrence amount.
   */
  servicePriceCents: number | null
  /** Extended price in cents (qty × priceEach, computed from maintServiceLine) */
  extPriceCents: number
  /** Sales tax in cents (always 0 for v1) */
  salesTaxCents: number
  /** Total price in cents (extPrice + salesTax) */
  totalPriceCents: number
  /** For internal use: whether this row is recurring (affects payment schedule) */
  isRecurring: boolean
}

export interface ContractTotals {
  extPriceCents: number
  salesTaxCents: number
  totalPriceCents: number
}

export interface PaymentScheduleMonth {
  /** Month name (e.g. "January", "February") */
  month: string
  /** Payment amount in cents */
  amountCents: number
}

/**
 * Build contract summary rows from an estimate. One row per section_service,
 * ordered by section sortOrder then service sortOrder.
 * Zero-price rows are kept (Aspire keeps them).
 */
export function buildContractRows(estimate: Estimate): ContractRow[] {
  const rows: ContractRow[] = []

  // Sort sections by sortOrder
  const sortedSections = [...estimate.sections].sort((a, b) => a.sortOrder - b.sortOrder)

  for (const section of sortedSections) {
    // Sort services within section by sortOrder
    const sortedServices = [...section.services].sort((a, b) => a.sortOrder - b.sortOrder)

    for (const svc of sortedServices) {
      // A missing unit price is not a zero price. Treating it as zero would
      // print $0.00 for a service the estimate never priced.
      const unitKnown = svc.unitSellCents != null
      const rate = svc.unitSellCents ?? 0
      const complexity = svc.complexityPct ?? 0
      // All maintenance work bundles into the contract cost and is broken into
      // the 12-month payment schedule. One-time is the marked exception, not
      // the default — so anything NOT explicitly one-time is recurring.
      //
      // Testing `=== 'recurring'` instead would drop every unresolved line
      // (a hand-entered line has no catalog item to derive a billing type
      // from, so it arrives as null) out of the payment-schedule base while
      // still counting it in the contract total.
      const isRecurring = svc.billingType !== 'one_time'

      // priceEachCents = maintServiceLine(..., qty=1, ...)
      const priceEach = priceEachCents(section.squareFeet, rate, complexity)

      // extPriceCents must come from maintServiceLine directly (with full qty),
      // never as priceEach × qty, to avoid rounding drift.
      const extPrice = maintServiceLine(section.squareFeet, rate, svc.qty, complexity)

      rows.push({
        label: svc.label,
        occurs: isRecurring ? svc.qty : null,
        priceEachCents: priceEach,
        servicePriceCents: unitKnown ? extPrice : null,
        extPriceCents: extPrice,
        salesTaxCents: 0, // No tax engine in v1
        totalPriceCents: extPrice, // total = ext + tax
        isRecurring,
      })
    }
  }

  return rows
}

/**
 * Calculate CONTRACT SUMMARY totals from rows.
 */
export function buildContractTotals(rows: ContractRow[]): ContractTotals {
  const extPriceCents = rows.reduce((sum, r) => sum + r.extPriceCents, 0)
  const salesTaxCents = rows.reduce((sum, r) => sum + r.salesTaxCents, 0)
  const totalPriceCents = rows.reduce((sum, r) => sum + r.totalPriceCents, 0)
  return { extPriceCents, salesTaxCents, totalPriceCents }
}

/**
 * Build 12-month payment schedule from contract rows and service start date.
 * Base is the sum of extPriceCents for recurring rows — which is every row
 * except those explicitly marked one-time.
 * Remainder is distributed: the first `rem` months get `per + 1`.
 */
export function buildPaymentSchedule(
  rows: ContractRow[],
  serviceStartDate: Date | null,
): PaymentScheduleMonth[] {
  // Base: sum of recurring rows only
  const base = rows
    .filter((r) => r.isRecurring)
    .reduce((sum, r) => sum + r.extPriceCents, 0)

  const per = Math.floor(base / 12)
  const rem = base - per * 12

  // Use getUTCMonth() — service dates are ISO date strings (YYYY-MM-DD), which
  // JS parses as UTC midnight. getMonth() would shift one day back in US timezones.
  const startMonth = serviceStartDate ? serviceStartDate.getUTCMonth() : 0

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  const schedule: PaymentScheduleMonth[] = []
  for (let i = 0; i < 12; i++) {
    const monthIndex = (startMonth + i) % 12
    const amountCents = i < rem ? per + 1 : per
    schedule.push({
      month: monthNames[monthIndex],
      amountCents,
    })
  }

  return schedule
}
