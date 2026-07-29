// ---------------------------------------------------------------------------
// Approver review logic (Handoff 09 — Approval Queue & Review Drawer).
//
// Pure §3 business rules for the approver inbox + drawer:
//
//   effCost   = cost0 × (1 + (comp − comp0))     // complexity delta scales cost
//   liveValue = effCost / (1 − margin)           // margin re-prices
//   liveTier  = tierForValue(liveValue, tiers)   // config ladder, never hardcoded
//   overCeiling = order(liveTier) > order(approverTier)   // BM<RD<BP<COO
//
// Hours-vs-price principle: complexity adjusts hours (→ cost); margin adjusts
// price. Both are AUDITED (estimate_adjustments, BRD III-1) and revertible.
// Approvers own ONLY these two levers — line items / takeoff / scope are
// estimator-owned, enforced through canEditField (lib/estimating/maintenance),
// not by hiding buttons: applyApproverAdjustments can emit a patch touching
// nothing but targetMargin + the derived contract-value roll-up.
// ---------------------------------------------------------------------------

import type {
  ApprovalRoleKey,
  ApprovalTier,
  Estimate,
  EstimateAdjustment,
} from '@/types/estimating'
import { sectionTotal, tierForValue } from './calc'
import { assertCanEdit } from './maintenance'

// ----- Baseline ----------------------------------------------------------------

export interface ReviewGroupBaseline {
  label: string
  /** Group price at the estimator's baseline, integer cents. */
  price0Cents: number
  /** Group cost at the estimator's baseline, integer cents. */
  cost0Cents: number
}

/** The estimator-generated originals the drawer reverts to (BRD III-1). */
export interface ReviewBaseline {
  value0Cents: number
  cost0Cents: number
  /** Integer percent (slider units), 0–30. */
  comp0Pct: number
  /** Integer percent (slider units), 10–40. */
  margin0Pct: number
  groups: ReviewGroupBaseline[]
}

/**
 * Baseline complexity: the value-weighted mean of the services' complexityPct,
 * as an integer percent. A uniform complexity yields exactly that value.
 */
function baselineComplexityPct(estimate: Estimate): number {
  let weighted = 0
  let total = 0
  for (const section of estimate.sections) {
    for (const svc of section.services) {
      const single = { ...section, services: [svc] }
      const line = sectionTotal(single, estimate.estimateType)
      weighted += line * svc.complexityPct
      total += line
    }
  }
  return total === 0 ? 0 : Math.round((weighted / total) * 100)
}

/**
 * Derive the drawer baseline from an estimate. `contractValueCents` (the
 * persisted roll-up used for routing) is the source of truth for value0;
 * section totals are proportionally scaled so groups sum to it.
 */
export function reviewBaseline(estimate: Estimate): ReviewBaseline {
  const value0Cents = estimate.contractValueCents
  const margin0Pct = Math.round(estimate.targetMargin * 100)
  const cost0Cents = Math.round(value0Cents * (1 - margin0Pct / 100))
  const sectionTotals = estimate.sections.map((s) => ({
    label: s.name,
    total: sectionTotal(s, estimate.estimateType),
  }))
  const sum = sectionTotals.reduce((acc, s) => acc + s.total, 0)
  const scale = sum === 0 ? 0 : value0Cents / sum
  const groups: ReviewGroupBaseline[] = sectionTotals.map((s) => {
    const price0 = Math.round(s.total * scale)
    return {
      label: s.label,
      price0Cents: price0,
      cost0Cents: Math.round(price0 * (1 - margin0Pct / 100)),
    }
  })
  return { value0Cents, cost0Cents, comp0Pct: baselineComplexityPct(estimate), margin0Pct, groups }
}

// ----- Live recompute (§3) -------------------------------------------------------

export interface ReviewGroupComputed {
  label: string
  priceCents: number
  /** The applied gross margin, in percent. */
  marginPct: number
}

export interface ReviewComputation {
  effCostCents: number
  liveValueCents: number
  liveTier: ApprovalTier | null
  groups: ReviewGroupComputed[]
  /** True when either lever deviates from the baseline. */
  changed: boolean
}

