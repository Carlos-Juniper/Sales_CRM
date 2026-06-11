import { RequireAuth, RoleGate } from '@/views/auth/RoleGate'

export function InsideSalesGuard({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RoleGate roles={['inside_sales', 'manager']} redirectTo="/outside-sales">
        {children}
      </RoleGate>
    </RequireAuth>
  )
}

export function OutsideSalesGuard({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RoleGate roles={['outside_sales', 'manager']} redirectTo="/inside-sales">
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
