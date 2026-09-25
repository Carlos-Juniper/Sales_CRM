import { describe, it, expect, beforeEach } from 'vitest'
import { cleanup, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useRole } from '@/hooks/useRole'
import {
  ANALYTICS_NAV_ROLES,
  ASSIGNABLE_ROLES,
  ESTIMATING_NAV_ROLES,
  PUBLIC_LEADS_NAV_ROLES,
  REP_SELECTOR_ROLES,
  SALES_NAV_ROLES,
  SALES_TEAM_ROLES,
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
    // #30 keeps Analytics management-only. Legacy sales lands on the pipeline
    // with the split roles, not on Analytics.
    expect(ANALYTICS_NAV_ROLES).not.toContain('sales')
    expect(PUBLIC_LEADS_NAV_ROLES).toContain('inside_sales')
    expect(defaultRouteForRole('maintenance_sales')).toBe('/inside-sales/pipeline')
    expect(defaultRouteForRole('install_sales')).toBe('/inside-sales/pipeline')
    expect(defaultRouteForRole('sales')).toBe('/inside-sales/pipeline')
  })

  it('requires an Aspire contact for the same roles as sales', () => {
    expect(requiresAspireSalesRep('sales')).toBe(true)
    expect(requiresAspireSalesRep('maintenance_sales')).toBe(true)
    expect(requiresAspireSalesRep('install_sales')).toBe(true)
    expect(requiresAspireSalesRep('inside_sales')).toBe(false)
    expect(requiresAspireSalesRep('manager')).toBe(false)
    expect(requiresAspireSalesRep('regional_sales_rep')).toBe(false)
    expect(requiresAspireSalesRep('vp_sales')).toBe(false)
    expect(requiresAspireSalesRep('regional_director')).toBe(false)
    expect(requiresAspireSalesRep('vice_president')).toBe(false)
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
    expect(roleLabel('inside_sales')).toBe('Inside Sales')
    expect(roleLabel('sales')).toBe('Legacy: Sales (reassign)')
    expect(roleLabel('outside_sales')).toBe('Legacy: Sales (reassign)')
    expect(roleLabel('regional_sales_rep')).toBe('Regional Sales Rep')
    expect(roleLabel('vp_sales')).toBe('VP of Sales')
    expect(roleLabel('regional_director')).toBe('Regional Director')
    expect(roleLabel('vice_president')).toBe('Vice President')
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

describe('admin-equivalent sales roles', () => {
  it('lands on Analytics and is not field-sales scoped', () => {
    for (const role of ['regional_sales_rep', 'vp_sales'] as const) {
      expect(defaultRouteForRole(role)).toBe('/inside-sales')
      expect(ANALYTICS_NAV_ROLES).toContain(role)
      expect(PUBLIC_LEADS_NAV_ROLES).toContain(role)
      expect(SALES_NAV_ROLES).toContain(role)
      expect(REP_SELECTOR_ROLES).toContain(role)
      expect(withRole(role).isAdmin).toBe(true)
      expect(withRole(role).isSales).toBe(false)
      expect(withRole(role).canAccess(ANALYTICS_NAV_ROLES)).toBe(true)
    }
    expect(defaultRouteForRole('regional_director')).toBe('/inside-sales')
    expect(defaultRouteForRole('vice_president')).toBe('/inside-sales')
    expect(withRole('regional_director').isAdmin).toBe(false)
    expect(withRole('vice_president').isAdmin).toBe(false)
  })

  it('offers the five sales roles and keeps legacy sales working', () => {
    expect([...SALES_TEAM_ROLES]).toEqual([
      'inside_sales',
      'maintenance_sales',
      'install_sales',
      'regional_sales_rep',
      'vp_sales',
    ])
    for (const role of SALES_TEAM_ROLES) {
      expect(ASSIGNABLE_ROLES).toContain(role)
    }
    expect(ASSIGNABLE_ROLES).not.toContain('sales')
    expect(withRole('sales').isSales).toBe(true)
    expect(withRole('outside_sales').isSales).toBe(true)
    expect(withRole('sales').canAccess(SALES_NAV_ROLES)).toBe(true)
    expect(defaultRouteForRole('sales')).toBe('/inside-sales/pipeline')
    expect(requiresAspireSalesRep('sales')).toBe(true)
    expect(requiresAspireSalesRep('outside_sales')).toBe(true)
    expect(requiresAspireSalesRep('inside_sales')).toBe(false)
    expect(requiresAspireSalesRep('regional_sales_rep')).toBe(false)
    expect(requiresAspireSalesRep('vp_sales')).toBe(false)
  })
})
