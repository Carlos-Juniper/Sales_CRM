import { setupWorker } from 'msw/browser'
import { CANONICAL_ROLES, type UserRole } from '@/types'
import { handlers, mockAuthSession } from './handlers'

// Dev-only. Production builds do not import this module.
// Call applyMockRole() before worker.start() so ?mockRole= is applied first.
export function applyMockRole(search = window.location.search): void {
  const requested = new URLSearchParams(search).get('mockRole')
  if (requested && (CANONICAL_ROLES as readonly string[]).includes(requested)) {
    mockAuthSession.role = requested as UserRole
  }
}

export const worker = setupWorker(...handlers)