/** Recompute the drawer readouts for the current slider positions. */
export function computeReview(
  baseline: ReviewBaseline,
  compPct: number,
  marginPct: number,
  tiers: ApprovalTier[],
): ReviewComputation {
  const compRatio = 1 + (compPct - baseline.comp0Pct) / 100
  const marginFactor = 1 - marginPct / 100
  const effCostCents = Math.round(baseline.cost0Cents * compRatio)
  const liveValueCents = Math.round(effCostCents / marginFactor)
  const groups: ReviewGroupComputed[] = baseline.groups.map((g) => {
    const cost = Math.round(g.cost0Cents * compRatio)
    return {
      label: g.label,
      priceCents: Math.round(cost / marginFactor),
      marginPct,
    }
  })
  return {
    effCostCents,
    liveValueCents,
    liveTier: tierForValue(liveValueCents, tiers),
    groups,
    changed: compPct !== baseline.comp0Pct || marginPct !== baseline.margin0Pct,
  }
}

/** BM < RD < BP < COO — true when the live tier outranks the approver's. */
export function isOverCeiling(
  liveTier: ApprovalTier | null,
  approverTier: ApprovalTier | null,
): boolean {
  if (!liveTier || !approverTier) return false
  return liveTier.order > approverTier.order
}

// ----- Queue routing & stats -------------------------------------------------------

export interface RoutedEstimate {
  estimate: Estimate
  tier: ApprovalTier | null
  /** Whole days since the estimate last moved (updatedAt). */
  waitedDays: number
}

const DAY_MS = 86_400_000

/** Days an estimate has waited in the approval queue, from `updatedAt`. */
export function waitedDays(estimate: Estimate, now: Date = new Date()): number {
  const elapsed = now.getTime() - new Date(estimate.updatedAt).getTime()
  return Math.max(0, Math.floor(elapsed / DAY_MS))
}

/**
 * The approver inbox source: pending-approval estimates, each routed to the
 * config tier its contract value falls in. Estimates whose type has no
 * approval matrix (install, open item) resolve to a null tier and therefore
 * never appear in any role's queue.
 */
export function routeApprovalQueue(
  estimates: Estimate[],
  tiers: ApprovalTier[],
  now: Date = new Date(),
): RoutedEstimate[] {
  return estimates
    .filter((e) => e.status === 'pending_approval')
    .map((estimate) => ({
      estimate,
      tier: tierForValue(
        estimate.contractValueCents,
        tiers.filter((t) => t.estimateType === estimate.estimateType),
      ),
      waitedDays: waitedDays(estimate, now),
    }))
}

/** The routed subset a given approver role sees. */
export function queueForRole(routed: RoutedEstimate[], role: ApprovalRoleKey): RoutedEstimate[] {
  return routed.filter((r) => r.tier?.roleKey === role)
}

export interface QueueStats {
  count: number
  valuePendingCents: number
  /** 0 when the queue is empty. */
  oldestDays: number
}

export function queueStats(routed: RoutedEstimate[]): QueueStats {
  return {
    count: routed.length,
    valuePendingCents: routed.reduce((s, r) => s + r.estimate.contractValueCents, 0),
    oldestDays: routed.reduce((m, r) => Math.max(m, r.waitedDays), 0),
  }
}

export type WaitSeverity = 'normal' | 'amber' | 'red'

/** Oldest-waiting color thresholds — amber ≥3 days, red ≥4 (assumed, open item). */
export function waitSeverity(days: number): WaitSeverity {
  if (days >= 4) return 'red'
  if (days >= 3) return 'amber'
  return 'normal'
}

/** COO >$1M mechanism is an open item (BRD III-3 / §12) — flag it on the card. */
export function escalationNote(tier: ApprovalTier | null): string | null {
  if (tier?.roleKey !== 'coo') return null
  return 'Above $1M — COO mechanism to confirm (§12)'
}

