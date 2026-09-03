// ---------------------------------------------------------------------------
// Slice 12 — Mine settings sections + dead-route cleanup.
//
// mine group: theme / connections
//   - renders for any authed user (plain sales role)
//   - theme: reads + writes uiStore.theme
//   - connections: renders the M365 connections UI (absorbed from ConnectionsPage)
//
// Router:
//   - /inside-sales/settings/connections no longer renders a standalone page;
//     navigating there does NOT match the old ConnectionsPage route.
//   - /settings/connections renders the Mine connections section.
//
// BranchManagerPage deleted:
//   - /settings path renders the SettingsPage shell, not BranchManagerPage.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import {
  render as rtlRender,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SettingsPage } from '@/views/settings/SettingsPage'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { makeUser } from '@/test/utils'
import type { UserRole } from '@/types'
import type { LegacyUserRole } from '@/types'

// ── helpers ─────────────────────────────────────────────────────────────────

function mockBranches() {
  server.use(
    http.get('*/api/settings/branches', () =>
      HttpResponse.json([
        { aspireBranchId: 1403, branchName: 'Bonita Springs', city: 'Bonita Springs' },
      ]),
    ),
  )
}

function renderSettings(
  role: UserRole | LegacyUserRole,
  initialEntries: string[],
) {
  useAuthStore.setState({ user: makeUser({ role }) })
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return rtlRender(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <TooltipProvider>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:section" element={<SettingsPage />} />
            <Route
              path="/settings/branch/:aspireBranchId/:section"
              element={<SettingsPage />}
            />
            <Route path="*" element={<Navigate to="/settings" replace />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── Mine group visibility ────────────────────────────────────────────────────

describe('Mine group — visibility', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null })
    mockBranches()
  })

  it('a plain sales user sees the Mine group', async () => {
    renderSettings('sales', ['/settings/theme'])
    expect(await screen.findByTestId('settings-group-mine')).toBeInTheDocument()
  })

  it('the Mine group has theme and connections nav items', async () => {
    renderSettings('sales', ['/settings/theme'])
    const mineGroup = await screen.findByTestId('settings-group-mine')
    expect(mineGroup).toHaveTextContent('Theme')
    expect(mineGroup).toHaveTextContent('Connections')
    expect(mineGroup).not.toHaveTextContent('Sidebar')
    expect(mineGroup).not.toHaveTextContent('Queue filters')
  })
})

// ── Theme section ────────────────────────────────────────────────────────────

describe('Mine — theme section', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ role: 'sales' }) })
    useUIStore.setState({ theme: 'system' })
    mockBranches()
  })

  it('renders the theme section for /settings/theme', async () => {
    renderSettings('sales', ['/settings/theme'])
    expect(await screen.findByTestId('settings-section-theme')).toBeInTheDocument()
  })

  it('reflects the current theme value from uiStore', async () => {
    useUIStore.setState({ theme: 'dark' })
    renderSettings('sales', ['/settings/theme'])
    await screen.findByTestId('settings-section-theme')
    const select = screen.getByRole('combobox', { name: /theme/i }) as HTMLSelectElement
    expect(select.value).toBe('dark')
  })

  it('updates the store when the theme is changed', async () => {
    useUIStore.setState({ theme: 'light' })
    renderSettings('sales', ['/settings/theme'])
    await screen.findByTestId('settings-section-theme')
    const select = screen.getByRole('combobox', { name: /theme/i }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'dark' } })
    await waitFor(() => expect(useUIStore.getState().theme).toBe('dark'))
  })
})

// ── Connections section ──────────────────────────────────────────────────────

describe('Mine — connections section', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ role: 'sales' }) })
    mockBranches()
  })

  it('renders the M365 connections UI at /settings/connections', async () => {
    renderSettings('sales', ['/settings/connections'])
    await screen.findByTestId('settings-section-connections')
    // Wait for the loading state to resolve and data to appear
    expect(await screen.findByText(/Microsoft Graph/i)).toBeInTheDocument()
  })

  it('shows not-connected state when graph is not connected', async () => {
    server.use(
      http.get('*/api/settings/connections', () =>
        HttpResponse.json({ graph: { connected: false } }),
      ),
    )
    renderSettings('sales', ['/settings/connections'])
    await screen.findByTestId('settings-section-connections')
    expect(await screen.findByText(/not connected/i)).toBeInTheDocument()
  })

  it('shows connected state when graph is connected', async () => {
    server.use(
      http.get('*/api/settings/connections', () =>
        HttpResponse.json({ graph: { connected: true } }),
      ),
    )
    renderSettings('sales', ['/settings/connections'])
    await screen.findByTestId('settings-section-connections')
    // should NOT show the connect button
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /connect microsoft/i })).not.toBeInTheDocument()
    })
  })
})

// ── Router: dead route for standalone connections ────────────────────────────

describe('Router — standalone /inside-sales/settings/connections route is gone', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ role: 'sales' }) })
    mockBranches()
  })

  it('/settings/connections renders the Mine connections section inside SettingsPage', async () => {
    renderSettings('sales', ['/settings/connections'])
    // SettingsPage shell must be present — NOT a bare standalone page
    expect(await screen.findByTestId('settings-shell')).toBeInTheDocument()
    expect(screen.getByTestId('settings-group-mine')).toBeInTheDocument()
  })
})

// ── BranchManagerPage deleted ────────────────────────────────────────────────

describe('BranchManagerPage removed', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ role: 'manager' }) })
    mockBranches()
  })

  it('/settings renders the SettingsPage shell (not BranchManagerPage)', async () => {
    renderSettings('manager', ['/settings'])
    expect(await screen.findByTestId('settings-shell')).toBeInTheDocument()
    // BranchManagerPage had a heading "Branch Manager"; that must be gone
    expect(screen.queryByText(/branch manager/i)).not.toBeInTheDocument()
  })
})
