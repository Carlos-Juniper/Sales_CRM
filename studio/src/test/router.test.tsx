import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { render as rtlRender } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { RequireAuth, RoleGate } from '@/views/auth/RoleGate'
import {
  SalesWorkspaceGuard,
  PublicLeadsGuard,
  EstimatingGuard,
} from '@/guards'
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
          <Route path="/inside-sales" element={<SalesWorkspaceGuard><div>Analytics Dashboard</div></SalesWorkspaceGuard>} />
          <Route path="/settings" element={<div>Settings Page</div>} />
          <Route path="/inside-sales/leads" element={<PublicLeadsGuard><div>Public Leads</div></PublicLeadsGuard>} />
          <Route path="/inside-sales/pipeline" element={<SalesWorkspaceGuard><div>Pipeline</div></SalesWorkspaceGuard>} />
          <Route path="/inside-sales/estimating" element={<EstimatingGuard><div>Estimating</div></EstimatingGuard>} />
          <Route path="/inside-sales/commissions" element={<SalesWorkspaceGuard><div>Commissions</div></SalesWorkspaceGuard>} />
          {/* Legacy routes kept for existing test coverage */}
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
    </QueryClientProvider>,
  )
}

describe('Router - Auth & Role Guards (canonical 10-role model)', () => {
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

  it('authenticated sales user can access /inside-sales', () => {
    const user = makeUser({ role: 'sales' })
    renderRoute(['/inside-sales'], user)
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
  })

  it('sales role can access the sales role-gated route', () => {
    const user = makeUser({ role: 'sales' })
    renderRoute(['/sales-role'], user)
    expect(screen.getByText('Sales Role Content')).toBeInTheDocument()
  })

  it('legacy outside_sales users normalize to sales and pass sales gates', () => {
    renderRoute(['/sales-role'], makeUser({ role: 'outside_sales' }))
    expect(screen.getByText('Sales Role Content')).toBeInTheDocument()
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
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
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
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
  })
})

describe('Per-route workspace guards (role-scoped navigation)', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null })
  })

  // ── inside_sales: Public Leads only ──────────────────────────────────────

  it('inside_sales can access Public Leads', () => {
    renderRoute(['/inside-sales/leads'], makeUser({ role: 'inside_sales' }))
    expect(screen.getByText('Public Leads')).toBeInTheDocument()
  })

  it('inside_sales is redirected from Analytics (sales workspace) to Public Leads', () => {
    renderRoute(['/inside-sales'], makeUser({ role: 'inside_sales' }))
    expect(screen.queryByText('Analytics Dashboard')).not.toBeInTheDocument()
    expect(screen.getByText('Public Leads')).toBeInTheDocument()
  })

  it('inside_sales is redirected from Pipeline to Public Leads', () => {
    renderRoute(['/inside-sales/pipeline'], makeUser({ role: 'inside_sales' }))
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument()
    expect(screen.getByText('Public Leads')).toBeInTheDocument()
  })

  it('inside_sales is redirected from Commissions to Public Leads', () => {
    renderRoute(['/inside-sales/commissions'], makeUser({ role: 'inside_sales' }))
    expect(screen.queryByText('Commissions')).not.toBeInTheDocument()
    expect(screen.getByText('Public Leads')).toBeInTheDocument()
  })

  // ── Estimators: Estimating only ──────────────────────────────────────────

  it('maintenance_estimating can access Estimating', () => {
    renderRoute(['/inside-sales/estimating'], makeUser({ role: 'maintenance_estimating' }))
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  it('maintenance_estimating is redirected from Pipeline to Estimating', () => {
    renderRoute(['/inside-sales/pipeline'], makeUser({ role: 'maintenance_estimating' }))
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument()
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  it('install_estimating is redirected from Analytics to Estimating', () => {
    renderRoute(['/inside-sales'], makeUser({ role: 'install_estimating' }))
    expect(screen.queryByText('Analytics Dashboard')).not.toBeInTheDocument()
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  // ── Procurement: Estimating (queue only) ──────────────────────────────────

  it('procurement can access Estimating', () => {
    renderRoute(['/inside-sales/estimating'], makeUser({ role: 'procurement' }))
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  it('procurement is redirected from Pipeline to Estimating', () => {
    renderRoute(['/inside-sales/pipeline'], makeUser({ role: 'procurement' }))
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument()
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  // ── Full-access tier: everything ──────────────────────────────────────────

  it('manager can access Public Leads (full-access tier)', () => {
    renderRoute(['/inside-sales/leads'], makeUser({ role: 'manager' }))
    expect(screen.getByText('Public Leads')).toBeInTheDocument()
  })

  it('regional_director can access Analytics (full-access tier)', () => {
    renderRoute(['/inside-sales'], makeUser({ role: 'regional_director' }))
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
  })

  it('vice_president can access Pipeline (full-access tier)', () => {
    renderRoute(['/inside-sales/pipeline'], makeUser({ role: 'vice_president' }))
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
  })

  it('ceo can access Commissions (full-access tier)', () => {
    renderRoute(['/inside-sales/commissions'], makeUser({ role: 'ceo' }))
    expect(screen.getByText('Commissions')).toBeInTheDocument()
  })

  it('admin can access Estimating (full-access tier)', () => {
    renderRoute(['/inside-sales/estimating'], makeUser({ role: 'admin' }))
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  // ── Sales: sales workspace + estimating (queue only) ──────────────────────

  it('sales can access Commissions', () => {
    renderRoute(['/inside-sales/commissions'], makeUser({ role: 'sales' }))
    expect(screen.getByText('Commissions')).toBeInTheDocument()
  })

  it('sales can access Estimating (queue only)', () => {
    renderRoute(['/inside-sales/estimating'], makeUser({ role: 'sales' }))
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  it('sales is redirected from Public Leads to Analytics', () => {
    renderRoute(['/inside-sales/leads'], makeUser({ role: 'sales' }))
    expect(screen.queryByText('Public Leads')).not.toBeInTheDocument()
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
  })

  // ── Split field sales: sales workspace, not Analytics or Public Leads ──

  it('maintenance_sales can access Pipeline and Estimating', () => {
    renderRoute(['/inside-sales/pipeline'], makeUser({ role: 'maintenance_sales' }))
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    renderRoute(['/inside-sales/estimating'], makeUser({ role: 'maintenance_sales' }))
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  it('install_sales lands on the sales home, the same page as sales', () => {
    renderRoute(['/inside-sales'], makeUser({ role: 'install_sales' }))
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
  })

  it('maintenance_sales is redirected from Public Leads to the sales home', () => {
    renderRoute(['/inside-sales/leads'], makeUser({ role: 'maintenance_sales' }))
    expect(screen.queryByText('Public Leads')).not.toBeInTheDocument()
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
  })

  // ── inside_sales: blocked from Estimating entirely ─────────────────────

  it('inside_sales is redirected from Estimating to Public Leads (not the queue)', () => {
    renderRoute(['/inside-sales/estimating'], makeUser({ role: 'inside_sales' }))
    expect(screen.queryByText('Estimating')).not.toBeInTheDocument()
    expect(screen.getByText('Public Leads')).toBeInTheDocument()
  })

  // ── Marketing: no inside-sales access at all ──────────────────────────

  it('marketing is redirected from /inside-sales to /settings (no loop)', () => {
    renderRoute(['/inside-sales'], makeUser({ role: 'marketing' }))
    expect(screen.queryByText('Analytics Dashboard')).not.toBeInTheDocument()
    expect(screen.getByText('Settings Page')).toBeInTheDocument()
  })
})
