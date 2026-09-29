// ---------------------------------------------------------------------------
// contract.test.ts — buildContract() for the maintenance agreement.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { buildContract } from '@/lib/proposal/contract'
import {
  CORAL_BAY_ANNUAL_MAINTENANCE_CENTS,
  CORAL_BAY_CONTRACT_VALUE_CENTS,
  CORAL_BAY_OPTIONAL_LABELS,
  CORAL_BAY_RECURRING_LINES,
  coralBayContractEstimate,
} from '@/test/fixtures/coralBayContract'
import type { Estimate } from '@/types/estimating'

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
    status: 'approved',
    serviceStartDate: serviceStartDate ?? null,
    sections: sections.map((sec, sIdx) => ({
      id: `sec-${sIdx}`,
      estimateId: 'est-test',
      name: `Section ${sIdx + 1}`,
      squareFeet: sec.squareFeet,
      sortOrder: sIdx,
      services: sec.services.map((svc, svIdx) => ({
        id: `svc-${sIdx}-${svIdx}`,
        sectionId: `sec-${sIdx}`,
        serviceKitId: null,
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
  } as Estimate
}

function scheduledCents(estimate: Estimate): number {
  return buildContract(estimate).schedule.reduce((sum, month) => sum + month.amountCents, 0)
}

describe('buildContract', () => {
  it('creates one row per service, ordered by section then service sortOrder', () => {
    const contract = buildContract(
      makeEstimate([
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
            { label: 'Cleanup', qty: 1, unitSellCents: 300, complexityPct: 0, billingType: 'one_time' },
          ],
        },
      ]),
    )

    expect(contract.rows.map((row) => row.label)).toEqual(['Mowing', 'Edging', 'Cleanup'])
  })

  it('calculates price per occurrence from the section area', () => {
    const [row] = buildContract(
      makeEstimate([
        {
          squareFeet: 10000,
          services: [{ label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 }],
        },
      ]),
    ).rows

    expect(row.priceEachCents).toBe(5000)
    expect(row.occurs).toBe(12)
  })

  it('applies complexity to the price per occurrence and the extended price', () => {
    const [row] = buildContract(
      makeEstimate([
        {
          squareFeet: 10000,
          services: [{ label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0.1 }],
        },
      ]),
    ).rows

    expect(row.priceEachCents).toBe(5500)
    expect(row.extPriceCents).toBe(66000)
  })

  it('keeps a stored zero and leaves a missing unit price null', () => {
    const contract = buildContract(
      makeEstimate([
        {
          squareFeet: 10000,
          services: [
            { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
            { label: 'Included', qty: 12, unitSellCents: 0, complexityPct: 0 },
            { label: 'Unpriced', qty: 4, unitSellCents: null, complexityPct: 0 },
          ],
        },
      ]),
    )

    expect(contract.rows[0].priceEachCents).not.toBeNull()
    expect(contract.rows[0].extPriceCents).toBe(60000)
    expect(contract.rows[1].priceEachCents).toBe(0)
    expect(contract.rows[1].extPriceCents).toBe(0)
    expect(contract.rows[2].priceEachCents).toBeNull()
    expect(contract.rows[2].extPriceCents).toBeNull()
    expect(contract.annualMaintenancePriceCents).toBe(60000)
  })

  it('uses the extended price, not price-each times quantity, when rounding differs', () => {
    // 1,500 sqft × 1¢ per 1,000 sqft rounds to 2¢ per occurrence, but
    // 2¢ × 3 occurrences is 6¢ while maintServiceLine rounds 4.5¢ to 5¢.
    const [row] = buildContract(
      makeEstimate([
        {
          squareFeet: 1500,
          services: [{ label: 'Mowing', qty: 3, unitSellCents: 1, complexityPct: 0 }],
        },
      ]),
    ).rows

    expect(row.priceEachCents).not.toBeNull()
    expect((row.priceEachCents ?? 0) * 3).not.toBe(row.extPriceCents)
    expect(row.extPriceCents).toBe(5)
  })

  it('sums priced rows and leaves an unpriced recurring row out of the annual price', () => {
    const contract = buildContract(
      makeEstimate([
        {
          squareFeet: 342000,
          services: [
            { label: 'Mowing', qty: 12, unitSellCents: 350, complexityPct: 0 },
            { label: 'Unpriced', qty: 4, unitSellCents: null, complexityPct: 0 },
            { label: 'Cleanup', qty: 1, unitSellCents: 300, complexityPct: 0, billingType: 'one_time' },
          ],
        },
        {
          squareFeet: 28500,
          services: [{ label: 'Irrigation', qty: 12, unitSellCents: 1000, complexityPct: 0 }],
        },
      ]),
    )

    const shown = contract.recurringRows.reduce((sum, row) => sum + (row.extPriceCents ?? 0), 0)
    expect(shown).toBe(contract.annualMaintenancePriceCents)
    expect(contract.oneTimeRows.map((row) => row.label)).toEqual(['Cleanup'])
    expect(contract.rows.find((row) => row.label === 'Unpriced')?.extPriceCents).toBeNull()
    expect(contract.totals.extPriceCents).toBe(
      contract.annualMaintenancePriceCents + (contract.oneTimeRows[0].extPriceCents ?? 0),
    )
    expect(contract.totals.salesTaxCents).toBe(0)
    expect(contract.totals.totalPriceCents).toBe(contract.totals.extPriceCents)
  })

  it('prices seeded Coral Bay recurring services and does not use the stored contract value', () => {
    const estimate = coralBayContractEstimate()
    const contract = buildContract(estimate)
    const optional = contract.oneTimeRows.reduce((sum, row) => sum + (row.extPriceCents ?? 0), 0)

    expect(contract.recurringRows.map((row) => row.label)).toEqual(
      CORAL_BAY_RECURRING_LINES.map((line) => line.label),
    )
    expect(contract.recurringRows.map((row) => row.extPriceCents)).toEqual(
      CORAL_BAY_RECURRING_LINES.map((line) => line.extPriceCents),
    )
    expect(contract.annualMaintenancePriceCents).toBe(CORAL_BAY_ANNUAL_MAINTENANCE_CENTS)
    expect(contract.annualMaintenancePriceCents).not.toBe(CORAL_BAY_CONTRACT_VALUE_CENTS)
    expect(contract.oneTimeRows.map((row) => row.label)).toEqual([...CORAL_BAY_OPTIONAL_LABELS])
    expect(contract.oneTimeRows.every((row) => row.priceEachCents != null)).toBe(true)
    expect(contract.totals.extPriceCents).toBe(contract.annualMaintenancePriceCents + optional)
    expect(scheduledCents(estimate)).toBe(contract.annualMaintenancePriceCents)
    expect(contract.schedule[0].month).toBe('January')
  })

  it('distributes the annual price evenly across 12 months', () => {
    const { schedule } = buildContract(
      makeEstimate([
        {
          squareFeet: 10000,
          services: [{ label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 }],
        },
      ]),
    )

    expect(schedule).toHaveLength(12)
    expect(schedule.every((month) => month.amountCents === 5000)).toBe(true)
  })

  it('starts from the service start month', () => {
    const { schedule } = buildContract(
      makeEstimate(
        [
          {
            squareFeet: 10000,
            services: [{ label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 }],
          },
        ],
        '2024-03-01',
      ),
    )

    expect(schedule[0].month).toBe('March')
    expect(schedule[1].month).toBe('April')
    expect(schedule[11].month).toBe('February')
  })

  it('defaults the schedule to January when the service start date is missing', () => {
    const { schedule } = buildContract(
      makeEstimate([
        {
          squareFeet: 10000,
          services: [{ label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 }],
        },
      ]),
    )

    expect(schedule[0].month).toBe('January')
  })

  describe('a line with no derivable billing type', () => {
    // All maintenance work bundles into the contract and is split across the
    // 12-month schedule. A hand-entered line has no service kit to derive a
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

    it('treats it as recurring and still prints its occurrence count', () => {
      const row = buildContract(withNullBillingType()).rows.find((item) => item.label === 'Hand-entered extra')
      expect(row?.isRecurring).toBe(true)
      expect(row?.occurs).toBe(4)
    })

    it('includes it in the payment schedule, which reconciles to the total', () => {
      const estimate = withNullBillingType()
      const contract = buildContract(estimate)
      expect(scheduledCents(estimate)).toBe(contract.totals.extPriceCents)
    })

    it('still lets an explicit one-time mark opt a line out of the schedule', () => {
      const estimate = makeEstimate([
        {
          squareFeet: 10000,
          services: [
            { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
            { label: 'Cleanup', qty: 1, unitSellCents: 300, complexityPct: 0, billingType: 'one_time' },
          ],
        },
      ])
      const contract = buildContract(estimate)

      expect(contract.oneTimeRows.map((row) => row.label)).toEqual(['Cleanup'])
      expect(scheduledCents(estimate)).toBe(contract.annualMaintenancePriceCents)
      expect(scheduledCents(estimate)).toBeLessThan(contract.totals.extPriceCents)
    })
  })
})
