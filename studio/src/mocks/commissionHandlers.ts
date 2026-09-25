import { http, HttpResponse } from 'msw'
import type {
  Commission,
  CommissionCloseQuarter,
  CommissionPayoutPeriod,
  CommissionPayoutSchedule,
  CommissionRep,
  CommissionSummary,
} from '@/types/commissions'
import repsJson from './fixtures/commissions/reps.json' with { type: 'json' }
import summaryAlexJson from './fixtures/commissions/summary-alex.json' with { type: 'json' }
import summaryCadyJson from './fixtures/commissions/summary-cady.json' with { type: 'json' }
import listAlexJson from './fixtures/commissions/list-alex.json' with { type: 'json' }
import listCadyJson from './fixtures/commissions/list-cady.json' with { type: 'json' }
import scheduleAlexJson from './fixtures/commissions/schedule-alex.json' with { type: 'json' }
import scheduleCadyJson from './fixtures/commissions/schedule-cady.json' with { type: 'json' }

/**
 * Static responses captured from the local API on 2026-09-25 after migrations
 * 065 and 066 ran against a seeded crm database. The handlers do not recompute
 * payout buckets or totals. Mark-paid only flips status fields on these objects.
 * Summary and list ignore date query params so a later calendar year still shows
 * this snapshot. The payout schedule keeps the captured groups and drops quarters
 * whose seeded close date falls outside start_date/end_date.
 */
const API = '/api'
const CADY_ID = 'rep-cady'

export const commissionReps = repsJson as CommissionRep[]
const summaryAlex = summaryAlexJson as CommissionSummary
const summaryCady = summaryCadyJson as CommissionSummary
const listAlex = structuredClone(listAlexJson) as Commission[]
const listCady = structuredClone(listCadyJson) as Commission[]
const scheduleAlex = scheduleAlexJson as CommissionPayoutSchedule
const scheduleCady = scheduleCadyJson as CommissionPayoutSchedule

/** Close date of each captured quarter, in the same order as the seeded deals. */
const quarterCloseDate = new Map<string, string>(
  scheduleAlex.quarters.map((quarter, index) => {
    const closeDate = [...listAlex]
      .filter((deal) => deal.status !== 'cancelled')
      .map((deal) => deal.created_at.slice(0, 10))
      .sort()[index]
    return [quarter.close_quarter, closeDate ?? '']
  }),
)

function quarterInWindow(quarter: CommissionCloseQuarter, start: string | null, end: string | null): boolean {
  const closeDate = quarterCloseDate.get(quarter.close_quarter) ?? ''
  if (!closeDate) return false
  if (start && closeDate < start) return false
  if (end && closeDate > end) return false
  return true
}

function periodsFromQuarters(quarters: CommissionCloseQuarter[]): CommissionPayoutPeriod[] {
  return quarters.flatMap((quarter) =>
    quarter.installments.map((row) => ({
      payout_period: row.payout_period,
      payout_date: row.payout_date,
      amount_cents: row.amount_cents,
      amount_partial: row.amount_partial,
      status: row.status,
      bucket: row.bucket,
    })),
  )
}

function scheduleFor(userId: string | null, start: string | null, end: string | null): CommissionPayoutSchedule {
  if (userId === CADY_ID) return scheduleCady
  const quarters = scheduleAlex.quarters.filter((quarter) => quarterInWindow(quarter, start, end))
  if (quarters.length === scheduleAlex.quarters.length) return scheduleAlex
  return {
    user_id: scheduleAlex.user_id,
    year: scheduleAlex.year,
    quarters,
    by_payout_period: periodsFromQuarters(quarters),
  }
}

function dealsFor(userId: string | null): Commission[] {
  return userId === CADY_ID ? listCady : listAlex
}

function findDeal(commissionId: string): Commission | undefined {
  return [...listAlex, ...listCady].find((deal) => deal.id === commissionId)
}

function findInstallment(installmentId: string): { deal: Commission; index: number } | undefined {
  for (const deal of [...listAlex, ...listCady]) {
    const index = deal.installments.findIndex((row) => row.id === installmentId)
    if (index >= 0) return { deal, index }
  }
  return undefined
}

export const commissionHandlers = [
  http.get(`${API}/commissions/reps`, () => HttpResponse.json(commissionReps)),
  http.get(`${API}/commissions/summary`, ({ request }) => {
    const userId = new URL(request.url).searchParams.get('user_id')
    return HttpResponse.json(userId === CADY_ID ? summaryCady : summaryAlex)
  }),
  http.get(`${API}/commissions/list`, ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const estimateType = url.searchParams.get('estimate_type')
    const rows = dealsFor(url.searchParams.get('user_id')).filter((deal) => {
      if (status && deal.status !== status) return false
      if (estimateType && deal.estimate_type !== estimateType) return false
      return true
    })
    return HttpResponse.json(rows)
  }),
  http.get(`${API}/commissions/payout-schedule`, ({ request }) => {
    const url = new URL(request.url)
    return HttpResponse.json(scheduleFor(
      url.searchParams.get('user_id'),
      url.searchParams.get('start_date'),
      url.searchParams.get('end_date'),
    ))
  }),
  http.post(`${API}/commissions/installments/:installmentId/mark-paid`, ({ params }) => {
    const found = findInstallment(String(params.installmentId))
    if (!found) return HttpResponse.json({ detail: 'Installment not found' }, { status: 404 })
    if (found.deal.status === 'cancelled' || found.deal.installments[found.index].status === 'cancelled') {
      return HttpResponse.json({ detail: 'Cancelled installment cannot be marked paid' }, { status: 409 })
    }
    found.deal.installments[found.index].status = 'paid'
    return HttpResponse.json({ success: true })
  }),
  http.post(`${API}/commissions/:commissionId/mark-paid`, async ({ params, request }) => {
    const deal = findDeal(String(params.commissionId))
    if (!deal) return HttpResponse.json({ detail: 'Commission not found' }, { status: 404 })
    const body = await request.json() as { payment_period?: string }
    deal.status = 'paid'
    deal.paid_at = new Date().toISOString()
    deal.payment_period = body.payment_period ?? deal.payment_period
    for (const row of deal.installments) row.status = 'paid'
    return HttpResponse.json({ success: true })
  }),
]
