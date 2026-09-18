import { useState, useMemo } from 'react'
import { TopNav } from '@/components/layout/TopNav'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrmAnalytics } from '@/hooks/useAnalytics'
import { useAuthStore } from '@/store/authStore'
import { useUsers } from '@/hooks/useBids'
import { cn, formatCurrency, formatCompact } from '@/lib/utils'
import { CROSS_BRANCH_ROLES } from '@/lib/roles'
import { CrmPipelineAnalyticsCard } from './components/analytics/CrmPipelineAnalyticsCard'
import { CrmRevenueCard } from './components/analytics/CrmRevenueCard'
import { CrmActivityCard } from './components/analytics/CrmActivityCard'
import type { UserRole } from '@/types'

function canViewAllCrms(role: UserRole | string | undefined): boolean {
  if (!role) return false
  return CROSS_BRANCH_ROLES.includes(role as UserRole)
}

interface StatCardProps {
  label: string
  dotColor: string
  value: string
  description?: string
  valueColor?: string
}

function StatCard({ label, dotColor, value, description, valueColor }: StatCardProps) {
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
          <div className="flex items-baseline gap-1.5">
            <p className={cn('text-2xl font-bold', valueColor ?? 'text-[hsl(var(--fg))]')}>
              {value}
            </p>
            {description && (
              <span className="text-xs text-[hsl(var(--muted-fg))]">
                {description}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function CRMAnalyticsPage() {
  const user = useAuthStore((s) => s.user)
  const userRole = user?.role
  const showCrmSelector = canViewAllCrms(userRole)

  const [selectedCrmId, setSelectedCrmId] = useState<string>(user?.id ?? '')

  const { data: users } = useUsers()
  const { data: analytics, isLoading } = useCrmAnalytics(selectedCrmId)

  const crmUsers = useMemo(() => {
    if (!users) return []
    return users.filter((u) =>
      u.role === 'inside_sales' ||
      u.role === 'outside_sales'
    ).sort((a, b) => a.name.localeCompare(b.name))
  }, [users])

  const selectedCrm = useMemo(() => {
    return crmUsers.find((u) => u.id === selectedCrmId) ?? user
  }, [crmUsers, selectedCrmId, user])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="CRM Analytics" />

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-[hsl(var(--fg))]">
                {selectedCrm?.name || 'CRM'} Performance
              </h1>
              <p className="text-sm text-[hsl(var(--muted-fg))] mt-0.5">
                Individual performance metrics and deal tracking
              </p>
            </div>

            {showCrmSelector && crmUsers.length > 0 && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <label className="text-sm font-medium text-[hsl(var(--muted-fg))]">
                  View CRM:
                </label>
                <Select
                  value={selectedCrmId}
                  onValueChange={setSelectedCrmId}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select a CRM" />
                  </SelectTrigger>
                  <SelectContent>
                    {crmUsers.map((crm) => (
                      <SelectItem key={crm.id} value={crm.id}>
                        {crm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="flex-1">
                  <CardContent className="pt-4 pb-5">
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : analytics ? (
            <div className="flex gap-3">
              <StatCard
                label="Win Rate"
                dotColor="bg-green-500"
                value={`${analytics.win_rate}%`}
                description="conversion"
                valueColor="text-emerald-600 dark:text-emerald-400"
              />
              <StatCard
                label="Total Revenue"
                dotColor="bg-blue-500"
                value={formatCurrency(analytics.total_revenue)}
                description={`${analytics.won_deals} deals`}
              />
              <StatCard
                label="Active Pipeline"
                dotColor="bg-purple-500"
                value={formatCompact(analytics.active_pipeline_value)}
                description={`${analytics.active_pipeline_count} leads`}
              />
              <StatCard
                label="This Month"
                dotColor="bg-amber-500"
                value={formatCurrency(analytics.won_value_this_month)}
                description={`${analytics.won_this_month} won`}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1">
              <CrmPipelineAnalyticsCard analytics={analytics} isLoading={isLoading} />
            </div>
            <div className="lg:col-span-1">
              <CrmActivityCard analytics={analytics} isLoading={isLoading} />
            </div>
            <div className="lg:col-span-1">
              <CrmRevenueCard analytics={analytics} isLoading={isLoading} />
            </div>
          </div>

        </div>
      </ScrollArea>
    </div>
  )
}
