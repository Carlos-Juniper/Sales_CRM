import { CANONICAL_ROLES, type UserRole } from '@/types'
import { hasRole, isRetiredSalesRole } from '@/lib/roles'

/** Shown for stored `sales` and `outside_sales` rows. Not an assignable option. */
export const LEGACY_SALES_LABEL = 'Legacy: Sales (reassign)'

/** Human labels for the canonical roles. */
export const ROLE_LABELS: Record<UserRole, string> = {
  procurement: 'Procurement',
  sales: LEGACY_SALES_LABEL,
  maintenance_sales: 'Maintenance Sales',
  install_sales: 'Install Sales',
  inside_sales: 'Inside Sales',
  admin: 'Admin',
  vp_sales: 'VP of Sales',
  manager: 'Branch Manager',
  regional_director: 'Regional Director',
  maintenance_estimating: 'Maintenance Estimating',
  install_estimating: 'Install Estimating',
  vice_president: 'Vice President',
  ceo: 'CEO',
  marketing: 'Marketing',
  sales_manager: 'Sales Manager',
  maintenance_estimating_manager: 'Maintenance Estimating Manager',
  install_estimating_manager: 'Install Estimating Manager',
}

/** Human label for a stored role. Unknown values title-case the slug. */
export function roleLabel(role: string): string {
  if (isRetiredSalesRole(role)) return LEGACY_SALES_LABEL
  if (hasRole(CANONICAL_ROLES, role)) return ROLE_LABELS[role]
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
