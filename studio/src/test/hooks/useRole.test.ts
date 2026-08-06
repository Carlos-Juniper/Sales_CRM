// ---------------------------------------------------------------------------
// Handoff 18 — canonical 9-role model on the frontend.
//
//   * UserRole covers the nine business roles; legacy inside_sales /
//     outside_sales normalize to `sales`.
//   * `admin` is the frontend super-role (canAccess always true); `manager`
//     narrows to its approval-tier role.
//   * Estimator/approver mapping mirrors api/authz.py.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuthStore } from '@/store/authStore'
import { useRole, normalizeRole } from '@/hooks/useRole'
import { ESTIMATOR_ROLES, APPROVER_ROLES, CROSS_BRANCH_ROLES } from '@/lib/roles'
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
      ['admin', 'ceo', 'install_estimating', 'maintenance_estimating', 'manager', 'regional_director', 'vice_president'].sort(),
    )
  })

  it('APPROVER_ROLES: approval-tier + admin (APPROVER_ROLES in authz.py)', () => {
    expect([...APPROVER_ROLES].sort()).toEqual(
      ['admin', 'ceo', 'manager', 'regional_director', 'vice_president'].sort(),
    )
  })

  it('CROSS_BRANCH_ROLES: org-wide visibility (CROSS_BRANCH_ROLES in authz.py)', () => {
    expect([...CROSS_BRANCH_ROLES].sort()).toEqual(['admin', 'ceo', 'vice_president'].sort())
  })
})

describe('canonical role set', () => {
  it('has exactly the nine business roles', () => {
    expect([...CANONICAL_ROLES].sort()).toEqual(
      [
        'admin',
        'ceo',
        'install_estimating',
        'maintenance_estimating',
        'manager',
        'procurement',
        'regional_director',
        'sales',
        'vice_president',
      ].sort(),
    )
  })

  it('normalizes legacy sales roles to sales', () => {
    expect(normalizeRole('inside_sales')).toBe('sales')
    expect(normalizeRole('outside_sales')).toBe('sales')
    expect(normalizeRole('manager')).toBe('manager')
  })
})

describe('useRole', () => {
  it('exposes the normalized role for legacy users', () => {
    expect(withRole('inside_sales').role).toBe('sales')
    expect(withRole('outside_sales').role).toBe('sales')
    expect(withRole('ceo').role).toBe('ceo')
  })

  it('admin is the super-role: canAccess always true', () => {
    const { canAccess } = withRole('admin')
    expect(canAccess('sales')).toBe(true)
    expect(canAccess(['manager'])).toBe(true)
  })

  it('manager is NOT a super-role anymore (narrows to its tier)', () => {
    const { canAccess } = withRole('manager')
    expect(canAccess('sales')).toBe(false)
    expect(canAccess('manager')).toBe(true)
  })

  it('legacy inside_sales users pass sales gates', () => {
    const { canAccess } = withRole('inside_sales')
    expect(canAccess('sales')).toBe(true)
    expect(canAccess('manager')).toBe(false)
  })

  it('maps estimating roles: line-item edit set (Handoff 28) vs approvers (mirrors api/authz.py)', () => {
    // Handoff 28: manager-tier roles added to ESTIMATOR_ROLES (line-item edit set).
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

  it('returns null role when logged out', () => {
    const { result } = renderHook(() => useRole())
    expect(result.current.role).toBeNull()
    expect(result.current.canAccess('sales')).toBe(false)
  })
})
