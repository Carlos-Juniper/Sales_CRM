import { Receipt } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import {
  describePayout,
  formatPayoutDate,
  PENDING_BILLING_DATA_LABEL,
  payoutAmountLabel,
} from '@/lib/commissions'
import type { CommissionPayoutPeriod } from '@/types/commissions'
import { InstallmentStatusBadge } from './InstallmentStatusBadge'

interface CommissionPayoutPeriodViewProps {
  periods: CommissionPayoutPeriod[] | undefined
  isLoading: boolean
}

function periodKey(period: CommissionPayoutPeriod): string {
  if (period.bucket === 'dated') return period.payout_date ?? 'dated'
  return period.bucket
}

export function CommissionPayoutPeriodView({ periods, isLoading }: CommissionPayoutPeriodViewProps) {
  const rows = periods ?? []
  const hasUndated = rows.some((period) => period.bucket !== 'dated')

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-1.5">
            <Receipt className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            <h2 className="text-sm font-semibold text-[hsl(var(--fg))]">What hits each check</h2>
          </div>
          <p className="text-xs text-[hsl(var(--muted-fg))] mt-1">
            Dated checks come first. Unscheduled (amount known) and pending billing data stay in separate groups.
          </p>
          {hasUndated && !isLoading && (
            <p className="text-xs text-[hsl(var(--muted-fg))] mt-1">
              A partial sum is the known dollars plus pending. Missing amounts are not estimated.
            </p>
          )}
        </div>

        {isLoading && (
          <div className="p-4 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <p className="px-4 py-8 text-sm text-center text-[hsl(var(--muted-fg))]">
            No checks in this period
          </p>
        )}

        {!isLoading && rows.length > 0 && (
          <ul>
            {rows.map((period) => {
              const payout = describePayout(period)
              const key = periodKey(period)
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-[hsl(var(--border))] last:border-0 text-sm"
                  data-testid={`payout-period-${key}`}
                >
                  <span className="min-w-[140px] font-medium text-[hsl(var(--fg))]">
                    {payout.kind === 'pending' ? PENDING_BILLING_DATA_LABEL : payout.month}
                  </span>
                  {period.payout_date && (
                    <span className="text-xs text-[hsl(var(--muted-fg))]">
                      {formatPayoutDate(period.payout_date)}
                    </span>
                  )}
                  {payout.kind === 'known' && payout.amount != null && (
                    <span className="ml-auto font-mono text-xs text-[hsl(var(--fg))]">
                      {payoutAmountLabel({ amount_cents: payout.amount, amount_partial: period.amount_partial })}
                    </span>
                  )}
                  <InstallmentStatusBadge status={period.status} />
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
