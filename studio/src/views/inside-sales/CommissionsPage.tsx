import { useState } from 'react'
import { DollarSign } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCommissionSummary, useCommissionsList, useCommissionReps } from '@/hooks/useCommissions'
import { useRole } from '@/hooks/useRole'
import { formatCents } from '@/lib/estimating/maintenance'
import { formatRate, getPeriodDates } from '@/lib/commissions'
import type { Period } from '@/lib/commissions'
import type { CommissionFilters } from '@/types/commissions'
import { CommissionDetailTable } from './components/commissions/CommissionDetailTable'
import { CommissionAttainmentBar } from './components/commissions/CommissionAttainmentBar'
import { cn } from '@/lib/utils'

const PERIOD_LABELS: Record<Period, string> = {
  this_year: 'This Year',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_month: 'This Month',
  last_month: 'Last Month',
  all_time: 'All Time',
}


interface KpiCardProps {
  label: string
  value: string
  dotColor: string
}

function KpiCard({ label, value, dotColor }: KpiCardProps) {
  return (
    <Card className="flex-1">
      <CardContent className="p-0">
        <div className="flex items-center gap-1.5 px-4 py-3">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotColor)} />
          <span className="text-xs font-semibold tracking-widest text-[hsl(var(--muted-fg))] uppercase">
            {label}
          </span>
        </div>
        <div className="border-t border-[hsl(var(--border))]" />
        <div className="px-5 py-4">
          <p className="text-3xl font-bold text-[hsl(var(--fg))]">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function CommissionsPage() {
  const { seesAllBranches, canViewRepSelector } = useRole()

  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined)
  const [period, setPeriod] = useState<Period>('this_year')
  const [filters, setFilters] = useState<CommissionFilters>({
    status: undefined,
    estimate_type: undefined,
  })

  const queryFilters: CommissionFilters = {
    ...filters,
    ...getPeriodDates(period),
    user_id: canViewRepSelector ? selectedUserId : undefined,
  }

  const { data: summary, isLoading: summaryLoading } = useCommissionSummary(queryFilters)
  const { data: commissions, isLoading: commissionsLoading } = useCommissionsList(queryFilters)
  const { data: reps } = useCommissionReps()

  const approvedCount = (commissions ?? []).filter(c => c.status === 'approved').length
  const paidCount = (commissions ?? []).filter(c => c.status === 'paid').length

  const attainmentMax = Math.max(summary?.scheduled_ytd_cents ?? 0, summary?.paid_ytd_cents ?? 0, 1)

  const selectedRep = canViewRepSelector && selectedUserId
    ? reps?.find(r => r.id === selectedUserId)
    : undefined

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
                {PERIOD_LABELS[period].toLowerCase()} commission summary
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

          {/* Rep rate chip — admin only, shown when a rep is selected and has a rate on file */}
          {selectedRep?.commission_rate != null && (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-fg))] -mt-3">
              <span className="font-medium text-[hsl(var(--fg))]">{selectedRep.name}</span>
              <span>·</span>
              <span>{formatRate(selectedRep.commission_rate)} commission rate</span>
              {selectedRep.effective_date && (
                <>
                  <span>·</span>
                  <span>
                    effective{' '}
                    {new Date(selectedRep.effective_date + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </>
              )}
            </div>
          )}

          {/* KPI Cards */}
          <div className="flex gap-4 flex-wrap">
            {summaryLoading ? (
              <>
                <Skeleton className="h-28 flex-1 min-w-[140px]" />
                <Skeleton className="h-28 flex-1 min-w-[140px]" />
              </>
            ) : (
              <>
                <KpiCard
                  label="Scheduled YTD"
                  value={formatCents(summary?.scheduled_ytd_cents ?? 0)}
                  dotColor="bg-blue-500"
                />
                <KpiCard
                  label="Paid YTD"
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
                <KpiCard
                  label="Approved"
                  value={`${approvedCount} deal${approvedCount !== 1 ? 's' : ''}`}
                  dotColor="bg-blue-300"
                />
                <KpiCard
                  label="Paid"
                  value={`${paidCount} deal${paidCount !== 1 ? 's' : ''}`}
                  dotColor="bg-green-300"
                />
              </>
            )}
          </div>

          {/* Attainment bars — Path A (proportional, no target) */}
          {!summaryLoading && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-fg))] mb-4">
                  Commission Attainment — {PERIOD_LABELS[period]}
                </p>
                <CommissionAttainmentBar
                  label="Paid YTD"
                  valueCents={summary?.paid_ytd_cents ?? 0}
                  maxCents={attainmentMax}
                  barColor="bg-green-500"
                />
                <CommissionAttainmentBar
                  label="Scheduled YTD"
                  valueCents={summary?.scheduled_ytd_cents ?? 0}
                  maxCents={attainmentMax}
                  barColor="bg-blue-500"
                />
              </CardContent>
            </Card>
          )}

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
