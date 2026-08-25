// ---------------------------------------------------------------------------
// Estimate status-transition handler.
//
// THE single place lifecycle rules live. UI never mutates status/lifecycle/
// ownership directly — it asks this module for a patch + audit records and
// persists both (the MSW handlers do the same server-side).
//
//   - Legal edges: STATUS_TRANSITIONS / canTransition.
//   - Side effects of entering a status (e.g. WON → aspireOwner flips to
//     'crm', lifecycle → 'won') are applied HERE, never in a component.
//   - Every transition emits a StatusTransitionRecord (actor + timestamp,
//     BRD III-1 auditability).
//   - "Approve & hand back to Sales" (BRD Steps 6/8) is an in-platform status
//     change, not an email: approveAndHandBack() chains → approved →
//     handed_back and returns one merged patch + per-step audit records.
//     The approval queue drives its approve action through the same
//     functions.
// ---------------------------------------------------------------------------

import type { AspireOwner, Estimate, EstimateLifecycle, EstimateStatus } from '@/types/estimating'

/**
 * A lifecycle (Bidding↔Won) edge riding the ONE status-transition audit trail
 * (no separate audit table). The `lifecycle:` prefix keeps
 * lifecycle edges distinguishable from status edges in the same table.
 */
export type LifecycleEdge = `lifecycle:${EstimateLifecycle}`

/** Who did it, when — persisted for every status change (BRD III-1). */
export interface StatusTransitionRecord {
  estimateId: string
  from: EstimateStatus | LifecycleEdge
  to: EstimateStatus | LifecycleEdge
  actor: string
  /** ISO timestamp. */
  at: string
}

export interface TransitionContext {
  actor: string
  /** ISO timestamp; defaults to now. */
  at?: string
}

/** The estimate fields a transition is allowed to touch. */
export interface TransitionPatch {
  status: EstimateStatus
  lifecycle?: EstimateLifecycle
  aspireOwner?: AspireOwner
}

export interface TransitionResult {
  /** Merged field changes — apply atomically with the audit records. */
  patch: TransitionPatch
  /** One record per edge walked, in order. */
  records: StatusTransitionRecord[]
}

export class IllegalTransitionError extends Error {
  constructor(from: EstimateStatus, to: EstimateStatus) {
    super(`Illegal estimate status transition: ${from} → ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

/** Legal edges of the §3.2 status machine. `won`/`lost` are terminal. */
export const STATUS_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  new_from_sales: ['queued', 'in_progress'],
  queued: ['in_progress'],
  in_progress: ['review', 'pending_approval', 'approved'],
  review: ['in_progress', 'pending_approval', 'approved'],
  pending_approval: ['in_progress', 'approved'],
  approved: ['handed_back'],
  handed_back: ['won', 'lost'],
  won: [],
  lost: [],
}

export function canTransition(from: EstimateStatus, to: EstimateStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to)
}

/**
 * Side effects of ENTERING a status. WON is the Aspire milestone where
 * ownership transfers from Estimating to the CRM (the salesperson).
 */
function sideEffectsFor(to: EstimateStatus): Omit<TransitionPatch, 'status'> {
  if (to === 'won') return { lifecycle: 'won', aspireOwner: 'crm' }
  return {}
}

/** Walk one legal edge; throws IllegalTransitionError otherwise. */
export function applyTransition(
  estimate: Pick<Estimate, 'id' | 'status'>,
  to: EstimateStatus,
  ctx: TransitionContext,
): TransitionResult {
  const from = estimate.status
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to)
  const at = ctx.at ?? new Date().toISOString()
  return {
    patch: { status: to, ...sideEffectsFor(to) },
    records: [{ estimateId: estimate.id, from, to, actor: ctx.actor, at }],
  }
}

/** Statuses from which "Approve & hand back to Sales" is available. */
export function canApproveAndHandBack(status: EstimateStatus): boolean {
  return status === 'approved' || canTransition(status, 'approved')
}

/**
 * The Approval & Handoff CTA: approve (if not already approved), then hand
 * back to the salesperson — all in-platform. Returns the merged patch plus an
 * audit record per step.
 */
export function approveAndHandBack(
  estimate: Pick<Estimate, 'id' | 'status'>,
  ctx: TransitionContext,
): TransitionResult {
  if (!canApproveAndHandBack(estimate.status)) {
    throw new IllegalTransitionError(estimate.status, 'handed_back')
  }
  const at = ctx.at ?? new Date().toISOString()
  const steps: EstimateStatus[] = estimate.status === 'approved' ? ['handed_back'] : ['approved', 'handed_back']

  let patch: TransitionPatch = { status: estimate.status }
  const records: StatusTransitionRecord[] = []
  let current = estimate.status
  for (const to of steps) {
    const step = applyTransition({ id: estimate.id, status: current }, to, { ...ctx, at })
    patch = { ...patch, ...step.patch }
    records.push(...step.records)
    current = to
  }
  return { patch, records }
}
