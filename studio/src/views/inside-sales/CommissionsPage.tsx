import { useState } from 'react'
import { DollarSign } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCommissionSummary, useCommissionsList, useCommissionReps } from '@/hooks/useCommissions'
import { useRole } from '@/hooks/useRole'
import { formatCommission } from '@/lib/commissions'
import type { CommissionFilters } from '@/types/commissions'
import { CommissionDetailTable } from './components/commissions/CommissionDetailTable'
import { cn } from '@/lib/utils'

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
  const { seesAllBranches } = useRole()

  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined)
  const [filters, setFilters] = useState<CommissionFilters>({
    status: undefined,
    estimate_type: undefined,
  })

  // Admins/execs can view any rep; sales reps are scoped to their own
  // (the backend enforces this too — this just picks the right query param).
  const queryFilters: CommissionFilters = {
    ...filters,
    user_id: seesAllBranches ? selectedUserId : undefined,
  }

  const { data: summary, isLoading: summaryLoading } = useCommissionSummary(queryFilters)
  const { data: commissions, isLoading: commissionsLoading } = useCommissionsList(queryFilters)
  const { data: reps } = useCommissionReps()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="Commissions" />

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">

          {/* Header with rep selector for admins */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-[hsl(var(--fg))]">
                {seesAllBranches && selectedUserId
                  ? `${reps?.find((r) => r.id === selectedUserId)?.name ?? ''}'s Commissions`
                  : 'Your Commissions'}
              </h1>
              <p className="text-sm text-[hsl(var(--muted-fg))] mt-0.5">
                Year-to-date commission summary
              </p>
            </div>

            {seesAllBranches && reps && reps.length > 0 && (
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Select a sales rep..." />
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
          </div>

          {/* KPI Cards */}
          <div className="flex gap-4">
            {summaryLoading ? (
              <>
                <Skeleton className="h-28 flex-1" />
                <Skeleton className="h-28 flex-1" />
              </>
            ) : (
              <>
                <KpiCard
                  label="Scheduled YTD"
                  value={formatCommission(summary?.scheduled_ytd_cents ?? 0)}
                  dotColor="bg-blue-500"
                />
                <KpiCard
                  label="Paid YTD"
                  value={formatCommission(summary?.paid_ytd_cents ?? 0)}
                  dotColor="bg-green-500"
                />
              </>
            )}
          </div>

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
