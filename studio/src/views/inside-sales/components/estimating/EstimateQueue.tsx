// ---------------------------------------------------------------------------
// Estimate Queue — the estimator's landing/worklist view.
//
// Replaces the shared Excel "list" with a role-and-branch-scoped queue visible
// only to Estimating/managers (BRD I-9.3 / I-9.5 / I-9.6). Estimates land here
// from intake with `estimateType` already set — the queue NEVER asks for or
// sets an editor mode; clicking a card opens the Line-Item Editor, which keys
// its engine off the estimate's immutable `estimateType`.
//
// SLA (BRD I-6.2): 14-calendar-day return window; countdown + at-risk state
// computed from `dueBackDate` against SLA_CONFIG (lib/estimating/sla.ts).
//
// ── Intake CTA seams ──────────────────────────────────────────────────
// The two intake CTAs accept opener callbacks:
//   <EstimateQueue onMaintenanceIntake={openMaintModal} onInstallIntake={openInstallModal} />
// Until those modals attach, clicking shows a clearly-marked stub toast.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Hammer,
  Inbox,
  Lock,
  Repeat,
  RotateCcw,
  Send,
  ShieldCheck,
  Trophy,
  User,
  XCircle,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useEstimates } from '@/hooks/useEstimate'
import { SyncStatusBadge } from './SyncStatusBadge'
import { acresFromSqft } from '@/lib/estimating/calc'
import { SLA_CONFIG, slaCountdownLabel, slaDaysLeft, slaStateFor, type SlaState } from '@/lib/estimating/sla'
import { useAuthStore } from '@/store/authStore'
import { useRole } from '@/hooks/useRole'
import { useUsers } from '@/hooks/useUsers'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import type { Estimate, EstimatePriority, EstimateStatus } from '@/types/estimating'
import { useEstimatingShell } from './useEstimatingShell'
import { useToast } from './useToast'
import { RushBadge } from './RushIndicators'

// ----- Branch scope ----------------------------------------------------------
// The scope is enforced SERVER-side from the JWT (BRD I-9.5): the
// API derives the branch from the authenticated user and ignores any client
// `branch` param for non-exec roles, so the client sends nothing. The
// lock-chip only *displays* the applied scope.
function branchScopeLabel(
  seesAllBranches: boolean,
  branchId: string | null | undefined,
): string {
  if (seesAllBranches) return 'All branches'
  return branchId || 'your branch'
}

// ----- Badge configs (§3.2 status enum + priority) ----------------------------

