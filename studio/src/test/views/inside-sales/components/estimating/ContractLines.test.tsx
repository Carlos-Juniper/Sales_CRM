import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/utils'
import { formatCents } from '@/lib/money'
import { buildContract } from '@/lib/proposal/contract'
import {
  CORAL_BAY_ANNUAL_MAINTENANCE_CENTS,
  CORAL_BAY_CONTRACT_VALUE_CENTS,
  CORAL_BAY_OPTIONAL_LABELS,
  CORAL_BAY_RECURRING_LINES,
  coralBayContractEstimate,
} from '@/test/fixtures/coralBayContract'
import { ContractLines } from '@/views/inside-sales/components/estimating/proposal-pages/ContractLines'
import type { Estimate, SectionService } from '@/types/estimating'

function service(
  partial: Pick<SectionService, 'id' | 'label' | 'qty' | 'unitSellCents' | 'sortOrder'> & {
    billingType?: SectionService['billingType']
  },
): SectionService {
  return {
    sectionId: 'sec-1',
    serviceKitId: null,
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

function cents(text: string | null): number {
  return Math.round(Number((text ?? '').replace(/[$,]/g, '')) * 100)
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

    expect(screen.getByRole('columnheader', { name: 'Annual Price' })).toBeInTheDocument()
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

    expect(screen.getByRole('columnheader', { name: 'Price per Occurrence' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Annual Price' })).toBeInTheDocument()
    expect(cellsIn('Unpriced mulch')).toEqual(['Unpriced mulch', '1', '', ''])
    expect(cellsIn('Included flowers')).toEqual(['Included flowers', '1', '$0.00', '$0.00'])
  })

  it('prints each Coral Bay recurring line at its calculated price', () => {
    const coralBay = coralBayContractEstimate()
    render(<ContractLines estimate={coralBay} />)

    const [servicesTable, optionalTable] = screen.getAllByRole('table')
    const serviceRows = within(servicesTable)
      .getAllByRole('row')
      .filter((row) => within(row).queryAllByRole('cell').length === 3)
    const lineCents = serviceRows.map((row) => cents(within(row).getAllByRole('cell')[2].textContent))
    const totalRow = within(servicesTable).getByRole('row', { name: /Annual Maintenance Price/ })
    const maintenanceCents = cents(within(totalRow).getAllByRole('cell')[1].textContent)
    const optionalRows = within(optionalTable)
      .getAllByRole('row')
      .filter((row) => within(row).queryAllByRole('cell').length === 4)
    const optionalCents = optionalRows.map((row) => cents(within(row).getAllByRole('cell')[3].textContent))

    expect(serviceRows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(
      CORAL_BAY_RECURRING_LINES.map((line) => line.label),
    )
    expect(lineCents).toEqual(CORAL_BAY_RECURRING_LINES.map((line) => line.extPriceCents))
    expect(lineCents.reduce((sum, value) => sum + value, 0)).toBe(maintenanceCents)
    expect(maintenanceCents).toBe(CORAL_BAY_ANNUAL_MAINTENANCE_CENTS)
    expect(formatCents(maintenanceCents)).not.toBe(formatCents(CORAL_BAY_CONTRACT_VALUE_CENTS))
    expect(optionalRows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      ...CORAL_BAY_OPTIONAL_LABELS,
    ])
    expect(optionalCents.every((value) => value > 0)).toBe(true)
    expect(maintenanceCents + optionalCents.reduce((sum, value) => sum + value, 0)).toBe(
      buildContract(coralBay).totals.extPriceCents,
    )
  })
})
