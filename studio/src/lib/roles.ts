// ---------------------------------------------------------------------------
// Canonical frontend role sets — single source of truth (Handoff 28).
// These mirror api/authz.py exactly. Import from here; do NOT redeclare inline.
// ---------------------------------------------------------------------------

import type { UserRole } from '@/types'

/** Roles that may edit line items, sections, and takeoff (Handoff 28). */
export const ESTIMATOR_ROLES: readonly UserRole[] = [
  'maintenance_estimating',
  'install_estimating',
  'admin',
  'manager',
  'regional_director',
  'vice_president',
  'ceo',
]

/** Roles that own approval-tier actions (complexity/margin + approve/hand-back). */
export const APPROVER_ROLES: readonly UserRole[] = [
  'manager',
  'regional_director',
  'vice_president',
  'ceo',
  'admin',
]

/** Roles with cross-branch visibility (BRD I-9.5). */
export const CROSS_BRANCH_ROLES: readonly UserRole[] = ['admin', 'vice_president', 'ceo']
