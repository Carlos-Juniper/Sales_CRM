// ---------------------------------------------------------------------------
// Contract generator — pure calculation layer for Landscape Maintenance
// Agreement pages (scope narrative, service tables, payment schedule).
//
// Callers use buildContract(). It is the only place that turns an estimate
// into rows, the annual maintenance price, and the 12-month schedule.
// ---------------------------------------------------------------------------

import { maintServiceLine, priceEachCents } from '@/lib/estimating/calc'
import type { Estimate } from '@/types/estimating'

export interface ContractRow {
  /** Service label from section_services.label (verbatim, including units). */
  label: string
  /** Occurrences per year, or null for items explicitly marked one-time. */
  occurs: number | null
  /**
   * Price per occurrence in cents, or null when the service has no unit price.
   * Null leaves the money cells blank. A stored zero is 0.
   */
  priceEachCents: number | null
  /**
   * Extended price in cents, from maintServiceLine (not priceEach × qty).
   * Null when the service has no unit price, so it adds nothing to a total.
   */
  extPriceCents: number | null
  /** Sales tax in cents (always 0 for v1). */
  salesTaxCents: number
  /** Total price in cents (extended price + sales tax). Missing prices count as 0. */
  totalPriceCents: number
  /** Whether this row is recurring (it is part of the payment schedule). */
  isRecurring: boolean
}

export interface ContractTotals {
  extPriceCents: number
  salesTaxCents: number
  totalPriceCents: number
}

export interface PaymentScheduleMonth {
  /** Month name (e.g. "January", "February"). */
  month: string
  /** Payment amount in cents. */
  amountCents: number
}

export interface Contract {
  rows: ContractRow[]
  recurringRows: ContractRow[]
  oneTimeRows: ContractRow[]
  totals: ContractTotals
  /** Recurring extended-price sum. Printed as the Annual Maintenance Price. */
  annualMaintenancePriceCents: number
  schedule: PaymentScheduleMonth[]
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

function amount(cents: number | null): number {
  return cents ?? 0
}

/**
 * One row per section service, ordered by section sortOrder then service
 * sortOrder. A real zero is kept (Aspire keeps it). A missing unit price
 * is null on both price fields.
 */
function buildContractRows(estimate: Estimate): ContractRow[] {
  const rows: ContractRow[] = []
  const sortedSections = [...estimate.sections].sort((a, b) => a.sortOrder - b.sortOrder)

  for (const section of sortedSections) {
    const sortedServices = [...section.services].sort((a, b) => a.sortOrder - b.sortOrder)

    for (const svc of sortedServices) {
      const complexity = svc.complexityPct ?? 0
      // All maintenance work bundles into the contract cost and is broken into
      // the 12-month payment schedule. One-time is the marked exception, not
      // the default — so anything NOT explicitly one-time is recurring.
      //
      // Testing `=== 'recurring'` instead would drop every unresolved line
      // (a hand-entered line has no service kit to derive a billing type
      // from, so it arrives as null) out of the payment-schedule base while
      // still counting it in the contract total.
      const isRecurring = svc.billingType !== 'one_time'
      const priced = svc.unitSellCents != null
      const rate = svc.unitSellCents ?? 0
      const extPriceCents = priced
        ? maintServiceLine(section.squareFeet, rate, svc.qty, complexity)
        : null

      rows.push({
        label: svc.label,
        occurs: isRecurring ? svc.qty : null,
        priceEachCents: priced ? priceEachCents(section.squareFeet, rate, complexity) : null,
        extPriceCents,
        salesTaxCents: 0,
        totalPriceCents: amount(extPriceCents),
        isRecurring,
      })
    }
  }

  return rows
}

function buildContractTotals(rows: ContractRow[]): ContractTotals {
  return {
    extPriceCents: rows.reduce((sum, row) => sum + amount(row.extPriceCents), 0),
    salesTaxCents: rows.reduce((sum, row) => sum + row.salesTaxCents, 0),
    totalPriceCents: rows.reduce((sum, row) => sum + row.totalPriceCents, 0),
  }
}

/**
 * Split one annual amount into twelve monthly payments. Remainder cents go
 * to the first months: month i < rem receives per + 1. The start date is an
 * ISO date parsed as UTC midnight; getUTCMonth avoids the US-timezone day
 * shift that getMonth() would apply.
 */
function buildPaymentSchedule(
  annualCents: number,
  serviceStart: Date | null,
): PaymentScheduleMonth[] {
  const per = Math.floor(annualCents / 12)
  const rem = annualCents - per * 12
  const startMonth = serviceStart ? serviceStart.getUTCMonth() : 0

  return Array.from({ length: 12 }, (_, i) => ({
    month: MONTH_NAMES[(startMonth + i) % 12],
    amountCents: i < rem ? per + 1 : per,
  }))
}

function parseServiceStart(estimate: Estimate): Date | null {
  return estimate.serviceStartDate ? new Date(estimate.serviceStartDate) : null
}

/** Rows, totals, and the payment schedule for one estimate. */
export function buildContract(estimate: Estimate): Contract {
  const rows = buildContractRows(estimate)
  const recurringRows = rows.filter((row) => row.isRecurring)
  const oneTimeRows = rows.filter((row) => !row.isRecurring)
  const annualMaintenancePriceCents = buildContractTotals(recurringRows).extPriceCents

  return {
    rows,
    recurringRows,
    oneTimeRows,
    totals: buildContractTotals(rows),
    annualMaintenancePriceCents,
    schedule: buildPaymentSchedule(annualMaintenancePriceCents, parseServiceStart(estimate)),
  }
}
