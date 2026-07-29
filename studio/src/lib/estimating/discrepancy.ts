// ---------------------------------------------------------------------------
// Discrepancy Review service (Handoff 06) — the reusable flag logic.
//
// Ported from the Project Summary Template spreadsheet (BRD §3.1 — port, don't
// rebuild). This module is deliberately HEADLESS: the Discrepancy Review tab
// consumes it today, and per the open II-9.8 decision it can later run as
// back-end automation that routes flagged lines to the CRM without the tab.
//
// Rules (verbatim from the template):
//   bidQty     = ceil(planQty × (1 + addPct))
//   isFlagged  = planQty === 0 ? false : |measured − plan| / plan > threshold
//   deltaVsOpp = measured − opportunityQty   // independent signal — always
//                                            // surfaced to the CRM when ≠ 0
//
// The threshold is CONFIG (DISCREPANCY_THRESHOLD: default 10%, range 1–25%,
// unconfirmed — confirm w/ Estimating in the Project Summary walk-through).
// It is passed in per call and never baked into a row.
// ---------------------------------------------------------------------------

import type { TakeoffLine } from '@/types/estimating'
import { bidQty, isFlagged } from './calc'
import { DISCREPANCY_THRESHOLD } from './config'

/** A takeoff line plus its derived (never stored) discrepancy values. */
export interface DerivedTakeoffLine extends TakeoffLine {
  bidQty: number
  flagged: boolean
  deltaVsOpp: number
}

/** Headless review summary — what the CRM banner / future automation reads. */
export interface DiscrepancyReview {
  lines: DerivedTakeoffLine[]
  lineCount: number
  /** Lines whose plan-vs-measured deviation strictly exceeds the threshold. */
  flaggedCount: number
  /** Lines where measured ≠ Aspire opportunity qty (separate signal). */
  oppDeltaCount: number
  anyFlagged: boolean
  /** The payload for "Surface to CRM" (qualifying-notes decision, II-6.4). */
  flaggedLines: DerivedTakeoffLine[]
}

/** Δ vs Opportunity: measured minus the qty currently in Aspire. */
export function deltaVsOpp(measuredQty: number, opportunityQty: number): number {
  return measuredQty - opportunityQty
}

/** Derive one line's bid qty, flag, and Δ vs opportunity. */
export function deriveTakeoffLine(
  line: TakeoffLine,
  threshold: number = DISCREPANCY_THRESHOLD.defaultPct,
): DerivedTakeoffLine {
  return {
    ...line,
    bidQty: bidQty(line.planQty, line.addPct),
    flagged: isFlagged(line.measuredQty, line.planQty, threshold),
    deltaVsOpp: deltaVsOpp(line.measuredQty, line.opportunityQty),
  }
}

/**
 * Review a full takeoff against a threshold. Pure and side-effect free so it
 * can run headless (II-9.8: potential back-end automation past the threshold).
 */
export function reviewTakeoff(
  lines: TakeoffLine[],
  threshold: number = DISCREPANCY_THRESHOLD.defaultPct,
): DiscrepancyReview {
  const derived = lines.map((l) => deriveTakeoffLine(l, threshold))
  const flaggedLines = derived.filter((l) => l.flagged)
  return {
    lines: derived,
    lineCount: derived.length,
    flaggedCount: flaggedLines.length,
    oppDeltaCount: derived.filter((l) => l.deltaVsOpp !== 0).length,
    anyFlagged: flaggedLines.length > 0,
    flaggedLines,
  }
}
