import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { render as rtlRender } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { RequireAuth, RoleGate } from '@/views/auth/RoleGate'
import { makeUser } from '@/test/utils'
import type { AuthUser } from '@/types'

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
}

function renderRoute(initialEntries: string[], user: AuthUser | null = null) {
  useAuthStore.setState({ user })
  const qc = makeQC()
  return rtlRender(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/inside-sales" element={<RequireAuth><div>Inside Sales Dashboard</div></RequireAuth>} />
          <Route
            path="/sales-role"
            element={
              <RequireAuth>
                <RoleGate roles={['sales', 'manager']} redirectTo="/inside-sales">
                  <div>Sales Role Content</div>
                </RoleGate>
              </RequireAuth>
            }
          />
          <Route
            path="/estimating-role"
            element={
              <RequireAuth>
                <RoleGate roles={['maintenance_estimating', 'install_estimating']} redirectTo="/inside-sales">
                  <div>Estimating Role Content</div>
                </RoleGate>
              </RequireAuth>
            }
          />
          <Route
            path="/manager-only"
            element={
              <RequireAuth>
                <RoleGate roles={['manager']} redirectTo="/inside-sales">
                  <div>Manager Only Content</div>
                </RoleGate>
              </RequireAuth>
            }
          />
          <Route path="/" element={<RequireAuth><Navigate to="/inside-sales" replace /></RequireAuth>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Router - Auth & Role Guards (canonical 9-role model, Handoff 18)', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null })
  })

  it('redirects unauthenticated user to /login when accessing /inside-sales', () => {
    renderRoute(['/inside-sales'], null)
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('redirects unauthenticated user to /login when accessing /', () => {
    renderRoute(['/'], null)
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('authenticated user can access /inside-sales', () => {
    const user = makeUser({ role: 'sales' })
    renderRoute(['/inside-sales'], user)
    expect(screen.getByText('Inside Sales Dashboard')).toBeInTheDocument()
  })

  it('sales role can access the sales role-gated route', () => {
    const user = makeUser({ role: 'sales' })
    renderRoute(['/sales-role'], user)
    expect(screen.getByText('Sales Role Content')).toBeInTheDocument()
  })

  it('legacy inside_sales/outside_sales users normalize to sales and pass sales gates', () => {
    for (const legacy of ['inside_sales', 'outside_sales'] as const) {
      const { unmount } = renderRoute(['/sales-role'], makeUser({ role: legacy }))
      expect(screen.getByText('Sales Role Content')).toBeInTheDocument()
      unmount()
    }
  })

  it('manager can access the sales role-gated route (listed explicitly)', () => {
    const user = makeUser({ role: 'manager' })
    renderRoute(['/sales-role'], user)
    expect(screen.getByText('Sales Role Content')).toBeInTheDocument()
  })

  it('estimating roles pass estimating-gated routes; sales is redirected away', () => {
    const estimator = makeUser({ role: 'maintenance_estimating' })
    const { unmount } = renderRoute(['/estimating-role'], estimator)
    expect(screen.getByText('Estimating Role Content')).toBeInTheDocument()
    unmount()

    renderRoute(['/estimating-role'], makeUser({ role: 'sales' }))
    expect(screen.queryByText('Estimating Role Content')).not.toBeInTheDocument()
    expect(screen.getByText('Inside Sales Dashboard')).toBeInTheDocument()
  })

  it('manager can access manager-only route', () => {
    const user = makeUser({ role: 'manager' })
    renderRoute(['/manager-only'], user)
    expect(screen.getByText('Manager Only Content')).toBeInTheDocument()
  })

  it('admin (super-role) can access manager-only route', () => {
    const user = makeUser({ role: 'admin' })
    renderRoute(['/manager-only'], user)
    expect(screen.getByText('Manager Only Content')).toBeInTheDocument()
  })

  it('sales cannot access manager-only route', () => {
    const user = makeUser({ role: 'sales' })
    renderRoute(['/manager-only'], user)
    expect(screen.queryByText('Manager Only Content')).not.toBeInTheDocument()
    expect(screen.getByText('Inside Sales Dashboard')).toBeInTheDocument()
  })
})
