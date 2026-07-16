import { describe, it, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import { EventFormDialog } from '@/views/inside-sales/components/calendar/EventFormDialog'
import type { CalendarEvent } from '@/types'
import { getBrowserTimezone, resolveToSupportedTimezone, TIMEZONE_OPTIONS } from '@/lib/timezones'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt1',
    subject: 'Site visit — Palm Grove HOA',
    start: { dateTime: '2026-07-14T14:00:00Z', timeZone: 'UTC' },
    end: { dateTime: '2026-07-14T15:00:00Z', timeZone: 'UTC' },
    attendees: [{ emailAddress: { address: 'owner@example.com' } }],
    isOrganizer: true,
    showAs: 'busy',
    ...overrides,
  }
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  events: [] as CalendarEvent[],
}

describe('EventFormDialog — timezone default', () => {
  it('defaults timezone select to the browser zone (mapped to nearest supported)', () => {
    render(<EventFormDialog {...defaultProps} />)
    const browserTz = resolveToSupportedTimezone(getBrowserTimezone())
    const expected = TIMEZONE_OPTIONS.find((o) => o.value === browserTz)!.label
    expect(screen.getByRole('combobox', { name: /timezone/i })).toHaveTextContent(expected)
  })
})

describe('EventFormDialog — create mode validation', () => {
  it('submit button is disabled when subject is empty', async () => {
    render(<EventFormDialog {...defaultProps} />)
    const submit = screen.getByRole('button', { name: /schedule|create/i })
    expect(submit).toBeDisabled()
  })

  it('shows validation error when end time is before start time', async () => {
    const user = userEvent.setup()
    render(<EventFormDialog {...defaultProps} />)

    await user.type(screen.getByLabelText(/subject/i), 'Test Meeting')

    const dateInput = screen.getByLabelText(/date/i)
    await user.type(dateInput, '2026-07-20')

    const startTime = screen.getByTestId('start-time')
    const endTime = screen.getByTestId('end-time')

    await user.clear(startTime)
    await user.type(startTime, '11:00')
    await user.clear(endTime)
    await user.type(endTime, '10:00')

    const submit = screen.getByRole('button', { name: /schedule|create/i })
    await user.click(submit)

    expect(screen.getByText(/end.*after.*start|start.*before.*end/i)).toBeInTheDocument()
  })

  it('submit is enabled when subject, date, and valid times are filled', async () => {
    const user = userEvent.setup()
    render(<EventFormDialog {...defaultProps} />)

    await user.type(screen.getByLabelText(/subject/i), 'Budget Review')

    const dateInput = screen.getByLabelText(/date/i)
    await user.type(dateInput, '2026-07-20')

    const startTime = screen.getByTestId('start-time')
    const endTime = screen.getByTestId('end-time')
    await user.clear(startTime)
    await user.type(startTime, '10:00')
    await user.clear(endTime)
    await user.type(endTime, '11:00')

    expect(screen.getByRole('button', { name: /schedule|create/i })).not.toBeDisabled()
  })
})

describe('EventFormDialog — conflict warning', () => {
  it('shows ConflictWarning when proposed slot overlaps an existing event', async () => {
    const user = userEvent.setup()
    const busyEvent = makeEvent({
      id: 'busy1',
      subject: 'Existing Busy Meeting',
      start: { dateTime: '2026-07-20T14:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-07-20T15:00:00Z', timeZone: 'UTC' },
      showAs: 'busy',
    })
    render(<EventFormDialog {...defaultProps} events={[busyEvent]} />)

    await user.type(screen.getByLabelText(/subject/i), 'New Meeting')

    const dateInput = screen.getByLabelText(/date/i)
    await user.type(dateInput, '2026-07-20')

    const startTime = screen.getByTestId('start-time')
    const endTime = screen.getByTestId('end-time')
    await user.clear(startTime)
    await user.type(startTime, '14:00')
    await user.clear(endTime)
    await user.type(endTime, '15:00')

    await waitFor(() => {
      expect(screen.getByText(/Existing Busy Meeting/)).toBeInTheDocument()
    })
  })

  it('does not warn for a free event overlap', async () => {
    const user = userEvent.setup()
    const freeEvent = makeEvent({
      id: 'free1',
      subject: 'Free Time Block',
      start: { dateTime: '2026-07-20T14:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-07-20T15:00:00Z', timeZone: 'UTC' },
      showAs: 'free',
    })
    render(<EventFormDialog {...defaultProps} events={[freeEvent]} />)

    await user.type(screen.getByLabelText(/subject/i), 'Another Meeting')
    await user.type(screen.getByLabelText(/date/i), '2026-07-20')

    const startTime = screen.getByTestId('start-time')
    const endTime = screen.getByTestId('end-time')
    await user.clear(startTime)
    await user.type(startTime, '14:00')
    await user.clear(endTime)
    await user.type(endTime, '15:00')

    expect(screen.queryByText(/Free Time Block/)).not.toBeInTheDocument()
  })

  it('submit remains enabled even when conflict warning is shown', async () => {
    const user = userEvent.setup()
    const busyEvent = makeEvent({
      id: 'busy2',
      start: { dateTime: '2026-07-20T14:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-07-20T15:00:00Z', timeZone: 'UTC' },
      showAs: 'busy',
    })
    render(<EventFormDialog {...defaultProps} events={[busyEvent]} />)

    await user.type(screen.getByLabelText(/subject/i), 'Overlapping')
    await user.type(screen.getByLabelText(/date/i), '2026-07-20')

    const startTime = screen.getByTestId('start-time')
    const endTime = screen.getByTestId('end-time')
    await user.clear(startTime)
    await user.type(startTime, '14:00')
    await user.clear(endTime)
    await user.type(endTime, '15:00')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /schedule|create/i })).not.toBeDisabled()
  })
})

