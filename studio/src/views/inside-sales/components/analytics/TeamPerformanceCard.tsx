import { useMemo } from 'react'
import { Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { AssigneeAvatar } from '@/components/shared/AssigneeAvatar'
import { useAllLeads } from '@/hooks/useLeads'
import { useUsers } from '@/hooks/useBids'
import { formatCurrency } from '@/lib/utils'
import type { User } from '@/types'

interface RepMetrics {
  user: User
  leadsAssigned: number
  proposalsSent: number
  wins: number
  winRate: number
  revenue: number
}

export function TeamPerformanceCard() {
  const { data: leadsData, isLoading: leadsLoading } = useAllLeads()
  const { data: users, isLoading: usersLoading } = useUsers()

  const isLoading = leadsLoading || usersLoading

  const repMetrics = useMemo((): RepMetrics[] => {
    const leads = leadsData?.data ?? []
    const salesReps = (users ?? []).filter(
      (u) => u.role === 'inside_sales' || u.role === 'outside_sales'
    )

    return salesReps.map((user) => {
      const assigned = leads.filter((l) => l.assigned_to === user.id)
      const proposalsSent = assigned.filter(
        (l) => l.status === 'proposal_sent' || l.status === 'won'
      ).length
      const wonLeads = assigned.filter((l) => l.status === 'won')
      const wins = wonLeads.length
      const revenue = wonLeads.reduce((sum, l) => sum + l.estimated_contract_value, 0)
      const winRate = proposalsSent > 0 ? Math.round((wins / proposalsSent) * 100) : 0

      return { user, leadsAssigned: assigned.length, proposalsSent, wins, winRate, revenue }
    }).sort((a, b) => b.revenue - a.revenue)
  }, [leadsData, users])

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
            <Users className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
          </div>
          <CardTitle className="text-sm font-semibold">Team Performance</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="space-y-0">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-1 pb-1.5 border-b border-[hsl(var(--border))]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))]">Rep</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] text-center w-10">Leads</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] text-center w-12">Props</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] text-center w-12">Win %</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] text-right w-16">Revenue</span>
            </div>

            {repMetrics.length === 0 ? (
              <p className="text-xs text-[hsl(var(--muted-fg))] py-4 text-center">No assigned leads yet</p>
            ) : (
              repMetrics.map((rep) => (
                <div
                  key={rep.user.id}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center px-1 py-2.5 border-b border-[hsl(var(--border))] last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AssigneeAvatar user={rep.user} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[hsl(var(--fg))] truncate">{rep.user.name.split(' ')[0]}</p>
                      <p className="text-[10px] text-[hsl(var(--muted-fg))] capitalize">{rep.user.role.replace('_', ' ')}</p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-[hsl(var(--fg))] text-center w-10">{rep.leadsAssigned}</span>
                  <span className="text-xs font-medium text-[hsl(var(--fg))] text-center w-12">{rep.proposalsSent}</span>
                  <span className={`text-xs font-semibold text-center w-12 ${rep.winRate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : rep.winRate > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[hsl(var(--muted-fg))]'}`}>
                    {rep.wins > 0 ? `${rep.winRate}%` : '—'}
                  </span>
                  <span className="text-xs font-medium text-[hsl(var(--fg))] text-right w-16">
                    {rep.revenue > 0 ? formatCurrency(rep.revenue) : '—'}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
