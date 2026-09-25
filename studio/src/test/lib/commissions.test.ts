import { describe, expect, it } from 'vitest'
import {
  describePayout,
  formatCloseQuarter,
  getCommissionPeriodDates,
  getPeriodDates,
  type Period,
} from '@/lib/commissions'

const SEP_25 = new Date('2026-09-25T15:00:00Z')
const JAN_15 = new Date('2026-01-15T12:00:00Z')
const FEB_15 = new Date('2026-02-15T12:00:00Z')

describe('getPeriodDates', () => {
  it.each<[Period, Date, { start_date?: string; end_date?: string }]>([
    ['this_year', SEP_25, { start_date: '2026-01-01', end_date: '2026-09-25' }],
    ['this_quarter', SEP_25, { start_date: '2026-07-01', end_date: '2026-09-25' }],
    ['last_quarter', SEP_25, { start_date: '2026-04-01', end_date: '2026-06-30' }],
    ['this_month', SEP_25, { start_date: '2026-09-01', end_date: '2026-09-25' }],
    ['last_month', SEP_25, { start_date: '2026-08-01', end_date: '2026-08-31' }],
    ['all_time', SEP_25, {}],
    ['this_year', JAN_15, { start_date: '2026-01-01', end_date: '2026-01-15' }],
    ['this_quarter', JAN_15, { start_date: '2026-01-01', end_date: '2026-01-15' }],
    ['last_quarter', FEB_15, { start_date: '2025-10-01', end_date: '2025-12-31' }],
    ['this_month', JAN_15, { start_date: '2026-01-01', end_date: '2026-01-15' }],
    ['last_month', JAN_15, { start_date: '2025-12-01', end_date: '2025-12-31' }],
    ['all_time', JAN_15, {}],
  ])('%s at %s', (period, now, expected) => {
    expect(getPeriodDates(period, now)).toEqual(expected)
  })

  it('gives All Time an explicit window on the commissions page', () => {
    expect(getCommissionPeriodDates('all_time', SEP_25)).toEqual({
      start_date: '1970-01-01',
      end_date: '2026-09-25',
    })
    expect(getCommissionPeriodDates('last_month', JAN_15)).toEqual({
      start_date: '2025-12-01',
      end_date: '2025-12-31',
    })
  })
})

describe('formatCloseQuarter', () => {
  it.each([
    ['2026-Q1', 'Q1 2026'],
    ['2026-Q4', 'Q4 2026'],
    ['not-a-quarter', 'not-a-quarter'],
  ])('%s → %s', (input, expected) => {
    expect(formatCloseQuarter(input)).toBe(expected)
  })
})

describe('describePayout', () => {
  it('uses the month label for a dated amount', () => {
    expect(describePayout({
      bucket: 'dated',
      payout_period: 'June 2026',
      payout_date: '2026-06-30',
      amount_cents: 15_000,
    })).toEqual({ label: 'June 2026', amount: 15_000 })
  })

  it('builds the month from the payout date when the period label is blank', () => {
    expect(describePayout({
      bucket: 'dated',
      payout_period: null,
      payout_date: '2026-06-30',
      amount_cents: 100,
    })).toEqual({ label: 'June 2026', amount: 100 })
  })

  it('labels a known undated amount as unscheduled', () => {
    expect(describePayout({
      bucket: 'unscheduled',
      payout_period: 'Unscheduled',
      payout_date: null,
      amount_cents: 15_000,
    })).toEqual({ label: 'Unscheduled (amount known)', amount: 15_000 })
    expect(describePayout({
      payout_period: null,
      payout_date: null,
      amount_cents: 100,
    })).toEqual({ label: 'Unscheduled (amount known)', amount: 100 })
  })

  it('uses the pending label and a null amount when the cents are unknown', () => {
    expect(describePayout({
      bucket: 'pending_billing_data',
      payout_period: null,
      payout_date: null,
      amount_cents: null,
    })).toEqual({ label: 'Pending billing data', amount: null })
  })
})
