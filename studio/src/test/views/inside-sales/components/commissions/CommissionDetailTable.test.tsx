import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import { CommissionDetailTable } from '@/views/inside-sales/components/commissions/CommissionDetailTable'
import type { Commission, CommissionFilters, CommissionInstallment } from '@/types/commissions'

function installment(overrides: Partial<CommissionInstallment> & Pick<CommissionInstallment, 'id'>): CommissionInstallment {
  return {
    installment_number: 1,
    payout_period: 'Pending billing data',
    payout_period_label: 'Pending billing data',
    payout_date: null,
    amount_cents: null,
    status: 'pending_billing_data',
    billing_installment_number: null,
    collected_amount_cents: null,
    bucket: 'pending_billing_data',
    payable: false,
    ...overrides,
  }
}

function makeCommission(
  installments: CommissionInstallment[],
  status: Commission['status'] = 'approved',
  payable = false,
): Commission {
  return {
    id: 'comm-dobson',
    estimate_id: 'est-dobson',
    lead_id: 'lead-dobson',
    user_id: 'rep-1',
    contract_value_cents: 1_000_000,
    commission_rate: 0.03,
    commission_amount_cents: 30_000,
    status,
    approved_at: '2026-04-08T15:00:00Z',
    paid_at: status === 'paid' ? '2026-06-30T15:00:00Z' : null,
    payment_period: status === 'paid' ? 'June 2026' : null,
    notes: 'Payments 2 and 3 wait on billing.',
    created_at: '2026-04-08T15:00:00Z',
    updated_at: '2026-04-08T15:00:00Z',
    property_name: 'Dobson Ranch HOA',
    rep_name: 'Alex Rivera',
    rep_email: 'alex.rivera@example.com',
    estimate_number: 1108,
    aspire_number: 'ASP-1108',
    estimate_type: 'maintenance',
    close_quarter: '2026-Q2',
    plan_key: 'standard',
    rep_plan_key: 'standard',
    plan_name: 'Standard Sales Commission',
    client_type: null,
    contract_start_date: '2026-04-01',
    payable,
    installments,
  }
}

const rows = [
  installment({
    id: 'dob-1',
    installment_number: 1,
    payout_period: 'June 2026',
    payout_period_label: 'June 2026',
    payout_date: '2026-06-30',
    amount_cents: 15_000,
    status: 'due',
    bucket: 'dated',
    payable: true,
  }),
  installment({
    id: 'dob-2',
    installment_number: 2,
    payout_period: 'Unscheduled',
    payout_period_label: 'Unscheduled',
    amount_cents: 15_000,
    status: 'pending_billing_data',
    billing_installment_number: 6,
    bucket: 'unscheduled',
    payable: false,
  }),
  installment({
    id: 'dob-3',
    installment_number: 3,
    status: 'pending_billing_data',
    billing_installment_number: 12,
  }),
]

const filters: CommissionFilters = {}

function renderTable(isAdmin: boolean, status: Commission['status'] = 'approved', payable = false) {
  return render(
    <CommissionDetailTable
      commissions={[makeCommission(rows, status, payable)]}
      isLoading={false}
      filters={filters}
      onFiltersChange={() => {}}
      isAdmin={isAdmin}
    />,
  )
}

describe('CommissionDetailTable installments', () => {
  it('shows pending billing data without inventing a date or amount', () => {
    renderTable(false)

    const pendingAmount = screen.getByTestId('installment-dob-2')
    expect(pendingAmount).toHaveTextContent('Unscheduled')
    expect(pendingAmount).not.toHaveTextContent('Unscheduled (amount known)')
    expect(pendingAmount).toHaveTextContent('Pending billing data')
    expect(pendingAmount).toHaveTextContent('$150.00')
    expect(pendingAmount).toHaveTextContent('Billing installment 6')
    expect(pendingAmount).not.toHaveTextContent('2026')

    const unknown = screen.getByTestId('installment-dob-3')
    expect(unknown).toHaveTextContent('Pending billing data')
    expect(unknown).toHaveTextContent('Billing installment 12')
    expect(unknown).not.toHaveTextContent('$0.00')
    expect(unknown).not.toHaveTextContent('$')
    expect(unknown).not.toHaveTextContent('June')
  })

  it('marks one installment paid and still offers pay-all for roles that can mark paid', async () => {
    const calls: { url: string; body: unknown }[] = []
    server.use(
      http.post('/api/commissions/installments/:installmentId/mark-paid', async ({ request, params }) => {
        calls.push({ url: request.url, body: { installmentId: String(params.installmentId) } })
        return HttpResponse.json({ success: true })
      }),
      http.post('/api/commissions/:commissionId/mark-paid', async ({ request, params }) => {
        calls.push({ url: request.url, body: { commissionId: String(params.commissionId), ...(await request.json() as object) } })
        return HttpResponse.json({ success: true })
      }),
    )
    const user = userEvent.setup()
    renderTable(true, 'approved', true)

    expect(screen.getByRole('button', { name: 'Mark Paid' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark payment 2 on Dobson Ranch HOA paid' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark payment 3 on Dobson Ranch HOA paid' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark payment 1 on Dobson Ranch HOA paid' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark payment 1 on Dobson Ranch HOA paid' }))
    await waitFor(() => expect(calls.some((call) => call.url.includes('/installments/dob-1/mark-paid'))).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Mark Paid' }))
    await waitFor(() => expect(calls.some((call) => call.url.includes('/commissions/comm-dobson/mark-paid'))).toBe(true))
    const payAll = calls.find((call) => call.url.includes('/commissions/comm-dobson/mark-paid'))
    expect(payAll?.body).toMatchObject({ commissionId: 'comm-dobson', payment_period: expect.stringMatching(/^[A-Z][a-z]+ \d{4}$/) })
  })

  it('hides mark-paid actions when the role cannot mark commissions paid', () => {
    renderTable(false, 'approved', true)
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark payment/ })).not.toBeInTheDocument()
  })

  it('hides the commission mark-paid button when the row is not payable', () => {
    renderTable(true, 'approved', false)
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark payment 1 on Dobson Ranch HOA paid' })).toBeInTheDocument()
  })
})
