// ---------------------------------------------------------------------------
// Approval Queue tab — the approver-facing inbox.
//
// Estimates in pending_approval are routed to a tier by contract value via
// the CONFIG approval_tiers ladder (tierForValue) — never a hardcoded matrix.
// The "Viewing as" switcher (MGR / RD / VP / CEO) filters the inbox to that
// tier. Opening a card raises the Approver Review Drawer where the two
// audited levers (complexity → hours/cost, margin → price) live. There is no
// "Escalate" action: an over-ceiling adjustment simply saves (audited, no
// approve) and the value-driven tier recompute re-routes the estimate to the
// correct queue automatically.
//
// Status changes always go through lib/estimating/transitions (approve =
// approveAndHandBack server-side; send-back = applyTransition → in_progress).
// Lifecycle side effects never happen here.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCheck, Clock, CornerUpLeft, Eye, Percent, ArrowUp } from 'lucide-react'
import { estimatingApi } from '@/api/estimating'
import { applyTransition } from '@/lib/estimating/transitions'
import { tierForValue } from '@/lib/estimating/calc'
import { useEstimatingConfig } from '@/hooks/useEstimatingConfig'
import {
  applyApproverAdjustments,
  escalationNote,
  reviewBaseline,
  queueForRole,
  queueStats,
  recordAdjustments,
  routeApprovalQueue,
  tierRangeLabel,
  waitSeverity,
  type RoutedEstimate,
  type SendBackReason,
} from '@/lib/estimating/approvalReview'
import { useAuthStore } from '@/store/authStore'
import { useUsers } from '@/hooks/useUsers'
import { cn } from '@/lib/utils'
import type { ApprovalRoleKey, ApprovalTier, Estimate } from '@/types/estimating'
import { useEstimatingShell } from './useEstimatingShell'
import { useToast } from './useToast'
import { ApproverReviewDrawer } from './ApproverReviewDrawer'

/**
 * Demo approver identities per role (design fixture). In production this is
 * the signed-in approver resolved from the user/role table.
 */
const APPROVER_DIRECTORY: Record<ApprovalRoleKey, { name: string; initials: string }> = {
  manager: { name: 'Robert Chen', initials: 'RC' },
  regional_director: { name: 'Amanda Torres', initials: 'AT' },
  vice_president: { name: 'Marcus Webb', initials: 'MW' },
  ceo: { name: 'Diane Voss', initials: 'DV' },
}

const ROLE_TABS: { key: ApprovalRoleKey; label: string }[] = [
  { key: 'manager', label: 'MGR' },
  { key: 'regional_director', label: 'RD' },
  { key: 'vice_president', label: 'VP' },
  { key: 'ceo', label: 'CEO' },
]

