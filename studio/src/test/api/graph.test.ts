import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { graphApi } from '@/api/graph'
import type { CalendarEvent } from '@/types'

const _SAMPLE_EVENT: CalendarEvent = {
  id: 'evt-001',
  subject: 'Site walkthrough',
  start: { dateTime: '2026-06-27T10:00:00', timeZone: 'UTC' },
  end: { dateTime: '2026-06-27T11:00:00', timeZone: 'UTC' },
  attendees: [{ emailAddress: { address: 'jennifer@silverleafhoa.org' } }],
  onlineMeeting: null,
}

describe('graphApi.listEvents', () => {
  it('GET /api/calendar/events with correct query params', async () => {
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/calendar/events', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json([_SAMPLE_EVENT])
      }),
    )

    const events = await graphApi.listEvents('2026-06-27T00:00:00Z', '2026-06-28T00:00:00Z')

    expect(events).toHaveLength(1)
    expect(events[0].id).toBe('evt-001')
    expect(capturedUrl?.searchParams.get('start')).toBe('2026-06-27T00:00:00Z')
    expect(capturedUrl?.searchParams.get('end')).toBe('2026-06-28T00:00:00Z')
  })

  it('returns empty array when no events', async () => {
    server.use(http.get('/api/calendar/events', () => HttpResponse.json([])))
    const events = await graphApi.listEvents('2026-06-27T00:00:00Z', '2026-06-28T00:00:00Z')
    expect(events).toEqual([])
  })
})

describe('graphApi.createEvent', () => {
  it('POST /api/calendar/events and return created event', async () => {
    server.use(
      http.post('/api/calendar/events', () => HttpResponse.json({ ..._SAMPLE_EVENT, id: 'new-evt' })),
    )

    const event = await graphApi.createEvent({
      subject: 'Site walkthrough',
      start_iso: '2026-06-27T10:00:00Z',
      end_iso: '2026-06-27T11:00:00Z',
      attendees: ['jennifer@silverleafhoa.org'],
      online_meeting: true,
    })

    expect(event.id).toBe('new-evt')
  })
})

describe('graphApi.scheduleMeeting', () => {
  it('POST /api/leads/:id/schedule-meeting and return event + lead_id', async () => {
    server.use(
      http.post('/api/leads/lead-uuid-1/schedule-meeting', () =>
        HttpResponse.json({ event: _SAMPLE_EVENT, lead_id: 'lead-uuid-1' }),
      ),
    )

    const result = await graphApi.scheduleMeeting('lead-uuid-1', {
      subject: 'Proposal meeting',
      start_iso: '2026-06-28T14:00:00Z',
      end_iso: '2026-06-28T15:00:00Z',
    })

    expect(result.lead_id).toBe('lead-uuid-1')
    expect(result.event.id).toBe('evt-001')
  })
})
