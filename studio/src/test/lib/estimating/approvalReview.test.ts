// ---------------------------------------------------------------------------
// Approval Queue & Review Drawer: pure logic (business rules).
//
//   effCost   = cost0 × (1 + (comp − comp0))
//   liveValue = effCost / (1 − margin)
//   liveTier  = tierForValue(liveValue, approval_tiers)
//   overCeiling = order(liveTier) > order(approverTier)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import type { ApprovalTier, Estimate } from '@/types/estimating'
import { estimatingApi } from '@/api/estimating'
import { APPROVAL_TIER_SEED, tiersForType } from '@/lib/estimating/config'
import { canEditField, assertCanEdit } from '@/lib/estimating/maintenance'
import {
  buildMaintenanceEstimate,
  buildInstallEstimate,
  toCreatePayload,
} from '@/mocks/estimatingData'
import {
  reviewBaseline,
  computeReview,
  isOverCeiling,
  routeApprovalQueue,
  queueForRole,
  queueStats,
  waitSeverity,
  escalationNote,
  SEND_BACK_REASONS,
  buildAdjustmentRecords,
  applyApproverAdjustments,
  recordAdjustments,
  tierRangeLabel,
} from '@/lib/estimating/approvalReview'

const MAINT_TIERS = tiersForType(APPROVAL_TIER_SEED, 'maintenance')
const mgr = MAINT_TIERS.find((t) => t.roleKey === 'manager')!
const rd = MAINT_TIERS.find((t) => t.roleKey === 'regional_director')!
const ceo = MAINT_TIERS.find((t) => t.roleKey === 'ceo')!

/** Pending-approval maintenance estimate with uniform complexity for clean math. */
function pendingEstimate(
  valueCents: number,
  { complexity = 0.1, margin = 0.22, ...rest }: { complexity?: number; margin?: number } & Partial<
    Parameters<typeof buildMaintenanceEstimate>[0]
  > = {},
): Estimate {
  const est = buildMaintenanceEstimate({
    status: 'pending_approval',
    targetMargin: margin,
    contractValueCents: valueCents,
    ...rest,
  })
  est.sections.forEach((s) => s.services.forEach((v) => (v.complexityPct = complexity)))
  return est
}

// ----- Baseline ---------------------------------------------------------------

describe('reviewBaseline', () => {
  it('derives value0 / cost0 / comp0 / margin0 from the estimate', () => {
    const est = pendingEstimate(9_500_000, { complexity: 0.1, margin: 0.22 })
    const b = reviewBaseline(est)
    expect(b.value0Cents).toBe(9_500_000)
    expect(b.margin0Pct).toBe(22)
    expect(b.comp0Pct).toBe(10) // uniform 10% complexity
    expect(b.cost0Cents).toBe(Math.round(9_500_000 * 0.78))
  })

  it('groups sum to the contract value (per-section, scaled)', () => {
    const est = pendingEstimate(9_500_000)
    const b = reviewBaseline(est)
    expect(b.groups).toHaveLength(est.sections.length)
    expect(b.groups.map((g) => g.label)).toEqual(est.sections.map((s) => s.name))
    const sum = b.groups.reduce((s, g) => s + g.price0Cents, 0)
    expect(Math.abs(sum - 9_500_000)).toBeLessThanOrEqual(b.groups.length) // rounding only
  })
})

// ----- Live recompute (§3) ------------------------------------------------------

