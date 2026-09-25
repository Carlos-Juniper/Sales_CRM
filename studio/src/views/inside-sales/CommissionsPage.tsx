import { useState } from 'react'
import { DollarSign } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useCommissionSummary,
  useCommissionsList,
  useCommissionReps,
  useCommissionPayoutSchedule,
} from '@/hooks/useCommissions'
import { useRole } from '@/hooks/useRole'
import { useAuthStore } from '@/store/authStore'
import { formatCents } from '@/lib/estimating/maintenance'
import {
  closedCommissionLabel,
  formatPayoutDate,
  formatRate,
  getCommissionPeriodDates,
} from '@/lib/commissions'
import type { Period } from '@/lib/commissions'
import type { CommissionFilters } from '@/types/commissions'
import { CommissionDetailTable } from './components/commissions/CommissionDetailTable'
import { CommissionAttainmentBar } from './components/commissions/CommissionAttainmentBar'
import { CommissionKpiCard } from './components/commissions/CommissionKpiCard'
import { CommissionOpenCheckCards } from './components/commissions/CommissionOpenCheckCards'
import { CommissionPayoutScheduleCard } from './components/commissions/CommissionPayoutScheduleCard'
import { CommissionPayoutPeriodView } from './components/commissions/CommissionPayoutPeriodView'

const PERIOD_LABELS: Record<Period, string> = {
  this_year: 'This Year',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_month: 'This Month',
  last_month: 'Last Month',
  all_time: 'All Time',
}

