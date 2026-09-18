import type { UserRole } from '@/types'

/** Roles that can view data across all branches / all CRMs. */
export const CROSS_BRANCH_ROLES: UserRole[] = ['admin', 'vp', 'ceo', 'manager']
