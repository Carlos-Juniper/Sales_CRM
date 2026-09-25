// ---------------------------------------------------------------------------
// Canonical frontend role sets — single source of truth.
// These mirror api/authz.py exactly. Import from here; do NOT redeclare inline.
// ---------------------------------------------------------------------------

import type { UserRole } from '@/types'

/**
 * Admin and the two sales roles that share every admin grant.
 * Mirrors api/authz.py ADMIN_EQUIVALENT_ROLES. regional_director and
 * vice_president are not members.
 */
export const ADMIN_EQUIVALENT_ROLES: readonly UserRole[] = [
  'admin',
  'regional_sales_rep',
  'vp_sales',
]

/** Roles that may edit line items, sections, and takeoff. */
export const ESTIMATOR_ROLES: readonly UserRole[] = [
  'maintenance_estimating',
  'install_estimating',
  ...ADMIN_EQUIVALENT_ROLES,
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
  ...ADMIN_EQUIVALENT_ROLES,
]

/** Roles with cross-branch visibility (BRD I-9.5). */
export const CROSS_BRANCH_ROLES: readonly UserRole[] = [
  ...ADMIN_EQUIVALENT_ROLES,
  'vice_president',
  'ceo',
]

/** Roles that may view sales performance / commission data for any rep.
 *  Broader than CROSS_BRANCH_ROLES — adds manager and regional_director so
 *  branch-level leaders can pick a rep without gaining full cross-branch write
 *  privileges. Mirrors api/authz.py REP_VIEWER_ROLES. */
export const REP_SELECTOR_ROLES: readonly UserRole[] = [
  ...ADMIN_EQUIVALENT_ROLES,
  'vice_president',
  'ceo',
  'manager',
  'regional_director',
]

/**
 * Roles that pick which sales rep's client references and team roster to edit.
 * A sales rep edits only their own rows and sees no picker. Marketing and
 * admin-equivalent roles are listed here (same pattern as
 * REP_SELECTOR_ROLES) because useRole checks membership, not only the
 * super-role bypass.
 */
export const ROSTER_REP_PICKER_ROLES: readonly UserRole[] = [
  'marketing',
  ...ADMIN_EQUIVALENT_ROLES,
]

// ── Workspace navigation role-groups ───────────────────────────────────────
//
// These are the single source of truth for which roles may reach which
// inside-sales routes. The Sidebar, the router guards, and the Estimating tab
// registry all import from here — do NOT redeclare inline.
//
// Admin-equivalent roles are the super-role: useRole().canAccess() bypasses
// any check for them, so listing them in FULL_ACCESS_ROLES is belt-and-suspenders.

/** Management plus admin-equivalent roles — see every tab, everywhere. */
export const FULL_ACCESS_ROLES: readonly UserRole[] = [
  'manager',
  'regional_director',
  'vice_president',
  'ceo',
  ...ADMIN_EQUIVALENT_ROLES,
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
 * Analytics nav item and `/inside-sales` (GET /api/dashboard/inside-sales).
 *
 * Defined once as FULL_ACCESS_ROLES: admin-equivalent roles (admin,
 * regional_sales_rep, vp_sales), manager, regional_director, vice_president,
 * and ceo. Field sales, including maintenance_sales and install_sales, are
 * not on this list — they use the pipeline. REP_SELECTOR_ROLES lists the
 * same people, but that constant is the sales-performance / commission rep
 * picker (api/authz.py REP_VIEWER_ROLES).
 */
export const ANALYTICS_NAV_ROLES: readonly UserRole[] = FULL_ACCESS_ROLES

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
  // Field sales share the sales workspace but not Analytics. Pipeline is a
  // page they can open, so a denied visit to /inside-sales does not bounce
  // back onto itself.
  if (role === 'sales' || role === 'maintenance_sales' || role === 'install_sales') {
    return '/inside-sales/pipeline'
  }
  // Management and admin-equivalent roles (admin, regional_sales_rep,
  // vp_sales) land on Analytics. Any other role (marketing, null, unknown)
  // has no inside-sales access — redirect to /settings, which is open to
  // every authenticated user, to avoid an infinite redirect loop.
  if (role !== null && ANALYTICS_NAV_ROLES.includes(role)) return '/inside-sales'
  return '/settings'
}
