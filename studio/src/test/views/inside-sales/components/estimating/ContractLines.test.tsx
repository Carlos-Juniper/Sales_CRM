import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/utils'
import { ContractLines } from '@/views/inside-sales/components/estimating/proposal-pages/ContractLines'
import type { Estimate, SectionService } from '@/types/estimating'

function service(
  partial: Pick<SectionService, 'id' | 'label' | 'qty' | 'unitSellCents' | 'sortOrder'> & {
    billingType?: SectionService['billingType']
  },
): SectionService {
  return {
    sectionId: 'sec-1',
    catalogItemId: null,
    uom: '/yr',
    complexityPct: 0,
    billingType: 'recurring',
    components: [],
    ...partial,
  }
}

function estimate(services: SectionService[]): Estimate {
  return {
    id: 'est-test',
    estimateType: 'maintenance',
    name: 'Test',
    status: 'approved',
    sections: [
      {
        id: 'sec-1',
        estimateId: 'est-test',
        name: 'Main',
        squareFeet: 10000,
        sortOrder: 0,
        services,
      },
    ],
  } as Estimate
}

function cellsIn(label: string): string[] {
  const row = screen.getByRole('cell', { name: label }).closest('tr')
  expect(row).not.toBeNull()
  return within(row as HTMLElement).getAllByRole('cell').map((cell) => cell.textContent)
}

describe('ContractLines', () => {
  it('prints each priced service and leaves an unpriced price blank', () => {
    render(
      <ContractLines
        estimate={estimate([
          service({ id: 'svc-1', label: 'Mowing', qty: 12, unitSellCents: 500, sortOrder: 0 }),
          service({
            id: 'svc-2',
            label: 'Unpriced bed work',
            qty: 4,
            unitSellCents: null,
            sortOrder: 1,
          }),
        ])}
      />,
    )

    expect(cellsIn('Mowing')).toEqual(['Mowing', '12', '$600.00'])
    expect(cellsIn('Unpriced bed work')).toEqual(['Unpriced bed work', '4', ''])
    expect(cellsIn('Annual Maintenance Price')).toEqual(['Annual Maintenance Price', '$600.00'])
  })

  it('leaves optional money cells blank when unpriced and prints a stored zero', () => {
    render(
      <ContractLines
        estimate={estimate([
          service({
            id: 'svc-1',
            label: 'Unpriced mulch',
            qty: 1,
            unitSellCents: null,
            sortOrder: 0,
            billingType: 'one_time',
          }),
          service({
            id: 'svc-2',
            label: 'Included flowers',
            qty: 1,
            unitSellCents: 0,
            sortOrder: 1,
            billingType: 'one_time',
          }),
        ])}
      />,
    )

    expect(cellsIn('Unpriced mulch')).toEqual(['Unpriced mulch', '1', '', ''])
    expect(cellsIn('Included flowers')).toEqual(['Included flowers', '1', '$0.00', '$0.00'])
  })

  it('prints the seeded Coral Bay approved value with recurring lines that sum to it', () => {
    // Same sections, quantities, rates, and square footage as
    // scripts/seed_contract_estimate.py, whose stored contract value is $48,000.
    const coralBay = {
      id: 'est-coral-bay',
      estimateType: 'maintenance',
      name: 'Coral Bay HOA — Contract Test',
      status: 'approved',
      contractValueCents: 4_800_000,
      sections: [
        {
          id: 'sec-main',
          estimateId: 'est-coral-bay',
          name: 'Main Property',
          squareFeet: 342_000,
          sortOrder: 0,
          services: [
            service({ id: 'svc-1', label: 'Mowing & Edging', qty: 12, unitSellCents: 350, sortOrder: 0 }),
            service({ id: 'svc-2', label: 'Landscape Bed Maintenance', qty: 12, unitSellCents: 200, sortOrder: 1 }),
            service({ id: 'svc-3', label: 'Fertilization', qty: 4, unitSellCents: 300, sortOrder: 2 }),
            service({ id: 'svc-4', label: 'Weed Control', qty: 6, unitSellCents: 200, sortOrder: 3 }),
            service({ id: 'svc-5', label: 'Tree Canopy Trimming', qty: 4, unitSellCents: 250, sortOrder: 4 }),
          ].map((row) => ({ ...row, sectionId: 'sec-main' })),
        },
        {
          id: 'sec-entrance',
          estimateId: 'est-coral-bay',
          name: 'Entrance & Amenity Areas',
          squareFeet: 28_500,
          sortOrder: 1,
          services: [
            service({ id: 'svc-6', label: 'Shrub & Hedge Trimming', qty: 6, unitSellCents: 1400, sortOrder: 0 }),
            service({ id: 'svc-7', label: 'Irrigation System Maint.', qty: 12, unitSellCents: 1000, sortOrder: 1 }),
            service({
              id: 'svc-8',
              label: 'Mulch Application',
              qty: 1,
              unitSellCents: 420_000,
              sortOrder: 2,
              billingType: 'one_time',
            }),
            service({
              id: 'svc-9',
              label: 'Annual Flower Installation',
              qty: 1,
              unitSellCents: 860_000,
              sortOrder: 3,
              billingType: 'one_time',
            }),
          ].map((row) => ({ ...row, sectionId: 'sec-entrance' })),
        },
      ],
    } as Estimate

    render(<ContractLines estimate={coralBay} />)

    const [servicesTable, optionalTable] = screen.getAllByRole('table')
    const serviceRows = within(servicesTable)
      .getAllByRole('row')
      .filter((row) => within(row).queryAllByRole('cell').length === 3)
    const lineCents = serviceRows.map((row) => {
      const price = within(row).getAllByRole('cell')[2].textContent ?? ''
      return Math.round(Number(price.replace(/[$,]/g, '')) * 100)
    })
    const totalRow = within(servicesTable).getByRole('row', { name: /Annual Maintenance Price/ })
    const totalText = within(totalRow).getAllByRole('cell')[1].textContent

    expect(lineCents).toHaveLength(7)
    expect(lineCents.reduce((sum, cents) => sum + cents, 0)).toBe(4_800_000)
    expect(totalText).toBe('$48,000.00')
    expect(within(optionalTable).getByRole('cell', { name: 'Mulch Application' })).toBeInTheDocument()
    expect(within(optionalTable).getByRole('cell', { name: 'Annual Flower Installation' })).toBeInTheDocument()
  })
})
