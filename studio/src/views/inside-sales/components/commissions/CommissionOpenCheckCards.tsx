import { formatCents } from '@/lib/estimating/maintenance'
import { formatPayoutDate } from '@/lib/commissions'
import type { CommissionNextPayout } from '@/types/commissions'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { CommissionKpiCard } from './CommissionKpiCard'

interface CommissionOpenCheckCardsProps {
  nextPayout: CommissionNextPayout | null | undefined
  dueCents: number | null | undefined
  upcomingCents: number | null | undefined
  isLoading: boolean
}

function nextPayoutHint(nextPayout: CommissionNextPayout | null | undefined): string {
  if (!nextPayout) return 'No dated check'
  return `${nextPayout.payout_period} · ${formatPayoutDate(nextPayout.payout_date)}`
}

export function CommissionOpenCheckCards({
  nextPayout,
  dueCents,
  upcomingCents,
  isLoading,
}: CommissionOpenCheckCardsProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-[hsl(var(--muted-fg))]">
        Open checks with a payout date. Pending billing data is not included. Not period-filtered.
      </p>
      {isLoading ? (
        <div className="flex gap-4 flex-wrap">
          <Skeleton className="h-28 flex-1 min-w-[160px]" />
          <Skeleton className="h-28 flex-1 min-w-[160px]" />
          <Skeleton className="h-28 flex-1 min-w-[160px]" />
        </div>
      ) : (
        <div className="flex gap-4 flex-wrap">
          <CommissionKpiCard
            label="Next payout"
            value={nextPayout ? formatCents(nextPayout.amount_cents) : '—'}
            hint={nextPayoutHint(nextPayout)}
            dotColor="bg-amber-500"
          />
          <CommissionKpiCard
            label="Due"
            value={formatCents(dueCents ?? 0)}
            hint="Dated checks on or before today"
            dotColor="bg-amber-300"
          />
          <CommissionKpiCard
            label="Upcoming"
            value={formatCents(upcomingCents ?? 0)}
            hint="Dated checks after today"
            dotColor="bg-blue-400"
          />
        </div>
      )}
    </div>
  )
}
