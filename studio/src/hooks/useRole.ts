import { useAuthStore } from '@/store/authStore'
import type { LegacyUserRole, UserRole } from '@/types'
import { ESTIMATOR_ROLES, APPROVER_ROLES, CROSS_BRANCH_ROLES } from '@/lib/roles'

// ── Canonical role model (mirrors api/authz.py) ─────────────────

const LEGACY_ROLE_MAP: Record<LegacyUserRole, UserRole> = {
  inside_sales: 'sales',
  outside_sales: 'sales',
}

/** Map a stored/JWT role onto the canonical vocabulary (legacy → sales). */
export function normalizeRole(role: UserRole | LegacyUserRole | string): UserRole {
  return (LEGACY_ROLE_MAP as Record<string, UserRole>)[role] ?? (role as UserRole)
}

export function useRole() {
  const user = useAuthStore((s) => s.user)
  const role: UserRole | null = user ? normalizeRole(user.role) : null

  return {
    role,
    isSales: role === 'sales',
    // `admin` is the super-role; `manager` narrows to its approval tier.
    isAdmin: role === 'admin',
    isManager: role === 'manager',
    isEstimator: role !== null && ESTIMATOR_ROLES.includes(role),
    isApprover: role !== null && APPROVER_ROLES.includes(role),
    seesAllBranches: role !== null && CROSS_BRANCH_ROLES.includes(role),
    canAccess: (requiredRole: UserRole | UserRole[]) => {
      if (!role) return false
      if (role === 'admin') return true
      const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
      return roles.includes(role)
    },
  }
}
