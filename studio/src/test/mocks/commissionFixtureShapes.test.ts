import { describe, expect, it } from 'vitest'
import reps from '@/mocks/fixtures/commissions/reps.json' with { type: 'json' }
import summaryAlex from '@/mocks/fixtures/commissions/summary-alex.json' with { type: 'json' }
import summaryCady from '@/mocks/fixtures/commissions/summary-cady.json' with { type: 'json' }
import listAlex from '@/mocks/fixtures/commissions/list-alex.json' with { type: 'json' }
import listCady from '@/mocks/fixtures/commissions/list-cady.json' with { type: 'json' }
import scheduleAlex from '@/mocks/fixtures/commissions/schedule-alex.json' with { type: 'json' }
import scheduleCady from '@/mocks/fixtures/commissions/schedule-cady.json' with { type: 'json' }
import type {
  Commission,
  CommissionInstallment,
  CommissionPayoutSchedule,
  CommissionQuarterInstallment,
  CommissionRep,
  CommissionSummary,
} from '@/types/commissions'

const COMMISSION_STATUS = ['approved', 'paid', 'cancelled']
const INSTALLMENT_STATUS = ['paid', 'due', 'upcoming', 'cancelled', 'pending_billing_data']
const BUCKET = ['dated', 'unscheduled', 'pending_billing_data']
const ESTIMATE_TYPE = ['maintenance', 'install']

function keys(value: object): string[] {
  return Object.keys(value).sort()
}

function expectKeys(value: object, expected: string[]) {
  expect(keys(value)).toEqual([...expected].sort())
}

const COMMISSION_KEYS = [
  'id', 'estimate_id', 'lead_id', 'user_id', 'contract_value_cents', 'commission_rate',
  'commission_amount_cents', 'status', 'approved_at', 'paid_at', 'payment_period', 'notes',
  'created_at', 'updated_at', 'rep_name', 'rep_email', 'property_name', 'estimate_number',
  'aspire_number', 'estimate_type', 'close_quarter', 'plan_key', 'rep_plan_key', 'plan_name',
  'client_type', 'contract_start_date', 'payable', 'payout_period', 'payout_period_label',
  'installments',
]

const INSTALLMENT_KEYS = [
  'id', 'installment_number', 'payout_period', 'payout_period_label', 'payout_date',
  'amount_cents', 'status', 'billing_installment_number', 'collected_amount_cents',
  'bucket', 'payable',
]

const PERIOD_KEYS = [
  'payout_period', 'payout_period_label', 'payout_date', 'amount_cents', 'amount_partial',
  'status', 'bucket',
]

const QUARTER_INSTALLMENT_KEYS = ['installment_number', ...PERIOD_KEYS]

const SUMMARY_KEYS = [
  'scheduled_ytd_cents', 'paid_ytd_cents', 'next_payout', 'upcoming_cents', 'due_cents',
  'plan_key', 'plan_name',
]

const NEXT_PAYOUT_KEYS = [
  'payout_period', 'payout_period_label', 'payout_date', 'amount_cents', 'bucket',
]

const REP_KEYS = ['id', 'name', 'email', 'commission_rate', 'effective_date', 'plan_key', 'plan_name']

const SCHEDULE_KEYS = ['user_id', 'year', 'quarters', 'by_payout_period']

function expectInstallment(row: CommissionInstallment) {
  expectKeys(row, INSTALLMENT_KEYS)
  expect(INSTALLMENT_STATUS).toContain(row.status)
  expect(BUCKET).toContain(row.bucket)
  expect(typeof row.payout_period).toBe('string')
  expect(row.payout_period_label).toBe(row.payout_period)
  expect(typeof row.payable).toBe('boolean')
  if (row.amount_cents != null) expect(typeof row.amount_cents).toBe('number')
  if (row.payout_date != null) expect(typeof row.payout_date).toBe('string')
}

function expectCommission(row: Commission) {
  expectKeys(row, COMMISSION_KEYS)
  expect(COMMISSION_STATUS).toContain(row.status)
  expect(ESTIMATE_TYPE).toContain(row.estimate_type)
  expect(typeof row.payable).toBe('boolean')
  expect(typeof row.payout_period).toBe('string')
  expect(row.payout_period_label).toBe(row.payout_period)
  expect(typeof row.rep_name).toBe('string')
  expect(typeof row.property_name).toBe('string')
  row.installments.forEach(expectInstallment)
}

function expectSummary(row: CommissionSummary) {
  expectKeys(row, SUMMARY_KEYS)
  expect(row).not.toHaveProperty('balances_period_filtered')
  if (row.next_payout) {
    expectKeys(row.next_payout, NEXT_PAYOUT_KEYS)
    expect(row.next_payout.bucket).toBe('dated')
    expect(row.next_payout.payout_period_label).toBe(row.next_payout.payout_period)
  }
}

function expectSchedule(row: CommissionPayoutSchedule) {
  expectKeys(row, SCHEDULE_KEYS)
  expect(row.year === null || typeof row.year === 'number').toBe(true)
  row.quarters.forEach((quarter) => {
    expectKeys(quarter, ['close_quarter', 'sales_count', 'commission_total_cents', 'installments'])
    quarter.installments.forEach((installment: CommissionQuarterInstallment) => {
      expectKeys(installment, QUARTER_INSTALLMENT_KEYS)
      expect(BUCKET).toContain(installment.bucket)
      expect(INSTALLMENT_STATUS).toContain(installment.status)
      expect(typeof installment.amount_partial).toBe('boolean')
      expect(installment).not.toHaveProperty('installment_number', undefined)
      expect(typeof installment.installment_number).toBe('number')
    })
  })
  row.by_payout_period.forEach((period) => {
    expectKeys(period, PERIOD_KEYS)
    expect(period).not.toHaveProperty('installment_number')
    expect(BUCKET).toContain(period.bucket)
    expect(typeof period.amount_partial).toBe('boolean')
  })
}

describe('commission fixtures match the da580a6 response shapes', () => {
  it('reps, summaries, lists, and schedules use the public keys', () => {
    const repRows = reps as CommissionRep[]
    repRows.forEach((rep) => expectKeys(rep, REP_KEYS))
    expectSummary(summaryAlex as CommissionSummary)
    expectSummary(summaryCady as CommissionSummary)
    ;(listAlex as Commission[]).forEach(expectCommission)
    ;(listCady as Commission[]).forEach(expectCommission)
    expectSchedule(scheduleAlex as CommissionPayoutSchedule)
    expectSchedule(scheduleCady as CommissionPayoutSchedule)
  })
})
