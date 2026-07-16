import { describe, it, expect } from 'vitest'
import { calendarEventToInput } from '@/views/inside-sales/components/calendar/CalendarGrid'
import type { CalendarEvent } from '@/types'

const base: CalendarEvent = {
  id: 'evt1',
  subject: 'Site visit — Palm Grove HOA',
  start: { dateTime: '2026-07-14T14:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-07-14T15:00:00.0000000', timeZone: 'UTC' },
  attendees: [],
  isOrganizer: true,
  showAs: 'busy',
}

describe('calendarEventToInput — Graph date normalization', () => {
  it('appends Z to a designator-less UTC datetime so it parses as UTC', () => {
    const input = calendarEventToInput(base)
    // With 'Z' appended, 14:00:00 UTC → any local parse is the same instant
    expect(input.start).toBeInstanceOf(Date)
    expect(input.end).toBeInstanceOf(Date)
    const start = input.start as Date
    expect(start.toISOString()).toBe('2026-07-14T14:00:00.000Z')
  })

  it('does not double-append Z when a designator is already present', () => {
    const event: CalendarEvent = {
      ...base,
      start: { dateTime: '2026-07-14T14:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-07-14T15:00:00Z', timeZone: 'UTC' },
    }
    const input = calendarEventToInput(event)
    const start = input.start as Date
    expect(start.toISOString()).toBe('2026-07-14T14:00:00.000Z')
  })

  it('handles +offset datetime strings (timezone designator present)', () => {
    const event: CalendarEvent = {
      ...base,
      start: { dateTime: '2026-07-14T10:00:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-07-14T11:00:00-04:00', timeZone: 'America/New_York' },
    }
    const input = calendarEventToInput(event)
    const start = input.start as Date
    expect(start.toISOString()).toBe('2026-07-14T14:00:00.000Z')
  })
})

describe('calendarEventToInput — classNames', () => {
  it('gives organizer events the brand green class', () => {
    const input = calendarEventToInput({ ...base, isOrganizer: true })
    expect(input.classNames).toContain('fc-event-organizer')
  })

  it('gives attendee-only events the brand green class too', () => {
    const input = calendarEventToInput({ ...base, isOrganizer: false })
    expect(input.classNames).toContain('fc-event-organizer')
  })

  it('gives the brand green class when isOrganizer is undefined', () => {
    const event: CalendarEvent = { ...base }
    delete event.isOrganizer
    const input = calendarEventToInput(event)
    expect(input.classNames).toContain('fc-event-organizer')
  })
})

describe('calendarEventToInput — extendedProps', () => {
  it('stashes the raw event in extendedProps.raw', () => {
    const input = calendarEventToInput(base)
    expect(input.extendedProps?.raw).toEqual(base)
  })

  it('propagates isOrganizer into extendedProps', () => {
    const input = calendarEventToInput(base)
    expect(input.extendedProps?.isOrganizer).toBe(true)
  })
})

describe('calendarEventToInput — id / title', () => {
  it('maps id and subject correctly', () => {
    const input = calendarEventToInput(base)
    expect(input.id).toBe('evt1')
    expect(input.title).toBe('Site visit — Palm Grove HOA')
  })
})
