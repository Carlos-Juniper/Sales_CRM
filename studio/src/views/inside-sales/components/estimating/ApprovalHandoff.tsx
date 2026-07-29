// ---------------------------------------------------------------------------
// Approval & Handoff tab (Handoff 08).
//
// Value-tiered approval routing for the open estimate:
//   - Contract value + required tier, computed from the CONFIG approval_tiers
//     rows via tierForValue (never a hardcoded ladder).
//   - Install estimates have NO approval matrix yet (BRD II-7 open item) —
//     the tiered flow is disabled, never silently reusing the maintenance
//     ladder.
//   - "Approve & hand back to Sales" is an in-platform status change (BRD
//     Steps 6/8) executed by lib/estimating/transitions.ts server-side;
//     actor + timestamp are audited (BRD III-1). No lifecycle logic here.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import {
  ArrowLeftRight,
  Briefcase,
  Building2,
  Check,
  Info,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  Users,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { estimatingApi } from '@/api/estimating'
import { tierForValue } from '@/lib/estimating/calc'
import { APPROVAL_TIER_SEED, tiersForType } from '@/lib/estimating/config'
import { canApproveAndHandBack } from '@/lib/estimating/transitions'
import { useAuthStore } from '@/store/authStore'
import { mockUsers } from '@/mocks/data'
import { cn } from '@/lib/utils'
import type { ApprovalRoleKey, ApprovalTier } from '@/types/estimating'
import { useEstimatingShell } from './useEstimatingShell'
import { useToast } from './useToast'

/** Exact dollars for the contract-value card (design: large, green). */
function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

/** Compact dollars for tier ranges ($100K, $1M) — derived from config cents. */
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
function tierRange(tier: ApprovalTier): string {
  if (tier.maxValueCents === null) return `Over ${compact(tier.minValueCents)}`
  if (tier.minValueCents === 0) return `Under ${compact(tier.maxValueCents)}`
  return `${compact(tier.minValueCents)}–${compact(tier.maxValueCents)}`
}

const TIER_ICONS: Record<ApprovalRoleKey, React.ElementType> = {
  branch_manager: UserCheck,
  regional_director: Users,
  bp: Briefcase,
  coo: Building2,
}

export interface ApprovalHandoffProps {
  /**
   * The approval_tiers config rows (§3.9). Defaults to the seed; in
   * production these come from the config table — the ladder re-renders from
   * whatever rows are supplied, with no code change.
   */
  tiers?: ApprovalTier[]
}

