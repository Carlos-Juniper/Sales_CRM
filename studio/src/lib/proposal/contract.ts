// ---------------------------------------------------------------------------
// Contract generator — pure calculation layer for Landscape Maintenance
// Agreement pages (scope narrative, CONTRACT SUMMARY, PAYMENT SCHEDULE).
//
// Follows the same convention as lib/proposal/chapters.ts: dependency-free of
// React/JSX, so it can be tested in isolation and its output cached/memoized
// without coupling to component lifecycle.
// ---------------------------------------------------------------------------

import { contractTotal, priceEachCents, maintServiceLine } from '@/lib/estimating/calc'
import type { Estimate } from '@/types/estimating'

export interface ContractRow {
  /** Service label from section_services.label (verbatim, including units) */
  label: string
  /** Occurrences per year, or null for items explicitly marked one-time */
  occurs: number | null
  /** Price per occurrence in cents */
  priceEachCents: number
  /**
   * True when the service has a unit sell price, including a real zero.
   * False leaves the Price cell blank. The displayed annual price is then
   * derived from extPriceCents — see displayedServicePriceCents — so the
   * cell and the Annual Maintenance Price cannot be stored as two numbers.
   */
  hasUnitPrice: boolean
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
      // A missing unit price is not a zero price. The extended amount stays 0
      // and the Price cell stays blank — the missing dollars are not invented
      // and not taken from the other rows.
      const unitSellCents = svc.unitSellCents
      const hasUnitPrice = unitSellCents != null
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

      // An unknown rate is not passed in as 0. Both figures stay 0 so a
      // missing price cannot grow out of square footage alone.
      // extPriceCents comes from maintServiceLine with the full qty, never
      // from priceEach × qty, so per-occurrence rounding cannot drift the total.
      const priceEach =
        unitSellCents == null
          ? 0
          : priceEachCents(section.squareFeet, unitSellCents, complexity)
      const extPrice =
        unitSellCents == null
          ? 0
          : maintServiceLine(section.squareFeet, unitSellCents, svc.qty, complexity)

      rows.push({
        label: svc.label,
        occurs: isRecurring ? svc.qty : null,
        priceEachCents: priceEach,
        hasUnitPrice,
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
 * Annual price printed on one recurring service row.
 * This is extPriceCents when the service has a unit price, and null when it
 * does not. It is not a second stored amount, and it is not priceEach × qty
 * (that product can differ by a cent from maintServiceLine).
 */
export function displayedServicePriceCents(row: ContractRow): number | null {
  return row.hasUnitPrice ? row.extPriceCents : null
}

export interface AnnualMaintenancePrice {
  /**
   * Printed Annual Maintenance Price. Sum of recurring extPriceCents — the
   * same figure buildContractTotals returns and the payment schedule divides
   * across 12 months.
   */
  totalCents: number
  /** Sum of the Price column. Blank cells add nothing. */
  pricedRowsCents: number
  /** Recurring rows whose Price cell is blank. */
  blankRowCount: number
  /**
   * Recurring extended cents with no Price cell. Part of totalCents, not of
   * pricedRowsCents. buildContractRows keeps this at 0: a missing unit price
   * has no extended amount. A row built any other way can still carry cents
   * here; they stay in the total and are not spread across the priced rows.
   */
  undisplayedCents: number
  /**
   * estimate.contractValueCents minus the full line rollup (contractTotal),
   * or null when no estimate is passed. Approver adjustments write
   * contractValueCents and do not rewrite section lines. The delta is not
   * added to totalCents and is not allocated onto rows.
   */
  contractValueAdjustmentCents: number | null
}

/**
 * Relate the Price column to the Annual Maintenance Price.
 *
 * Both come from each recurring row's extPriceCents. A row with a unit price
 * contributes that amount to the column and to the total. A row without one
 * contributes its extPriceCents only to the total (0 for rows from
 * buildContractRows) and prints a blank cell. An estimate-level contract-value
 * adjustment is reported beside the total and does not change either number.
 */
export function annualMaintenancePrice(
  recurringRows: ContractRow[],
  estimate?: Estimate,
): AnnualMaintenancePrice {
  let pricedRowsCents = 0
  let undisplayedCents = 0
  let blankRowCount = 0

  for (const row of recurringRows) {
    const shown = displayedServicePriceCents(row)
    if (shown == null) {
      blankRowCount += 1
      undisplayedCents += row.extPriceCents
    } else {
      pricedRowsCents += shown
    }
  }

  return {
    totalCents: pricedRowsCents + undisplayedCents,
    pricedRowsCents,
    blankRowCount,
    undisplayedCents,
    contractValueAdjustmentCents: estimate
      ? estimate.contractValueCents - contractTotal(estimate)
      : null,
  }
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
