// ---------------------------------------------------------------------------
// ContractLines — itemized pricing on the Landscape Maintenance Agreement's
// first page, plus the lump-sum fallback when the estimate has no services.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/utils'
import { buildContractRows, buildContractTotals, buildPaymentSchedule } from '@/lib/proposal/contract'
import { ContractPage } from '@/views/inside-sales/components/estimating/proposal-pages/contract-page'
import { ContractLines } from '@/views/inside-sales/components/estimating/proposal-pages/ContractLines'
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
  overrides?: Partial<Estimate>,
): Estimate {
  return {
    id: 'est-test',
    estimateType: 'maintenance',
    name: 'Test Estimate',
    aspireNumber: null,
    estimateNumber: 1,
    aspireOpportunityId: null,
    aspireSyncStatus: 'synced',
    propertyId: null,
    clientName: 'Test Client',
    aspireBranchId: 1,
    branchCity: 'Test City',
    acreage: 5,
    contractValueCents: 0,
    targetMargin: 0.22,
    status: 'approved',
    lifecycle: 'approved',
    aspireOwner: 'estimating',
    priority: 'medium',
    winProbability: 0.8,
    siteWalkDate: null,
    dueBackDate: '2024-01-01',
    anticipatedCloseDate: null,
    serviceStartDate: '2024-03-01',
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
    ...overrides,
  } as Estimate
}

function line(label: string) {
  const match = screen.getAllByTestId('contract-line').find((el) => el.getAttribute('data-label') === label)
  if (!match) throw new Error(`missing contract line ${label}`)
  return match
}

describe('ContractLines itemized pricing', () => {
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

  it('renders one row per recurring service with frequency, unit price, and line total', () => {
    render(<ContractPage estimate={estimate} lead={{ property_name: 'Willowbrook Estates' }} />)
    const page = screen.getByTestId('page-contract-scope')
    const table = within(page).getByTestId('contract-pricing-table')

    expect(within(table).getByText('Frequency')).toBeInTheDocument()
    expect(within(table).getByText('Unit Price')).toBeInTheDocument()
    expect(within(table).getByText('Line Total')).toBeInTheDocument()

    const mowing = within(page).getAllByTestId('contract-line').find((el) => el.getAttribute('data-label') === 'Mowing')
    const edging = within(page).getAllByTestId('contract-line').find((el) => el.getAttribute('data-label') === 'Edging')
    expect(mowing).toBeTruthy()
    expect(edging).toBeTruthy()
    expect(within(mowing!).getByTestId('contract-line-frequency')).toHaveTextContent('12')
    expect(within(mowing!).getByTestId('contract-line-unit')).toHaveTextContent('$50.00')
    expect(within(mowing!).getByTestId('contract-line-total')).toHaveTextContent('$600.00')
    expect(within(edging!).getByTestId('contract-line-frequency')).toHaveTextContent('4')
    expect(within(edging!).getByTestId('contract-line-unit')).toHaveTextContent('$20.00')
    expect(within(edging!).getByTestId('contract-line-total')).toHaveTextContent('$80.00')

    expect(within(table).queryByText('Mulch')).not.toBeInTheDocument()
    const optional = within(page).getByTestId('contract-optional-line')
    expect(optional).toHaveAttribute('data-label', 'Mulch')
    expect(optional).toHaveTextContent('$30.00')
  })

  it('reconciles subtotal and annual price to the recurring line totals and the payment schedule', () => {
    render(<ContractPage estimate={estimate} lead={{ property_name: 'Willowbrook Estates' }} />)
    const page = screen.getByTestId('page-contract-scope')
    const rows = buildContractRows(estimate).filter((row) => row.isRecurring)
    const totals = buildContractTotals(rows)
    const scheduled = buildPaymentSchedule(buildContractRows(estimate), new Date('2024-03-01'))
      .reduce((sum, month) => sum + month.amountCents, 0)

    expect(totals.extPriceCents).toBe(68000)
    expect(scheduled).toBe(68000)
    expect(within(page).queryByTestId('contract-tax')).not.toBeInTheDocument()
    expect(within(page).getByTestId('contract-subtotal')).toHaveTextContent('$680.00')
    expect(within(page).getByTestId('contract-total')).toHaveTextContent('Annual Maintenance Price')
    expect(within(page).getByTestId('contract-total')).toHaveTextContent('$680.00')

    const summary = screen.getByTestId('page-contract-summary')
    expect(within(summary).queryByTestId('contract-pricing-table')).not.toBeInTheDocument()
    const scheduleTotal = within(summary).getAllByText('$680.00')
    expect(scheduleTotal.length).toBeGreaterThan(0)
  })

  it('prints the extended line total when price-each times quantity would round differently', () => {
    const rounded = makeEstimate([
      {
        squareFeet: 1001,
        services: [{ label: 'Detail work', qty: 3, unitSellCents: 333, complexityPct: 0 }],
      },
    ])
    render(<ContractLines estimate={rounded} />)
    const row = line('Detail work')
    expect(within(row).getByTestId('contract-line-unit')).toHaveTextContent('$3.33')
    expect(within(row).getByTestId('contract-line-total')).toHaveTextContent('$10.00')
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$10.00')
  })

  it('leaves unit price blank when the service has no unit sell price', () => {
    const mixed = makeEstimate([
      {
        squareFeet: 10000,
        services: [
          { label: 'Mowing', qty: 12, unitSellCents: 500, complexityPct: 0 },
          { label: 'Hand entered', qty: 4, unitSellCents: null, complexityPct: 0 },
        ],
      },
    ])
    render(<ContractLines estimate={mixed} />)
    const hand = line('Hand entered')
    expect(within(hand).getByTestId('contract-line-unit').textContent).toBe('')
    expect(within(hand).getByTestId('contract-line-total')).toHaveTextContent('$0.00')
    expect(within(hand).getByTestId('contract-line-frequency')).toHaveTextContent('4')
  })

  it('omits the unit price column when no line has one', () => {
    const unpriced = makeEstimate([
      {
        squareFeet: 10000,
        services: [{ label: 'Hand entered', qty: 4, unitSellCents: null, complexityPct: 0 }],
      },
    ])
    render(<ContractLines estimate={unpriced} />)
    expect(screen.queryByText('Unit Price')).not.toBeInTheDocument()
    expect(screen.getByTestId('contract-line-frequency')).toHaveTextContent('4')
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$0.00')
  })
})

describe('ContractLines lump-sum fallback', () => {
  it('shows the persisted contract total and no invented service rows', () => {
    const estimate = makeEstimate([], { contractValueCents: 18_500_000 })
    render(<ContractPage estimate={estimate} lead={{ property_name: 'Coral Bay HOA' }} />)
    const page = screen.getByTestId('page-contract-scope')
    const table = within(page).getByTestId('contract-pricing-lump-sum')
    expect(within(table).queryByTestId('contract-line')).not.toBeInTheDocument()
    expect(within(table).queryByTestId('contract-subtotal')).not.toBeInTheDocument()
    expect(within(table).queryByText('Unit Price')).not.toBeInTheDocument()
    expect(within(table).getByTestId('contract-total')).toHaveTextContent('$185,000.00')
    expect(within(table).getByText('Annual Maintenance Price')).toBeInTheDocument()
  })

  it('renders nothing when there are no line items and no contract value', () => {
    render(<ContractLines estimate={makeEstimate([], { contractValueCents: 0 })} />)
    expect(screen.queryByTestId('contract-pricing-lump-sum')).not.toBeInTheDocument()
    expect(screen.queryByTestId('contract-pricing-table')).not.toBeInTheDocument()
  })
})