export default function CommissionsPage() {
  const { seesAllBranches, canViewRepSelector } = useRole()
  const currentUser = useAuthStore((state) => state.user)

  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined)
  const [period, setPeriod] = useState<Period>('this_year')
  const [filters, setFilters] = useState<CommissionFilters>({
    status: undefined,
    estimate_type: undefined,
  })

  const queryFilters: CommissionFilters = {
    ...filters,
    ...getCommissionPeriodDates(period),
    user_id: canViewRepSelector ? selectedUserId : undefined,
  }
  const { data: summary, isLoading: summaryLoading } = useCommissionSummary(queryFilters)
  const { data: commissions, isLoading: commissionsLoading } = useCommissionsList(queryFilters)
  const { data: reps } = useCommissionReps()
  const { data: schedule, isLoading: scheduleLoading } = useCommissionPayoutSchedule({
    user_id: queryFilters.user_id,
    start_date: queryFilters.start_date,
    end_date: queryFilters.end_date,
  })

  const approvedCount = (commissions ?? []).filter(c => c.status === 'approved').length
  const paidCount = (commissions ?? []).filter(c => c.status === 'paid').length

  const attainmentMax = Math.max(summary?.scheduled_ytd_cents ?? 0, summary?.paid_ytd_cents ?? 0, 1)
  const closedLabel = closedCommissionLabel(period)

  const selectedRep = canViewRepSelector && selectedUserId
    ? reps?.find(r => r.id === selectedUserId)
    : undefined

  const ownPlanName = !canViewRepSelector ? summary?.plan_name : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="Commissions" />

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">

          {/* Header with rep selector + period dropdown */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-[hsl(var(--fg))]">
                {canViewRepSelector && selectedRep
                  ? `${selectedRep.name}'s Commissions`
                  : 'Your Commissions'}
              </h1>
              <p className="text-sm text-[hsl(var(--muted-fg))] mt-0.5">
                {PERIOD_LABELS[period]} · totals follow the deal close date, not the check date
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {canViewRepSelector && reps && reps.length > 0 && (
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All Reps" />
                  </SelectTrigger>
                  <SelectContent>
                    {reps.map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PERIOD_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedRep?.plan_name && (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-fg))] -mt-3">
              <span className="font-medium text-[hsl(var(--fg))]">{selectedRep.name}</span>
              <span>·</span>
              <span>{selectedRep.plan_name}</span>
            </div>
          )}
          {selectedRep && !selectedRep.plan_name && selectedRep.commission_rate != null && (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-fg))] -mt-3">
              <span className="font-medium text-[hsl(var(--fg))]">{selectedRep.name}</span>
              <span>·</span>
              <span>
                {formatRate(selectedRep.commission_rate)} commission rate
                {selectedRep.effective_date ? ` · effective ${formatPayoutDate(selectedRep.effective_date)}` : ''}
              </span>
            </div>
          )}
          {ownPlanName && (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-fg))] -mt-3">
              <span className="font-medium text-[hsl(var(--fg))]">{currentUser?.name ?? 'You'}</span>
              <span>·</span>
              <span>{ownPlanName}</span>
            </div>
          )}

          {/* Close-date totals. Not the amount landing on each check. */}
          <div className="space-y-2">
            <p className="text-xs text-[hsl(var(--muted-fg))]">
              Closed commission is the amount recorded when the deal was won. Fully paid means every installment on that deal is paid.
            </p>
            <div className="flex gap-4 flex-wrap">
              {summaryLoading ? (
                <>
                  <Skeleton className="h-28 flex-1 min-w-[140px]" />
                  <Skeleton className="h-28 flex-1 min-w-[140px]" />
                </>
              ) : (
                <>
                  <CommissionKpiCard
                    label={closedLabel}
                    value={formatCents(summary?.scheduled_ytd_cents ?? 0)}
                    dotColor="bg-blue-500"
                  />
                  <CommissionKpiCard
                    label="Fully paid"
                    value={formatCents(summary?.paid_ytd_cents ?? 0)}
                    dotColor="bg-green-500"
                  />
                </>
              )}
              {commissionsLoading ? (
                <>
                  <Skeleton className="h-28 flex-1 min-w-[140px]" />
                  <Skeleton className="h-28 flex-1 min-w-[140px]" />
                </>
              ) : (
                <>
                  <CommissionKpiCard
                    label="Approved"
                    value={`${approvedCount} deal${approvedCount !== 1 ? 's' : ''}`}
                    dotColor="bg-blue-300"
                  />
                  <CommissionKpiCard
                    label="Paid"
                    value={`${paidCount} deal${paidCount !== 1 ? 's' : ''}`}
                    dotColor="bg-green-300"
                  />
                </>
              )}
            </div>
          </div>

          <CommissionOpenCheckCards
            nextPayout={summary?.next_payout}
            dueCents={summary?.due_cents}
            upcomingCents={summary?.upcoming_cents}
            isLoading={summaryLoading}
            balancesPeriodFiltered={summary?.balances_period_filtered ?? false}
          />

          {/* Attainment bars — Path A (proportional, no target) */}
          {!summaryLoading && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-fg))] mb-4">
                  Commission Attainment — {PERIOD_LABELS[period]}
                </p>
                <CommissionAttainmentBar
                  label="Fully paid"
                  valueCents={summary?.paid_ytd_cents ?? 0}
                  maxCents={attainmentMax}
                  barColor="bg-green-500"
                />
                <CommissionAttainmentBar
                  label={closedLabel}
                  valueCents={summary?.scheduled_ytd_cents ?? 0}
                  maxCents={attainmentMax}
                  barColor="bg-blue-500"
                />
              </CardContent>
            </Card>
          )}

          <CommissionPayoutScheduleCard
            schedule={schedule}
            isLoading={scheduleLoading}
          />

          <CommissionPayoutPeriodView
            periods={schedule?.by_payout_period}
            isLoading={scheduleLoading}
          />

          {/* Commission Detail Table */}
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
                  <h2 className="text-sm font-semibold text-[hsl(var(--fg))]">
                    Commission Details
                  </h2>
                </div>
              </div>

              <CommissionDetailTable
                commissions={commissions ?? []}
                isLoading={commissionsLoading}
                filters={filters}
                onFiltersChange={setFilters}
                isAdmin={seesAllBranches}
              />
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  )
}