describe('computeReview', () => {
  // Design fixture: $358,000 · comp0 18 · margin0 22.
  const baseline = {
    value0Cents: 35_800_000,
    cost0Cents: Math.round(35_800_000 * 0.78), // 27,924,000
    comp0Pct: 18,
    margin0Pct: 22,
    groups: [
      { label: 'Mowing', price0Cents: 17_600_000, cost0Cents: Math.round(17_600_000 * 0.78) },
      { label: 'Irrigation', price0Cents: 18_200_000, cost0Cents: Math.round(18_200_000 * 0.78) },
    ],
  }

  it('is identity at the baseline levers (changed=false)', () => {
    const r = computeReview(baseline, 18, 22, MAINT_TIERS)
    expect(r.effCostCents).toBe(27_924_000)
    expect(r.liveValueCents).toBe(35_800_000)
    expect(r.changed).toBe(false)
    expect(r.liveTier?.roleKey).toBe('vice_president') // $358K → $250K–$1M band
  })

  it('complexity delta scales cost; margin re-prices (effCost / (1 − margin))', () => {
    const r = computeReview(baseline, 28, 22, MAINT_TIERS) // +10 pts complexity
    expect(r.effCostCents).toBe(Math.round(27_924_000 * 1.1)) // 30,716,400
    expect(r.liveValueCents).toBe(Math.round(30_716_400 / 0.78))
    expect(r.changed).toBe(true)
  })

  it('margin-only change re-prices without touching cost', () => {
    const r = computeReview(baseline, 18, 30, MAINT_TIERS)
    expect(r.effCostCents).toBe(27_924_000)
    expect(r.liveValueCents).toBe(Math.round(27_924_000 / 0.7))
  })

  it('recomputes each group with the same complexity ratio + new margin', () => {
    const r = computeReview(baseline, 28, 30, MAINT_TIERS)
    const g0cost = Math.round(17_600_000 * 0.78) * 1.1
    expect(r.groups[0].priceCents).toBe(Math.round(g0cost / 0.7))
    // group margin readout is the applied margin
    expect(r.groups[0].marginPct).toBeCloseTo(30, 5)
    // groups sum to the live total (± rounding)
    const sum = r.groups.reduce((s, g) => s + g.priceCents, 0)
    expect(Math.abs(sum - r.liveValueCents)).toBeLessThanOrEqual(r.groups.length)
  })

  it('routes the live value through the config ladder', () => {
    // $95K → Manager; margin 30% pushes it to $105,857 → RD
    const b = reviewBaseline(pendingEstimate(9_500_000))
    expect(computeReview(b, 10, 22, MAINT_TIERS).liveTier?.roleKey).toBe('manager')
    expect(computeReview(b, 10, 30, MAINT_TIERS).liveTier?.roleKey).toBe('regional_director')
  })
})

describe('isOverCeiling', () => {
  it('is true only when the live tier outranks the approver tier (MGR<RD<VP<CEO)', () => {
    expect(isOverCeiling(rd, mgr)).toBe(true)
    expect(isOverCeiling(mgr, rd)).toBe(false)
    expect(isOverCeiling(mgr, mgr)).toBe(false)
    expect(isOverCeiling(ceo, rd)).toBe(true)
  })

  it('is false when either tier is unresolved (no matrix)', () => {
    expect(isOverCeiling(null, mgr)).toBe(false)
    expect(isOverCeiling(rd, null)).toBe(false)
  })
})

// ----- Queue routing & stats ------------------------------------------------------

describe('routeApprovalQueue / queueForRole', () => {
  it('routes pending_approval estimates to tiers by contract value (config-driven)', () => {
    const a = pendingEstimate(9_500_000) // Manager
    const b = pendingEstimate(15_000_000) // RD
    const c = buildMaintenanceEstimate({ status: 'in_progress', contractValueCents: 5_000_000 })
    const routed = routeApprovalQueue([a, b, c], APPROVAL_TIER_SEED)
    expect(routed).toHaveLength(2)
    expect(queueForRole(routed, 'manager').map((r) => r.estimate.id)).toEqual([a.id])
    expect(queueForRole(routed, 'regional_director').map((r) => r.estimate.id)).toEqual([b.id])
    expect(queueForRole(routed, 'ceo')).toHaveLength(0)
  })

  it('routes INSTALL estimates through the install ladder — same bands as maintenance', () => {
    const inst = buildInstallEstimate({ status: 'pending_approval', contractValueCents: 15_000_000 })
    const routed = routeApprovalQueue([inst], APPROVAL_TIER_SEED)
    expect(routed).toHaveLength(1)
    expect(routed[0].tier?.estimateType).toBe('install')
    expect(queueForRole(routed, 'regional_director').map((r) => r.estimate.id)).toEqual([inst.id])
    for (const role of ['manager', 'vice_president', 'ceo'] as const) {
      expect(queueForRole(routed, role)).toHaveLength(0)
    }
  })

  it('computes waited days from updatedAt', () => {
    const now = new Date('2026-07-23T12:00:00Z')
    const est = pendingEstimate(9_500_000)
    est.updatedAt = new Date('2026-07-20T12:00:00Z').toISOString()
    const [r] = routeApprovalQueue([est], APPROVAL_TIER_SEED, now)
    expect(r.waitedDays).toBe(3)
  })
})

