import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useRole } from '@/hooks/useRole'
import type { UserRole } from '@/types'

interface RoleGateProps {
  children: React.ReactNode
  roles: readonly UserRole[]
  redirectTo?: string
}

export function RoleGate({ children, roles, redirectTo = '/login' }: RoleGateProps) {
  const user = useAuthStore((s) => s.user)
  const { canAccess } = useRole()

  if (!user) return <Navigate to="/login" replace />
  if (!canAccess(roles)) return <Navigate to={redirectTo} replace />

  return <>{children}</>
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
