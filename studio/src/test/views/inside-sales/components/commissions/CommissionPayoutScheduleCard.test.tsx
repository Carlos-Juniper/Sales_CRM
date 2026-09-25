import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { CommissionPayoutScheduleCard } from '@/views/inside-sales/components/commissions/CommissionPayoutScheduleCard'
import type { CommissionPayoutSchedule } from '@/types/commissions'

const schedule: CommissionPayoutSchedule = {
  user_id: 'rep-1',
  year: 2026,
  quarters: [
    {
      close_quarter: '2026-Q2',
      sales_count: 1,
      commission_total_cents: 30_000,
      installments: [
        {
          installment_number: 1,
          payout_period: 'June 2026',
          payout_date: '2026-06-30',
          amount_cents: 15_000,
          amount_partial: false,
          status: 'due',
          bucket: 'dated',
        },
        {
          installment_number: 2,
          payout_period: 'Unscheduled',
          payout_date: null,
          amount_cents: 15_000,
          amount_partial: false,
          status: 'pending_billing_data',
          bucket: 'unscheduled',
        },
        {
          installment_number: 3,
          payout_period: null,
          payout_date: null,
          amount_cents: null,
          amount_partial: false,
          status: 'pending_billing_data',
          bucket: 'pending_billing_data',
        },
        {
          installment_number: 1,
          payout_period: 'April 2026',
          payout_date: '2026-04-30',
          amount_cents: 15_000,
          amount_partial: true,
          status: 'due',
          bucket: 'dated',
        },
      ],
    },
  ],
  by_payout_period: [],
}

describe('CommissionPayoutScheduleCard', () => {
  it('shows each closed quarter with payout month, amount, and status', () => {
    render(
      <CommissionPayoutScheduleCard
        schedule={schedule}
        isLoading={false}
        scopeNote="Deals closed in 2026."
      />,
    )

    expect(screen.getByRole('heading', { name: 'Payout schedule' })).toBeInTheDocument()
    expect(screen.getByText('Q2 2026')).toBeInTheDocument()
    expect(screen.getByText('1 deal · $300.00 recorded at close')).toBeInTheDocument()

    const first = screen.getByTestId('quarter-2026-Q2-payment-1-dated-2026-06-30')
    expect(first).toHaveTextContent('June 2026')
    expect(first).toHaveTextContent('$150.00')
    expect(first).toHaveTextContent('Due')
  })

  it('renders pending billing data without a date or a stand-in amount', () => {
    render(
      <CommissionPayoutScheduleCard
        schedule={schedule}
        isLoading={false}
        scopeNote="Deals closed in 2026."
      />,
    )

    const knownAmount = screen.getByTestId('quarter-2026-Q2-payment-2-unscheduled-none')
    expect(knownAmount).toHaveTextContent('Unscheduled (amount known)')
    expect(knownAmount).toHaveTextContent('Pending billing data')
    expect(knownAmount).toHaveTextContent('$150.00')
    expect(knownAmount).not.toHaveTextContent('2026')

    const unknown = screen.getByTestId('quarter-2026-Q2-payment-3-pending_billing_data-none')
    expect(unknown).toHaveTextContent('Pending billing data')
    expect(unknown).not.toHaveTextContent('$0.00')
    expect(unknown).not.toHaveTextContent('$')
    expect(unknown).not.toHaveTextContent('2026')
    expect(unknown).not.toHaveTextContent('June')
  })

  it('marks a mixed quarter total as known dollars plus pending', () => {
    render(
      <CommissionPayoutScheduleCard
        schedule={schedule}
        isLoading={false}
        scopeNote="Deals closed in 2026."
      />,
    )

    const partial = screen.getByTestId('quarter-2026-Q2-payment-1-dated-2026-04-30')
    expect(partial).toHaveTextContent('$150.00 + pending')
  })
})
