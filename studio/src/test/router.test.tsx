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
          <Route path="/outside-sales" element={<RequireAuth><div>Outside Sales</div></RequireAuth>} />
          <Route
            path="/inside-sales-role"
            element={
              <RequireAuth>
                <RoleGate roles={['inside_sales', 'manager']} redirectTo="/outside-sales">
                  <div>Inside Sales Role Content</div>
                </RoleGate>
              </RequireAuth>
            }
          />
          <Route
            path="/outside-sales-role"
            element={
              <RequireAuth>
                <RoleGate roles={['outside_sales', 'manager']} redirectTo="/inside-sales">
                  <div>Outside Sales Role Content</div>
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

describe('Router - Auth & Role Guards', () => {
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
    const user = makeUser({ role: 'inside_sales' })
    renderRoute(['/inside-sales'], user)
    expect(screen.getByText('Inside Sales Dashboard')).toBeInTheDocument()
  })

  it('inside_sales role can access inside_sales role-gated route', () => {
    const user = makeUser({ role: 'inside_sales' })
    renderRoute(['/inside-sales-role'], user)
    expect(screen.getByText('Inside Sales Role Content')).toBeInTheDocument()
  })

  it('manager can access inside_sales role-gated route', () => {
    const user = makeUser({ role: 'manager' })
    renderRoute(['/inside-sales-role'], user)
    expect(screen.getByText('Inside Sales Role Content')).toBeInTheDocument()
  })

  it('outside_sales role is redirected away from inside-sales-role route', () => {
    const user = makeUser({ role: 'outside_sales' })
    renderRoute(['/inside-sales-role'], user)
    expect(screen.getByText('Outside Sales')).toBeInTheDocument()
  })

  it('outside_sales role can access outside-sales-role route', () => {
    const user = makeUser({ role: 'outside_sales' })
    renderRoute(['/outside-sales-role'], user)
    expect(screen.getByText('Outside Sales Role Content')).toBeInTheDocument()
  })

  it('inside_sales role is redirected away from outside-sales-role route', () => {
    const user = makeUser({ role: 'inside_sales' })
    renderRoute(['/outside-sales-role'], user)
    expect(screen.getByText('Inside Sales Dashboard')).toBeInTheDocument()
  })

  it('manager can access manager-only route', () => {
    const user = makeUser({ role: 'manager' })
    renderRoute(['/manager-only'], user)
    expect(screen.getByText('Manager Only Content')).toBeInTheDocument()
  })

  it('inside_sales cannot access manager-only route', () => {
    const user = makeUser({ role: 'inside_sales' })
    renderRoute(['/manager-only'], user)
    expect(screen.queryByText('Manager Only Content')).not.toBeInTheDocument()
    expect(screen.getByText('Inside Sales Dashboard')).toBeInTheDocument()
  })
})
