import { CheckCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { formatCurrency } from '@/lib/utils'
import type { CrmAnalytics } from '@/types'

interface CrmActivityCardProps {
  analytics: CrmAnalytics | undefined
  isLoading: boolean
}

export function CrmActivityCard({ analytics, isLoading }: CrmActivityCardProps) {
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Won Deals</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!analytics || analytics.won_deals_list.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <CheckCircle className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Won Deals</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-[hsl(var(--muted-fg))] text-center py-8">No won deals yet</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <CheckCircle className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Won Deals</CardTitle>
          </div>
          <span className="text-xs text-[hsl(var(--muted-fg))]">
            {analytics.won_deals_list.length} recent
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-0">
          <div className="grid grid-cols-[1fr_auto] gap-2 px-1 pb-1.5 border-b border-[hsl(var(--border))]">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))]">Property</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] text-right w-20">Value</span>
          </div>

          {analytics.won_deals_list.map((deal, index) => {
            const closeDate = deal.close_date ? new Date(deal.close_date) : null
            const formattedDate = closeDate
              ? closeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'No date'

            return (
              <div
                key={index}
                className="grid grid-cols-[1fr_auto] gap-2 items-center px-1 py-2.5 border-b border-[hsl(var(--border))] last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[hsl(var(--fg))] truncate">
                    {deal.property_name || 'Untitled Property'}
                  </p>
                  <p className="text-[10px] text-[hsl(var(--muted-fg))] mt-0.5">
                    Closed: {formattedDate}
                  </p>
                </div>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 text-right w-20">
                  {formatCurrency(deal.value)}
                </span>
              </div>
            )
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-[hsl(var(--border))]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))]">Total Revenue</span>
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(analytics.total_revenue)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
