import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { PipelineAnalyticsCard } from './components/analytics/PipelineAnalyticsCard'
import { RevenueForecastCard } from './components/analytics/RevenueForecastCard'
import { ScoreDistributionCard } from './components/analytics/ScoreDistributionCard'
import { TeamPerformanceCard } from './components/analytics/TeamPerformanceCard'
import { useInsideSalesDashboard } from '@/hooks/useBids'
import { useAuthStore } from '@/store/authStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn, formatCompact } from '@/lib/utils'

interface GroupedStat {
  title: string
  value: string | number
  description?: string
  valueColor?: string
  descriptionColor?: string
}

interface GroupedStatCardProps {
  label: string
  dotColor: string
  stats: GroupedStat[]
  onClick?: () => void
}

function GroupedStatCard({ label, dotColor, stats, onClick }: GroupedStatCardProps) {
  return (
    <Card className={cn('flex-1', onClick && 'cursor-pointer hover:shadow-md transition-shadow')} onClick={onClick}>
      <CardContent className="p-0">
        <div className="flex items-center gap-1.5 px-4 py-3">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotColor)} />
          <span className="text-xs font-semibold tracking-widest text-[hsl(var(--muted-fg))] uppercase">{label}</span>
        </div>
        <div className="border-t border-[hsl(var(--border))]" />
        <div className="flex divide-x divide-[hsl(var(--border))]">
          {stats.map((stat, i) => (
            <div key={i} className="flex-1 px-5 py-4">
              <p className="text-xs text-[hsl(var(--muted-fg))]">{stat.title}</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <p className={cn('text-2xl font-bold', stat.valueColor ?? 'text-[hsl(var(--fg))]')}>
                  {stat.value}
                </p>
                {stat.description && (
                  <span className={cn('text-xs', stat.descriptionColor ?? 'text-[hsl(var(--muted-fg))]')}>
                    {stat.description}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { data: summary, isLoading: summaryLoading } = useInsideSalesDashboard()
  const user = useAuthStore((s) => s.user)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="Analytics" />

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-[hsl(var(--fg))]">
                {greeting}, {user?.name?.split(' ')[0]}
              </h1>
              <p className="text-sm text-[hsl(var(--muted-fg))] mt-0.5">
                {dateLabel}
                {summary && (
                  <> · <span className="font-medium">{summary.new_leads_today} leads in your queue</span></>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" className="gap-1.5 bg-[hsl(var(--fg))] text-[hsl(var(--bg))] hover:bg-[hsl(var(--fg))]/90">
                <Sparkles className="h-3.5 w-3.5" />
                AI summary
              </Button>
            </div>
          </div>

          {/* Grouped stat cards */}
          {summaryLoading ? (
            <div className="flex gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="flex-1">
                  <CardContent className="pt-4 pb-5">
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : summary ? (
            <div className="flex gap-3">
              <GroupedStatCard
                label="Today"
                dotColor="bg-green-500"
                onClick={() => navigate('/inside-sales/leads')}
                stats={[
                  { title: 'New leads', value: summary.new_leads_today },
                  {
                    title: 'Overdue',
                    value: summary.overdue_follow_ups,
                    description: 'follow-up',
                    valueColor: summary.overdue_follow_ups > 0 ? 'text-red-600 dark:text-red-400' : undefined,
                    descriptionColor: summary.overdue_follow_ups > 0 ? 'text-red-600 dark:text-red-400' : undefined,
                  },
                ]}
              />
              <GroupedStatCard
                label="Pipeline"
                dotColor="bg-green-500"
                onClick={() => navigate('/inside-sales/pipeline')}
                stats={[
                  { title: 'Open value', value: formatCompact(summary.pipeline_value) },
                  { title: 'Open bids', value: summary.open_bids, description: `${summary.bids_due_this_week} due this wk` },
                ]}
              />
              <GroupedStatCard
                label="Won this month"
                dotColor="bg-purple-500"
                stats={[
                  { title: 'Deals', value: summary.won_this_month },
                  { title: 'Value', value: formatCompact(summary.won_value_this_month) },
                ]}
              />
            </div>
          ) : null}

          {/* Analytics grid */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3"><PipelineAnalyticsCard /></div>
            <div className="lg:col-span-2"><TeamPerformanceCard /></div>
            <div className="lg:col-span-2"><RevenueForecastCard /></div>
            <div className="lg:col-span-3"><ScoreDistributionCard /></div>
          </div>

        </div>
      </ScrollArea>
    </div>
  )
}
