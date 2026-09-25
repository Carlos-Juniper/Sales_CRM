import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { CommissionPayoutPeriodView } from '@/views/inside-sales/components/commissions/CommissionPayoutPeriodView'
import type { CommissionPayoutPeriod } from '@/types/commissions'

const periods: CommissionPayoutPeriod[] = [
  {
    payout_period: null,
    payout_date: null,
    amount_cents: null,
    amount_partial: false,
    status: 'pending_billing_data',
    bucket: 'pending_billing_data',
  },
  {
    payout_period: 'Unscheduled',
    payout_date: null,
    amount_cents: 22_500,
    amount_partial: false,
    status: 'pending_billing_data',
    bucket: 'unscheduled',
  },
  {
    payout_period: 'September 2026',
    payout_date: '2026-09-30',
    amount_cents: 7_500,
    amount_partial: false,
    status: 'upcoming',
    bucket: 'dated',
  },
  {
    payout_period: 'June 2026',
    payout_date: '2026-06-30',
    amount_cents: 15_000,
    amount_partial: false,
    status: 'due',
    bucket: 'dated',
  },
]

describe('CommissionPayoutPeriodView', () => {
  it('keeps dated checks ahead of separate unscheduled and pending groups', () => {
    render(<CommissionPayoutPeriodView periods={periods} isLoading={false} />)

    expect(screen.getByRole('heading', { name: 'What hits each check' })).toBeInTheDocument()

    const june = screen.getByTestId('payout-period-2026-06-30')
    expect(june).toHaveTextContent('June 2026')
    expect(june).toHaveTextContent('Jun 30, 2026')
    expect(june).toHaveTextContent('$150.00')
    expect(june).toHaveTextContent('Due')

    const september = screen.getByTestId('payout-period-2026-09-30')
    expect(september).toHaveTextContent('September 2026')
    expect(september).toHaveTextContent('$75.00')
    expect(september).toHaveTextContent('Upcoming')

    const unscheduled = screen.getByTestId('payout-period-unscheduled')
    expect(unscheduled).toHaveTextContent('Unscheduled (amount known)')
    expect(unscheduled).toHaveTextContent('$225.00')
    expect(unscheduled).not.toHaveTextContent('2026')

    const pending = screen.getByTestId('payout-period-pending_billing_data')
    expect(pending).toHaveTextContent('Pending billing data')
    expect(pending).not.toHaveTextContent('$0.00')
    expect(pending).not.toHaveTextContent('$')
    expect(pending).not.toHaveTextContent('2026')

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('June 2026')
    expect(items[1]).toHaveTextContent('September 2026')
    expect(items[2]).toHaveTextContent('Unscheduled (amount known)')
    expect(items[3]).toHaveTextContent('Pending billing data')
  })

  it('marks a mixed check as known dollars plus pending', () => {
    const mixed: CommissionPayoutPeriod = {
      payout_period: 'June 2026',
      payout_date: '2026-06-30',
      amount_cents: 15_000,
      amount_partial: true,
      status: 'due',
      bucket: 'dated',
    }
    render(<CommissionPayoutPeriodView periods={[mixed]} isLoading={false} />)
    expect(screen.getByTestId('payout-period-2026-06-30')).toHaveTextContent('$150.00 + pending')
  })
})
