// ---------------------------------------------------------------------------
// Canonical 10-role model on the frontend.
//
//   * UserRole covers the canonical business roles, including `inside_sales`
//     and the field-sales split (`maintenance_sales`, `install_sales`); only
//     the retired `outside_sales` normalizes to `sales`.
//   * `admin` is the frontend super-role (canAccess always true); `manager`
//     narrows to its approval-tier role.
//   * Estimator/approver mapping mirrors api/authz.py.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuthStore } from '@/store/authStore'
import { useRole, normalizeRole } from '@/hooks/useRole'
import {
  ESTIMATOR_ROLES,
  ESTIMATING_ONLY_ROLES,
  APPROVER_ROLES,
  CROSS_BRANCH_ROLES,
  ANALYTICS_NAV_ROLES,
  FULL_ACCESS_ROLES,
  REP_SELECTOR_ROLES,
  ROSTER_REP_PICKER_ROLES,
  defaultRouteForRole,
} from '@/lib/roles'
import { CANONICAL_ROLES } from '@/types'
import { makeUser } from '@/test/utils'

function withRole(role: string) {
  useAuthStore.setState({ user: makeUser({ role: role as never }) })
  return renderHook(() => useRole()).result.current
}

beforeEach(() => {
  useAuthStore.setState({ user: null })
})

// Pin the role constants so any drift from api/authz.py is immediately visible.
// When you change either side, update both this snapshot AND the Python frozensets.
describe('roles.ts — canonical role constants (mirrors api/authz.py)', () => {
  it('ESTIMATOR_ROLES: estimators + manager-tier (LINE_ITEM_EDIT_ROLES in authz.py)', () => {
    expect([...ESTIMATOR_ROLES].sort()).toEqual(
      ['admin', 'ceo', 'install_estimating', 'maintenance_estimating', 'manager', 'regional_director', 'vice_president', 'vp_sales'].sort(),
    )
  })

  it('APPROVER_ROLES: approval-tier + admin-equivalent (APPROVER_ROLES in authz.py)', () => {
    expect([...APPROVER_ROLES].sort()).toEqual(
      ['admin', 'ceo', 'manager', 'regional_director', 'vice_president', 'vp_sales'].sort(),
    )
  })

  it('CROSS_BRANCH_ROLES: org-wide visibility (CROSS_BRANCH_ROLES in authz.py)', () => {
    expect([...CROSS_BRANCH_ROLES].sort()).toEqual(
      ['admin', 'ceo', 'vice_president', 'vp_sales'].sort(),
    )
  })

  it('REP_SELECTOR_ROLES mirrors api/authz.py REP_VIEWER_ROLES', () => {
    expect([...REP_SELECTOR_ROLES].sort()).toEqual(
      ['admin', 'ceo', 'manager', 'regional_director', 'vice_president', 'vp_sales'].sort(),
    )
  })

  it('ANALYTICS_NAV_ROLES is management plus admin-equivalent roles, defined once as FULL_ACCESS_ROLES', () => {
    expect(ANALYTICS_NAV_ROLES).toBe(FULL_ACCESS_ROLES)
    expect([...ANALYTICS_NAV_ROLES].sort()).toEqual(
      ['admin', 'ceo', 'manager', 'regional_director', 'vice_president', 'vp_sales'].sort(),
    )
    // Same members as the rep picker today, but a different permission.
    expect([...ANALYTICS_NAV_ROLES].sort()).toEqual([...REP_SELECTOR_ROLES].sort())
    expect(ANALYTICS_NAV_ROLES).not.toBe(REP_SELECTOR_ROLES)
  })

  it('ESTIMATING_ONLY_ROLES is the two estimating disciplines, not admin or management', () => {
    expect([...ESTIMATING_ONLY_ROLES].sort()).toEqual(
      ['install_estimating', 'maintenance_estimating'].sort(),
    )
  })
})

