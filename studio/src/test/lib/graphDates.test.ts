import { describe, it, expect } from 'vitest'
import { parseGraphDate, toUtcIso } from '@/lib/graphDates'

describe('parseGraphDate', () => {
  describe('designator-less strings (Graph calendarView UTC response)', () => {
    it('normalizes a bare datetime string to UTC', () => {
      const d = parseGraphDate('2026-06-27T10:00:00.0000000')
      expect(d.toISOString()).toBe('2026-06-27T10:00:00.000Z')
    })

    it('normalizes a datetime without fractional seconds to UTC', () => {
      const d = parseGraphDate('2026-07-14T15:30:00')
      expect(d.toISOString()).toBe('2026-07-14T15:30:00.000Z')
    })

    it('normalizes a datetime with seconds only (no fractions)', () => {
      const d = parseGraphDate('2026-07-14T09:00:00')
      expect(d.toISOString()).toBe('2026-07-14T09:00:00.000Z')
    })
  })

  describe('strings that already have a timezone designator', () => {
    it('leaves a Z-suffixed string unchanged', () => {
      const d = parseGraphDate('2026-06-27T10:00:00Z')
      expect(d.toISOString()).toBe('2026-06-27T10:00:00.000Z')
    })

    it('leaves a +00:00 offset string unchanged', () => {
      const d = parseGraphDate('2026-06-27T10:00:00+00:00')
      expect(d.toISOString()).toBe('2026-06-27T10:00:00.000Z')
    })

    it('leaves a negative offset string unchanged', () => {
      const d = parseGraphDate('2026-06-27T10:00:00-05:00')
      expect(d.toISOString()).toBe('2026-06-27T15:00:00.000Z')
    })
  })
})

describe('toUtcIso', () => {
  describe('DST-aware conversions (July is DST / summer time)', () => {
    it('converts ET wall clock to UTC (July: EDT = UTC-4)', () => {
      const result = toUtcIso('2026-07-14T10:00:00', 'America/New_York')
      expect(result).toBe('2026-07-14T14:00:00.000Z')
    })

    it('converts CT wall clock to UTC (July: CDT = UTC-5)', () => {
      const result = toUtcIso('2026-07-14T10:00:00', 'America/Chicago')
      expect(result).toBe('2026-07-14T15:00:00.000Z')
    })

    it('converts MT wall clock to UTC (July: MDT = UTC-6)', () => {
      const result = toUtcIso('2026-07-14T10:00:00', 'America/Denver')
      expect(result).toBe('2026-07-14T16:00:00.000Z')
    })

    it('converts PT wall clock to UTC (July: PDT = UTC-7)', () => {
      const result = toUtcIso('2026-07-14T10:00:00', 'America/Los_Angeles')
      expect(result).toBe('2026-07-14T17:00:00.000Z')
    })
  })

  describe('non-DST conversions (January is standard time)', () => {
    it('converts ET wall clock to UTC (January: EST = UTC-5)', () => {
      const result = toUtcIso('2026-01-14T10:00:00', 'America/New_York')
      expect(result).toBe('2026-01-14T15:00:00.000Z')
    })

    it('converts CT wall clock to UTC (January: CST = UTC-6)', () => {
      const result = toUtcIso('2026-01-14T10:00:00', 'America/Chicago')
      expect(result).toBe('2026-01-14T16:00:00.000Z')
    })
  })
})
