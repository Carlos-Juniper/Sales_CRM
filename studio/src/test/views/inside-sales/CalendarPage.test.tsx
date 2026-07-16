import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '@/test/utils'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import type { CalendarEvent } from '@/types'

// FullCalendar does not render meaningfully in jsdom — mock it globally
vi.mock('@fullcalendar/react', () => ({
  default: ({ datesSet }: { datesSet?: (arg: { startStr: string; endStr: string }) => void }) => {
    // fire datesSet once on mount so the page wires up the query range
    if (datesSet) {
      datesSet({ startStr: '2026-07-13T00:00:00', endStr: '2026-07-20T00:00:00' })
    }
    return <div data-testid="fullcalendar-mock" />
  },
}))
vi.mock('@fullcalendar/timegrid', () => ({ default: {} }))
vi.mock('@fullcalendar/interaction', () => ({ default: {} }))

// Parallel-agent components — expected to be missing modules; mock them here so
// CalendarPage can import them without blowing up the test suite.
vi.mock(
  '@/views/inside-sales/components/calendar/EventFormDialog',
  () => ({
    EventFormDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
      open ? (
        <div data-testid="event-form-dialog">
          <button onClick={() => onOpenChange(false)}>Close</button>
        </div>
      ) : null,
  }),
)
vi.mock(
  '@/views/inside-sales/components/calendar/EventDetailPopover',
  () => ({
    EventDetailPopover: ({
      event,
      onClose,
      onEdit,
    }: {
      event: { id: string; subject: string } | null
      onClose: () => void
      onEdit: (e: unknown) => void
    }) =>
      event ? (
        <div data-testid="event-detail-popover">
          <span>{event.subject}</span>
          <button onClick={onClose}>Close</button>
          <button onClick={() => onEdit(event)}>Edit</button>
        </div>
      ) : null,
  }),
)

const mockEvent: CalendarEvent = {
  id: 'evt1',
  subject: 'Site visit — Palm Grove HOA',
  start: { dateTime: '2026-07-14T14:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-07-14T15:00:00.0000000', timeZone: 'UTC' },
  attendees: [],
  isOrganizer: true,
  showAs: 'busy',
}

// Lazy import so mocks register before the module loads
async function importCalendarPage() {
  const mod = await import('@/views/inside-sales/CalendarPage')
  return mod.default
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser(), isLoading: false })
  server.use(http.get('/api/calendar/events', () => HttpResponse.json([mockEvent])))
  vi.resetModules()
})

describe('CalendarPage — timezone label', () => {
  it('shows a "Times shown in" label in the header', async () => {
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    expect(screen.getByText(/times shown in/i)).toBeInTheDocument()
  })
})

describe('CalendarPage — view toggle', () => {
  it('renders Week, 3-day, and Day toggle tabs', async () => {
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    expect(screen.getByRole('tab', { name: /week/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /3-day/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^day$/i })).toBeInTheDocument()
  })

  it('Week tab is selected by default on desktop (matchMedia returns false → not mobile)', async () => {
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    const weekTab = screen.getByRole('tab', { name: /week/i })
    expect(weekTab).toHaveAttribute('data-state', 'active')
  })

  it('switching to 3-day tab marks it active', async () => {
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    const threeDayTab = screen.getByRole('tab', { name: /3-day/i })
    await userEvent.click(threeDayTab)
    expect(threeDayTab).toHaveAttribute('data-state', 'active')
  })

  it('switching to Day tab marks it active', async () => {
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    const dayTab = screen.getByRole('tab', { name: /^day$/i })
    await userEvent.click(dayTab)
    expect(dayTab).toHaveAttribute('data-state', 'active')
  })
})

describe('CalendarPage — view toggle state persistence (module-level)', () => {
  it('view selection is remembered via module-level ref across re-renders', async () => {
    const CalendarPage = await importCalendarPage()
    const { unmount } = render(<CalendarPage />)
    const threeDayTab = screen.getByRole('tab', { name: /3-day/i })
    await userEvent.click(threeDayTab)
    expect(threeDayTab).toHaveAttribute('data-state', 'active')
    unmount()

    render(<CalendarPage />)
    expect(screen.getByRole('tab', { name: /3-day/i })).toHaveAttribute('data-state', 'active')
  })
})

describe('CalendarPage — 400 (Graph not connected) empty state', () => {
  it('shows the connect-account dashed-border empty state on 400', async () => {
    server.use(
      http.get('/api/calendar/events', () =>
        HttpResponse.json({ detail: 'Graph not connected' }, { status: 400 }),
      ),
    )
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    await waitFor(() => {
      expect(screen.getByText(/connect your microsoft account/i)).toBeInTheDocument()
    })
    const link = screen.getByRole('link', { name: /connect/i })
    expect(link).toHaveAttribute('href', '/inside-sales/settings/connections')
  })
})

describe('CalendarPage — 502 (Graph error) toast', () => {
  it('shows a retry button on 502', async () => {
    server.use(
      http.get('/api/calendar/events', () =>
        HttpResponse.json({ detail: 'Bad gateway' }, { status: 502 }),
      ),
    )
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
  })
})

describe('CalendarPage — EventFormDialog wiring', () => {
  it('dialog is closed initially', async () => {
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    expect(screen.queryByTestId('event-form-dialog')).not.toBeInTheDocument()
  })
})

describe('CalendarPage — EventDetailPopover wiring', () => {
  it('popover is closed initially', async () => {
    const CalendarPage = await importCalendarPage()
    render(<CalendarPage />)
    expect(screen.queryByTestId('event-detail-popover')).not.toBeInTheDocument()
  })
})
