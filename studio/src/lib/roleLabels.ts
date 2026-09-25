import type { UserRole } from '@/types'

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
  regional_sales: 'Regional Sales',
  vp_sales: 'VP of Sales',
  manager: 'Branch Manager',
  regional_director: 'Regional Director',
  maintenance_estimating: 'Maintenance Estimating',
  install_estimating: 'Install Estimating',
  vice_president: 'Vice President',
  ceo: 'CEO',
  marketing: 'Marketing',
}

/** Human label for a stored role. Unknown values title-case the slug. */
export function roleLabel(role: string): string {
  if (role === 'sales' || role === 'outside_sales') return LEGACY_SALES_LABEL
  if (role in ROLE_LABELS) return ROLE_LABELS[role as UserRole]
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
