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
  /** Number of occurrences per year, or null for one-time items */
  occurs: number | null
  /** Price per occurrence in cents */
  priceEachCents: number
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
      const rate = svc.unitSellCents ?? 0
      const complexity = svc.complexityPct ?? 0
      const isRecurring = svc.billingType === 'recurring'

      // priceEachCents = maintServiceLine(..., qty=1, ...)
      const priceEach = priceEachCents(section.squareFeet, rate, complexity)

      // extPriceCents must come from maintServiceLine directly (with full qty),
      // never as priceEach × qty, to avoid rounding drift.
      const extPrice = maintServiceLine(section.squareFeet, rate, svc.qty, complexity)

      rows.push({
        label: svc.label,
        occurs: isRecurring ? svc.qty : null,
        priceEachCents: priceEach,
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
 * Base is the sum of extPriceCents for recurring rows only.
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

  // Start month: serviceStartDate's month, or January if null
  const startMonth = serviceStartDate ? serviceStartDate.getMonth() : 0

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
