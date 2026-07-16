import { describe, it, expect } from 'vitest'
import { findConflicts } from '@/lib/calendarConflicts'
import type { CalendarEvent } from '@/types'

function makeEvent(overrides: Partial<CalendarEvent> & { id: string; startIso: string; endIso: string }): CalendarEvent {
  const { startIso, endIso, ...rest } = overrides
  return {
    subject: 'Meeting',
    attendees: [],
    start: { dateTime: startIso, timeZone: 'UTC' },
    end: { dateTime: endIso, timeZone: 'UTC' },
    ...rest,
  }
}

const base = {
  proposed: {
    start: new Date('2026-07-14T10:00:00Z'),
    end: new Date('2026-07-14T11:00:00Z'),
  },
}

describe('findConflicts', () => {
  describe('overlap detection', () => {
    it('returns empty when no events exist', () => {
      expect(findConflicts(base.proposed, [])).toEqual([])
    })

    it('detects a fully contained overlap', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T10:15:00Z', endIso: '2026-07-14T10:45:00Z' })
      expect(findConflicts(base.proposed, [event])).toHaveLength(1)
    })

    it('detects a containing overlap (event wraps proposed)', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T09:00:00Z', endIso: '2026-07-14T12:00:00Z' })
      expect(findConflicts(base.proposed, [event])).toHaveLength(1)
    })

    it('detects a partial overlap at the start', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T09:30:00Z', endIso: '2026-07-14T10:30:00Z' })
      expect(findConflicts(base.proposed, [event])).toHaveLength(1)
    })

    it('detects a partial overlap at the end', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T10:30:00Z', endIso: '2026-07-14T11:30:00Z' })
      expect(findConflicts(base.proposed, [event])).toHaveLength(1)
    })
  })

  describe('boundary-touching events', () => {
    it('does NOT conflict when event ends exactly when proposed starts', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T09:00:00Z', endIso: '2026-07-14T10:00:00Z' })
      expect(findConflicts(base.proposed, [event])).toHaveLength(0)
    })

    it('does NOT conflict when event starts exactly when proposed ends', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T11:00:00Z', endIso: '2026-07-14T12:00:00Z' })
      expect(findConflicts(base.proposed, [event])).toHaveLength(0)
    })
  })

  describe('exclusions', () => {
    it('skips events with showAs === "free"', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T10:15:00Z', endIso: '2026-07-14T10:45:00Z', showAs: 'free' })
      expect(findConflicts(base.proposed, [event])).toHaveLength(0)
    })

    it('skips cancelled events', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T10:15:00Z', endIso: '2026-07-14T10:45:00Z', isCancelled: true })
      expect(findConflicts(base.proposed, [event])).toHaveLength(0)
    })

    it('skips the event matching excludeEventId', () => {
      const event = makeEvent({ id: 'self', startIso: '2026-07-14T10:00:00Z', endIso: '2026-07-14T11:00:00Z' })
      expect(findConflicts(base.proposed, [event], 'self')).toHaveLength(0)
    })

    it('still includes other overlapping events when excludeEventId is set', () => {
      const self = makeEvent({ id: 'self', startIso: '2026-07-14T10:00:00Z', endIso: '2026-07-14T11:00:00Z' })
      const other = makeEvent({ id: 'e2', startIso: '2026-07-14T10:30:00Z', endIso: '2026-07-14T11:30:00Z' })
      const result = findConflicts(base.proposed, [self, other], 'self')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('e2')
    })
  })

  describe('non-conflicting events not in exclusions', () => {
    it('does not flag non-overlapping busy events', () => {
      const before = makeEvent({ id: 'e1', startIso: '2026-07-14T08:00:00Z', endIso: '2026-07-14T09:00:00Z', showAs: 'busy' })
      const after = makeEvent({ id: 'e2', startIso: '2026-07-14T12:00:00Z', endIso: '2026-07-14T13:00:00Z', showAs: 'busy' })
      expect(findConflicts(base.proposed, [before, after])).toHaveLength(0)
    })

    it('includes overlapping tentative events', () => {
      const event = makeEvent({ id: 'e1', startIso: '2026-07-14T10:15:00Z', endIso: '2026-07-14T10:45:00Z', showAs: 'tentative' })
      expect(findConflicts(base.proposed, [event])).toHaveLength(1)
    })
  })
})