describe('defaultRouteForRole', () => {
  it('sends only management to Analytics, and everyone else to a page they can open', () => {
    expect(defaultRouteForRole('admin')).toBe('/inside-sales')
    expect(defaultRouteForRole('vp_sales')).toBe('/inside-sales')
    expect(defaultRouteForRole('manager')).toBe('/inside-sales')
    expect(defaultRouteForRole('regional_director')).toBe('/inside-sales')
    expect(defaultRouteForRole('vice_president')).toBe('/inside-sales')
    expect(defaultRouteForRole('ceo')).toBe('/inside-sales')

    expect(defaultRouteForRole('sales')).toBe('/inside-sales/pipeline')
    expect(defaultRouteForRole('maintenance_sales')).toBe('/inside-sales/pipeline')
    expect(defaultRouteForRole('install_sales')).toBe('/inside-sales/pipeline')
    expect(defaultRouteForRole('inside_sales')).toBe('/inside-sales/leads')
    expect(defaultRouteForRole('maintenance_estimating')).toBe('/inside-sales/estimating')
    expect(defaultRouteForRole('install_estimating')).toBe('/inside-sales/estimating')
    expect(defaultRouteForRole('procurement')).toBe('/inside-sales/estimating')
    expect(defaultRouteForRole('marketing')).toBe('/settings')
    expect(defaultRouteForRole(null)).toBe('/settings')
  })
})

describe('canonical role set', () => {
  it('has exactly the canonical business roles', () => {
    // Handoff 50 §3 adds `marketing` (cross-branch proposal-asset owner).
    expect([...CANONICAL_ROLES].sort()).toEqual(
      [
        'admin',
        'ceo',
        'install_estimating',
        'vp_sales',
        'install_sales',
        'inside_sales',
        'maintenance_estimating',
        'maintenance_sales',
        'manager',
        'marketing',
        'procurement',
        'regional_director',
        'sales',
        'vice_president',
      ].sort(),
    )
  })

  it('normalizes outside_sales to sales but leaves inside_sales canonical', () => {
    expect(normalizeRole('outside_sales')).toBe('sales')
    expect(normalizeRole('inside_sales')).toBe('inside_sales')
    expect(normalizeRole('manager')).toBe('manager')
  })
})

