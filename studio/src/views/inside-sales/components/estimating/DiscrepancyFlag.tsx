// ---------------------------------------------------------------------------
// Discrepancy Review tab (Handoff 06) — reconcile plan vs measured vs Aspire
// opportunity quantities and surface flagged lines to the CRM for the
// qualifying-notes decision (BRD II-6.4).
//
// All flag math lives in the headless service (lib/estimating/discrepancy.ts,
// ported from the Project Summary Template per §3.1) — this component only
// renders it. Threshold is config (DISCREPANCY_THRESHOLD: default 10%, range
// 1–25%; UNCONFIRMED — confirm w/ Estimating in the Project Summary
// walk-through). II-9.8 open decision: this stays a visual tab for now, but
// the service can run headless later.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Check, Send, TriangleAlert } from 'lucide-react'
import type { TakeoffLine } from '@/types/estimating'
import { reviewTakeoff, type DerivedTakeoffLine } from '@/lib/estimating/discrepancy'
import { DISCREPANCY_THRESHOLD } from '@/lib/estimating/config'
import { estimatingApi, type UpdateTakeoffLinePayload } from '@/api/estimating'
import { useEstimatingShell } from './useEstimatingShell'
import { useToast } from './useToast'
import { cn } from '@/lib/utils'

interface DiscrepancyFlagProps {
  /** Test/deep-link seam. Defaults to the open estimate's takeoff lines. */
  initialLines?: TakeoffLine[]
}

/** Blue-cell convention: estimator-editable inputs (legacy "edit blue cells"). */
const CELL_INPUT =
  'font-mono text-right text-[11.5px] text-[#1e3a8a] bg-[#eff6ff] border border-[#bfdbfe] ' +
  'rounded-[5px] px-1.5 py-1 focus:outline-none focus:border-[#2E7D52] ' +
  'focus:ring-2 focus:ring-[#2E7D52]/15 focus:bg-white'

const TH = 'px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] text-right'

function StatCard({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3',
        className,
      )}
    >
      <p className="text-[11px] text-[hsl(var(--muted-fg))]">{label}</p>
      {children}
    </div>
  )
}

/** Whole-percent display for a decimal pct (0.05 → 5). */
function toWholePct(decimal: number): number {
  return Math.round(decimal * 10000) / 100
}

