import { RequireAuth, RoleGate } from '@/views/auth/RoleGate'
import type { UserRole } from '@/types'

// The inside-sales workspace hosts the lead/bid views AND the estimating tab
// (queue, editors, approvals), so every business role that participates in
// that flow may enter. Real permissions (estimator-owned vs approver-owned,
// branch scope, approval tiers) are enforced SERVER-side;
// `admin` passes every gate via useRole's canAccess super-role.
const INSIDE_SALES_ROLES: UserRole[] = [
  'sales',
  'manager',
  'maintenance_estimating',
  'install_estimating',
  'regional_director',
  'vice_president',
  'ceo',
  'procurement',
]

export function InsideSalesGuard({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RoleGate roles={INSIDE_SALES_ROLES} redirectTo="/login">
        {children}
      </RoleGate>
    </RequireAuth>
  )
}

export function ManagerGuard({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RoleGate roles={['manager']} redirectTo="/inside-sales">
        {children}
      </RoleGate>
    </RequireAuth>
  )
}
