import { describe, it, expect } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { createWrapper } from '@/test/utils'
import {
  useCommissionPayoutSchedule,
  useCommissionsList,
  useCommissionSummary,
  useMarkInstallmentPaid,
} from '@/hooks/useCommissions'
import type { CommissionPayoutSchedule, CommissionSummary } from '@/types/commissions'

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
      ],
    },
  ],
  by_payout_period: [
    {
      payout_period: 'June 2026',
      payout_date: '2026-06-30',
      amount_cents: 15_000,
      amount_partial: false,
      status: 'due',
      bucket: 'dated',
    },
  ],
}

const summary: CommissionSummary = {
  scheduled_ytd_cents: 125_000,
  paid_ytd_cents: 80_000,
  next_payout: { payout_period: 'June 2026', payout_date: '2026-06-30', amount_cents: 15_000 },
  due_cents: 15_000,
  upcoming_cents: 7_500,
  balances_period_filtered: false,
  plan_key: 'standard',
  plan_name: 'Standard Sales Commission',
}

describe('useCommissionPayoutSchedule', () => {
  it('loads the schedule for the requested rep and close year', async () => {
    const urls: string[] = []
    server.use(
      http.get('/api/commissions/payout-schedule', ({ request }) => {
        urls.push(request.url)
        return HttpResponse.json(schedule)
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(
      () => useCommissionPayoutSchedule({ user_id: 'rep-1', year: 2026 }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.quarters[0].close_quarter).toBe('2026-Q2')
    expect(result.current.data?.by_payout_period[0].amount_cents).toBe(15_000)
    expect(urls[0]).toContain('user_id=rep-1')
    expect(urls[0]).toContain('year=2026')
  })

  it('refetches list, summary, and the payout schedule after marking an installment paid', async () => {
    let scheduleHits = 0
    let listHits = 0
    let summaryHits = 0
    const posted: string[] = []
    server.use(
      http.get('/api/commissions/payout-schedule', () => {
        scheduleHits += 1
        return HttpResponse.json(schedule)
      }),
      http.get('/api/commissions/list', () => {
        listHits += 1
        return HttpResponse.json([])
      }),
      http.get('/api/commissions/summary', () => {
        summaryHits += 1
        return HttpResponse.json(summary)
      }),
      http.post('/api/commissions/installments/:installmentId/mark-paid', ({ params }) => {
        posted.push(String(params.installmentId))
        return HttpResponse.json({ success: true })
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(
      () => ({
        schedule: useCommissionPayoutSchedule({ user_id: 'rep-1', year: 2026 }),
        list: useCommissionsList({ user_id: 'rep-1' }),
        summary: useCommissionSummary({ user_id: 'rep-1' }),
        mark: useMarkInstallmentPaid(),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.schedule.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.summary.isSuccess).toBe(true))
    const before = { scheduleHits, listHits, summaryHits }

    await act(async () => {
      await result.current.mark.mutateAsync('dob-2')
    })

    expect(posted).toEqual(['dob-2'])
    await waitFor(() => expect(scheduleHits).toBeGreaterThan(before.scheduleHits))
    expect(listHits).toBeGreaterThan(before.listHits)
    expect(summaryHits).toBeGreaterThan(before.summaryHits)
  })
})
