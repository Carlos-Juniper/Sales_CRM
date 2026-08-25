// ---------------------------------------------------------------------------
// Handoff 06 — Discrepancy Review: reusable flag service (headless).
//
// Business rules ported from the Project Summary Template (BRD §3.1), with
// the rounding updated per Handoff 20's locked decision (round, not ceil):
//   bidQty     = round(planQty × (1 + addPct))
//   isFlagged  = planQty === 0 ? false : |measured − plan| / plan > threshold
//   deltaVsOpp = measured − opportunityQty
// Threshold is config (DISCREPANCY_THRESHOLD, default 10%, range 1–25%).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import type { TakeoffLine } from '@/types/estimating'
import { DISCREPANCY_THRESHOLD } from '@/lib/estimating/config'
import {
  deltaVsOpp,
  deriveTakeoffLine,
  reviewTakeoff,
} from '@/lib/estimating/discrepancy'

function line(overrides: Partial<TakeoffLine> = {}): TakeoffLine {
  return {
    id: 'tk-1',
    estimateId: 'est-1',
    description: 'Bermuda sod',
    uom: 'SF',
    planQty: 100,
    addPct: 0.1,
    measuredQty: 100,
    opportunityQty: 100,
    ...overrides,
  }
}

describe('deltaVsOpp', () => {
  it('is measured minus opportunity qty', () => {
    expect(deltaVsOpp(115, 100)).toBe(15)
  })

  it('is negative when the opportunity carries more than was measured', () => {
    expect(deltaVsOpp(20, 24)).toBe(-4)
  })

  it('is 0 when measured matches the opportunity', () => {
    expect(deltaVsOpp(50, 50)).toBe(0)
  })
})

describe('deriveTakeoffLine', () => {
  it('computes bidQty = round(plan × (1 + add%)) via the shared calc helper', () => {
    const d = deriveTakeoffLine(line({ planQty: 100, addPct: 0.1 }), 0.1)
    expect(d.bidQty).toBe(110)
  })

  it('rounds bid qty to the NEAREST unit (Handoff 20: round, not ceil)', () => {
    expect(deriveTakeoffLine(line({ planQty: 9, addPct: 0.1 }), 0.1).bidQty).toBe(10) // 9.9 → 10
    expect(deriveTakeoffLine(line({ planQty: 24, addPct: 0.05 }), 0.1).bidQty).toBe(25) // 25.2 → 25
  })

  it('flags when |measured − plan| / plan strictly exceeds the threshold', () => {
    const d = deriveTakeoffLine(line({ planQty: 100, measuredQty: 115 }), 0.1)
    expect(d.flagged).toBe(true)
  })

  it('does not flag when deviation equals the threshold exactly', () => {
    const d = deriveTakeoffLine(line({ planQty: 100, measuredQty: 110 }), 0.1)
    expect(d.flagged).toBe(false)
  })

  it('never flags a zero plan qty (guard)', () => {
    const d = deriveTakeoffLine(line({ planQty: 0, measuredQty: 50 }), 0.1)
    expect(d.flagged).toBe(false)
    expect(d.bidQty).toBe(0)
  })

  it('computes deltaVsOpp independently of the flag', () => {
    // Within threshold (no flag) but the opportunity qty is stale — Δ ≠ 0.
    const d = deriveTakeoffLine(
      line({ planQty: 100, measuredQty: 105, opportunityQty: 90 }),
      0.1,
    )
    expect(d.flagged).toBe(false)
    expect(d.deltaVsOpp).toBe(15)
  })

  it('defaults the threshold to the config value', () => {
    // 15% deviation: flagged at the 10% config default.
    const d = deriveTakeoffLine(line({ planQty: 100, measuredQty: 115 }))
    expect(d.flagged).toBe(true)
    expect(DISCREPANCY_THRESHOLD.defaultPct).toBe(0.1)
  })

  it('re-evaluates against a different threshold (config-driven, not baked in)', () => {
    const l = line({ planQty: 100, measuredQty: 115 })
    expect(deriveTakeoffLine(l, 0.1).flagged).toBe(true)
    expect(deriveTakeoffLine(l, 0.2).flagged).toBe(false)
  })
})

describe('reviewTakeoff (headless summary — usable without the tab, II-9.8)', () => {
  const lines: TakeoffLine[] = [
    line({ id: 'a', planQty: 100, addPct: 0.1, measuredQty: 100, opportunityQty: 100 }),
    line({ id: 'b', planQty: 100, addPct: 0.05, measuredQty: 115, opportunityQty: 100 }),
    line({ id: 'c', planQty: 0, measuredQty: 50, opportunityQty: 0 }),
    line({ id: 'd', planQty: 20, addPct: 0, measuredQty: 20, opportunityQty: 24 }),
  ]

  it('counts lines, flagged lines, and Δ-vs-opp ≠ 0 lines', () => {
    const r = reviewTakeoff(lines, 0.1)
    expect(r.lineCount).toBe(4)
    expect(r.flaggedCount).toBe(1) // only b (15% > 10%); c is guarded
    expect(r.oppDeltaCount).toBe(3) // b (+15), c (+50), d (−4)
  })

  it('collects the flagged lines for the CRM surface payload', () => {
    const r = reviewTakeoff(lines, 0.1)
    expect(r.flaggedLines.map((l) => l.id)).toEqual(['b'])
    expect(r.anyFlagged).toBe(true)
  })

  it('reports a clean review when the threshold absorbs all deviation', () => {
    const r = reviewTakeoff(lines, 0.2)
    expect(r.flaggedCount).toBe(0)
    expect(r.anyFlagged).toBe(false)
    expect(r.flaggedLines).toEqual([])
  })

  it('handles an empty line set', () => {
    const r = reviewTakeoff([], 0.1)
    expect(r.lineCount).toBe(0)
    expect(r.flaggedCount).toBe(0)
    expect(r.oppDeltaCount).toBe(0)
    expect(r.anyFlagged).toBe(false)
  })
})