export function DiscrepancyFlag({ initialLines }: DiscrepancyFlagProps) {
  const { openEstimate } = useEstimatingShell()
  const { show } = useToast()

  // Handoff 20 — lines load from GET …/takeoff-lines and edits PATCH back, so
  // state survives a reload. `initialLines` stays a test/deep-link seam that
  // skips the fetch. The live recompute below stays local (threshold slider);
  // the server independently recomputes derived fields it returns.
  const [lines, setLines] = useState<TakeoffLine[]>(() => initialLines ?? [])
  const estimateId = initialLines ? null : (openEstimate?.id ?? null)

  useEffect(() => {
    if (!estimateId) return
    let cancelled = false
    estimatingApi
      .listTakeoffLines(estimateId)
      .then((rows) => {
        if (!cancelled) setLines(rows)
      })
      .catch(() => {
        /* keep whatever we have — the tab degrades to an empty table */
      })
    return () => {
      cancelled = true
    }
  }, [estimateId])
  // Whole-percent slider value (config-backed: default 10, range 1–25).
  const [thresholdPct, setThresholdPct] = useState(
    () => toWholePct(DISCREPANCY_THRESHOLD.defaultPct),
  )

  const review = useMemo(() => reviewTakeoff(lines, thresholdPct / 100), [lines, thresholdPct])
  const { anyFlagged, flaggedCount } = review

  function updateLine(id: string, patch: UpdateTakeoffLinePayload) {
    // Optimistic local recompute (live), then persist the edit (Handoff 20).
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    if (openEstimate) {
      estimatingApi.updateTakeoffLine(openEstimate.id, id, patch).catch(() => {
        /* best-effort — the next load re-syncs from the server */
      })
    }
  }

  function surfaceToCrm() {
    // TODO(crm): wire the real CRM handoff — push review.flaggedLines to the
    // CRM's qualifying-notes queue (integration target open, Handoff 06 §5).
    show(
      anyFlagged
        ? `${flaggedCount} discrepancy line(s) surfaced to CRM`
        : 'Nothing to surface — all lines reconcile',
    )
  }

  function numFromInput(value: string): number {
    const n = Number(value)
    return value === '' || Number.isNaN(n) ? 0 : n
  }

  return (
    <div className="flex flex-col gap-3.5 max-w-[1120px]">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Takeoff lines">
          <p data-testid="stat-line-count" className="mt-1 text-[22px] font-extrabold font-mono">
            {review.lineCount}
          </p>
        </StatCard>
        <StatCard
          label="Flagged (> threshold)"
          className={cn(anyFlagged && 'border-[#fde68a]')}
        >
          <p
            data-testid="stat-flagged-count"
            className={cn(
              'mt-1 text-[22px] font-extrabold font-mono',
              anyFlagged && 'text-[#b45309]',
            )}
          >
            {flaggedCount}
          </p>
        </StatCard>
        <StatCard label="Δ vs Opportunity ≠ 0">
          <p
            data-testid="stat-opp-delta-count"
            className="mt-1 text-[22px] font-extrabold font-mono text-[#1d4ed8]"
          >
            {review.oppDeltaCount}
          </p>
        </StatCard>
        <StatCard label="Flag threshold">
          <div className="mt-1 flex items-baseline gap-1">
            <span data-testid="stat-threshold-pct" className="text-[22px] font-extrabold font-mono">
              {thresholdPct}
            </span>
            <span className="text-[11px] text-[hsl(var(--muted-fg))]">%</span>
          </div>
          <input
            type="range"
            aria-label="Flag threshold"
            min={toWholePct(DISCREPANCY_THRESHOLD.minPct)}
            max={toWholePct(DISCREPANCY_THRESHOLD.maxPct)}
            value={thresholdPct}
            onChange={(e) => setThresholdPct(Number(e.target.value))}
            className="mt-1 w-full accent-[#2E7D52]"
          />
        </StatCard>
      </div>

      {/* Reconciliation table */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-[hsl(var(--muted))]">
                <th className={cn(TH, 'text-left px-3')}>Takeoff line</th>
                <th className={TH}>Plan QTY</th>
                <th className={TH}>Add %</th>
                <th className={TH}>Bid QTY</th>
                <th className={TH}>Measured</th>
                <th className={TH}>Opp (Aspire)</th>
                <th className={TH}>Δ vs Opp</th>
                <th className={cn(TH, 'text-center px-3')}>Status</th>
              </tr>
            </thead>
            <tbody>
              {review.lines.map((ln: DerivedTakeoffLine) => (
                <tr
                  key={ln.id}
                  className={cn(
                    'border-t border-[hsl(var(--border))]',
                    ln.flagged && 'bg-[#fffbeb]',
                  )}
                >
                  <td className="px-3 py-2 font-medium">
                    {ln.description}
                    <div className="text-[10px] font-normal text-[hsl(var(--muted-fg))]">
                      {ln.uom}
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <input
                      type="number"
                      aria-label={`Plan QTY — ${ln.description}`}
                      className={cn(CELL_INPUT, 'w-[70px]')}
                      value={ln.planQty}
                      onChange={(e) => updateLine(ln.id, { planQty: numFromInput(e.target.value) })}
                    />
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <input
                      type="number"
                      aria-label={`Add % — ${ln.description}`}
                      className={cn(CELL_INPUT, 'w-[56px]')}
                      value={toWholePct(ln.addPct)}
                      onChange={(e) =>
                        updateLine(ln.id, { addPct: numFromInput(e.target.value) / 100 })
                      }
                    />
                  </td>
                  <td
                    data-testid={`bid-qty-${ln.id}`}
                    className="px-2.5 py-2 text-right font-mono font-bold"
                  >
                    {ln.bidQty}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <input
                      type="number"
                      aria-label={`Measured — ${ln.description}`}
                      className={cn(CELL_INPUT, 'w-[70px]')}
                      value={ln.measuredQty}
                      onChange={(e) =>
                        updateLine(ln.id, { measuredQty: numFromInput(e.target.value) })
                      }
                    />
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <input
                      type="number"
                      aria-label={`Opp (Aspire) — ${ln.description}`}
                      className={cn(CELL_INPUT, 'w-[70px]')}
                      value={ln.opportunityQty}
                      onChange={(e) =>
                        updateLine(ln.id, { opportunityQty: numFromInput(e.target.value) })
                      }
                    />
                  </td>
                  <td
                    data-testid={`delta-${ln.id}`}
                    className={cn(
                      'px-2.5 py-2 text-right font-mono font-semibold',
                      ln.deltaVsOpp !== 0 ? 'text-[#1d4ed8]' : 'text-[hsl(var(--muted-fg))]',
                    )}
                  >
                    {ln.deltaVsOpp > 0 ? `+${ln.deltaVsOpp}` : ln.deltaVsOpp}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {ln.flagged ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#fde68a] bg-[#fef3c7] px-2 py-[3px] text-[10px] font-semibold text-[#b45309]">
                        <TriangleAlert className="h-[11px] w-[11px]" />
                        Review
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#bbf7d0] bg-[#dcfce7] px-2 py-[3px] text-[10px] font-semibold text-[#15803d]">
                        <Check className="h-[11px] w-[11px]" />
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CRM banner — human review stays in the loop (II-6.4) */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-[10px] border px-4 py-3',
          anyFlagged
            ? 'border-[#fde68a] bg-[#fffbeb]'
            : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]',
        )}
      >
        {anyFlagged ? (
          <TriangleAlert className="h-[17px] w-[17px] flex-shrink-0 text-[#92400e]" />
        ) : (
          <CheckCircle2 className="h-[17px] w-[17px] flex-shrink-0 text-[hsl(var(--muted-fg))]" />
        )}
        <p
          className={cn(
            'flex-1 text-xs',
            anyFlagged ? 'text-[#92400e]' : 'text-[hsl(var(--muted-fg))]',
          )}
        >
          {anyFlagged
            ? `${flaggedCount} line(s) diverge beyond the ${thresholdPct}% threshold — surface to the CRM for the qualifying-notes decision.`
            : 'No lines exceed the threshold. Bid quantities reconcile with measured takeoff.'}
        </p>
        <button
          type="button"
          onClick={surfaceToCrm}
          className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#2E7D52] px-3 text-[11.5px] font-semibold text-white hover:bg-[#256844] cursor-pointer"
        >
          <Send className="h-3.5 w-3.5" />
          Surface to CRM
        </button>
      </div>

      <p className="text-[10.5px] leading-normal text-[hsl(var(--muted-fg))]">
        Bid QTY = <span className="font-mono">round(Plan × (1 + Add%))</span> · Flag ={' '}
        <span className="font-mono">|Measured − Plan| / Plan &gt; threshold</span> · human review
        stays in the loop — the CRM makes the qualifying-notes decision.
      </p>
    </div>
  )
}
