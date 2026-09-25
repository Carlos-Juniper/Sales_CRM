// Rep picker is limited to REP_SELECTOR_ROLES (api/authz.py REP_VIEWER_ROLES).
// Non-viewers must not render the picker and must not call GET /commissions/reps
// (that route 403s). Summary and list load with no user_id so the API auto-scopes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import CommissionsPage from '@/views/inside-sales/CommissionsPage'
import type { UserRole } from '@/types'

window.HTMLElement.prototype.hasPointerCapture = vi.fn()
window.HTMLElement.prototype.releasePointerCapture = vi.fn()
window.HTMLElement.prototype.scrollIntoView = vi.fn()

function trackRequests() {
  const calls: string[] = []
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/commissions')) {
      calls.push(`${url.pathname}${url.search}`)
    }
  }
  server.events.on('request:start', listener)
  return {
    calls,
    unsubscribe: () => server.events.removeListener('request:start', listener),
  }
}

function seed(role: UserRole) {
  useAuthStore.setState({ user: makeUser({ role }), isLoading: false })
}

function repPicker() {
  return screen.getAllByRole('combobox').find((el) => el.textContent === 'All Reps')
}

describe('CommissionsPage rep picker', () => {
  let stop: () => void
  let calls: string[]

  beforeEach(() => {
    const tracked = trackRequests()
    calls = tracked.calls
    stop = tracked.unsubscribe
  })

  afterEach(() => {
    stop()
    useAuthStore.setState({ user: null })
  })

  async function waitForSummary() {
    await waitFor(() => {
      expect(screen.getAllByText('$1,250.00').length).toBeGreaterThan(0)
    })
  }

  it.each(['sales', 'inside_sales', 'marketing'] as const)(
    'hides the rep picker and skips /reps for %s',
    async (role) => {
      seed(role)
      render(<CommissionsPage />)
      await waitForSummary()

      expect(repPicker()).toBeUndefined()
      expect(screen.getByRole('heading', { name: 'Your Commissions' })).toBeInTheDocument()
      expect(calls.some((url) => url.startsWith('/api/commissions/reps'))).toBe(false)

      const summary = calls.find((url) => url.startsWith('/api/commissions/summary'))
      const list = calls.find((url) => url.startsWith('/api/commissions/list'))
      expect(summary).toBeDefined()
      expect(list).toBeDefined()
      expect(summary).not.toContain('user_id')
      expect(list).not.toContain('user_id')
    },
  )

  it('shows the rep picker and loads /reps for a viewer role', async () => {
    seed('manager')
    const user = userEvent.setup()
    render(<CommissionsPage />)
    await waitForSummary()

    const picker = repPicker()
    expect(picker).toBeDefined()
    expect(calls.some((url) => url === '/api/commissions/reps')).toBe(true)

    const summary = calls.find((url) => url.startsWith('/api/commissions/summary'))
    expect(summary).toBeDefined()
    expect(summary).not.toContain('user_id')

    await user.click(picker!)
    await user.click(await screen.findByRole('option', { name: 'Alex Rivera' }))

    await waitFor(() => {
      expect(
        calls.some(
          (url) => url.startsWith('/api/commissions/summary') && url.includes('user_id=rep-alex'),
        ),
      ).toBe(true)
    })
    expect(
      calls.some((url) => url.startsWith('/api/commissions/list') && url.includes('user_id=rep-alex')),
    ).toBe(true)
    expect(screen.getByRole('heading', { name: "Alex Rivera's Commissions" })).toBeInTheDocument()
    expect(screen.getByText('Standard Sales Commission')).toBeInTheDocument()
  })

  it('keeps the captured close total after the calendar year rolls over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-01-01T15:00:00Z'))
    seed('sales')
    render(<CommissionsPage />)
    await waitForSummary()
    vi.useRealTimers()
  })

  it('shows the signed-in rep their plan from the summary', async () => {
    seed('sales')
    render(<CommissionsPage />)
    await waitForSummary()

    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('Standard Sales Commission')).toBeInTheDocument()
    expect(screen.getByText(/Not period-filtered/)).toBeInTheDocument()
    expect(screen.queryByText(/this schedule/i)).not.toBeInTheDocument()
  })

  it('sends the selected close dates with the payout schedule', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T15:00:00Z'))
    seed('sales')
    const user = userEvent.setup()
    render(<CommissionsPage />)
    await waitForSummary()

    const schedule = calls.find((url) => url.startsWith('/api/commissions/payout-schedule'))
    expect(schedule).toContain('start_date=2026-01-01')
    expect(schedule).toContain('end_date=2026-09-25')
    expect(schedule).not.toContain('year=')
    expect(screen.getByText('$625.00')).toBeInTheDocument()
    expect(screen.queryByText(/this schedule/i)).not.toBeInTheDocument()

    const periodPicker = (label: string) => {
      const picker = screen.getAllByRole('combobox').find((el) => el.textContent === label)
      if (!picker) throw new Error(`missing period picker ${label}`)
      return picker
    }

    await user.click(periodPicker('This Year'))
    await user.click(await screen.findByRole('option', { name: 'This Month' }))
    await waitFor(() => {
      expect(screen.getByText('No closed deals in this period')).toBeInTheDocument()
    })
    expect(screen.getByText('No checks in this period')).toBeInTheDocument()
    expect(screen.queryByText('$625.00')).not.toBeInTheDocument()
    expect(
      calls.some(
        (url) =>
          url.startsWith('/api/commissions/payout-schedule')
          && url.includes('start_date=2026-09-01')
          && url.includes('end_date=2026-09-25')
          && !url.includes('year='),
      ),
    ).toBe(true)

    await user.click(periodPicker('This Month'))
    await user.click(await screen.findByRole('option', { name: 'Last Month' }))
    expect(await screen.findByText('Q3 2026')).toBeInTheDocument()
    expect(screen.getByText('1 deal · $150.00 recorded at close')).toBeInTheDocument()
    expect(screen.queryByText('Q1 2026')).not.toBeInTheDocument()
    expect(screen.queryByText('Q2 2026')).not.toBeInTheDocument()
    expect(screen.queryByText('$625.00')).not.toBeInTheDocument()
    expect(
      calls.some(
        (url) =>
          url.startsWith('/api/commissions/payout-schedule')
          && url.includes('start_date=2026-08-01')
          && url.includes('end_date=2026-08-31')
          && !url.includes('year='),
      ),
    ).toBe(true)
    vi.useRealTimers()
  })

  it('shows the legacy rate chip when the selected rep has no plan', async () => {
    seed('manager')
    const user = userEvent.setup()
    render(<CommissionsPage />)
    await waitForSummary()

    await user.click(repPicker()!)
    await user.click(await screen.findByRole('option', { name: 'Michelle Cady' }))

    expect(await screen.findByText(/4\.00% commission rate/)).toBeInTheDocument()
    expect(screen.getByText(/effective Jan 1, 2026/)).toBeInTheDocument()
    expect(screen.queryByText('Standard Sales Commission')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "Michelle Cady's Commissions" })).toBeInTheDocument()
  })
})
