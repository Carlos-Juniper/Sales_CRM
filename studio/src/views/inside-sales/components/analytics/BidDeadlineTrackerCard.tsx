import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { DeadlineChip } from '@/components/shared/DeadlineChip'
import { useBids } from '@/hooks/useBids'
import { formatCurrency, daysUntil } from '@/lib/utils'
import { BID_STATUS_LABELS } from '@/lib/constants'
import type { Bid, BidStatus } from '@/types'

const ACTIVE_STATUSES: BidStatus[] = ['pending', 'pursuing', 'submitted']

const BID_STATUS_COLORS: Record<BidStatus, { bg: string; text: string }> = {
  pending:   { bg: 'bg-slate-100 dark:bg-slate-800',  text: 'text-slate-600 dark:text-slate-300' },
  pursuing:  { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  submitted: { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-700 dark:text-violet-300' },
  won:       { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300' },
  lost:      { bg: 'bg-red-100 dark:bg-red-900/30',   text: 'text-red-700 dark:text-red-300' },
  no_bid:    { bg: 'bg-slate-100 dark:bg-slate-800',  text: 'text-slate-500 dark:text-slate-400' },
}

function urgencyAccent(days: number): string {
  if (days <= 3)  return 'bg-red-500'
  if (days <= 7)  return 'bg-amber-400'
  if (days <= 14) return 'bg-blue-400'
  return 'bg-emerald-400'
}

function BidRow({ bid }: { bid: Bid }) {
  const days = daysUntil(bid.deadline)
  const colors = BID_STATUS_COLORS[bid.status]

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[hsl(var(--border))] last:border-0">
      {/* Urgency accent */}
      <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${urgencyAccent(days)}`} />

      {/* Title + agency */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[hsl(var(--fg))] truncate">{bid.title}</p>
        <p className="text-[10px] text-[hsl(var(--muted-fg))] truncate mt-0.5">{bid.agency}</p>
      </div>

      {/* Status badge */}
      <span className={`hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0 ${colors.bg} ${colors.text}`}>
        {BID_STATUS_LABELS[bid.status]}
      </span>

      {/* Deadline chip */}
      <DeadlineChip deadline={bid.deadline} className="flex-shrink-0 text-[10px]" />

      {/* Value */}
      <span className="text-xs font-semibold text-[hsl(var(--fg))] flex-shrink-0 w-16 text-right">
        {formatCurrency(bid.estimated_value)}
      </span>
    </div>
  )
}

export function BidDeadlineTrackerCard() {
  const navigate = useNavigate()
  const { data: bids, isLoading } = useBids()

  const { activeBids, totalAtRisk, dueThisWeek } = useMemo(() => {
    const active = (bids ?? [])
      .filter((b) => ACTIVE_STATUSES.includes(b.status))
      .sort((a, b) => daysUntil(a.deadline) - daysUntil(b.deadline))

    const totalAtRisk = active.reduce((sum, b) => sum + b.estimated_value, 0)
    const dueThisWeek = active.filter((b) => daysUntil(b.deadline) <= 7).length

    return { activeBids: active, totalAtRisk, dueThisWeek }
  }, [bids])

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <CalendarClock className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Bid Deadlines</CardTitle>
          </div>
          <div className="flex gap-4 text-right">
            {dueThisWeek > 0 && (
              <div>
                <p className="text-[10px] text-[hsl(var(--muted-fg))] uppercase tracking-wide">Due This Week</p>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{dueThisWeek}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-[hsl(var(--muted-fg))] uppercase tracking-wide">At Risk</p>
              <p className="text-lg font-bold text-[hsl(var(--fg))]">{formatCurrency(totalAtRisk)}</p>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : activeBids.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-fg))] py-6 text-center">No active bids with deadlines</p>
        ) : (
          <>
            {/* Column headers */}
            <div className="flex items-center gap-3 pb-1.5 border-b border-[hsl(var(--border))]">
              <div className="w-1 flex-shrink-0" />
              <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))]">Bid</span>
              <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] w-16">Status</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] w-16">Deadline</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] w-16 text-right">Value</span>
            </div>

            <div>
              {activeBids.map((bid) => <BidRow key={bid.id} bid={bid} />)}
            </div>

            <Button
              variant="link"
              size="sm"
              className="mt-1 px-0 h-auto text-xs"
              onClick={() => navigate('/inside-sales/proposals')}
            >
              View proposals →
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
