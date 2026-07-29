// ---------------------------------------------------------------------------
// Handoff 08 — status-transition module (pure lib).
//
// Lifecycle side-effects (e.g. WON → aspireOwner flips to 'crm') are enforced
// HERE, in the transition handler, never in the UI. Every transition carries
// an actor + timestamp audit record (BRD III-1); "Approve & hand back" is an
// in-platform status change, not an email (BRD Steps 6/8).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  canTransition,
  applyTransition,
  approveAndHandBack,
  canApproveAndHandBack,
  IllegalTransitionError,
} from '@/lib/estimating/transitions'
import { buildMaintenanceEstimate } from '@/mocks/estimatingData'

const CTX = { actor: 'Rita Delgado (RD)', at: '2026-07-23T15:00:00.000Z' }

describe('canTransition', () => {
  it('allows approved → handed_back (the in-platform handoff)', () => {
    expect(canTransition('approved', 'handed_back')).toBe(true)
  })

  it('allows pending_approval → approved', () => {
    expect(canTransition('pending_approval', 'approved')).toBe(true)
  })

  it('rejects skipping the approval: queued → handed_back', () => {
    expect(canTransition('queued', 'handed_back')).toBe(false)
  })

  it('treats won and lost as terminal', () => {
    expect(canTransition('won', 'in_progress')).toBe(false)
    expect(canTransition('lost', 'queued')).toBe(false)
  })
})

describe('applyTransition', () => {
  it('produces a status patch plus an audit record with actor and timestamp', () => {
    const est = buildMaintenanceEstimate({ status: 'pending_approval' })
    const result = applyTransition(est, 'approved', CTX)
    expect(result.patch.status).toBe('approved')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      estimateId: est.id,
      from: 'pending_approval',
      to: 'approved',
      actor: 'Rita Delgado (RD)',
      at: '2026-07-23T15:00:00.000Z',
    })
  })

  it('defaults the audit timestamp to now (ISO) when not supplied', () => {
    const est = buildMaintenanceEstimate({ status: 'approved' })
    const before = Date.now()
    const result = applyTransition(est, 'handed_back', { actor: 'BM' })
    const at = Date.parse(result.records[0].at)
    expect(at).toBeGreaterThanOrEqual(before)
    expect(at).toBeLessThanOrEqual(Date.now())
  })

  it('WON flips lifecycle and Aspire ownership to the CRM — a transition-handler side effect, not a UI one', () => {
    const est = buildMaintenanceEstimate({ status: 'handed_back' })
    const result = applyTransition(est, 'won', CTX)
    expect(result.patch).toMatchObject({
      status: 'won',
      lifecycle: 'won',
      aspireOwner: 'crm',
    })
  })

  it('non-WON transitions carry no ownership side effects', () => {
    const est = buildMaintenanceEstimate({ status: 'approved' })
    const result = applyTransition(est, 'handed_back', CTX)
    expect(result.patch.lifecycle).toBeUndefined()
    expect(result.patch.aspireOwner).toBeUndefined()
  })

  it('throws IllegalTransitionError on a disallowed edge', () => {
    const est = buildMaintenanceEstimate({ status: 'won' })
    expect(() => applyTransition(est, 'in_progress', CTX)).toThrow(IllegalTransitionError)
  })
})

describe('approveAndHandBack', () => {
  it('from pending_approval: lands on handed_back with TWO audit records (approved, then handed_back)', () => {
    const est = buildMaintenanceEstimate({ status: 'pending_approval' })
    const result = approveAndHandBack(est, CTX)
    expect(result.patch.status).toBe('handed_back')
    expect(result.records.map((r) => `${r.from}→${r.to}`)).toEqual([
      'pending_approval→approved',
      'approved→handed_back',
    ])
    for (const r of result.records) {
      expect(r.actor).toBe(CTX.actor)
      expect(r.at).toBe(CTX.at)
    }
  })

  it('from in_progress (branch review done in-line): also lands on handed_back', () => {
    const est = buildMaintenanceEstimate({ status: 'in_progress' })
    const result = approveAndHandBack(est, CTX)
    expect(result.patch.status).toBe('handed_back')
    expect(result.records.at(-1)).toMatchObject({ from: 'approved', to: 'handed_back' })
  })

  it('from approved: only the handoff step remains (one record)', () => {
    const est = buildMaintenanceEstimate({ status: 'approved' })
    const result = approveAndHandBack(est, CTX)
    expect(result.patch.status).toBe('handed_back')
    expect(result.records).toHaveLength(1)
  })

  it('throws for terminal / already-handed-back statuses', () => {
    expect(() =>
      approveAndHandBack(buildMaintenanceEstimate({ status: 'handed_back' }), CTX),
    ).toThrow(IllegalTransitionError)
    expect(() => approveAndHandBack(buildMaintenanceEstimate({ status: 'won' }), CTX)).toThrow(
      IllegalTransitionError,
    )
  })

  it('canApproveAndHandBack mirrors the eligible statuses', () => {
    expect(canApproveAndHandBack('pending_approval')).toBe(true)
    expect(canApproveAndHandBack('review')).toBe(true)
    expect(canApproveAndHandBack('in_progress')).toBe(true)
    expect(canApproveAndHandBack('approved')).toBe(true)
    expect(canApproveAndHandBack('handed_back')).toBe(false)
    expect(canApproveAndHandBack('won')).toBe(false)
    expect(canApproveAndHandBack('lost')).toBe(false)
  })
})
