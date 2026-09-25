import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { ContractLines } from '@/views/inside-sales/components/estimating/proposal-pages/ContractLines'
import type { Estimate } from '@/types/estimating'

function estimate(): Estimate {
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
        services: [
          {
            id: 'svc-1',
            sectionId: 'sec-1',
            catalogItemId: null,
            label: 'Mowing',
            qty: 12,
            uom: '/yr',
            complexityPct: 0,
            unitSellCents: 500,
            sortOrder: 0,
            billingType: 'recurring',
            components: [],
          },
          {
            id: 'svc-2',
            sectionId: 'sec-1',
            catalogItemId: null,
            label: 'Unpriced bed work',
            qty: 4,
            uom: '/yr',
            complexityPct: 0,
            unitSellCents: null,
            sortOrder: 1,
            billingType: 'recurring',
            components: [],
          },
        ],
      },
    ],
  } as Estimate
}

describe('ContractLines', () => {
  it('prints each priced service in the existing table and leaves an unpriced row blank', () => {
    render(<ContractLines estimate={estimate()} />)

    const mowing = screen.getByText('Mowing').closest('tr')
    const unpriced = screen.getByText('Unpriced bed work').closest('tr')

    expect(mowing?.querySelector('[data-testid="contract-line-frequency"]')?.textContent).toBe('12')
    expect(mowing?.querySelector('[data-testid="contract-line-price"]')?.textContent).toBe('$600.00')
    expect(unpriced?.querySelector('[data-testid="contract-line-frequency"]')?.textContent).toBe('4')
    expect(unpriced?.querySelector('[data-testid="contract-line-price"]')?.textContent).toBe('')
    expect(screen.getByTestId('contract-total').textContent).toContain('Annual Maintenance Price')
    expect(screen.getByTestId('contract-total').textContent).toContain('$600.00')
  })
})
