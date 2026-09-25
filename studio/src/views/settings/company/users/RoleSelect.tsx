import type { UserRole } from '@/types'
import { ASSIGNABLE_ROLES } from '@/lib/roles'
import { LEGACY_SALES_LABEL, ROLE_LABELS } from '@/lib/roleLabels'

/**
 * Role picker of assignable roles. A row that already stores `sales` or
 * `outside_sales` shows that value as a disabled option so the editor can
 * display it. It is not a choice for a new assignment.
 */
export function RoleSelect({
  value,
  onChange,
  currentRole,
  id,
  testId,
  ariaLabel,
}: {
  value: string
  onChange: (role: string) => void
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
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
    >
      {legacy && (
        <option value={legacy} disabled>
          {LEGACY_SALES_LABEL}
        </option>
      )}
      {ASSIGNABLE_ROLES.map((role: UserRole) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  )
}
