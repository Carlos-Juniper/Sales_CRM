import { CalendarClock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { formatCents } from '@/lib/estimating/maintenance'
import {
  formatCloseQuarter,
  payoutAmountLabel,
  payoutGroupLabel,
} from '@/lib/commissions'
import type { CommissionPayoutSchedule } from '@/types/commissions'
import { InstallmentStatusBadge } from './InstallmentStatusBadge'

interface CommissionPayoutScheduleCardProps {
  schedule: CommissionPayoutSchedule | undefined
  isLoading: boolean
  scopeNote: string
}

export function CommissionPayoutScheduleCard({
  schedule,
  isLoading,
  scopeNote,
}: CommissionPayoutScheduleCardProps) {
  const quarters = schedule?.quarters ?? []

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            <h2 className="text-sm font-semibold text-[hsl(var(--fg))]">Payout schedule</h2>
          </div>
          <p className="text-xs text-[hsl(var(--muted-fg))] mt-1">{scopeNote}</p>
        </div>

        {isLoading && (
          <div className="p-4 space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!isLoading && quarters.length === 0 && (
          <p className="px-4 py-8 text-sm text-center text-[hsl(var(--muted-fg))]">
            No closed deals in {schedule?.year ?? 'this year'}
          </p>
        )}

        {!isLoading && quarters.map((quarter) => (
          <section
            key={quarter.close_quarter}
            className="px-4 py-3 border-b border-[hsl(var(--border))] last:border-0"
            data-testid={`close-quarter-${quarter.close_quarter}`}
          >
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-sm font-medium text-[hsl(var(--fg))]">
                {formatCloseQuarter(quarter.close_quarter)}
              </h3>
              <p className="text-xs text-[hsl(var(--muted-fg))] text-right">
                {quarter.sales_count} deal{quarter.sales_count === 1 ? '' : 's'}
                {' · '}
                {formatCents(quarter.commission_total_cents)} recorded at close
              </p>
            </div>
            {quarter.installments.length === 0 ? (
              <p className="text-xs text-[hsl(var(--muted-fg))]">No installment schedule</p>
            ) : (
              <ul className="space-y-1.5">
                {quarter.installments.map((installment) => {
                  const month = payoutGroupLabel(installment)
                  const amount = payoutAmountLabel(installment)
                  const rowKey = `${installment.installment_number}-${installment.bucket}-${installment.payout_date ?? ''}`
                  return (
                    <li
                      key={rowKey}
                      className="flex items-center gap-3 flex-wrap text-xs"
                      data-testid={`quarter-${quarter.close_quarter}-payment-${installment.installment_number}-${installment.bucket}-${installment.payout_date ?? 'none'}`}
                    >
                      <span className="w-20 text-[hsl(var(--muted-fg))]">
                        Payment {installment.installment_number}
                      </span>
                      <span className="text-[hsl(var(--fg))]">{month}</span>
                      {amount !== month && (
                        <span className="font-mono text-[hsl(var(--fg))]">{amount}</span>
                      )}
                      <InstallmentStatusBadge status={installment.status} />
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  )
}