/** Compact dollars from config cents: $100K · $1M. */
function compact(cents: number): string {
  const v = cents / 100
  if (v >= 1_000_000) {
    const m = v / 1_000_000
    return `$${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${v.toLocaleString()}`
}

/** Human range for a config row: "Under $100K" · "$100K–$250K" · "Over $1M". */
export function tierRangeLabel(tier: ApprovalTier): string {
  if (tier.maxValueCents === null) return `Over ${compact(tier.minValueCents)}`
  if (tier.minValueCents === 0) return `Under ${compact(tier.maxValueCents)}`
  return `${compact(tier.minValueCents)}–${compact(tier.maxValueCents)}`
}

// ----- Send-back (single-select reason, required) -----------------------------------

/** Design chip set — structural problems only an estimator may fix. */
export const SEND_BACK_REASONS = [
  'Takeoff / boundaries off',
  'Scope mismatch',
  'Pricing concern',
  'Missing service line',
  'Regional template wrong',
] as const

export type SendBackReason = (typeof SEND_BACK_REASONS)[number]

// ----- Adjustments audit (BRD III-1) --------------------------------------------------

let adjSeq = 0
function adjId(): string {
  adjSeq += 1
  return `adj-${Date.now()}-${adjSeq}`
}

/**
 * One estimate_adjustments row per changed lever, from/to as decimals.
 * Reverting to the original is itself an audited record back to baseline.
 * Ownership is enforced here (not just in the UI): each lever asserts the
 * approver role may edit it.
 */
export function buildAdjustmentRecords(
  estimateId: string,
  actor: string,
  baseline: Pick<ReviewBaseline, 'comp0Pct' | 'margin0Pct'>,
  live: { compPct: number; marginPct: number },
  at: string = new Date().toISOString(),
): EstimateAdjustment[] {
  const records: EstimateAdjustment[] = []
  if (live.compPct !== baseline.comp0Pct) {
    assertCanEdit('approver', 'complexity')
    records.push({
      id: adjId(),
      estimateId,
      actor,
      field: 'complexity',
      fromValue: baseline.comp0Pct / 100,
      toValue: live.compPct / 100,
      createdAt: at,
    })
  }
  if (live.marginPct !== baseline.margin0Pct) {
    assertCanEdit('approver', 'margin')
    records.push({
      id: adjId(),
      estimateId,
      actor,
      field: 'margin',
      fromValue: baseline.margin0Pct / 100,
      toValue: live.marginPct / 100,
      createdAt: at,
    })
  }
  return records
}

/**
 * In-memory adjustments audit log. Open item: persist through a backend
 * estimate_adjustments endpoint once one exists (none in the Handoff 00 API
 * surface yet) — mirrors the lifecycleAuditLog precedent.
 */
export const adjustmentAuditLog: EstimateAdjustment[] = []

export function recordAdjustments(records: EstimateAdjustment[]): void {
  adjustmentAuditLog.push(...records)
}

export function clearAdjustmentAuditLog(): void {
  adjustmentAuditLog.length = 0
}

// ----- Applying approver adjustments ---------------------------------------------------

/** The ONLY estimate fields an approver adjustment may touch. */
export interface ApproverAdjustmentPatch {
  contractValueCents: number
  targetMargin: number
}

export interface ApproverAdjustmentResult {
  patch: ApproverAdjustmentPatch
  records: EstimateAdjustment[]
}

/**
 * Turn slider positions into a persistable patch + audit rows. The patch
 * carries only the approver-owned levers' effects (targetMargin + the derived
 * contract-value roll-up) — sections/line items/takeoff are unrepresentable
 * here, enforcing estimator ownership in the model rather than the UI.
 */
export function applyApproverAdjustments(
  estimate: Estimate,
  tiers: ApprovalTier[],
  live: { compPct: number; marginPct: number },
  actor: string,
  at?: string,
): ApproverAdjustmentResult {
  const baseline = reviewBaseline(estimate)
  const { liveValueCents } = computeReview(baseline, live.compPct, live.marginPct, tiers)
  return {
    patch: { contractValueCents: liveValueCents, targetMargin: live.marginPct / 100 },
    records: buildAdjustmentRecords(estimate.id, actor, baseline, live, at),
  }
}
