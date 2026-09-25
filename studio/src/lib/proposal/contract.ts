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
   * True when the service has a unit sell price, including a real zero.
   * False leaves the money cells blank. The rate still falls through to 0
   * for the extended price, so a missing price adds nothing to the total.
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
      const hasUnitPrice = svc.unitSellCents != null
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
 * Extended price of rows that actually have a unit price. Unpriced rows
 * contribute nothing — their extended price is already 0, and they must not
 * take a share of an approved-value adjustment.
 */
function pricedExtSum(rows: ContractRow[]): number {
  return rows.reduce((sum, row) => sum + (row.hasUnitPrice ? row.extPriceCents : 0), 0)
}

/**
 * Scale priced rows so their extended prices sum to `targetCents`.
 *
 * Approvers store one approved number on `estimate.contractValueCents` and
 * do not rewrite section lines. The caller passes the rows that make up that
 * number — on the agreement, the recurring services behind the Annual
 * Maintenance Price and the payment schedule. One-time optional rows are a
 * separate quote and are not passed in.
 *
 * Largest-remainder rounding (integer cents, ties broken by earlier row)
 * makes the scaled cents sum exactly to the target. A null target, a target
 * already equal to the priced line sum, or a zero line sum returns the rows
 * unchanged — a zero sum cannot be divided.
 */
export function scaleRowsToContractValue(
  rows: ContractRow[],
  targetCents: number | null,
): ContractRow[] {
  if (targetCents == null) return rows
  const lineSum = pricedExtSum(rows)
  if (lineSum === 0 || lineSum === targetCents) return rows

  const weights = rows.map((row) => (row.hasUnitPrice ? row.extPriceCents : 0))
  const target = BigInt(targetCents)
  const sum = BigInt(lineSum)
  const floors = weights.map((weight) =>
    weight === 0 ? 0 : Number((target * BigInt(weight)) / sum),
  )
  const remainders = weights.map((weight) =>
    weight === 0 ? 0n : (target * BigInt(weight)) % sum,
  )
  let leftover = targetCents - floors.reduce((acc, floor) => acc + floor, 0)

  // Only positive-weight rows take a remainder cent. A stored $0.00 and a
  // blank unpriced row both have weight 0, so neither absorbs leftover.
  const order = weights
    .map((_, index) => index)
    .filter((index) => weights[index] !== 0)
    .sort((a, b) => {
      if (remainders[a] === remainders[b]) return a - b
      return remainders[a] > remainders[b] ? -1 : 1
    })

  const extras = new Array<number>(rows.length).fill(0)
  for (let i = 0; i < order.length && leftover > 0; i += 1) {
    extras[order[i]] = 1
    leftover -= 1
  }

  return rows.map((row, index) => {
    if (!row.hasUnitPrice || weights[index] === 0) return row
    const extPriceCents = floors[index] + extras[index]
    return {
      ...row,
      extPriceCents,
      totalPriceCents: extPriceCents + row.salesTaxCents,
    }
  })
}

/**
 * Printed total for `rows` after scaling to the approved value.
 * When the priced line sum is 0 the rows cannot move, but the approved
 * number is still what the agreement prints.
 */
export function approvedTotalCents(rows: ContractRow[], targetCents: number | null): number {
  if (targetCents != null && pricedExtSum(rows) === 0) return targetCents
  return pricedExtSum(scaleRowsToContractValue(rows, targetCents))
}

const MONTH_NAMES = [
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

/**
 * Split an annual cent total across 12 months.
 * Remainder is distributed: the first `rem` months get `per + 1`.
 */
function distributeAcrossMonths(
  baseCents: number,
  serviceStartDate: Date | null,
): PaymentScheduleMonth[] {
  const per = Math.floor(baseCents / 12)
  const rem = baseCents - per * 12

  // Use getUTCMonth() — service dates are ISO date strings (YYYY-MM-DD), which
  // JS parses as UTC midnight. getMonth() would shift one day back in US timezones.
  const startMonth = serviceStartDate ? serviceStartDate.getUTCMonth() : 0

  const schedule: PaymentScheduleMonth[] = []
  for (let i = 0; i < 12; i++) {
    const monthIndex = (startMonth + i) % 12
    const amountCents = i < rem ? per + 1 : per
    schedule.push({
      month: MONTH_NAMES[monthIndex],
      amountCents,
    })
  }

  return schedule
}

/**
 * Build 12-month payment schedule from contract rows and service start date.
 * Base is the sum of extPriceCents for recurring rows — which is every row
 * except those explicitly marked one-time.
 */
export function buildPaymentSchedule(
  rows: ContractRow[],
  serviceStartDate: Date | null,
): PaymentScheduleMonth[] {
  const base = rows
    .filter((r) => r.isRecurring)
    .reduce((sum, r) => sum + r.extPriceCents, 0)

  return distributeAcrossMonths(base, serviceStartDate)
}

/**
 * Payment schedule for the agreement. The base is the approved contract
 * value when one is set, allocated the same way as the Annual Maintenance
 * Price (recurring rows only). A zero recurring line sum still prints the
 * approved total across the twelve months; the service lines themselves
 * stay unscaled.
 */
export function buildApprovedPaymentSchedule(
  rows: ContractRow[],
  targetCents: number | null,
  serviceStartDate: Date | null,
): PaymentScheduleMonth[] {
  const recurring = rows.filter((row) => row.isRecurring)
  return distributeAcrossMonths(approvedTotalCents(recurring, targetCents), serviceStartDate)
}
