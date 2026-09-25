// ---------------------------------------------------------------------------
// Canonical frontend role sets — single source of truth.
// These mirror api/authz.py exactly. Import from here; do NOT redeclare inline.
// ---------------------------------------------------------------------------

import type { UserRole } from '@/types'

/** Roles that may edit line items, sections, and takeoff. */
export const ESTIMATOR_ROLES: readonly UserRole[] = [
  'maintenance_estimating',
  'install_estimating',
  'admin',
  'manager',
  'regional_director',
  'vice_president',
  'ceo',
]

/**
 * The two estimating disciplines only. They are refused on leads and proposals
 * (api/authz.py ESTIMATING_ONLY_ROLES). Admin and management stay in
 * ESTIMATOR_ROLES for line-item edits, but they are not in this set.
 */
export const ESTIMATING_ONLY_ROLES: readonly UserRole[] = [
  'maintenance_estimating',
  'install_estimating',
]

/** Roles that own approval-tier actions (complexity/margin + approve/hand-back). */
export const APPROVER_ROLES: readonly UserRole[] = [
  'manager',
  'regional_director',
  'vice_president',
  'ceo',
  'admin',
]

/** Roles with cross-branch visibility (BRD I-9.5). */
export const CROSS_BRANCH_ROLES: readonly UserRole[] = ['admin', 'vice_president', 'ceo']

/** Roles that may view sales performance / commission data for any rep.
 *  Broader than CROSS_BRANCH_ROLES — adds manager and regional_director so
 *  branch-level leaders can pick a rep without gaining full cross-branch write
 *  privileges. Mirrors api/authz.py REP_VIEWER_ROLES. */
export const REP_SELECTOR_ROLES: readonly UserRole[] = [
  'admin',
  'vice_president',
  'ceo',
  'manager',
  'regional_director',
]

/**
 * Roles that pick which sales rep's client references and team roster to edit.
 * A sales rep edits only their own rows and sees no picker. Marketing and
 * admin are listed here; `admin` is explicit (same pattern as
 * REP_SELECTOR_ROLES) because useRole checks membership, not the super-role
 * bypass.
 */
export const ROSTER_REP_PICKER_ROLES: readonly UserRole[] = ['marketing', 'admin']

// ── Workspace navigation role-groups ───────────────────────────────────────
//
// These are the single source of truth for which roles may reach which
// inside-sales routes. The Sidebar, the router guards, and the Estimating tab
// registry all import from here — do NOT redeclare inline.
//
// admin is the super-role: useRole().canAccess() bypasses any check for admin,
// so listing admin explicitly in FULL_ACCESS_ROLES is belt-and-suspenders.

/** manager / regional_director / vice_president / ceo / admin — see every tab, everywhere. */
export const FULL_ACCESS_ROLES: readonly UserRole[] = [
  'manager', 'regional_director', 'vice_president', 'ceo', 'admin',
]

/**
 * Analytics nav item and `/inside-sales` (GET /api/dashboard/inside-sales).
 *
 * Defined once as FULL_ACCESS_ROLES: admin, manager, regional_director,
 * vice_president, and ceo. REP_SELECTOR_ROLES happens to list the same five
 * people, but that constant is the sales-performance / commission rep picker
 * (api/authz.py REP_VIEWER_ROLES). The backend keeps those permissions
 * separate (ANALYTICS_DASHBOARD_ROLES = FULL_ACCESS_ROLES), so this alias
 * does too.
 */
export const ANALYTICS_NAV_ROLES: readonly UserRole[] = FULL_ACCESS_ROLES

/** Shared sales tabs (leads / pipeline / proposals / calendar / accounts / map / commissions / sales-performance). Analytics is ANALYTICS_NAV_ROLES. */
export const SALES_NAV_ROLES: readonly UserRole[] = ['sales', ...FULL_ACCESS_ROLES]

/** Public Leads (the inside-sales qualification queue). */
export const PUBLIC_LEADS_NAV_ROLES: readonly UserRole[] = ['inside_sales', ...FULL_ACCESS_ROLES]

/** Anyone who can land on the Estimating page at all (sees at least the queue). */
export const ESTIMATING_NAV_ROLES: readonly UserRole[] = [
  'sales', 'procurement', 'maintenance_estimating', 'install_estimating', ...FULL_ACCESS_ROLES,
]

/**
 * Each role's own reachable landing page — used as RoleGate's `redirectTo`
 * so a denied role bounces to a page it *can* see instead of /login or a loop.
 */
export function defaultRouteForRole(role: UserRole | null): string {
  if (role === 'inside_sales') return '/inside-sales/leads'
  if (role === 'maintenance_estimating' || role === 'install_estimating' || role === 'procurement')
    return '/inside-sales/estimating'
  // Sales can use the rest of the sales workspace, but not Analytics.
  // Pipeline is their landing page so a denied visit to /inside-sales
  // does not bounce back onto itself.
  if (role === 'sales') return '/inside-sales/pipeline'
  // Management and admin land on Analytics. Any other role (marketing, null,
  // unknown) has no inside-sales access — redirect to /settings, which is
  // open to every authenticated user, to avoid an infinite redirect loop.
  if (role !== null && ANALYTICS_NAV_ROLES.includes(role)) return '/inside-sales'
  return '/settings'
}
