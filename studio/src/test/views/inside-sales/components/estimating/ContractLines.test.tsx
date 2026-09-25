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
})
