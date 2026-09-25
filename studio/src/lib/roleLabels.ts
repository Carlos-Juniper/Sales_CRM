import type { UserRole } from '@/types'

/** Human labels for the canonical roles. */
export const ROLE_LABELS: Record<UserRole, string> = {
  procurement: 'Procurement',
  sales: 'Sales',
  maintenance_sales: 'Maintenance Sales',
  install_sales: 'Install Sales',
  inside_sales: 'Inside Sales',
  admin: 'Admin',
  manager: 'Branch Manager',
  regional_director: 'Regional Director',
  maintenance_estimating: 'Maintenance Estimating',
  install_estimating: 'Install Estimating',
  vice_president: 'Vice President',
  ceo: 'CEO',
  marketing: 'Marketing',
}

/** Human label for a stored role. Unknown / legacy values title-case the slug. */
export function roleLabel(role: string): string {
  if (role in ROLE_LABELS) return ROLE_LABELS[role as UserRole]
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
