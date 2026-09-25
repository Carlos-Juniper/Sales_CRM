import type { UserRole } from '@/types'
import { ASSIGNABLE_ROLES } from '@/lib/roles'
import { LEGACY_SALES_LABEL, ROLE_LABELS } from '@/lib/roleLabels'

export type RoleSelectValue = UserRole | 'outside_sales'

/**
 * Role picker of assignable roles. Legacy `sales` / `outside_sales` are not
 * choices. Pass `currentRole` when editing a row that already has one, so
 * the select can show "Legacy: Sales (reassign)" without offering it to
 * anyone else.
 */
export function RoleSelect({
  value,
  onChange,
  currentRole,
  id,
  testId,
  ariaLabel,
}: {
  value: RoleSelectValue
  onChange: (role: RoleSelectValue) => void
  currentRole?: string
  id?: string
  testId?: string
  ariaLabel?: string
}) {
  const legacy =
    currentRole === 'sales' || currentRole === 'outside_sales' ? currentRole : null
  return (
    <select
      id={id}
      data-testid={testId}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as RoleSelectValue)}
      className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
    >
      {legacy && (
        <option value={legacy}>{LEGACY_SALES_LABEL}</option>
      )}
      {ASSIGNABLE_ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  )
}
