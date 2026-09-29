import { describe, expect, it } from 'vitest'
import {
  formatCloseQuarter,
  getCommissionPeriodDates,
  getPeriodDates,
  payoutAmountLabel,
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

describe('payoutAmountLabel', () => {
  it('formats a known amount and a partial sum', () => {
    expect(payoutAmountLabel({ amount_cents: 15_000 })).toBe('$150.00')
    expect(payoutAmountLabel({ amount_cents: 15_000, amount_partial: true })).toBe('$150.00 + pending')
  })

  it('does not invent dollars when the amount is null', () => {
    expect(payoutAmountLabel({ amount_cents: null })).toBe('Pending billing data')
  })
})
