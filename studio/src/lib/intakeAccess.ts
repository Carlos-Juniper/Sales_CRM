import { ApiError } from '@/api/client'
import type { AuthUser, IntakeType } from '@/types'

const BOTH_INTAKE_TYPES: readonly IntakeType[] = ['maintenance', 'install']

type IntakeSession = Pick<AuthUser, 'allowed_intake_types'> | null | undefined

/**
 * Intake types the server allows for this session.
 *
 * Missing or null (an older backend that does not send the field) shows both
 * buttons so nothing disappears before that response ships. An explicit list
 * is used as-is — never derived from the user's role.
 */
export function allowedIntakeTypes(user: IntakeSession): IntakeType[] {
  const raw = user?.allowed_intake_types
  if (raw == null) return [...BOTH_INTAKE_TYPES]
  return raw.filter((t): t is IntakeType => t === 'maintenance' || t === 'install')
}

export function canStartIntake(user: IntakeSession, type: IntakeType): boolean {
  return allowedIntakeTypes(user).includes(type)
}

/**
 * Toast copy for a refused intake create, draft save, or draft resume.
 * A 403 carries the server's detail; anything else keeps the caller's fallback.
 */
export function intakeDeniedMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 403) {
    const message = err.message.trim()
    if (message) return message
    return 'You are not allowed to submit this intake type.'
  }
  return fallback
}