const PRIORITY_CONFIG: Record<EstimatePriority, { label: string; className: string }> = {
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  high: { label: 'High', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  medium: { label: 'Medium', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
}

const STATUS_CONFIG: Record<
  EstimateStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  new_from_sales: { label: 'New — from Sales', icon: Inbox, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  queued: { label: 'Queued', icon: Clock, className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  in_progress: { label: 'In Progress', icon: RotateCcw, className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  review: { label: 'Review', icon: AlertTriangle, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  pending_approval: { label: 'Pending Approval', icon: ShieldCheck, className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  approved: { label: 'Approved', icon: CheckCircle2, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  handed_back: { label: 'Handed Back', icon: Send, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  won: { label: 'Won', icon: Trophy, className: 'bg-[#e8f3ed] text-[#2E7D52] dark:bg-emerald-900/30 dark:text-emerald-300' },
  lost: { label: 'Lost', icon: XCircle, className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
}

/** Type tag: customer_type and/or estimateType (design: government/HOA/install…). */
function typeTag(estimate: Estimate): string {
  if (estimate.estimateType === 'install') return 'install'
  const labels: Record<string, string> = {
    hoa: 'HOA',
    cdd: 'CDD',
    government: 'government',
    commercial: 'commercial',
  }
  return labels[estimate.customerType] ?? estimate.customerType
}

/** Acreage is stored when known, otherwise derived from section square feet. */
function estimateAcres(estimate: Estimate): number {
  if (estimate.acreage !== null) return estimate.acreage
  return acresFromSqft(estimate.sections.reduce((sum, s) => sum + s.squareFeet, 0))
}

// ----- Sorting -----------------------------------------------------------------

type SortKey = 'priority' | 'deadline' | 'value' | 'acreage'
type SortDir = 'asc' | 'desc'

const PRIORITY_ORDER: Record<EstimatePriority, number> = { urgent: 0, high: 1, medium: 2 }

/** Default direction per chip: priority/deadline most-pressing-first, value/acreage largest-first. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  priority: 'asc',
  deadline: 'asc',
  value: 'desc',
  acreage: 'desc',
}

function compareBy(key: SortKey, a: Estimate, b: Estimate): number {
  switch (key) {
    case 'priority':
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    case 'deadline':
      return new Date(a.dueBackDate).getTime() - new Date(b.dueBackDate).getTime()
    case 'value':
      return a.contractValueCents - b.contractValueCents
    case 'acreage':
      return estimateAcres(a) - estimateAcres(b)
  }
}

// ----- Component -----------------------------------------------------------------

export interface EstimateQueueProps {
  /** Opens the Maintenance Intake modal (`estimateType: 'maintenance'`). */
  onMaintenanceIntake?: () => void
  /** Opens the Install Proposal Request modal (`estimateType: 'install'`). */
  onInstallIntake?: () => void
  /** CTA label is configurable. */
  installCtaLabel?: string
}

export function EstimateQueue({
  onMaintenanceIntake,
  onInstallIntake,
  installCtaLabel = 'Install Intake',
}: EstimateQueueProps) {
  const { openEstimateAt } = useEstimatingShell()
  const { show } = useToast()
  const user = useAuthStore((s) => s.user)
  const { seesAllBranches } = useRole()
  const branchScope = branchScopeLabel(seesAllBranches, user?.branch_id)
  const { findUser } = useUsers()

  // Branch scope is applied server-side from the session — no branch param.
  const { data: estimatesData, isError, refetch } = useEstimates()
  const estimates = estimatesData ?? (isError ? [] : null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(DEFAULT_DIR[key])
    }
  }

  function openEstimate(estimate: Estimate) {
    // The editor auto-selects its engine from `estimateType` — no mode prompt.
    openEstimateAt(estimate, 'editor')
  }

  // Stubs — replaced by the real modal openers when they land.
  function handleMaintenanceIntake() {
    if (onMaintenanceIntake) onMaintenanceIntake()
    else show('Maintenance intake modal is not wired up yet')
  }
  function handleInstallIntake() {
    if (onInstallIntake) onInstallIntake()
    else show('Install intake modal is not wired up yet')
  }

  const items = useMemo(() => {
    if (!estimates) return []
    const filtered =
      statusFilter === 'all' ? estimates : estimates.filter((e) => e.status === statusFilter)
    return [...filtered].sort((a, b) => {
      const cmp = compareBy(sortKey, a, b)
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [estimates, statusFilter, sortKey, sortDir])

  // AC 1 — stats computed from the live queried set, never hardcoded.
  const stats = useMemo(() => {
    const all = estimates ?? []
    return {
      total: all.length,
      slaAtRisk: all.filter((e) => slaStateFor(slaDaysLeft(e.dueBackDate)) !== 'ok').length,
      active: all.filter((e) => e.status === 'in_progress' || e.status === 'review').length,
      valueCents: all.reduce((sum, e) => sum + e.contractValueCents, 0),
    }
  }, [estimates])

  function SortIcon({ field }: { field: SortKey }) {
    if (sortKey !== field) return null
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard testId="stat-total-queue" label="Total Queue" value={String(stats.total)} sub="estimates pending" />
        <StatCard
          testId="stat-sla-at-risk"
          label="SLA at Risk"
          value={String(stats.slaAtRisk)}
          sub={`breaching ${SLA_CONFIG.returnWindowDays}-day window`}
          danger={stats.slaAtRisk > 0}
        />
        <StatCard testId="stat-active" label="Active" value={String(stats.active)} sub="in build or review" />
        <StatCard
          testId="stat-queue-value"
          label="Queue Value"
          value={formatCurrency(stats.valueCents / 100)}
          sub="est. contract value"
        />
      </div>

      {/* Filter / sort bar + intake CTAs */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-xs" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {(Object.keys(STATUS_CONFIG) as EstimateStatus[]).map((k) => (
              <SelectItem key={k} value={k}>
                {STATUS_CONFIG[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Lock-chip — reflects the server-enforced row scope (BRD I-9.5). */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bfdcc9] bg-[#e8f3ed] px-2.5 py-1 text-[11px] font-medium text-[#2E7D52]">
          <Lock className="h-3 w-3" />
          Role &amp; branch scoped — {branchScope}
        </span>

        <div className="flex items-center gap-1 ml-auto text-xs text-[hsl(var(--muted-fg))]">
          Sort by:
          {(['priority', 'deadline', 'value', 'acreage'] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleSort(k)}
              className={cn(
                'flex items-center gap-0.5 px-2 py-1 rounded capitalize hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer',
                sortKey === k && 'bg-[hsl(var(--muted))] font-medium text-[hsl(var(--fg))]',
              )}
            >
              {k} <SortIcon field={k} />
            </button>
          ))}
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={handleMaintenanceIntake}
        >
          <Repeat className="h-3.5 w-3.5" /> Maintenance intake
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5 bg-[#2E7D52] hover:bg-[#256844] text-white"
          onClick={handleInstallIntake}
        >
          <Hammer className="h-3.5 w-3.5" /> {installCtaLabel}
        </Button>
      </div>

      {/* Queue cards */}
      <div className="flex flex-col gap-2 overflow-y-auto pb-4">
        {estimates === null ? (
          <p className="py-8 text-center text-xs text-[hsl(var(--muted-fg))]">Loading queue…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-xs text-[hsl(var(--muted-fg))]">
            No estimates in your queue.
          </p>
        ) : (
          items.map((estimate) => (
            <QueueCard key={estimate.id} estimate={estimate} onOpen={openEstimate} onRetried={() => void refetch()} findUser={findUser} />
          ))
        )}
      </div>
    </div>
  )
}

// ----- Pieces ---------------------------------------------------------------------

function StatCard({
  testId,
  label,
  value,
  sub,
  danger = false,
}: {
  testId: string
  label: string
  value: string
  sub: string
  danger?: boolean
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-3 pb-3">
        <p className="text-xs text-[hsl(var(--muted-fg))]">{label}</p>
        <p className={cn('text-xl font-bold mt-0.5', danger ? 'text-red-500' : 'text-[hsl(var(--fg))]')}>
          {value}
        </p>
        <p className="text-[10px] text-[hsl(var(--muted-fg))] mt-0.5">{sub}</p>
      </CardContent>
    </Card>
  )
}

function QueueCard({
  estimate,
  onOpen,
  onRetried,
  findUser,
}: {
  estimate: Estimate
  onOpen: (estimate: Estimate) => void
  onRetried?: () => void
  findUser: (id: string | null | undefined) => { avatar_initials: string; name: string } | undefined
}) {
  const daysLeft = slaDaysLeft(estimate.dueBackDate)
  const sla: SlaState = slaStateFor(daysLeft)
  const priCfg = PRIORITY_CONFIG[estimate.priority]
  const statusCfg = STATUS_CONFIG[estimate.status]
  const StatusIcon = statusCfg.icon
  const rep = findUser(estimate.assignedLsEstimator ?? estimate.assignedIrrEstimator)
  const acres = estimateAcres(estimate)

  return (
    <Card
      data-testid="queue-card"
      onClick={() => onOpen(estimate)}
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        // Border escalates toward danger as the SLA window closes (§1).
        sla === 'breached' && 'border-red-400 dark:border-red-700',
        sla === 'at_risk' && 'border-red-300 dark:border-red-800',
        sla === 'ok' && estimate.status === 'new_from_sales' && 'border-[#bfdcc9]',
      )}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {/* Badge row */}
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold', priCfg.className)}>
                {priCfg.label}
              </span>
              <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', statusCfg.className)}>
                <StatusIcon className="h-2.5 w-2.5" />
                {statusCfg.label}
              </span>
              {/* Server flag only. Past-due rows stay on the overdue countdown below; isRush is false for those. */}
              {estimate.isRush && <RushBadge />}
              <span className="text-[10px] text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded">
                {typeTag(estimate)}
              </span>
            </div>

            <p data-testid="queue-card-name" className="font-semibold text-sm text-[hsl(var(--fg))] truncate">
              {estimate.name}
            </p>

            {/* User-facing identifier (Aspire #) + sync-status affordance. The
                wrapper stops click bubbling so a retry doesn't open the editor. */}
            <div className="mt-1" onClick={(e) => e.stopPropagation()}>
              <SyncStatusBadge estimate={estimate} onRetried={onRetried} />
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-1">
              <span className="text-xs text-[hsl(var(--muted-fg))]">
                {acres.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ac
              </span>
              <span className="text-xs font-medium text-[hsl(var(--fg))]">
                {formatCurrency(estimate.contractValueCents / 100)}
              </span>
              {estimate.siteWalkDate && (
                <span className="text-xs text-[hsl(var(--muted-fg))]">
                  Walk: {formatDate(estimate.siteWalkDate)}
                </span>
              )}
            </div>
          </div>

          {/* Right column: SLA countdown + assigned rep */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
            <span
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                sla === 'breached' ? 'text-red-600' : sla === 'at_risk' ? 'text-amber-600' : 'text-[hsl(var(--muted-fg))]',
              )}
            >
              <Calendar className="h-3.5 w-3.5" />
              {slaCountdownLabel(daysLeft, sla)}
            </span>
            {rep ? (
              <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-fg))]">
                <span className="h-5 w-5 rounded-full bg-[#2E7D52] flex items-center justify-center text-white text-[8px] font-bold">
                  {rep.avatar_initials}
                </span>
                {rep.name.split(' ')[0]}
              </span>
            ) : (
              <span className="text-[10px] text-[hsl(var(--muted-fg))] flex items-center gap-1">
                <User className="h-3 w-3" /> Unassigned
              </span>
            )}
          </div>
        </div>

        {/* Tracked RFI status, surfaced for visibility only
            (nothing gates approval on it). */}
        {estimate.rfiStatus && (
          <p
            data-testid="queue-rfi-status"
            className="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block"
          >
            <span className="font-semibold">RFI:</span> {estimate.rfiStatus}
          </p>
        )}

        {estimate.notes && (
          <p className="mt-2 text-xs text-[hsl(var(--muted-fg))] line-clamp-2 italic">
            “{estimate.notes}”
          </p>
        )}
      </CardContent>
    </Card>
  )
}