export function ApprovalHandoff({ tiers = APPROVAL_TIER_SEED }: ApprovalHandoffProps) {
  const { openEstimate, setOpenEstimate } = useEstimatingShell()
  const { show } = useToast()
  const user = useAuthStore((s) => s.user)
  const [notifyBmRd, setNotifyBmRd] = useState(
    openEstimate?.approvalSettings?.notifyBmRdOnReturn ?? true,
  )
  const [submitting, setSubmitting] = useState(false)

  if (!openEstimate) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <ShieldCheck className="h-8 w-8 text-[hsl(var(--muted-fg))]" />
        <p className="text-sm font-medium text-[hsl(var(--fg))]">No estimate open</p>
        <p className="text-xs text-[hsl(var(--muted-fg))]">
          Open an estimate from the queue to review its approval routing.
        </p>
      </div>
    )
  }

  const ladder = tiersForType(tiers, openEstimate.estimateType)
  const requiredTier = tierForValue(openEstimate.contractValueCents, ladder)
  const noMatrix = ladder.length === 0
  const salesperson =
    mockUsers.find((u) => u.id === openEstimate.crmRep)?.name ?? 'the salesperson'
  const eligible = !noMatrix && canApproveAndHandBack(openEstimate.status)

  async function handleNotifyChange(checked: boolean) {
    if (!openEstimate) return
    setNotifyBmRd(checked)
    const updated = await estimatingApi.update(openEstimate.id, {
      approvalSettings: { notifyBmRdOnReturn: checked },
    })
    setOpenEstimate(updated)
  }

  async function handleApprove() {
    if (!openEstimate || !eligible || submitting) return
    setSubmitting(true)
    try {
      const { estimate } = await estimatingApi.approveAndHandBack(openEstimate.id, {
        actor: user?.name ?? 'Unknown approver',
        notifyBmRdOnReturn: notifyBmRd,
      })
      setOpenEstimate(estimate)
      show(`Approved & handed back to Sales (${salesperson})`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex max-w-[820px] flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-[hsl(var(--fg))]">Approval &amp; handoff</h3>
        <p className="mt-1 text-xs text-[hsl(var(--muted-fg))]">
          Routing is enforced automatically by total contract value.
        </p>
      </div>

      {/* Contract value + tier ladder */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
        <div className="mb-3.5 flex items-center justify-between">
          <div>
            <p className="text-[13px] text-[hsl(var(--muted-fg))]">This estimate</p>
            <p className="mt-0.5 text-2xl font-bold text-[#2E7D52]">
              {dollars(openEstimate.contractValueCents)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[hsl(var(--muted-fg))]">Required tier</p>
            <p data-testid="required-tier" className="mt-0.5 text-base font-bold text-[hsl(var(--fg))]">
              {noMatrix ? '—' : (requiredTier?.label ?? '—')}
            </p>
          </div>
        </div>

        {noMatrix ? (
          <div
            data-testid="no-approval-matrix"
            className="flex items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <p className="text-xs text-amber-800">
              No approval matrix defined for install estimates; pending confirmation. The tiered
              approve flow is disabled until the install ladder is configured — the maintenance
              ladder is never reused silently.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {[...ladder]
                .sort((a, b) => a.order - b.order)
                .map((tier) => {
                  const Icon = TIER_ICONS[tier.roleKey] ?? ShieldCheck
                  const active = tier.id === requiredTier?.id
                  return (
                    <div
                      key={tier.id}
                      data-testid={`tier-row-${tier.roleKey}`}
                      className={cn(
                        'flex items-center gap-3 rounded-[10px] border px-3.5 py-[11px]',
                        active
                          ? 'border-[#2E7D52] bg-[#f0faf4]'
                          : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 flex-shrink-0',
                          active ? 'text-[#2E7D52]' : 'text-[hsl(var(--muted-fg))]',
                        )}
                      />
                      <div className="flex-1">
                        <p
                          className={cn(
                            'text-[13px] font-semibold',
                            active ? 'text-[#1d5c3b]' : 'text-[hsl(var(--fg))]',
                          )}
                        >
                          {tier.label}
                        </p>
                        <p className="mt-px text-[11px] text-[hsl(var(--muted-fg))]">
                          {tierRange(tier)}
                        </p>
                      </div>
                      {active && (
                        <span className="text-[11px] font-semibold text-[#2E7D52]">
                          Required for this estimate
                        </span>
                      )}
                    </div>
                  )
                })}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-fg))]">
              <Info className="h-3.5 w-3.5 flex-shrink-0" />
              "BP" senior-ops title and the COO mechanism above $1M are open items — routing here
              is configurable, not hard-coded.
            </p>
          </>
        )}
      </div>

      {/* On-approval settings + CTA */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
        <p className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]">On approval</p>
        <label className="flex cursor-pointer items-center gap-2.5 py-2">
          <Switch
            checked={notifyBmRd}
            onCheckedChange={handleNotifyChange}
            aria-label="Notify both Branch Manager & Regional Director on return (current practice)"
          />
          <span className="text-xs text-[hsl(var(--fg))]">
            Notify both Branch Manager &amp; Regional Director on return (current practice)
          </span>
        </label>
        <div className="mt-2 flex items-center gap-2.5 rounded-[10px] border border-[#bfdfcd] bg-[#f0faf4] px-3 py-2.5">
          <ArrowLeftRight className="h-4 w-4 flex-shrink-0 text-[#2E7D52]" />
          <p className="text-xs text-[#1d5c3b]">
            Approved estimate flows back to <strong>{salesperson}</strong> in-platform via status
            change — no email handoff.
          </p>
        </div>
        <button
          type="button"
          onClick={handleApprove}
          disabled={!eligible || submitting}
          className="mt-3.5 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#2E7D52] text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          Approve &amp; hand back to Sales
        </button>
      </div>
    </div>
  )
}