describe('queueStats & waitSeverity', () => {
  it('computes awaiting count, value pending, and oldest waiting', () => {
    const now = new Date('2026-07-23T12:00:00Z')
    const a = pendingEstimate(9_500_000)
    a.updatedAt = new Date('2026-07-19T12:00:00Z').toISOString() // 4d
    const b = pendingEstimate(4_000_000)
    b.updatedAt = new Date('2026-07-22T12:00:00Z').toISOString() // 1d
    const routed = queueForRole(routeApprovalQueue([a, b], APPROVAL_TIER_SEED, now), 'manager')
    const stats = queueStats(routed)
    expect(stats.count).toBe(2)
    expect(stats.valuePendingCents).toBe(13_500_000)
    expect(stats.oldestDays).toBe(4)
  })

  it('applies the assumed color thresholds: amber ≥3 days, red ≥4', () => {
    expect(waitSeverity(0)).toBe('normal')
    expect(waitSeverity(2)).toBe('normal')
    expect(waitSeverity(3)).toBe('amber')
    expect(waitSeverity(4)).toBe('red')
    expect(waitSeverity(9)).toBe('red')
  })
})

describe('escalationNote / tierRangeLabel', () => {
  it('flags the CEO >$1M mechanism as an open item', () => {
    expect(escalationNote(ceo)).toMatch(/CEO mechanism to confirm/i)
    expect(escalationNote(mgr)).toBeNull()
    expect(escalationNote(null)).toBeNull()
  })

  it('formats tier ranges from config cents', () => {
    expect(tierRangeLabel(mgr)).toBe('Under $100K')
    expect(tierRangeLabel(rd)).toBe('$100K–$250K')
    expect(tierRangeLabel(ceo)).toBe('Over $1M')
  })
})

// ----- Audit + revert + ownership (BRD III-1) ---------------------------------------

