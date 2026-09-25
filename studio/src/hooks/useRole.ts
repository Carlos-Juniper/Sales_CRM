import { useAuthStore } from '@/store/authStore'
import type { LegacyUserRole, UserRole } from '@/types'
import {
  ADMIN_EQUIVALENT_ROLES,
  ESTIMATOR_ROLES,
  ESTIMATING_ONLY_ROLES,
  APPROVER_ROLES,
  CROSS_BRANCH_ROLES,
  FIELD_SALES_ROLES,
  REP_SELECTOR_ROLES,
  ANALYTICS_NAV_ROLES,
  ROSTER_REP_PICKER_ROLES,
} from '@/lib/roles'

// ── Canonical role model (mirrors api/authz.py) ─────────────────

const LEGACY_ROLE_MAP: Record<LegacyUserRole, UserRole> = {
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
    isSales: role !== null && FIELD_SALES_ROLES.includes(role),
    // Admin-equivalent roles (admin, vp_sales) are the
    // super-role. `manager` narrows to its approval tier. regional_director
    // and vice_president are not admin-equivalent.
    isAdmin: role !== null && ADMIN_EQUIVALENT_ROLES.includes(role),
    isManager: role === 'manager',
    // Handoff 50 §3: cross-branch owner of company-wide proposal assets.
    isMarketing: role === 'marketing',
    // May manage company-wide proposal assets (portfolio, references, bios).
    // Mirrors api/authz.py MARKETING_ROLES (marketing + admin-equivalent).
    canManageMarketingAssets:
      role === 'marketing' || (role !== null && ADMIN_EQUIVALENT_ROLES.includes(role)),
    isEstimator: role !== null && ESTIMATOR_ROLES.includes(role),
    // The two estimating disciplines. Admin and management are isEstimator
    // (line-item edits) but can still read leads.
    isEstimatingOnly: role !== null && ESTIMATING_ONLY_ROLES.includes(role),
    isApprover: role !== null && APPROVER_ROLES.includes(role),
    seesAllBranches: role !== null && CROSS_BRANCH_ROLES.includes(role),
    // REP_SELECTOR_ROLES sees every rep. regional_sales gets the same picker
    // but the API limits it to themselves and their direct reports.
    canViewRepSelector:
      role !== null && (REP_SELECTOR_ROLES.includes(role) || role === 'regional_sales'),
    canViewAnalytics: role !== null && ANALYTICS_NAV_ROLES.includes(role),
    // Proposal settings: marketing/admin pick a rep; a sales rep does not.
    canPickRosterRep: role !== null && ROSTER_REP_PICKER_ROLES.includes(role),
    canAccess: (requiredRole: UserRole | readonly UserRole[]) => {
      if (!role) return false
      if (ADMIN_EQUIVALENT_ROLES.includes(role)) return true
      const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
      return roles.includes(role)
    },
  }
}
