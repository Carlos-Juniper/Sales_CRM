import { describe, it, expect } from 'vitest'
import {
  cn,
  formatCurrency,
  formatDate,
  formatRelativeTime,
  daysUntil,
  getInitials,
  formatCompact,
  scoreToColor,
} from '@/lib/utils'

describe('cn — class name merging', () => {
  it('merges multiple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('deduplicates conflicting Tailwind classes (last wins)', () => {
    const result = cn('text-red-500', 'text-blue-500')
    expect(result).toBe('text-blue-500')
  })

  it('handles conditional objects', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })

  it('ignores falsy values', () => {
    expect(cn('a', undefined, null, false, 'b')).toBe('a b')
  })

  it('returns empty string for no args', () => {
    expect(cn()).toBe('')
  })
})

describe('formatCurrency', () => {
  it('formats millions with one decimal', () => {
    expect(formatCurrency(1_500_000)).toBe('$1.5M')
  })

  it('formats exactly 1 million', () => {
    expect(formatCurrency(1_000_000)).toBe('$1.0M')
  })

  it('formats thousands rounded to nearest K', () => {
    expect(formatCurrency(420_000)).toBe('$420K')
  })

  it('formats 1000 as $1K', () => {
    expect(formatCurrency(1_000)).toBe('$1K')
  })

  it('formats sub-thousand with dollar sign', () => {
    expect(formatCurrency(500)).toBe('$500')
  })

  it('formats 0 as $0', () => {
    expect(formatCurrency(0)).toBe('$0')
  })
})

describe('formatDate', () => {
  it('formats a valid ISO date string', () => {
    const result = formatDate('2025-03-15T00:00:00.000Z')
    expect(result).toMatch(/Mar/)
    expect(result).toMatch(/2025/)
  })

  it('includes the day number', () => {
    // Use a mid-month date to avoid UTC→local timezone boundary issues
    const result = formatDate('2025-06-15T12:00:00.000Z')
    expect(result).toMatch(/Jun/)
    expect(result).toMatch(/15/)
  })

  it('returns a string for any valid ISO input', () => {
    expect(typeof formatDate(new Date().toISOString())).toBe('string')
  })
})

describe('formatRelativeTime', () => {
  it('returns "Just now" for times less than 1 hour ago', () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    expect(formatRelativeTime(recent)).toBe('Just now')
  })

  it('returns Xh ago for hours within the same day', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago')
  })

  it('returns "Yesterday" for 1 day ago', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(yesterday)).toBe('Yesterday')
  })

  it('returns Xd ago for 2–6 days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago')
  })

  it('returns Xw ago for 7–29 days', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(twoWeeksAgo)).toBe('2w ago')
  })

  it('returns a formatted date for 30+ days ago', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    const result = formatRelativeTime(old)
    expect(result).not.toMatch(/ago/)
    expect(result).not.toBe('Just now')
  })
})

describe('daysUntil', () => {
  it('returns 0 for today', () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    expect(daysUntil(today.toISOString())).toBe(0)
  })

  it('returns positive number for future dates', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    expect(daysUntil(future)).toBeGreaterThan(0)
  })

  it('returns negative number for past dates', () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(daysUntil(past)).toBeLessThan(0)
  })
})

describe('getInitials', () => {
  it('returns first two initials uppercased', () => {
    expect(getInitials('Carlos Hernandez')).toBe('CH')
  })

  it('returns single initial for single name', () => {
    expect(getInitials('Carlos')).toBe('C')
  })

  it('uses only first two words', () => {
    expect(getInitials('John Michael Smith')).toBe('JM')
  })
})

describe('formatCompact', () => {
  it('formats millions compactly', () => {
    expect(formatCompact(1_500_000)).toBe('$1.5M')
  })

  it('strips trailing .0 from millions', () => {
    expect(formatCompact(2_000_000)).toBe('$2M')
  })

  it('formats thousands rounded', () => {
    expect(formatCompact(185_000)).toBe('$185k')
  })

  it('formats sub-thousand directly', () => {
    expect(formatCompact(999)).toBe('$999')
  })

  it('formats 0', () => {
    expect(formatCompact(0)).toBe('$0')
  })
})

describe('scoreToColor', () => {
  it('score 75+ returns green', () => {
    expect(scoreToColor(75)).toBe('#2E7D52')
    expect(scoreToColor(100)).toBe('#2E7D52')
    expect(scoreToColor(90)).toBe('#2E7D52')
  })

  it('score 50–74 returns amber', () => {
    expect(scoreToColor(50)).toBe('#D97706')
    expect(scoreToColor(74)).toBe('#D97706')
    expect(scoreToColor(60)).toBe('#D97706')
  })

  it('score 25–49 returns orange', () => {
    expect(scoreToColor(25)).toBe('#EA580C')
    expect(scoreToColor(49)).toBe('#EA580C')
  })

  it('score 0–24 returns red', () => {
    expect(scoreToColor(0)).toBe('#DC2626')
    expect(scoreToColor(24)).toBe('#DC2626')
  })

  it('boundary: 74 is amber, 75 is green', () => {
    expect(scoreToColor(74)).toBe('#D97706')
    expect(scoreToColor(75)).toBe('#2E7D52')
  })

  it('boundary: 49 is orange, 50 is amber', () => {
    expect(scoreToColor(49)).toBe('#EA580C')
    expect(scoreToColor(50)).toBe('#D97706')
  })

  it('boundary: 24 is red, 25 is orange', () => {
    expect(scoreToColor(24)).toBe('#DC2626')
    expect(scoreToColor(25)).toBe('#EA580C')
  })
})