describe('adjustment audit', () => {
  it('writes one record per changed lever with from/to decimals and actor', () => {
    const records = buildAdjustmentRecords(
      'est-1',
      'Amanda Torres',
      { comp0Pct: 18, margin0Pct: 22 },
      { compPct: 24, marginPct: 25 },
      '2026-07-23T12:00:00Z',
    )
    expect(records).toHaveLength(2)
    const complexity = records.find((r) => r.field === 'complexity')!
    expect(complexity.fromValue).toBeCloseTo(0.18)
    expect(complexity.toValue).toBeCloseTo(0.24)
    expect(complexity.actor).toBe('Amanda Torres')
    const margin = records.find((r) => r.field === 'margin')!
    expect(margin.fromValue).toBeCloseTo(0.22)
    expect(margin.toValue).toBeCloseTo(0.25)
  })

  it('writes nothing when the levers sit at baseline', () => {
    expect(
      buildAdjustmentRecords('est-1', 'A', { comp0Pct: 18, margin0Pct: 22 }, { compPct: 18, marginPct: 22 }),
    ).toHaveLength(0)
  })

  it('revert-to-original is itself an audited from/to record back to baseline', () => {
    const records = buildAdjustmentRecords(
      'est-1',
      'A',
      { comp0Pct: 24, margin0Pct: 25 },
      { compPct: 18, marginPct: 22 },
    )
    expect(records.map((r) => [r.fromValue, r.toValue])).toEqual([
      [0.24, 0.18],
      [0.25, 0.22],
    ])
  })

  it('recordAdjustments PERSISTS the rows — GET /adjustments returns the trail (survives reload)', async () => {
    const est = await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate({ status: 'pending_approval' })),
    )
    const records = buildAdjustmentRecords(
      est.id, 'Amanda Torres', { comp0Pct: 10, margin0Pct: 22 }, { compPct: 12, marginPct: 22 },
    )
    const saved = await recordAdjustments(records)
    expect(saved).toHaveLength(1)

    // A "reload" (fresh GET) shows the persisted row — not an in-memory array.
    const trail = await estimatingApi.listAdjustments(est.id)
    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({
      estimateId: est.id,
      field: 'complexity',
      actor: 'Amanda Torres',
    })
    expect(trail[0].fromValue).toBeCloseTo(0.1)
    expect(trail[0].toValue).toBeCloseTo(0.12)
    expect(trail[0].id).toBeTruthy()
    expect(Number.isNaN(Date.parse(trail[0].createdAt))).toBe(false)
  })

  it('a revert persists a REVERSING row — the trail shows both the change and the revert (BRD III-1)', async () => {
    const est = await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate({ status: 'pending_approval' })),
    )
    // The change: margin 22 → 30.
    await recordAdjustments(
      buildAdjustmentRecords(est.id, 'A', { comp0Pct: 10, margin0Pct: 22 }, { compPct: 10, marginPct: 30 }),
    )
    // The revert: margin 30 → back to the original 22 (current → original).
    await recordAdjustments(
      buildAdjustmentRecords(est.id, 'A', { comp0Pct: 10, margin0Pct: 30 }, { compPct: 10, marginPct: 22 }),
    )
    const trail = await estimatingApi.listAdjustments(est.id)
    expect(trail.map((r) => [r.fromValue, r.toValue])).toEqual([
      [0.22, 0.3],
      [0.3, 0.22],
    ])
  })
})

describe('applyApproverAdjustments — approver-owned levers only', () => {
  it('patches ONLY targetMargin + the derived contract value — never sections/line items', () => {
    const est = pendingEstimate(9_500_000)
    const { patch, records } = applyApproverAdjustments(est, MAINT_TIERS, { compPct: 12, marginPct: 25 }, 'Amanda')
    expect(Object.keys(patch).sort()).toEqual(['contractValueCents', 'targetMargin'])
    expect(patch.targetMargin).toBeCloseTo(0.25)
    const expectedCost = Math.round(9_500_000 * 0.78) * 1.02
    expect(patch.contractValueCents).toBe(Math.round(expectedCost / 0.75))
    expect(records).toHaveLength(2)
  })

  it('the ownership model forbids approvers from touching estimator-owned fields', () => {
    expect(canEditField('approver', 'lineItems')).toBe(false)
    expect(canEditField('approver', 'qty')).toBe(false)
    expect(canEditField('approver', 'squareFeet')).toBe(false)
    expect(() => assertCanEdit('approver', 'lineItems')).toThrow(/estimator-owned/)
    // the two audited levers remain legal
    expect(canEditField('approver', 'complexity')).toBe(true)
    expect(canEditField('approver', 'margin')).toBe(true)
  })
})

// ----- Send-back config -----------------------------------------------------------

describe('SEND_BACK_REASONS', () => {
  it('matches the design chip set', () => {
    expect(SEND_BACK_REASONS).toEqual([
      'Takeoff / boundaries off',
      'Scope mismatch',
      'Pricing concern',
      'Missing service line',
      'Regional template wrong',
    ])
  })
})

// keep the tier fixtures honest against the seed
describe('seed sanity', () => {
  it('MGR < RD < VP < CEO ordering holds in config', () => {
    const orders = MAINT_TIERS.map((t: ApprovalTier) => t.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })
})
