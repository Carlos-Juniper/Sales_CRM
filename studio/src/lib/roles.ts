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
 * Field sales: legacy `sales` plus the maintenance/install split.
 * Same access as `sales` (own leads, proposals, self-scoped performance).
 * Not the rep-selector viewer list, and not Public Leads.
 * Mirrors api/authz.py FIELD_SALES_ROLES.
 */
export const FIELD_SALES_ROLES: readonly UserRole[] = [
  'sales',
  'maintenance_sales',
  'install_sales',
]

/**
 * Analytics nav item and `/inside-sales`. Legacy `sales` stays here.
 * `maintenance_sales` and `install_sales` do not — they use the rest of the
 * sales workspace, not the company dashboard.
 */
export const ANALYTICS_NAV_ROLES: readonly UserRole[] = ['sales', ...FULL_ACCESS_ROLES]

/** Shared sales tabs (pipeline / own leads / proposals / calendar / accounts / map / commissions / sales-performance). Analytics is ANALYTICS_NAV_ROLES. */
export const SALES_NAV_ROLES: readonly UserRole[] = [...FIELD_SALES_ROLES, ...FULL_ACCESS_ROLES]

/** Public Leads (the inside-sales qualification queue). */
export const PUBLIC_LEADS_NAV_ROLES: readonly UserRole[] = ['inside_sales', ...FULL_ACCESS_ROLES]

/** Anyone who can land on the Estimating page at all (sees at least the queue). */
export const ESTIMATING_NAV_ROLES: readonly UserRole[] = [
  ...FIELD_SALES_ROLES,
  'procurement',
  'maintenance_estimating',
  'install_estimating',
  ...FULL_ACCESS_ROLES,
]

/** Aspire ContactID is required for the same roles that stamp SalesRepID. */
export function requiresAspireSalesRep(role: string): boolean {
  return (FIELD_SALES_ROLES as readonly string[]).includes(role)
}

/**
 * Each role's own reachable landing page — used as RoleGate's `redirectTo`
 * so a denied role bounces to a page it *can* see instead of /login or a loop.
 */
export function defaultRouteForRole(role: UserRole | null): string {
  if (role === 'inside_sales') return '/inside-sales/leads'
  if (role === 'maintenance_estimating' || role === 'install_estimating' || role === 'procurement')
    return '/inside-sales/estimating'
  // Split field-sales roles share the sales workspace but not Analytics.
  // Pipeline is a page they can open, so a denied visit to /inside-sales
  // does not bounce back onto itself.
  if (role === 'maintenance_sales' || role === 'install_sales') return '/inside-sales/pipeline'
  // sales and the full-access tier all have Analytics at /inside-sales.
  // Any other role (marketing, null, unknown) has no inside-sales access —
  // redirect to /settings, which is open to every authenticated user, to
  // avoid an infinite redirect loop.
  if (role !== null && SALES_NAV_ROLES.includes(role)) return '/inside-sales'
  return '/settings'
}
