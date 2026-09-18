import { TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { formatCurrency } from '@/lib/utils'
import type { CrmAnalytics } from '@/types'

interface MetricRow {
  label: string
  value: number
  target: number
  color: string
}

interface CrmPipelineAnalyticsCardProps {
  analytics: CrmAnalytics | undefined
  isLoading: boolean
}

export function CrmPipelineAnalyticsCard({ analytics, isLoading }: CrmPipelineAnalyticsCardProps) {
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Sales Volume vs Target</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!analytics) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Sales Volume vs Target</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-[hsl(var(--muted-fg))] text-center py-4">No data available</p>
        </CardContent>
      </Card>
    )
  }

  const targetMultiplier = 1.25

  const metrics: MetricRow[] = [
    {
      label: 'Win YTD',
      value: analytics.won_ytd,
      target: analytics.won_ytd * targetMultiplier,
      color: 'bg-emerald-500',
    },
    {
      label: 'Sales Volume YTD',
      value: analytics.total_revenue,
      target: analytics.total_revenue * targetMultiplier,
      color: 'bg-blue-500',
    },
    {
      label: 'Win & Loss Reasons',
      value: analytics.won_deals + (analytics.leads_by_status.lost || 0),
      target: (analytics.won_deals + (analytics.leads_by_status.lost || 0)) * 1.2,
      color: 'bg-amber-500',
    },
    {
      label: 'Run Rate & Loss Seasons',
      value: analytics.won_value_this_month * 12,
      target: (analytics.won_value_this_month * 12) * 1.15,
      color: 'bg-purple-500',
    },
  ]

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
          </div>
          <CardTitle className="text-sm font-semibold">Sales Volume vs Target</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {metrics.map((metric) => {
          const percentage = Math.min((metric.value / metric.target) * 100, 100)
          const isOnTarget = percentage >= 80

          return (
            <div key={metric.label} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${metric.color}`} />
                  <span className="font-medium text-[hsl(var(--fg))]">{metric.label}</span>
                </div>
                <span className="text-xs text-[hsl(var(--muted-fg))]">
                  {formatCurrency(metric.value)} / {formatCurrency(metric.target)}
                </span>
              </div>

              <div className="relative h-2 bg-[hsl(var(--muted))] rounded-full overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 ${metric.color} transition-all duration-300`}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className={isOnTarget ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  {percentage.toFixed(0)}% {isOnTarget ? 'On Target' : 'Below Target'}
                </span>
                <span className="text-[hsl(var(--muted-fg))]">
                  {formatCurrency(metric.target - metric.value)} remaining
                </span>
              </div>
            </div>
          )
        })}

        <div className="mt-6 pt-4 border-t border-[hsl(var(--border))]">
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] mb-1">Overall Win Rate</p>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {analytics.win_rate}%
            </p>
            <p className="text-xs text-[hsl(var(--muted-fg))] mt-1">
              {analytics.won_deals} won / {analytics.total_leads} total leads
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
