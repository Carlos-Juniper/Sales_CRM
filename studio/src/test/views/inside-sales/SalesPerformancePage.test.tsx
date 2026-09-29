// Rep picker is limited to REP_SELECTOR_ROLES (api/authz.py REP_VIEWER_ROLES).
// Non-viewers must not render the picker and must not call
// GET /sales-performance/reps (that route 403s). Summary and deal lists load
// with no user_id so the API auto-scopes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import SalesPerformancePage from '@/views/inside-sales/SalesPerformancePage'
import type { UserRole } from '@/types'

window.HTMLElement.prototype.hasPointerCapture = vi.fn()
window.HTMLElement.prototype.releasePointerCapture = vi.fn()
window.HTMLElement.prototype.scrollIntoView = vi.fn()

function trackRequests() {
  const calls: string[] = []
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/sales-performance')) {
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

/** The rep control is the combobox ahead of the period select. */
function filterComboboxes() {
  return screen.getAllByRole('combobox')
}

describe('SalesPerformancePage rep picker', () => {
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
      expect(screen.getAllByText(/2 won/).length).toBeGreaterThan(0)
    })
  }

  it.each(['sales', 'inside_sales', 'marketing'] as const)(
    'hides the rep picker and skips /reps for %s',
    async (role) => {
      seed(role)
      render(<SalesPerformancePage />)
      await waitForSummary()

      const comboboxes = filterComboboxes()
      expect(comboboxes).toHaveLength(1)
      expect(comboboxes[0]).toHaveTextContent('This Year')
      expect(screen.queryByText('All Reps')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Search deals...')).toBeInTheDocument()
      expect(calls.some((url) => url.startsWith('/api/sales-performance/reps'))).toBe(false)

      for (const path of [
        '/api/sales-performance/summary',
        '/api/sales-performance/won-deals',
        '/api/sales-performance/lost-deals',
      ]) {
        const hit = calls.find((url) => url.startsWith(path))
        expect(hit, path).toBeDefined()
        expect(hit).not.toContain('user_id')
      }
    },
  )

  it('shows the rep picker and loads /reps for a viewer role', async () => {
    seed('admin')
    const user = userEvent.setup()
    render(<SalesPerformancePage />)
    await waitForSummary()

    const comboboxes = filterComboboxes()
    expect(comboboxes).toHaveLength(2)
    expect(comboboxes[1]).toHaveTextContent('This Year')
    expect(calls.some((url) => url === '/api/sales-performance/reps')).toBe(true)

    const summary = calls.find((url) => url.startsWith('/api/sales-performance/summary'))
    expect(summary).toBeDefined()
    expect(summary).not.toContain('user_id')

    await user.click(comboboxes[0])
    await user.click(await screen.findByRole('option', { name: 'Alex Rivera' }))

    await waitFor(() => {
      expect(
        calls.some(
          (url) =>
            url.startsWith('/api/sales-performance/summary') && url.includes('user_id=rep-alex'),
        ),
      ).toBe(true)
    })
    expect(
      calls.some(
        (url) => url.startsWith('/api/sales-performance/won-deals') && url.includes('user_id=rep-alex'),
      ),
    ).toBe(true)
    expect(
      calls.some(
        (url) => url.startsWith('/api/sales-performance/lost-deals') && url.includes('user_id=rep-alex'),
      ),
    ).toBe(true)
  })
})
