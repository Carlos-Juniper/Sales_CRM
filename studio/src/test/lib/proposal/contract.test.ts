// ---------------------------------------------------------------------------
// contract.test.ts — Contract generator calculation layer tests
//
// Covers buildContractRows, buildContractTotals, and buildPaymentSchedule
// functions from lib/proposal/contract.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  buildContractRows,
  buildContractTotals,
  buildPaymentSchedule,
  buildPricingFooter,
} from '@/lib/proposal/contract'
import type { Estimate } from '@/types/estimating'

// Helper to create a minimal maintenance estimate
function makeEstimate(
  sections: Array<{
    squareFeet: number
    services: Array<{
      label: string
      qty: number
      unitSellCents: number | null
      complexityPct: number
      billingType?: 'recurring' | 'one_time' | null
    }>
  }>,
  serviceStartDate?: string | null,
): Estimate {
  return {
    id: 'est-test',
    estimateType: 'maintenance',
    name: 'Test Estimate',
    aspireNumber: '12345',
    estimateNumber: 1,
    aspireOpportunityId: null,
    aspireSyncStatus: 'synced',
    propertyId: null,
    clientName: 'Test Client',
    aspireBranchId: 1,
    branchCity: 'Test City',
    acreage: 5,
    contractValueCents: 100000,
    targetMargin: 0.22,
    status: 'approved',
    lifecycle: 'approved',
    aspireOwner: 'estimating',
    priority: 'medium',
    winProbability: 0.8,
    siteWalkDate: null,
    dueBackDate: '2024-01-01',
    anticipatedCloseDate: null,
    serviceStartDate: serviceStartDate ?? null,
    assignedLsEstimator: null,
    assignedIrrEstimator: null,
    crmRep: null,
    customerType: 'commercial',
    sections: sections.map((sec, sIdx) => ({
      id: `sec-${sIdx}`,
      estimateId: 'est-test',
      name: `Section ${sIdx + 1}`,
      squareFeet: sec.squareFeet,
      sortOrder: sIdx,
      services: sec.services.map((svc, svIdx) => ({
        id: `svc-${sIdx}-${svIdx}`,
        sectionId: `sec-${sIdx}`,
        catalogItemId: null,
        label: svc.label,
        qty: svc.qty,
        uom: '/yr',
        complexityPct: svc.complexityPct,
        unitSellCents: svc.unitSellCents,
        embeddedCostCents: null,
        targetGm: null,
        hours: null,
        sortOrder: svIdx,
        billingType: svc.billingType === undefined ? 'recurring' : svc.billingType,
        components: [],
      })),
    })),
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  } as Estimate
}

