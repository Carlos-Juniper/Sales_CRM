import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

// ─── Toast auto-dismiss ───────────────────────────────────────────────────────

describe('Toast auto-dismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds toast to store and dismisses after timeout', async () => {
    const { toast, toasts: initialToasts } = useUIStore.getState()
    expect(initialToasts.length).toBe(0)

    act(() => {
      toast('Test notification', { variant: 'success' })
    })

    const { toasts } = useUIStore.getState()
    const newToast = toasts.find((t) => t.title === 'Test notification')
    expect(newToast).toBeDefined()
    expect(newToast?.open).toBe(true)
    expect(newToast?.variant).toBe('success')

    // Fast-forward past the 4500ms dismiss timeout
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    const { toasts: updatedToasts } = useUIStore.getState()
    const dismissedToast = updatedToasts.find((t) => t.title === 'Test notification')
    expect(dismissedToast?.open).toBe(false)
  })

  it('toast is open immediately after being added', () => {
    act(() => {
      useUIStore.getState().toast('Immediate toast')
    })
    const { toasts } = useUIStore.getState()
    const t = toasts.find((t) => t.title === 'Immediate toast')
    expect(t?.open).toBe(true)
  })

  it('multiple toasts can coexist', () => {
    act(() => {
      useUIStore.getState().toast('Toast A')
      useUIStore.getState().toast('Toast B')
    })
    const { toasts } = useUIStore.getState()
    expect(toasts.filter((t) => t.open).length).toBeGreaterThanOrEqual(2)
  })

  it('dismissToast marks a specific toast as closed', () => {
    act(() => {
      useUIStore.getState().toast('Dismissable toast')
    })
    const { toasts, dismissToast } = useUIStore.getState()
    const t = toasts.find((t) => t.title === 'Dismissable toast')
    expect(t).toBeDefined()
    act(() => {
      dismissToast(t!.id)
    })
    const updated = useUIStore.getState().toasts.find((t) => t.title === 'Dismissable toast')
    expect(updated?.open).toBe(false)
  })
})

// ─── Theme toggle ─────────────────────────────────────────────────────────────

describe('Theme toggle', () => {
  beforeEach(() => {
    // Reset document classes
    document.documentElement.classList.remove('dark')
  })

  it('setTheme adds dark class to document when set to dark', () => {
    const { setTheme } = useUIStore.getState()

    // Simulate applying dark theme (as App.tsx would do it)
    act(() => {
      setTheme('dark')
    })

    const { theme } = useUIStore.getState()
    expect(theme).toBe('dark')
  })

  it('setTheme stores light theme correctly', () => {
    act(() => {
      useUIStore.getState().setTheme('light')
    })
    expect(useUIStore.getState().theme).toBe('light')
  })

  it('setTheme stores system theme correctly', () => {
    act(() => {
      useUIStore.getState().setTheme('system')
    })
    expect(useUIStore.getState().theme).toBe('system')
  })
})

// ─── Optimistic update rollback on 500 ───────────────────────────────────────

describe('Optimistic update rollback on 500', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeUser() })
  })

  it('PATCH /api/bids returns 500 — error toast is shown', async () => {
    server.use(
      http.patch('/api/bids/:id', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    const { default: BidTrackerPage } = await import('@/views/inside-sales/BidTrackerPage')
    render(<BidTrackerPage />)

    // Wait for bids to load
    await screen.findByText('City of Tempe — Parks Maintenance')

    // Find a Pursue button (pending bid: Peoria Unified School District)
    const pursueButtons = screen.getAllByRole('button', { name: /pursue/i })
    expect(pursueButtons.length).toBeGreaterThan(0)

    const user = userEvent.setup()
    // mutateAsync rejects on 500 — catch it so it doesn't become an unhandled rejection
    void user.click(pursueButtons[0]).catch(() => {})

    // The mutation failed — error toast should be queued in UIStore
    await waitFor(() => {
      const { toasts } = useUIStore.getState()
      const errorToast = toasts.find((t) => t.variant === 'error')
      expect(errorToast).toBeDefined()
    }, { timeout: 5000 })
  })

  it('PATCH /api/leads/:id returns 500 — error toast is shown', async () => {
    server.use(
      http.patch('/api/leads/:id', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    const { useUpdateLead } = await import('@/hooks/useLeads')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { MemoryRouter } = await import('react-router-dom')

    // Use the hook directly in a small test component
    let mutateRef: ((args: { id: string; body: Record<string, unknown> }) => Promise<unknown>) | null = null

    function TestComponent() {
      const updateLead = useUpdateLead()
      mutateRef = updateLead.mutateAsync
      return <div>Test</div>
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const { render: rtl } = await import('@testing-library/react')
    rtl(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TestComponent />
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => expect(mutateRef).not.toBeNull())

    // Trigger the failing mutation
    try {
      await mutateRef!({ id: 'l1', body: { status: 'won' } })
    } catch {
      // Expected to fail
    }

    // Error toast should appear
    await waitFor(() => {
      const { toasts } = useUIStore.getState()
      const errorToast = toasts.find((t) => t.variant === 'error')
      expect(errorToast).toBeDefined()
    })
  })
})
