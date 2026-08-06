// ---------------------------------------------------------------------------
// Approver Review Drawer (Handoff 09, "Option B") — right slide-out, ~560px.
//
// The approver reviews the estimate READ-ONLY (line items / takeoff / scope
// are estimator-owned) and applies exactly two audited levers:
//   - Complexity (hours) 0–30%   → scales cost
//   - Gross margin (price) 10–40% → re-prices
// All math + the tier re-route come from lib/estimating/approvalReview; every
// saved adjustment writes estimate_adjustments rows and reverting to the
// original is one click. If the live value climbs past the approver's ceiling,
// Approve is no longer available — the primary action becomes a plain
// "Save adjustment" (persist without approving); the value-driven tier
// recompute re-routes the estimate to the higher tier's queue automatically.
// There is NO explicit "Escalate" action (Handoff 19 §4).
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react'
import { ArrowUp, Check, Clock, CornerUpLeft, Percent } from 'lucide-react'
import { SlideOverPanel } from '@/components/shared/SlideOverPanel'
import { Textarea } from '@/components/ui/textarea'
import type { ApprovalTier, Estimate } from '@/types/estimating'
import {
  computeReview,
  isOverCeiling,
  reviewBaseline,
  SEND_BACK_REASONS,
  type SendBackReason,
} from '@/lib/estimating/approvalReview'
import { cn } from '@/lib/utils'

/** Group dot colors, cycled per row (design palette). */
const GROUP_DOTS = ['#2E7D52', '#2563eb', '#0891b2', '#d97706']

/** Whole dollars from integer cents: $95,000. */
function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

export interface ApproverReviewDrawerProps {
  estimate: Estimate
  /** The tier the estimate is CURRENTLY routed to (badge in the header). */
  tier: ApprovalTier | null
  /** The viewer's own tier — the approval ceiling. */
  approverTier: ApprovalTier | null
  /** Full ladder for the estimate's type. */
  tiers: ApprovalTier[]
  /** Display name of the estimator who built it. */
  builtBy: string
  /** Open directly on the send-back panel (card "Send back" action). */
  initialSendBack?: boolean
  onClose: () => void
  /** Approve, optionally persisting adjusted levers first. */
  onApprove: (live: { compPct: number; marginPct: number }, changed: boolean) => void
  /**
   * Over-ceiling: persist the adjustment WITHOUT approving — the value-driven
   * tier recompute re-routes the estimate to the higher tier's queue.
   */
  onSaveAdjustment: (live: { compPct: number; marginPct: number }) => void
  onSendBack: (reason: SendBackReason, note: string) => void
}

