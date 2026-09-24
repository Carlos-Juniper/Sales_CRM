import { describe, it, expect, beforeEach } from 'vitest'
import { cleanup, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useRole } from '@/hooks/useRole'
import {
  ANALYTICS_NAV_ROLES,
  ESTIMATING_NAV_ROLES,
  PUBLIC_LEADS_NAV_ROLES,
  REP_SELECTOR_ROLES,
  SALES_NAV_ROLES,
  defaultRouteForRole,
  requiresAspireSalesRep,
} from '@/lib/roles'
import { SETTINGS_GROUPS } from '@/views/settings/sections'
import { Sidebar } from '@/components/layout/Sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { makeUser } from '@/test/utils'
import { roleLabel } from '@/lib/roleLabels'

const SPLIT = ['maintenance_sales', 'install_sales'] as const

function withRole(role: string) {
  cleanup()
  useAuthStore.setState({ user: makeUser({ role: role as never }) })
  const { result, unmount } = renderHook(() => useRole())
  const current = result.current
  unmount()
  return current
}

beforeEach(() => {
  useAuthStore.setState({ user: null })
})

describe('split field-sales role gates', () => {
  it('includes the new roles on sales and estimating nav', () => {
    for (const role of SPLIT) {
      expect(SALES_NAV_ROLES).toContain(role)
      expect(ESTIMATING_NAV_ROLES).toContain(role)
      expect(withRole(role).canAccess(SALES_NAV_ROLES)).toBe(true)
      expect(withRole(role).canAccess(ESTIMATING_NAV_ROLES)).toBe(true)
    }
  })

  it('leaves Analytics, Public Leads, and the rep selector unchanged', () => {
    for (const role of SPLIT) {
      expect(ANALYTICS_NAV_ROLES).not.toContain(role)
      expect(PUBLIC_LEADS_NAV_ROLES).not.toContain(role)
      expect(REP_SELECTOR_ROLES).not.toContain(role)
      expect(withRole(role).canAccess(ANALYTICS_NAV_ROLES)).toBe(false)
      expect(withRole(role).canAccess(PUBLIC_LEADS_NAV_ROLES)).toBe(false)
      expect(withRole(role).canViewRepSelector).toBe(false)
    }
    expect(ANALYTICS_NAV_ROLES).toContain('sales')
    expect(PUBLIC_LEADS_NAV_ROLES).toContain('inside_sales')
    expect(defaultRouteForRole('maintenance_sales')).toBe('/inside-sales')
    expect(defaultRouteForRole('install_sales')).toBe('/inside-sales')
    expect(defaultRouteForRole('sales')).toBe('/inside-sales')
  })

  it('requires an Aspire contact for the same roles as sales', () => {
    expect(requiresAspireSalesRep('sales')).toBe(true)
    expect(requiresAspireSalesRep('maintenance_sales')).toBe(true)
    expect(requiresAspireSalesRep('install_sales')).toBe(true)
    expect(requiresAspireSalesRep('inside_sales')).toBe(false)
    expect(requiresAspireSalesRep('manager')).toBe(false)
  })

  it('gives the split roles the sales settings group', () => {
    const salesGroup = SETTINGS_GROUPS.find((g) => g.id === 'marketing')
    expect(salesGroup?.roles).toEqual(
      expect.arrayContaining(['sales', 'maintenance_sales', 'install_sales']),
    )
  })

  it('labels the new roles for menus and badges', () => {
    expect(roleLabel('maintenance_sales')).toBe('Maintenance Sales')
    expect(roleLabel('install_sales')).toBe('Install Sales')
    expect(roleLabel('sales')).toBe('Sales')
  })

  it('hides Analytics and Public Leads for a maintenance sales rep', () => {
    useAuthStore.setState({ user: makeUser({ role: 'maintenance_sales', name: 'Avery Brooks' }) })
    render(
      <TooltipProvider>
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      </TooltipProvider>,
    )
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Public Leads' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pipeline' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Estimating' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sales Performance' })).toBeInTheDocument()
    expect(screen.getByText('Maintenance Sales')).toBeInTheDocument()
  })
})