const SEVERITY_COLOR: Record<ReturnType<typeof waitSeverity>, string> = {
  normal: 'text-[hsl(var(--fg))]',
  amber: 'text-amber-600',
  red: 'text-red-600',
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function waitedLabel(days: number): string {
  if (days === 0) return 'waiting today'
  return days === 1 ? '1 day waiting' : `${days} days waiting`
}


export interface ApprovalQueueProps {
  /**
   * approval_tiers config rows (§3.9). Defaults to the API-fetched config
   * table; the config.ts seed is only the offline fallback.
   */
  tiers?: ApprovalTier[]
  /** Test/deep-link seam; when absent the pending set is fetched. */
  estimates?: Estimate[]
}

export function ApprovalQueue({ tiers: tiersProp, estimates }: ApprovalQueueProps) {
  const { approvalTiers } = useEstimatingConfig()
  const tiers = tiersProp ?? approvalTiers
  const { openEstimateAt } = useEstimatingShell()
  const { show } = useToast()
  const user = useAuthStore((s) => s.user)

  const { findUser } = useUsers()
  const [role, setRole] = useState<ApprovalRoleKey>('manager')
  const [items, setItems] = useState<Estimate[]>(estimates ?? [])
  const [selected, setSelected] = useState<{ id: string; sendBack: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (estimates) return
    let cancelled = false
    estimatingApi.list({ status: 'pending_approval' }).then((list) => {
      if (!cancelled) setItems(list)
    })
    return () => {
      cancelled = true
    }
  }, [estimates])

  const routed = useMemo(() => routeApprovalQueue(items, tiers), [items, tiers])
  const mine = queueForRole(routed, role)
  const stats = queueStats(mine)
  const approverTier =
    tiers.find((t) => t.roleKey === role && t.estimateType === 'maintenance') ?? null
  const approver = APPROVER_DIRECTORY[role]
  const actor = user?.name ?? 'Unknown approver'
  const oldestSeverity = waitSeverity(stats.oldestDays)

  const selectedRouted: RoutedEstimate | null = selected
    ? (routed.find((r) => r.estimate.id === selected.id) ?? null)
    : null
  // The viewer's ceiling in the ladder of the ESTIMATE'S type — maintenance
  // and install ladders mirror each other today but may diverge as config.
  const drawerApproverTier = selectedRouted
    ? (tiers.find(
        (t) =>
          t.roleKey === role && t.estimateType === selectedRouted.estimate.estimateType,
      ) ?? null)
    : null

  function replaceItem(updated: Estimate) {
    setItems((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
  }

  async function persistAdjustments(
    estimate: Estimate,
    live: { compPct: number; marginPct: number },
  ): Promise<Estimate> {
    const { patch, records } = applyApproverAdjustments(estimate, tiers, live, actor)
    const updated = await estimatingApi.update(estimate.id, patch)
    await recordAdjustments(records) // persisted estimate_adjustments audit (BRD III-1)
    return updated
  }

  async function handleApprove(
    estimate: Estimate,
    live?: { compPct: number; marginPct: number },
    changed = false,
  ) {
    if (busy) return
    setBusy(true)
    try {
      if (live && changed) await persistAdjustments(estimate, live)
      const { estimate: updated } = await estimatingApi.approveAndHandBack(estimate.id, { actor })
      replaceItem(updated) // no longer pending_approval → leaves every queue
      setSelected(null)
      const estimatorName = findUser(estimate.assignedLsEstimator)?.name ?? 'the estimator'
      show(
        changed
          ? `Adjustment saved & ${estimate.name} approved`
          : `${estimate.name} approved & handed back to Sales (${estimatorName})`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveAdjustment(
    estimate: Estimate,
    live: { compPct: number; marginPct: number },
  ) {
    if (busy) return
    setBusy(true)
    try {
      const updated = await persistAdjustments(estimate, live)
      replaceItem(updated) // the value-driven tier recompute re-routes it
      setSelected(null)
      const routedTier = tierForValue(
        updated.contractValueCents,
        tiers.filter((t) => t.estimateType === updated.estimateType),
      )
      show(
        routedTier
          ? `Adjustment saved — routed to ${routedTier.label}`
          : 'Adjustment saved',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleSendBack(estimate: Estimate, reason: SendBackReason, note: string) {
    if (busy) return
    setBusy(true)
    try {
      // Legal edge or throw — the transition module owns the machine.
      const { patch } = applyTransition(estimate, 'in_progress', { actor })
      const updated = await estimatingApi.update(estimate.id, patch)
      replaceItem(updated)
      setSelected(null)
      show(`Sent back to ${findUser(estimate.assignedLsEstimator)?.name ?? 'the estimator'} — ${reason}${note ? ' · note attached' : ''}`)
    } finally {
      setBusy(false)
    }
  }

  function handleOpenEstimate(estimate: Estimate) {
    openEstimateAt(estimate, 'editor')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Heading + role switcher */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[hsl(var(--fg))]">Approval queue</h3>
          <p className="mt-1 text-xs text-[hsl(var(--muted-fg))]">
            Estimates awaiting your sign-off, routed to your tier by contract value.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-[10px] bg-[hsl(var(--muted))] p-1">
          <span className="px-1.5 text-[11px] text-[hsl(var(--muted-fg))]">Viewing as</span>
          {ROLE_TABS.map((rt) => (
            <button
              key={rt.key}
              type="button"
              onClick={() => {
                setRole(rt.key)
                setSelected(null)
              }}
              className={cn(
                'cursor-pointer rounded-[7px] px-2.5 py-1 text-xs font-semibold transition-colors',
                role === rt.key
                  ? 'bg-[hsl(var(--card))] text-[#2E7D52] shadow-sm'
                  : 'text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]',
              )}
            >
              {rt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Identity + stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3.5 shadow-sm">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#2E7D52] text-[13px] font-bold text-white">
            {approver.initials}
          </span>
          <div>
            <p className="text-[13px] font-semibold text-[hsl(var(--fg))]">{approver.name}</p>
            <p className="text-[11px] text-[hsl(var(--muted-fg))]">
              {approverTier ? `${approverTier.label} · ${tierRangeLabel(approverTier)}` : '—'}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3.5 shadow-sm">
          <p className="text-[11px] text-[hsl(var(--muted-fg))]">Awaiting you</p>
          <p data-testid="stat-awaiting" className="mt-0.5 text-xl font-bold text-[hsl(var(--fg))]">
            {stats.count}
          </p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3.5 shadow-sm">
          <p className="text-[11px] text-[hsl(var(--muted-fg))]">Value pending</p>
          <p
            data-testid="stat-value-pending"
            className="mt-0.5 text-xl font-bold text-[hsl(var(--fg))]"
          >
            {dollars(stats.valuePendingCents)}
          </p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3.5 shadow-sm">
          <p className="text-[11px] text-[hsl(var(--muted-fg))]">Oldest waiting</p>
          <p
            data-testid="stat-oldest"
            data-severity={oldestSeverity}
            className={cn('mt-0.5 text-xl font-bold', SEVERITY_COLOR[oldestSeverity])}
          >
            {stats.oldestDays === 0
              ? '—'
              : stats.oldestDays === 1
                ? '1 day'
                : `${stats.oldestDays} days`}
          </p>
        </div>
      </div>

      {/* Queue cards */}
      <div className="flex flex-col gap-2.5">
        {mine.map(({ estimate, tier, waitedDays }) => {
          const note = escalationNote(tier)
          const severity = waitSeverity(waitedDays)
          const builtBy = findUser(estimate.assignedLsEstimator)?.name ?? 'the estimator'
          // baseline chips: weighted complexity + target margin
          const { comp0Pct, margin0Pct } = reviewBaseline(estimate)
          return (
            <div
              key={estimate.id}
              data-testid={`aq-card-${estimate.id}`}
              onClick={() => setSelected({ id: estimate.id, sendBack: false })}
              className="cursor-pointer rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start gap-3.5">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {tier && (
                      <span className="rounded-[5px] border border-[#bfdfcd] bg-[#f0faf4] px-1.5 py-0.5 text-[10px] font-semibold text-[#2E7D52]">
                        {tier.label} tier
                      </span>
                    )}
                    <span className="rounded-[5px] bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-fg))]">
                      {estimate.estimateType}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-[11px]',
                        severity === 'normal' ? 'text-[hsl(var(--muted-fg))]' : SEVERITY_COLOR[severity],
                      )}
                    >
                      <Clock className="h-3 w-3" />
                      {waitedLabel(waitedDays)}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[hsl(var(--fg))]">{estimate.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3.5">
                    <span className="text-base font-bold text-[#2E7D52]">
                      {dollars(estimate.contractValueCents)}
                    </span>
                    {estimate.acreage != null && (
                      <span className="text-[11px] text-[hsl(var(--muted-fg))]">
                        {estimate.acreage} ac
                      </span>
                    )}
                    <span className="text-[11px] text-[hsl(var(--muted-fg))]">
                      built by {builtBy}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-fg))]">
                      <Clock className="h-2.5 w-2.5" />
                      complexity +{comp0Pct}%
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-fg))]">
                      <Percent className="h-2.5 w-2.5" />
                      margin {margin0Pct}%
                    </span>
                  </div>
                </div>
                <div
                  className="flex w-[150px] flex-shrink-0 flex-col gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleApprove(estimate)}
                    className="inline-flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[#2E7D52] text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected({ id: estimate.id, sendBack: true })}
                    className="inline-flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-xs text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
                  >
                    <CornerUpLeft className="h-3.5 w-3.5" />
                    Send back
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEstimate(estimate)}
                    className="inline-flex h-[30px] cursor-pointer items-center justify-center gap-1 rounded-lg text-[11px] text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]"
                  >
                    <Eye className="h-3 w-3" />
                    Open estimate
                  </button>
                </div>
              </div>
              {note && (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                  <ArrowUp className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                  <span className="text-[11px] text-amber-800">{note}</span>
                </div>
              )}
            </div>
          )
        })}

        {mine.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 py-12 text-center text-[hsl(var(--muted-fg))]">
            <CheckCheck className="h-7 w-7" />
            <p className="text-[13px]">
              Queue is clear. No estimates awaiting{' '}
              {approverTier?.label ?? APPROVER_DIRECTORY[role].name} approval.
            </p>
          </div>
        )}
      </div>

      {/* Review drawer */}
      {selectedRouted && (
        <ApproverReviewDrawer
          key={`${selectedRouted.estimate.id}-${selected?.sendBack ? 'sb' : 'review'}`}
          estimate={selectedRouted.estimate}
          tier={selectedRouted.tier}
          approverTier={drawerApproverTier}
          tiers={tiers.filter((t) => t.estimateType === selectedRouted.estimate.estimateType)}
          builtBy={findUser(selectedRouted.estimate.assignedLsEstimator)?.name ?? 'the estimator'}
          initialSendBack={selected?.sendBack ?? false}
          onClose={() => setSelected(null)}
          onApprove={(live, changed) => handleApprove(selectedRouted.estimate, live, changed)}
          onSaveAdjustment={(live) => handleSaveAdjustment(selectedRouted.estimate, live)}
          onSendBack={(reason, note) => handleSendBack(selectedRouted.estimate, reason, note)}
        />
      )}
    </div>
  )
}
