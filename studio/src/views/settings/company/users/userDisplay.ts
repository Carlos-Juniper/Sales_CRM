import type { AdminUser } from '@/api/settings'

/**
 * Whether a user row is active. Backend "deactivate, never delete" means a row
 * is active unless explicitly flagged 0/false — and `GET /api/users` may omit
 * the flag entirely today (Slice 6 shape gap), which can only mean active.
 */
export function isUserActive(user: Pick<AdminUser, 'active'>): boolean {
  if (user.active === undefined || user.active === null) return true
  return user.active === true || user.active === 1
}
