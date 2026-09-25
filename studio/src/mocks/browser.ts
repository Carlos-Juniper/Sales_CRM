import { setupWorker } from 'msw/browser'
import { CANONICAL_ROLES, type UserRole } from '@/types'
import { handlers, mockAuthSession } from './handlers'

// Dev-only: /inside-sales/commissions?mockRole=admin shows the rep picker
// and mark-paid actions. Production builds do not import this module.
const requested = new URLSearchParams(window.location.search).get('mockRole')
if (requested && (CANONICAL_ROLES as readonly string[]).includes(requested)) {
  mockAuthSession.role = requested as UserRole
}

export const worker = setupWorker(...handlers)
