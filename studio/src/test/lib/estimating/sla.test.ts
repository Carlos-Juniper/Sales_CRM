// ---------------------------------------------------------------------------
// SLA helpers (BRD I-6.2: 14-calendar-day minimum return window).
// The "at risk" threshold is CONFIG, never hardcoded in views.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  SLA_CONFIG,
  businessDateOnly,
  calendarDaysOut,
  defaultDueBackDate,
  isPastCalendarDate,
  isRushWindowDate,
  localDateOnly,
  slaCountdownLabel,
  slaDaysLeft,
  slaStateFor,
  type SlaConfig,
} from '@/lib/estimating/sla'

const DAY = 86400000
const NOW = new Date('2026-07-23T10:30:00')

function isoInDays(n: number): string {
  return new Date(NOW.getTime() + n * DAY).toISOString()
}

describe('SLA config (BRD I-6.2)', () => {
  it('encodes the 14-calendar-day return window', () => {
    expect(SLA_CONFIG.returnWindowDays).toBe(14)
  })

  it('has a positive at-risk threshold inside the window', () => {
    expect(SLA_CONFIG.atRiskThresholdDays).toBeGreaterThan(0)
    expect(SLA_CONFIG.atRiskThresholdDays).toBeLessThan(SLA_CONFIG.returnWindowDays)
  })
})

describe('slaDaysLeft', () => {
  it('counts whole calendar days until the due-back date', () => {
    expect(slaDaysLeft(isoInDays(10), NOW)).toBe(10)
    expect(slaDaysLeft(isoInDays(1), NOW)).toBe(1)
  })

  it('is 0 on the due-back day regardless of time of day', () => {
    expect(slaDaysLeft(new Date('2026-07-23T23:59:00').toISOString(), NOW)).toBe(0)
    expect(slaDaysLeft(new Date('2026-07-23T00:01:00').toISOString(), NOW)).toBe(0)
  })

  it('goes negative once the due-back date has passed', () => {
    expect(slaDaysLeft(isoInDays(-3), NOW)).toBe(-3)
  })
})

describe('slaStateFor', () => {
  const config: SlaConfig = { returnWindowDays: 14, atRiskThresholdDays: 4 }

  it('is ok when more days remain than the config threshold', () => {
    expect(slaStateFor(10, config)).toBe('ok')
    expect(slaStateFor(5, config)).toBe('ok')
  })

  it('is at_risk at or below the config threshold (inclusive), down to due today', () => {
    expect(slaStateFor(4, config)).toBe('at_risk')
    expect(slaStateFor(1, config)).toBe('at_risk')
    expect(slaStateFor(0, config)).toBe('at_risk')
  })

  it('is breached once days-left is negative', () => {
    expect(slaStateFor(-1, config)).toBe('breached')
  })

  it('reads the threshold from config, not a literal', () => {
    expect(slaStateFor(4, { returnWindowDays: 14, atRiskThresholdDays: 2 })).toBe('ok')
    expect(slaStateFor(2, { returnWindowDays: 14, atRiskThresholdDays: 2 })).toBe('at_risk')
  })

  it('defaults to SLA_CONFIG when no config given', () => {
    expect(slaStateFor(SLA_CONFIG.atRiskThresholdDays)).toBe('at_risk')
    expect(slaStateFor(SLA_CONFIG.atRiskThresholdDays + 1)).toBe('ok')
  })
})

describe('slaCountdownLabel', () => {
  it('renders "Xd left" when ok', () => {
    expect(slaCountdownLabel(10, 'ok')).toBe('10d left')
  })

  it('renders "Xd left — SLA risk" when at risk', () => {
    expect(slaCountdownLabel(2, 'at_risk')).toBe('2d left — SLA risk')
  })

  it('renders "Due today — SLA risk" on the due day', () => {
    expect(slaCountdownLabel(0, 'at_risk')).toBe('Due today — SLA risk')
  })

  it('renders "Xd overdue — SLA breached" when breached', () => {
    expect(slaCountdownLabel(-3, 'breached')).toBe('3d overdue — SLA breached')
  })
})

describe('local calendar dates', () => {
  const today = '2026-09-24'

  it('formats the local calendar date rather than the UTC instant', () => {
    const local = new Date(2026, 0, 1, 23, 30, 0)
    const month = String(local.getMonth() + 1).padStart(2, '0')
    const day = String(local.getDate()).padStart(2, '0')
    expect(localDateOnly(local)).toBe(`${local.getFullYear()}-${month}-${day}`)
  })

  it('counts calendar days without parsing YYYY-MM-DD as UTC midnight', () => {
    expect(calendarDaysOut('2026-09-24', today)).toBe(0)
    expect(calendarDaysOut('2026-09-23', today)).toBe(-1)
    expect(calendarDaysOut('2026-10-08', today)).toBe(14)
    expect(isPastCalendarDate('2026-09-23', today)).toBe(true)
    expect(isPastCalendarDate('2026-09-24', today)).toBe(false)
  })

  it('treats today through window-1 as a rush and the window boundary as not', () => {
    expect(isRushWindowDate('2026-09-24', 14, today)).toBe(true)
    expect(isRushWindowDate('2026-10-07', 14, today)).toBe(true)
    expect(isRushWindowDate('2026-10-08', 14, today)).toBe(false)
    expect(isRushWindowDate('2026-09-23', 14, today)).toBe(false)
    expect(isRushWindowDate('', 14, today)).toBe(false)
  })
})

describe('business timezone today', () => {
  // 23:30 Eastern is 03:30 UTC the next day. A same-day date is not past,
  // and a blank needed-back date lands on the SLA boundary, not today.
  const evening = new Date('2026-09-25T03:30:00Z')

  it('uses America/New_York when UTC has already rolled to the next day', () => {
    expect(businessDateOnly(evening)).toBe('2026-09-24')
    expect(isPastCalendarDate('2026-09-24', businessDateOnly(evening))).toBe(false)
    expect(isRushWindowDate('2026-09-24', 14, businessDateOnly(evening))).toBe(true)
  })

  it('defaults a blank needed-back date to today plus the return window', () => {
    expect(defaultDueBackDate(14, businessDateOnly(evening))).toBe('2026-10-08')
    expect(defaultDueBackDate(7, '2026-09-24')).toBe('2026-10-01')
    expect(isRushWindowDate(defaultDueBackDate(14, '2026-09-24'), 14, '2026-09-24')).toBe(false)
    expect(defaultDueBackDate(Number.NaN, '2026-09-24')).toBe('2026-10-08')
  })
})
