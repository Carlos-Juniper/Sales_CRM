import { describe, it, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import { EventDetailPopover } from '@/views/inside-sales/components/calendar/EventDetailPopover'
import type { CalendarEvent } from '@/types'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt1',
    subject: 'Site visit — Palm Grove HOA',
    start: { dateTime: '2026-07-14T14:00:00Z', timeZone: 'UTC' },
    end: { dateTime: '2026-07-14T15:00:00Z', timeZone: 'UTC' },
    attendees: [{ emailAddress: { address: 'owner@palmgrove.com', name: 'Palm Owner' } }],
    isOrganizer: true,
    showAs: 'busy',
    webLink: 'https://outlook.office.com/event/evt1',
    onlineMeeting: { joinUrl: 'https://teams.microsoft.com/join/abc123' },
    ...overrides,
  }
}

function renderPopover(event: CalendarEvent | null, overrides: { onClose?: () => void; onEdit?: (e: CalendarEvent) => void } = {}) {
  const anchor = document.createElement('div')
  document.body.appendChild(anchor)
  return render(
    <EventDetailPopover
      event={event}
      anchorEl={anchor}
      onClose={overrides.onClose ?? vi.fn()}
      onEdit={overrides.onEdit ?? vi.fn()}
    />
  )
}

describe('EventDetailPopover — closed state', () => {
  it('renders nothing when event is null', () => {
    const { container } = renderPopover(null)
    expect(container.firstChild).toBeNull()
  })
})

describe('EventDetailPopover — organizer view', () => {
  it('displays event subject', () => {
    renderPopover(makeEvent())
    expect(screen.getByText('Site visit — Palm Grove HOA')).toBeInTheDocument()
  })

  it('displays formatted time range', () => {
    renderPopover(makeEvent())
    const content = document.body.textContent ?? ''
    expect(content).toMatch(/\d{1,2}:\d{2}/)
  })

  it('shows attendee email addresses', () => {
    renderPopover(makeEvent())
    expect(screen.getByText(/owner@palmgrove\.com|Palm Owner/)).toBeInTheDocument()
  })

  it('shows Teams join button when onlineMeeting.joinUrl is present', () => {
    renderPopover(makeEvent())
    const joinBtn = screen.getByRole('link', { name: /join teams/i })
    expect(joinBtn).toHaveAttribute('href', 'https://teams.microsoft.com/join/abc123')
  })

  it('shows "Open in Outlook" link pointing to webLink', () => {
    renderPopover(makeEvent())
    const outlookLink = screen.getByRole('link', { name: /open in outlook/i })
    expect(outlookLink).toHaveAttribute('href', 'https://outlook.office.com/event/evt1')
    expect(outlookLink).toHaveAttribute('target', '_blank')
  })

  it('shows Edit button for organizer', () => {
    renderPopover(makeEvent())
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
  })

  it('shows Delete button for organizer', () => {
    renderPopover(makeEvent())
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('calls onEdit with the event when Edit is clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const event = makeEvent()
    renderPopover(event, { onEdit })
    await user.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(event)
  })

  it('calls useDeleteCalendarEvent and then onClose after confirming delete', async () => {
    const user = userEvent.setup()
    let deleteCalled = false
    server.use(
      http.delete('/api/calendar/events/evt1', async () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      })
    )
    const onClose = vi.fn()
    renderPopover(makeEvent(), { onClose })

    await user.click(screen.getByRole('button', { name: /delete/i }))

    const confirmBtn = await screen.findByRole('button', { name: /confirm|yes/i })
    await user.click(confirmBtn)

    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('does not delete when cancel is clicked in confirm dialog', async () => {
    const user = userEvent.setup()
    let deleteCalled = false
    server.use(
      http.delete('/api/calendar/events/evt1', async () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      })
    )
    renderPopover(makeEvent())

    await user.click(screen.getByRole('button', { name: /delete/i }))
    const cancelBtn = await screen.findByRole('button', { name: /cancel/i })
    await user.click(cancelBtn)

    expect(deleteCalled).toBe(false)
  })
})

describe('EventDetailPopover — attendee view (not organizer)', () => {
  it('does not show Edit button for non-organizer', () => {
    renderPopover(makeEvent({ isOrganizer: false }))
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  it('does not show Delete button for non-organizer', () => {
    renderPopover(makeEvent({ isOrganizer: false }))
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('still shows Teams join link for attendee', () => {
    renderPopover(makeEvent({ isOrganizer: false }))
    expect(screen.getByRole('link', { name: /join teams/i })).toBeInTheDocument()
  })

  it('still shows Open in Outlook link for attendee', () => {
    renderPopover(makeEvent({ isOrganizer: false }))
    expect(screen.getByRole('link', { name: /open in outlook/i })).toBeInTheDocument()
  })
})

describe('EventDetailPopover — optional fields', () => {
  it('does not render Teams button when onlineMeeting is absent', () => {
    renderPopover(makeEvent({ onlineMeeting: null }))
    expect(screen.queryByRole('link', { name: /join teams/i })).not.toBeInTheDocument()
  })

  it('does not render Open in Outlook when webLink is absent', () => {
    renderPopover(makeEvent({ webLink: undefined }))
    expect(screen.queryByRole('link', { name: /open in outlook/i })).not.toBeInTheDocument()
  })
})
