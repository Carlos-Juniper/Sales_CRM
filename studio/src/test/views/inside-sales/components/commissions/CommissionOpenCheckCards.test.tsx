import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { CommissionOpenCheckCards } from '@/views/inside-sales/components/commissions/CommissionOpenCheckCards'

describe('CommissionOpenCheckCards', () => {
  it('shows the next dated check plus due and upcoming totals', () => {
    render(
      <CommissionOpenCheckCards
        nextPayout={{ payout_period: 'June 2026', payout_date: '2026-06-30', amount_cents: 15_000 }}
        dueCents={15_000}
        upcomingCents={7_500}
        isLoading={false}
        balancesPeriodFiltered={false}
      />,
    )

    expect(screen.getByText('Next payout')).toBeInTheDocument()
    expect(screen.getByText('June 2026 · Jun 30, 2026')).toBeInTheDocument()
    expect(screen.getAllByText('$150.00').length).toBeGreaterThan(0)
    expect(screen.getByText('$75.00')).toBeInTheDocument()
    expect(screen.getByText('Due')).toBeInTheDocument()
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(screen.getByText(/Pending billing data is not included/)).toBeInTheDocument()
    expect(screen.getByText(/Not period-filtered/)).toBeInTheDocument()
  })

  it('hides the period-filter note when balances are period-filtered', () => {
    render(
      <CommissionOpenCheckCards
        nextPayout={{ payout_period: 'June 2026', payout_date: '2026-06-30', amount_cents: 15_000 }}
        dueCents={15_000}
        upcomingCents={7_500}
        isLoading={false}
        balancesPeriodFiltered
      />,
    )

    expect(screen.getByText(/Pending billing data is not included/)).toBeInTheDocument()
    expect(screen.queryByText(/Not period-filtered/)).not.toBeInTheDocument()
  })

  it('does not invent a date or amount when there is no next payout', () => {
    render(
      <CommissionOpenCheckCards
        nextPayout={null}
        dueCents={0}
        upcomingCents={0}
        isLoading={false}
        balancesPeriodFiltered={false}
      />,
    )

    expect(screen.getByText('No dated check')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/20\d\d/)).not.toBeInTheDocument()
    expect(screen.queryByText('$150.00')).not.toBeInTheDocument()
  })
})