describe('useRole', () => {
  it('exposes the normalized role for legacy users', () => {
    expect(withRole('outside_sales').role).toBe('sales')
    expect(withRole('inside_sales').role).toBe('inside_sales')
    expect(withRole('ceo').role).toBe('ceo')
  })

  it('admin is the super-role: canAccess always true', () => {
    const { canAccess } = withRole('admin')
    expect(canAccess('sales')).toBe(true)
    expect(canAccess(['manager'])).toBe(true)
  })

  it('vp_sales shares the admin super-role bypass', () => {
    for (const role of ['vp_sales'] as const) {
      const access = withRole(role)
      expect(access.isAdmin).toBe(true)
      expect(access.canAccess('sales')).toBe(true)
      expect(access.canAccess(['manager'])).toBe(true)
      expect(access.canManageMarketingAssets).toBe(true)
      expect(access.isSales).toBe(false)
      expect(access.isEstimatingOnly).toBe(false)
      expect(access.seesAllBranches).toBe(true)
      expect(access.canViewAnalytics).toBe(true)
      expect(access.canViewRepSelector).toBe(true)
      expect(access.canPickRosterRep).toBe(true)
      expect(access.isEstimator).toBe(true)
      expect(access.isApprover).toBe(true)
    }
    expect(withRole('regional_director').isAdmin).toBe(false)
    expect(withRole('vice_president').isAdmin).toBe(false)
    expect(withRole('regional_director').seesAllBranches).toBe(false)
    expect(withRole('vice_president').seesAllBranches).toBe(true)
  })

  it('manager is NOT a super-role anymore (narrows to its tier)', () => {
    const { canAccess } = withRole('manager')
    expect(canAccess('sales')).toBe(false)
    expect(canAccess('manager')).toBe(true)
  })

  it('legacy outside_sales users pass sales gates', () => {
    const { canAccess } = withRole('outside_sales')
    expect(canAccess('sales')).toBe(true)
    expect(canAccess('manager')).toBe(false)
  })

  it('inside_sales is its own gate — it does not pass a plain sales gate', () => {
    const { canAccess } = withRole('inside_sales')
    expect(canAccess('inside_sales')).toBe(true)
    expect(canAccess('sales')).toBe(false)
  })

  it('maps estimating roles: line-item edit set vs approvers (mirrors api/authz.py)', () => {
    // Manager-tier roles added to ESTIMATOR_ROLES (line-item edit set).
    expect(withRole('maintenance_estimating').isEstimator).toBe(true)
    expect(withRole('install_estimating').isEstimator).toBe(true)
    expect(withRole('admin').isEstimator).toBe(true)
    expect(withRole('manager').isEstimator).toBe(true)
    expect(withRole('regional_director').isEstimator).toBe(true)
    expect(withRole('vice_president').isEstimator).toBe(true)
    expect(withRole('ceo').isEstimator).toBe(true)
    expect(withRole('sales').isEstimator).toBe(false)
    expect(withRole('procurement').isEstimator).toBe(false)

    expect(withRole('manager').isApprover).toBe(true)
    expect(withRole('regional_director').isApprover).toBe(true)
    expect(withRole('vice_president').isApprover).toBe(true)
    expect(withRole('ceo').isApprover).toBe(true)
    expect(withRole('admin').isApprover).toBe(true)
    expect(withRole('maintenance_estimating').isApprover).toBe(false)
    expect(withRole('sales').isApprover).toBe(false)
  })

  it('cross-branch visibility: admin/vice_president/ceo see all branches', () => {
    expect(withRole('admin').seesAllBranches).toBe(true)
    expect(withRole('vice_president').seesAllBranches).toBe(true)
    expect(withRole('ceo').seesAllBranches).toBe(true)
    expect(withRole('manager').seesAllBranches).toBe(false)
    expect(withRole('sales').seesAllBranches).toBe(false)
    expect(withRole('regional_director').seesAllBranches).toBe(false)
  })

  it('canViewAnalytics is management only', () => {
    for (const role of ['admin', 'vp_sales', 'manager', 'regional_director', 'vice_president', 'ceo'] as const) {
      expect(withRole(role).canViewAnalytics).toBe(true)
    }
    for (const role of ['sales', 'maintenance_sales', 'install_sales', 'inside_sales', 'maintenance_estimating', 'install_estimating', 'procurement', 'marketing'] as const) {
      expect(withRole(role).canViewAnalytics).toBe(false)
    }
  })

  it('isEstimatingOnly is the two disciplines, not admin or sales', () => {
    expect(withRole('maintenance_estimating').isEstimatingOnly).toBe(true)
    expect(withRole('install_estimating').isEstimatingOnly).toBe(true)
    expect(withRole('admin').isEstimatingOnly).toBe(false)
    expect(withRole('manager').isEstimatingOnly).toBe(false)
    expect(withRole('sales').isEstimatingOnly).toBe(false)
  })

  it('roster rep picker is marketing and admin only', () => {
    expect([...ROSTER_REP_PICKER_ROLES].sort()).toEqual(
      ['admin', 'marketing', 'vp_sales'].sort(),
    )
    expect(withRole('marketing').canPickRosterRep).toBe(true)
    expect(withRole('admin').canPickRosterRep).toBe(true)
    expect(withRole('vp_sales').canPickRosterRep).toBe(true)
    expect(withRole('sales').canPickRosterRep).toBe(false)
    expect(withRole('manager').canPickRosterRep).toBe(false)
  })

  it('treats the split field-sales roles as sales, not as rep-selector viewers', () => {
    expect(withRole('maintenance_sales').isSales).toBe(true)
    expect(withRole('install_sales').isSales).toBe(true)
    expect(withRole('sales').isSales).toBe(true)
    expect(withRole('maintenance_sales').canViewRepSelector).toBe(false)
    expect(withRole('install_sales').canViewRepSelector).toBe(false)
    expect(withRole('inside_sales').isSales).toBe(false)
  })

  it('returns null role when logged out', () => {
    const { result } = renderHook(() => useRole())
    expect(result.current.role).toBeNull()
    expect(result.current.canAccess('sales')).toBe(false)
    expect(result.current.canViewRepSelector).toBe(false)
  })

  it('canViewRepSelector follows REP_SELECTOR_ROLES (api/authz.py REP_VIEWER_ROLES)', () => {
    for (const role of CANONICAL_ROLES) {
      expect(withRole(role).canViewRepSelector).toBe(REP_SELECTOR_ROLES.includes(role))
    }
    expect(withRole('admin').canViewRepSelector).toBe(true)
    expect(withRole('vice_president').canViewRepSelector).toBe(true)
    expect(withRole('ceo').canViewRepSelector).toBe(true)
    expect(withRole('manager').canViewRepSelector).toBe(true)
    expect(withRole('regional_director').canViewRepSelector).toBe(true)
    expect(withRole('sales').canViewRepSelector).toBe(false)
    expect(withRole('inside_sales').canViewRepSelector).toBe(false)
    expect(withRole('procurement').canViewRepSelector).toBe(false)
    expect(withRole('marketing').canViewRepSelector).toBe(false)
    expect(withRole('maintenance_estimating').canViewRepSelector).toBe(false)
    expect(withRole('install_estimating').canViewRepSelector).toBe(false)
  })
})