describe('buildContractRows', () => {
  it('creates one row per service, ordered by section then service sortOrder', () => {
    const estimate = makeEstimate([
      {
        squareFeet: 10000,
        services: [
          { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
          { label: 'Edging', qty: 12, unitSellCents: 200, complexityPct: 0 },
        ],
      },
      {
        squareFeet: 5000,
        services: [
          { label: 'Mulch', qty: 1, unitSellCents: 300, complexityPct: 0, billingType: 'one_time' },
        ],
      },
    ])

    const rows = buildContractRows(estimate)

    expect(rows).toHaveLength(3)
    expect(rows[0].label).toBe('Mowing')
    expect(rows[1].label).toBe('Edging')
    expect(rows[2].label).toBe('Mulch')
  })

  it('calculates priceEachCents correctly', () => {
    const estimate = makeEstimate([
      {
        squareFeet: 10000,
        services: [
          { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
        ],
      },
    ])

    const rows = buildContractRows(estimate)

    expect(rows[0].priceEachCents).toBe(5000)
    expect(rows[0].occurs).toBe(12)
  })

  it('applies complexity percentage correctly', () => {
    const estimate = makeEstimate([
      {
        squareFeet: 10000,
        services: [
          { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0.10 },
        ],
      },
    ])

    const rows = buildContractRows(estimate)

    expect(rows[0].priceEachCents).toBe(5500)
    expect(rows[0].extPriceCents).toBe(66000)
  })

  it('exposes a unit price only when the service has a unit sell price', () => {
    const estimate = makeEstimate([
      {
        squareFeet: 10000,
        services: [
          { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
          { label: 'Unpriced', qty: 4, unitSellCents: null, complexityPct: 0 },
        ],
      },
    ])

    const rows = buildContractRows(estimate)

    expect(rows[0].unitPriceCents).toBe(5000)
    expect(rows[1].unitPriceCents).toBeNull()
    expect(rows[1].extPriceCents).toBe(0)
  })

  it('keeps the line total on maintServiceLine when price-each times qty would drift', () => {
    const estimate = makeEstimate([
      {
        squareFeet: 1001,
        services: [
          { label: 'Detail work', qty: 3, unitSellCents: 333, complexityPct: 0 },
        ],
      },
    ])

    const rows = buildContractRows(estimate)

    expect(rows[0].priceEachCents * rows[0].occurs!).not.toBe(rows[0].extPriceCents)
    expect(rows[0].extPriceCents).toBe(1000)
  })
})

describe('buildContractTotals', () => {
  it('sums all rows correctly', () => {
    const rows = [
      {
        label: 'Mowing',
        occurs: 12,
        priceEachCents: 5000,
        extPriceCents: 60000,
        salesTaxCents: 0,
        totalPriceCents: 60000,
        isRecurring: true,
      },
      {
        label: 'Mulch',
        occurs: null,
        priceEachCents: 1500,
        extPriceCents: 1500,
        salesTaxCents: 0,
        totalPriceCents: 1500,
        isRecurring: false,
      },
    ]

    const totals = buildContractTotals(rows)

    expect(totals.extPriceCents).toBe(61500)
    expect(totals.totalPriceCents).toBe(61500)
  })
})

describe('buildPricingFooter', () => {
  it('omits sales tax when the rows carry none, and the total matches the line-item sum', () => {
    const estimate = makeEstimate([
      {
        squareFeet: 10000,
        services: [
          { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
          { label: 'Edging', qty: 4, unitSellCents: 200, complexityPct: 0 },
          { label: 'Mulch', qty: 1, unitSellCents: 300, complexityPct: 0, billingType: 'one_time' },
        ],
      },
    ])
    const rows = buildContractRows(estimate)
    const recurring = rows.filter((row) => row.isRecurring)
    const totals = buildContractTotals(recurring)
    const footer = buildPricingFooter(totals)

    expect(footer.map((line) => line.kind)).toEqual(['subtotal', 'total'])
    expect(footer.find((line) => line.kind === 'tax')).toBeUndefined()
    const lineSum = recurring.reduce((sum, row) => sum + row.extPriceCents, 0)
    expect(footer.find((line) => line.kind === 'subtotal')?.amountCents).toBe(lineSum)
    expect(footer.find((line) => line.kind === 'total')?.amountCents).toBe(lineSum)
    expect(footer.find((line) => line.kind === 'total')?.label).toBe('Annual Maintenance Price')
    const scheduled = buildPaymentSchedule(rows, null).reduce((sum, month) => sum + month.amountCents, 0)
    expect(scheduled).toBe(footer.find((line) => line.kind === 'total')?.amountCents)
  })

  it('includes a tax line only when the totals carry tax, and the total adds it', () => {
    const footer = buildPricingFooter({
      extPriceCents: 60000,
      salesTaxCents: 4200,
      totalPriceCents: 64200,
    })

    expect(footer.map((line) => line.kind)).toEqual(['subtotal', 'tax', 'total'])
    expect(footer.find((line) => line.kind === 'tax')?.amountCents).toBe(4200)
    expect(footer.find((line) => line.kind === 'total')?.amountCents).toBe(64200)
  })
})

describe('buildPaymentSchedule', () => {
  it('distributes payment evenly across 12 months', () => {
    const rows = [
      {
        label: 'Mowing',
        occurs: 12,
        priceEachCents: 5000,
        extPriceCents: 60000,
        salesTaxCents: 0,
        totalPriceCents: 60000,
        isRecurring: true,
      },
    ]

    const schedule = buildPaymentSchedule(rows, null)

    expect(schedule).toHaveLength(12)
    expect(schedule.every((m) => m.amountCents === 5000)).toBe(true)
  })

  it('starts from serviceStartDate month when provided', () => {
    const rows = [
      {
        label: 'Mowing',
        occurs: 12,
        priceEachCents: 5000,
        extPriceCents: 60000,
        salesTaxCents: 0,
        totalPriceCents: 60000,
        isRecurring: true,
      },
    ]

    const schedule = buildPaymentSchedule(rows, new Date('2024-03-01'))

    expect(schedule[0].month).toBe('March')
    expect(schedule[1].month).toBe('April')
  })

  it('defaults to January when serviceStartDate is null', () => {
    const rows = [
      {
        label: 'Mowing',
        occurs: 12,
        priceEachCents: 5000,
        extPriceCents: 60000,
        salesTaxCents: 0,
        totalPriceCents: 60000,
        isRecurring: true,
      },
    ]

    const schedule = buildPaymentSchedule(rows, null)

    expect(schedule[0].month).toBe('January')
  })

  describe('a line with no derivable billing type', () => {
    // All maintenance work bundles into the contract and is split across the
    // 12-month schedule. A hand-entered line has no catalog item to derive a
    // billing type from and arrives as null — it must still bundle, not vanish
    // from the schedule while still counting toward the contract total.
    const withNullBillingType = () =>
      makeEstimate([
        {
          squareFeet: 10000,
          services: [
            { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
            { label: 'Hand-entered extra', qty: 4, unitSellCents: 250, complexityPct: 0, billingType: null },
          ],
        },
      ])

    it('treats it as recurring', () => {
      const rows = buildContractRows(withNullBillingType())
      expect(rows.find((r) => r.label === 'Hand-entered extra')?.isRecurring).toBe(true)
    })

    it('still prints its occurrence count', () => {
      const rows = buildContractRows(withNullBillingType())
      expect(rows.find((r) => r.label === 'Hand-entered extra')?.occurs).toBe(4)
    })

    it('includes it in the payment-schedule base, which reconciles to the total', () => {
      const rows = buildContractRows(withNullBillingType())
      const totals = buildContractTotals(rows)
      const scheduled = buildPaymentSchedule(rows, null).reduce((n, m) => n + m.amountCents, 0)
      expect(scheduled).toBe(totals.extPriceCents)
    })

    it('still lets an explicit one-time mark opt a line out', () => {
      const estimate = makeEstimate([
        {
          squareFeet: 10000,
          services: [
            { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
            { label: 'Mulch', qty: 1, unitSellCents: 300, complexityPct: 0, billingType: 'one_time' },
          ],
        },
      ])
      const rows = buildContractRows(estimate)
      const totals = buildContractTotals(rows)
      const scheduled = buildPaymentSchedule(rows, null).reduce((n, m) => n + m.amountCents, 0)
      expect(rows.find((r) => r.label === 'Mulch')?.isRecurring).toBe(false)
      expect(scheduled).toBeLessThan(totals.extPriceCents)
    })
  })
})
