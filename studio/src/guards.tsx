import { Navigate } from 'react-router-dom'
import { RequireAuth, RoleGate } from '@/views/auth/RoleGate'
import { useRole } from '@/hooks/useRole'
import {
  SALES_NAV_ROLES,
  PUBLIC_LEADS_NAV_ROLES,
  ESTIMATING_NAV_ROLES,
  ANALYTICS_NAV_ROLES,
  defaultRouteForRole,
} from '@/lib/roles'

// ── Per-route workspace guards ──────────────────────────────────────────────
//
// Replaces the former blanket InsideSalesGuard. Each guard gates a specific
// area of the inside-sales workspace on the shared role-group arrays from
// lib/roles.ts, so direct URL navigation is blocked (not just hidden from
// nav). A denied role redirects to its own landing page via
// defaultRouteForRole() instead of /login.

/** `/inside-sales` — management and admin only. */
export function AnalyticsGuard({ children }: { children: React.ReactNode }) {
  const { role } = useRole()
  return (
    <RequireAuth>
      <RoleGate roles={ANALYTICS_NAV_ROLES} redirectTo={defaultRouteForRole(role)}>
        {children}
      </RoleGate>
    </RequireAuth>
  )
}

/** Index route: each role opens a page it can actually see. */
export function HomeRedirect() {
  const { role } = useRole()
  return <Navigate to={defaultRouteForRole(role)} replace />
}

export function SalesWorkspaceGuard({ children }: { children: React.ReactNode }) {
  const { role } = useRole()
  return (
    <RequireAuth>
      <RoleGate roles={SALES_NAV_ROLES} redirectTo={defaultRouteForRole(role)}>
        {children}
      </RoleGate>
    </RequireAuth>
  )
}

export function PublicLeadsGuard({ children }: { children: React.ReactNode }) {
  const { role } = useRole()
  return (
    <RequireAuth>
      <RoleGate roles={PUBLIC_LEADS_NAV_ROLES} redirectTo={defaultRouteForRole(role)}>
        {children}
      </RoleGate>
    </RequireAuth>
  )
}

export function EstimatingGuard({ children }: { children: React.ReactNode }) {
  const { role } = useRole()
  return (
    <RequireAuth>
      <RoleGate roles={ESTIMATING_NAV_ROLES} redirectTo={defaultRouteForRole(role)}>
        {children}
      </RoleGate>
    </RequireAuth>
  )
}