describe('EventFormDialog — edit mode', () => {
  it('prefills fields from the event prop', () => {
    const event = makeEvent()
    render(<EventFormDialog {...defaultProps} event={event} />)
    expect(screen.getByDisplayValue('Site visit — Palm Grove HOA')).toBeInTheDocument()
  })

  it('shows occurrence-only note for occurrence events', () => {
    const event = makeEvent({ type: 'occurrence' })
    render(<EventFormDialog {...defaultProps} event={event} />)
    expect(screen.getByText(/this occurrence only/i)).toBeInTheDocument()
  })

  it('shows occurrence-only note for exception events', () => {
    const event = makeEvent({ type: 'exception' })
    render(<EventFormDialog {...defaultProps} event={event} />)
    expect(screen.getByText(/this occurrence only/i)).toBeInTheDocument()
  })

  it('does not show occurrence note for singleInstance events', () => {
    const event = makeEvent({ type: 'singleInstance' })
    render(<EventFormDialog {...defaultProps} event={event} />)
    expect(screen.queryByText(/this occurrence only/i)).not.toBeInTheDocument()
  })

  it('excludes the edited event from conflict detection', async () => {
    const user = userEvent.setup()
    const event = makeEvent({
      id: 'self',
      subject: 'Self Event',
      start: { dateTime: '2026-07-20T14:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-07-20T15:00:00Z', timeZone: 'UTC' },
      showAs: 'busy',
    })
    render(<EventFormDialog {...defaultProps} events={[event]} event={event} />)

    await user.clear(screen.getByLabelText(/subject/i))
    await user.type(screen.getByLabelText(/subject/i), 'Self Event Renamed')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('fires useUpdateCalendarEvent on submit in edit mode', async () => {
    const user = userEvent.setup()
    let patchCalled = false
    server.use(
      http.patch('/api/calendar/events/evt1', async () => {
        patchCalled = true
        return HttpResponse.json(makeEvent({ subject: 'Updated' }))
      })
    )

    const event = makeEvent()
    render(<EventFormDialog {...defaultProps} event={event} />)

    await user.clear(screen.getByLabelText(/subject/i))
    await user.type(screen.getByLabelText(/subject/i), 'Updated Subject')
    await user.click(screen.getByRole('button', { name: /save|update/i }))

    await waitFor(() => expect(patchCalled).toBe(true))
  })
})

describe('EventFormDialog — create mode submit', () => {
  it('fires useCreateCalendarEvent on submit', async () => {
    const user = userEvent.setup()
    let postBody: unknown
    server.use(
      http.post('/api/calendar/events', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 'newevt', subject: 'New', start: { dateTime: '2026-07-20T15:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-07-20T16:00:00Z', timeZone: 'UTC' }, attendees: [], isOrganizer: true }, { status: 201 })
      })
    )

    render(<EventFormDialog {...defaultProps} />)
    await user.type(screen.getByLabelText(/subject/i), 'New Meeting')
    await user.type(screen.getByLabelText(/date/i), '2026-07-20')

    const startTime = screen.getByTestId('start-time')
    const endTime = screen.getByTestId('end-time')
    await user.clear(startTime)
    await user.type(startTime, '10:00')
    await user.clear(endTime)
    await user.type(endTime, '11:00')

    await user.click(screen.getByRole('button', { name: /schedule|create/i }))
    await waitFor(() => expect(postBody).toBeDefined())
    expect((postBody as Record<string, unknown>).subject).toBe('New Meeting')
  })
})

describe('EventFormDialog — leadMode', () => {
  it('pre-chips contact_email when leadMode is set', () => {
    render(
      <EventFormDialog
        {...defaultProps}
        leadMode={{ leadId: 'lead1', contactEmail: 'client@example.com' }}
      />
    )
    expect(screen.getByText('client@example.com')).toBeInTheDocument()
  })

  it('fires useScheduleMeeting (not useCreateCalendarEvent) when leadMode is set', async () => {
    const user = userEvent.setup()
    let scheduleCalled = false
    server.use(
      http.post('/api/leads/lead1/schedule-meeting', async () => {
        scheduleCalled = true
        return HttpResponse.json({ event: makeEvent(), lead_id: 'lead1' })
      })
    )

    render(
      <EventFormDialog
        {...defaultProps}
        leadMode={{ leadId: 'lead1', contactEmail: 'client@example.com' }}
      />
    )

    await user.type(screen.getByLabelText(/subject/i), 'Lead Meeting')
    await user.type(screen.getByLabelText(/date/i), '2026-07-20')

    const startTime = screen.getByTestId('start-time')
    const endTime = screen.getByTestId('end-time')
    await user.clear(startTime)
    await user.type(startTime, '10:00')
    await user.clear(endTime)
    await user.type(endTime, '11:00')

    await user.click(screen.getByRole('button', { name: /schedule/i }))
    await waitFor(() => expect(scheduleCalled).toBe(true))
  })

  it('allows removing the pre-chipped contact email', async () => {
    const user = userEvent.setup()
    render(
      <EventFormDialog
        {...defaultProps}
        leadMode={{ leadId: 'lead1', contactEmail: 'client@example.com' }}
      />
    )
    const removeBtn = screen.getByRole('button', { name: /remove client@example\.com/i })
    await user.click(removeBtn)
    expect(screen.queryByText('client@example.com')).not.toBeInTheDocument()
  })
})
