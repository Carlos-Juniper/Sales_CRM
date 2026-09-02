import { CANONICAL_ROLES, type UserRole } from '@/types'

/** Human labels for the canonical roles (select options are the raw slugs). */
const ROLE_LABELS: Record<UserRole, string> = {
  procurement: 'Procurement',
  sales: 'Sales',
  admin: 'Admin',
  manager: 'Branch Manager',
  regional_director: 'Regional Director',
  maintenance_estimating: 'Maintenance Estimating',
  install_estimating: 'Install Estimating',
  vice_president: 'Vice President',
  ceo: 'CEO',
}

/** Role picker backed by the canonical role vocabulary (mirrors api/authz). */
export function RoleSelect({
  value,
  onChange,
  id,
  testId,
  ariaLabel,
}: {
  value: UserRole
  onChange: (role: UserRole) => void
  id?: string
  testId?: string
  ariaLabel?: string
}) {
  return (
    <select
      id={id}
      data-testid={testId}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as UserRole)}
      className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
    >
      {CANONICAL_ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  )
}
