import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'

export function useRole() {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? null

  return {
    role,
    isInsideSales: role === 'inside_sales',
    isOutsideSales: role === 'outside_sales',
    isManager: role === 'manager',
    canAccess: (requiredRole: UserRole | UserRole[]) => {
      if (!role) return false
      if (role === 'manager') return true
      const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
      return roles.includes(role)
    },
  }
}
