// ---------------------------------------------------------------------------
// ContractLines — per-service price on the existing Description of Services
// table. The table, its rows, and the Annual Maintenance Price total stay;
// each recurring row gains a price cell in the same currency style.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/utils'
import { buildContractRows, buildContractTotals } from '@/lib/proposal/contract'
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

function cents(text: string): number {
  return Math.round(Number(text.replace(/[$,]/g, '')) * 100)
}

describe('ContractLines per-service price', () => {
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

  it('keeps the existing services table and adds each service price beside its frequency', () => {
    render(<ContractPage estimate={estimate} lead={{ property_name: 'Willowbrook Estates' }} />)
    const page = screen.getByTestId('page-contract-scope')
    const table = page.querySelector('.services-tbl')
    expect(table).toBeTruthy()
    expect(within(table as HTMLElement).getByText('Description of Services')).toBeInTheDocument()
    expect(within(table as HTMLElement).getByText('Frequency')).toBeInTheDocument()
    expect(within(table as HTMLElement).getByText('General Maintenance Services')).toBeInTheDocument()
    expect(within(table as HTMLElement).queryByText('Subtotal')).not.toBeInTheDocument()
    expect(within(table as HTMLElement).queryByText('Sales Tax')).not.toBeInTheDocument()
    expect(within(table as HTMLElement).queryByText('Unit Price')).not.toBeInTheDocument()
    expect(within(table as HTMLElement).queryByText('Line Total')).not.toBeInTheDocument()

    const mowing = line('Mowing')
    const edging = line('Edging')
    expect(within(mowing).getByTestId('contract-line-frequency')).toHaveTextContent('12')
    expect(within(mowing).getByTestId('contract-line-price')).toHaveTextContent('$600.00')
    expect(within(edging).getByTestId('contract-line-frequency')).toHaveTextContent('4')
    expect(within(edging).getByTestId('contract-line-price')).toHaveTextContent('$80.00')
    expect(within(table as HTMLElement).queryByText('Mulch')).not.toBeInTheDocument()

    const optional = page.querySelector('.optional-tbl')
    expect(optional).toBeTruthy()
    expect(within(optional as HTMLElement).getByText('Mulch')).toBeInTheDocument()
    expect(within(optional as HTMLElement).getAllByText('$30.00').length).toBeGreaterThan(0)
    expect(within(screen.getByTestId('page-contract-summary')).queryByText('Mowing')).not.toBeInTheDocument()
  })

  it('keeps the annual total and the per-service prices sum to it', () => {
    render(<ContractLines estimate={estimate} />)
    const recurring = buildContractRows(estimate).filter((row) => row.isRecurring)
    const annual = buildContractTotals(recurring).extPriceCents
    expect(annual).toBe(68000)

    const shown = screen.getAllByTestId('contract-line-price').map((cell) => cents(cell.textContent ?? ''))
    expect(shown.reduce((sum, n) => sum + n, 0)).toBe(annual)
    expect(screen.getByTestId('contract-total')).toHaveTextContent('Annual Maintenance Price')
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$680.00')
  })

  it('shows the extended price when price-each times frequency would miss the total', () => {
    const rounded = makeEstimate([
      {
        squareFeet: 1001,
        services: [{ label: 'Detail work', qty: 3, unitSellCents: 333, complexityPct: 0 }],
      },
    ])
    render(<ContractLines estimate={rounded} />)
    expect(within(line('Detail work')).getByTestId('contract-line-price')).toHaveTextContent('$10.00')
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$10.00')
  })

  it('leaves the price cell blank when the service has no unit sell price', () => {
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
    expect(within(hand).getByTestId('contract-line-frequency')).toHaveTextContent('4')
    expect(within(hand).getByTestId('contract-line-price').textContent).toBe('')
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$600.00')
    const shown = screen
      .getAllByTestId('contract-line-price')
      .map((cell) => cell.textContent ?? '')
      .filter((text) => text !== '')
      .map(cents)
    expect(shown.reduce((sum, n) => sum + n, 0)).toBe(60000)
  })
})

describe('ContractLines without services', () => {
  it('renders no table and does not invent a lump-sum row', () => {
    render(
      <ContractPage
        estimate={makeEstimate([], { contractValueCents: 18_500_000 })}
        lead={{ property_name: 'Coral Bay HOA' }}
      />,
    )
    const page = screen.getByTestId('page-contract-scope')
    expect(page.querySelector('.services-tbl')).toBeNull()
    expect(within(page).queryByText('Annual Maintenance Price')).not.toBeInTheDocument()
    expect(within(page).queryByText('$185,000.00')).not.toBeInTheDocument()
  })
})
