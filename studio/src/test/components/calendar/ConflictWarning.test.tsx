import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { ConflictWarning } from '@/views/inside-sales/components/calendar/ConflictWarning'
import type { CalendarEvent } from '@/types'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt1',
    subject: 'Site visit — Palm Grove HOA',
    start: { dateTime: '2026-07-14T14:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-07-14T15:00:00.0000000', timeZone: 'UTC' },
    attendees: [],
    isOrganizer: true,
    showAs: 'busy',
    ...overrides,
  }
}

describe('ConflictWarning', () => {
  it('renders nothing when conflicts array is empty', () => {
    const { container } = render(<ConflictWarning conflicts={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders amber warning with conflict subject', () => {
    render(<ConflictWarning conflicts={[makeEvent()]} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Site visit — Palm Grove HOA/)).toBeInTheDocument()
  })

  it('includes the time range of the conflicting event', () => {
    render(<ConflictWarning conflicts={[makeEvent()]} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/\d{1,2}:\d{2}/)
  })

  it('renders multiple conflicts', () => {
    const conflicts = [
      makeEvent({ id: 'e1', subject: 'Event A' }),
      makeEvent({ id: 'e2', subject: 'Event B' }),
    ]
    render(<ConflictWarning conflicts={conflicts} />)
    expect(screen.getByText(/Event A/)).toBeInTheDocument()
    expect(screen.getByText(/Event B/)).toBeInTheDocument()
  })

  it('has amber styling', () => {
    const { container } = render(<ConflictWarning conflicts={[makeEvent()]} />)
    const alert = container.querySelector('[role="alert"]') as HTMLElement
    expect(alert.className).toMatch(/amber/)
  })
})