export function ApproverReviewDrawer({
  estimate,
  tier,
  approverTier,
  tiers,
  builtBy,
  initialSendBack = false,
  onClose,
  onApprove,
  onSaveAdjustment,
  onSendBack,
}: ApproverReviewDrawerProps) {
  const baseline = useMemo(() => reviewBaseline(estimate), [estimate])
  const [compPct, setCompPct] = useState(baseline.comp0Pct)
  const [marginPct, setMarginPct] = useState(baseline.margin0Pct)
  const [sendBack, setSendBack] = useState(initialSendBack)
  const [reason, setReason] = useState<SendBackReason | null>(null)
  const [note, setNote] = useState('')

  const live = computeReview(baseline, compPct, marginPct, tiers)
  const overCeiling = isOverCeiling(live.liveTier, approverTier)

  const primaryLabel = overCeiling
    ? 'Save adjustment'
    : live.changed
      ? 'Save adjustment & approve'
      : 'Approve'

  function handlePrimary() {
    if (overCeiling) onSaveAdjustment({ compPct, marginPct })
    else onApprove({ compPct, marginPct }, live.changed)
  }

  return (
    <SlideOverPanel isOpen onClose={onClose} width="md">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-[hsl(var(--border))] px-5 py-4">
          <div className="mb-1 flex items-center gap-2">
            {tier && (
              <span className="rounded-[5px] border border-[#bfdfcd] bg-[#f0faf4] px-1.5 py-0.5 text-[10px] font-semibold text-[#2E7D52]">
                {tier.label} tier
              </span>
            )}
            <span className="rounded-[5px] bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-fg))]">
              {estimate.estimateType}
            </span>
          </div>
          <p className="text-[17px] font-bold text-[hsl(var(--fg))]">{estimate.name}</p>
          <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-fg))]">
            {estimate.acreage != null ? `${estimate.acreage} ac · ` : ''}built by {builtBy}
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {/* Read-only estimate summary */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
              Estimate summary{' '}
              <span className="font-medium normal-case tracking-normal">
                · read-only — line items are estimator-owned
              </span>
            </p>
            <div className="overflow-hidden rounded-[10px] border border-[hsl(var(--border))]">
              {live.groups.map((g, i) => (
                <div
                  key={g.label}
                  className="flex items-center gap-2.5 border-b border-[hsl(var(--border))]/60 px-3.5 py-2.5"
                >
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: GROUP_DOTS[i % GROUP_DOTS.length] }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-[13px] text-[hsl(var(--fg))]">{g.label}</span>
                  <span className="text-[11px] text-[hsl(var(--muted-fg))]">
                    {g.marginPct.toFixed(1)}% margin
                  </span>
                  <span className="text-[13px] font-semibold text-[hsl(var(--fg))]">
                    {dollars(g.priceCents)}
                  </span>
                </div>
              ))}
              <div className="flex items-center bg-[hsl(var(--muted))] px-3.5 py-2.5">
                <span className="flex-1 text-[13px] font-semibold text-[hsl(var(--fg))]">
                  Total contract value
                </span>
                <span data-testid="live-total" className="text-[15px] font-bold text-[#2E7D52]">
                  {dollars(live.liveValueCents)}
                </span>
              </div>
            </div>
          </div>

          {/* Audited adjustment levers */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
              Your adjustments{' '}
              <span className="font-medium normal-case tracking-normal">· audited</span>
            </p>
            <div className="flex flex-col gap-3.5 rounded-[10px] border border-[hsl(var(--border))] p-3.5">
              <div>
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--fg))]">
                    <Clock className="h-3.5 w-3.5 text-[#2563eb]" />
                    Complexity (hours)
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span className="text-sm font-bold text-[hsl(var(--fg))]">+{compPct}%</span>
                    <button
                      type="button"
                      aria-label="Reset complexity"
                      onClick={() => setCompPct(baseline.comp0Pct)}
                      className="cursor-pointer text-[11px] text-[#2E7D52] hover:underline"
                    >
                      Reset
                    </button>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={compPct}
                  aria-label="Complexity (hours)"
                  onChange={(e) => setCompPct(Number(e.target.value))}
                  className="w-full accent-[#2E7D52]"
                />
              </div>
              <div>
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--fg))]">
                    <Percent className="h-3.5 w-3.5 text-[#2E7D52]" />
                    Gross margin (price)
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span className="text-sm font-bold text-[hsl(var(--fg))]">{marginPct}%</span>
                    <button
                      type="button"
                      aria-label="Reset margin"
                      onClick={() => setMarginPct(baseline.margin0Pct)}
                      className="cursor-pointer text-[11px] text-[#2E7D52] hover:underline"
                    >
                      Reset
                    </button>
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={40}
                  step={1}
                  value={marginPct}
                  aria-label="Gross margin (price)"
                  onChange={(e) => setMarginPct(Number(e.target.value))}
                  className="w-full accent-[#2E7D52]"
                />
              </div>
              <div className="flex justify-between border-t border-[hsl(var(--border))] pt-2.5 text-[11px] text-[hsl(var(--muted-fg))]">
                <span data-testid="lever-readout">
                  Cost {dollars(live.effCostCents)} · was {dollars(baseline.value0Cents)}
                </span>
                <span data-testid="routes-to">Routes to {live.liveTier?.label ?? '—'}</span>
              </div>
            </div>
          </div>

          {/* Over-ceiling banner — auto-routes on save, no explicit escalation */}
          {overCeiling && (
            <div
              data-testid="over-ceiling-banner"
              className="flex items-center gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5"
            >
              <ArrowUp className="h-4 w-4 flex-shrink-0 text-amber-600" />
              <span className="text-xs text-amber-800">
                This adjustment pushes the estimate above your approval ceiling — saving routes it
                to <strong>{live.liveTier?.label}</strong>&rsquo;s queue and you can no longer
                approve it directly.
              </span>
            </div>
          )}

          {/* Send-back panel */}
          {sendBack && (
            <div className="flex flex-col gap-2.5 rounded-[10px] border border-[hsl(var(--border))] p-3.5">
              <p className="text-xs font-semibold text-[hsl(var(--fg))]">Send back to estimator</p>
              <p className="text-[11px] text-[hsl(var(--muted-fg))]">
                Structural changes (line items, takeoff, scope) are estimator-owned. Pick a reason —
                it re-enters the estimator&apos;s queue as a revision.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SEND_BACK_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={cn(
                      'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                      reason === r
                        ? 'border-[#8fc7a8] bg-[#f0faf4] text-[#1d5c3b]'
                        : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--fg))] hover:border-[#8fc7a8]',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note for the estimator…"
                aria-label="Note for the estimator"
                className="min-h-[60px] text-xs"
              />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex flex-shrink-0 gap-2.5 border-t border-[hsl(var(--border))] px-5 py-3.5">
          {sendBack ? (
            <>
              <button
                type="button"
                onClick={() => setSendBack(false)}
                className="h-10 cursor-pointer rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-[13px] text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!reason}
                onClick={() => reason && onSendBack(reason, note)}
                className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#2E7D52] text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
                Send back to estimator
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSendBack(true)}
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-[13px] text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
                Send back
              </button>
              <button
                type="button"
                onClick={handlePrimary}
                className={cn(
                  'inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13px] font-semibold text-white transition-opacity hover:opacity-90',
                  overCeiling ? 'bg-[#b45309]' : 'bg-[#2E7D52]',
                )}
              >
                <Check className="h-4 w-4" />
                {primaryLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </SlideOverPanel>
  )
}
