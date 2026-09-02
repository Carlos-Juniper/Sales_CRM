// ---------------------------------------------------------------------------
// Settings shell (Slice 9): section nav, permission filtering, branch picker.
//
// The shell reads role (permission filtering of the section groups) and the
// manageable-branch list (branch picker) — server state via MSW. Deep links
// (/settings/branch/:aspireBranchId/:section) override the default branch.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SettingsPage } from '@/views/settings/SettingsPage'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '@/test/utils'
import type { UserRole } from '@/types'
import type { LegacyUserRole } from '@/types'

const BRANCHES = [
  { aspireBranchId: 1403, branchName: 'Bonita Springs', city: 'Bonita Springs' },
  { aspireBranchId: 3696, branchName: 'Fort Myers', city: 'Fort Myers' },
]

function mockBranches(list = BRANCHES) {
  server.use(
    http.get('*/api/settings/branches', () => HttpResponse.json(list)),
  )
}

function renderSettings(role: UserRole | LegacyUserRole, initialEntries: string[]) {
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

describe('SettingsPage shell', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null })
    mockBranches()
  })

  it('renders the settings shell', async () => {
    renderSettings('admin', ['/settings'])
    expect(await screen.findByTestId('settings-shell')).toBeInTheDocument()
  })

  it('an admin sees Company + Branch + Mine section groups', async () => {
    renderSettings('admin', ['/settings'])
    expect(await screen.findByTestId('settings-group-company')).toBeInTheDocument()
    expect(screen.getByTestId('settings-group-branch')).toBeInTheDocument()
    expect(screen.getByTestId('settings-group-mine')).toBeInTheDocument()
  })

  it('a manager sees Branch + Mine but NOT Company', async () => {
    renderSettings('manager', ['/settings'])
    expect(await screen.findByTestId('settings-group-branch')).toBeInTheDocument()
    expect(screen.getByTestId('settings-group-mine')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-group-company')).not.toBeInTheDocument()
  })

  it('a regional_director sees Branch + Mine but NOT Company', async () => {
    renderSettings('regional_director', ['/settings'])
    expect(await screen.findByTestId('settings-group-branch')).toBeInTheDocument()
    expect(screen.getByTestId('settings-group-mine')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-group-company')).not.toBeInTheDocument()
  })

  it('a plain user (sales) sees only Mine', async () => {
    renderSettings('sales', ['/settings'])
    expect(await screen.findByTestId('settings-group-mine')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-group-company')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-group-branch')).not.toBeInTheDocument()
  })

  it('bare /settings renders the first section placeholder (Users, for admin)', async () => {
    renderSettings('admin', ['/settings'])
    expect(await screen.findByTestId('settings-section-users')).toBeInTheDocument()
  })

  it('a deep link renders the named section placeholder', async () => {
    renderSettings('admin', ['/settings/margin-bands'])
    expect(await screen.findByTestId('settings-section-margin-bands')).toBeInTheDocument()
  })

  it('branch picker defaults to the first alphabetical scoped branch', async () => {
    renderSettings('manager', ['/settings/crew-rate'])
    const picker = (await screen.findByTestId('settings-branch-picker')) as HTMLSelectElement
    // Bonita Springs (1403) sorts before Fort Myers (3696).
    await waitFor(() => expect(picker.value).toBe('1403'))
  })

  it('a /settings/branch/:id deep link overrides the default branch', async () => {
    renderSettings('manager', ['/settings/branch/3696/crew-rate'])
    const picker = (await screen.findByTestId('settings-branch-picker')) as HTMLSelectElement
    await waitFor(() => expect(picker.value).toBe('3696'))
  })

  it('renders exactly the branches the endpoint returns (server-side filtered)', async () => {
    // If the endpoint already excluded active=0 / DO NOT USE rows, the picker
    // shows only what came back — the client does no filtering of its own.
    mockBranches([
      { aspireBranchId: 1403, branchName: 'Bonita Springs', city: 'Bonita Springs' },
    ])
    renderSettings('manager', ['/settings/crew-rate'])
    const picker = (await screen.findByTestId('settings-branch-picker')) as HTMLSelectElement
    await waitFor(() =>
      expect(picker.querySelectorAll('option')).toHaveLength(1),
    )
    expect(picker.value).toBe('1403')
  })
})
