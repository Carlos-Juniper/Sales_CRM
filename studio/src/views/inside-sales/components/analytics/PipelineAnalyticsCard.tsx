import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { useAllLeads } from '@/hooks/useLeads'
import { formatCurrency } from '@/lib/utils'
import type { LeadStatus } from '@/types'

const STAGES: { status: LeadStatus; label: string; color: string }[] = [
  { status: 'new',           label: 'New',         color: '#94a3b8' },
  { status: 'contacted',     label: 'Contacted',   color: '#60a5fa' },
  { status: 'qualified',     label: 'Qualified',   color: '#818cf8' },
  { status: 'proposal_sent', label: 'Proposal',    color: '#a78bfa' },
  { status: 'won',           label: 'Won',         color: '#34d399' },
]

interface StageRow {
  label: string
  status: LeadStatus
  count: number
  value: number
  color: string
  conversionRate: number | null
}

interface CustomTooltipProps {
  active?: boolean
  payload?: { payload: StageRow }[]
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-[hsl(var(--fg))] mb-1">{d.label}</p>
      <p className="text-[hsl(var(--muted-fg))]">{d.count} leads</p>
      <p className="text-[hsl(var(--muted-fg))]">{formatCurrency(d.value)} total value</p>
      {d.conversionRate !== null && (
        <p className="text-[hsl(var(--muted-fg))]">{d.conversionRate}% from previous</p>
      )}
    </div>
  )
}

export function PipelineAnalyticsCard() {
  const { data: leadsData, isLoading } = useAllLeads()

  const { stages, winRate, avgDealValue } = useMemo(() => {
    const leads = leadsData?.data ?? []

    const stageCounts: Partial<Record<LeadStatus, { count: number; value: number }>> = {}
    for (const lead of leads) {
      if (!stageCounts[lead.status]) stageCounts[lead.status] = { count: 0, value: 0 }
      stageCounts[lead.status]!.count += 1
      stageCounts[lead.status]!.value += lead.estimated_contract_value
    }

    const rows: StageRow[] = STAGES.map((s, i) => {
      const curr = stageCounts[s.status] ?? { count: 0, value: 0 }
      const prev = i > 0 ? (stageCounts[STAGES[i - 1].status] ?? { count: 0 }) : null
      const conversionRate = prev && prev.count > 0
        ? Math.round((curr.count / prev.count) * 100)
        : null
      return { ...s, ...curr, conversionRate }
    })

    const totalQualified = (stageCounts['qualified']?.count ?? 0) +
      (stageCounts['proposal_sent']?.count ?? 0) +
      (stageCounts['won']?.count ?? 0)
    const wonCount = stageCounts['won']?.count ?? 0
    const wonValue = stageCounts['won']?.value ?? 0

    return {
      stages: rows,
      winRate: totalQualified > 0 ? Math.round((wonCount / totalQualified) * 100) : 0,
      avgDealValue: wonCount > 0 ? wonValue / wonCount : 0,
    }
  }, [leadsData])

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Pipeline Analytics</CardTitle>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <p className="text-[10px] text-[hsl(var(--muted-fg))] uppercase tracking-wide">Win Rate</p>
              <p className="text-lg font-bold text-[hsl(var(--fg))]">{winRate}%</p>
            </div>
            <div>
              <p className="text-[10px] text-[hsl(var(--muted-fg))] uppercase tracking-wide">Avg Deal</p>
              <p className="text-lg font-bold text-[hsl(var(--fg))]">{formatCurrency(avgDealValue)}</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stages} barCategoryGap="28%">
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-fg))' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-fg))' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={24}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {stages.map((s) => (
                  <Cell key={s.status} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* Stage conversion chips */}
        {!isLoading && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {stages.map((s) => (
              <div key={s.status} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--muted))]">
                <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-[10px] text-[hsl(var(--muted-fg))]">
                  {s.label}: <span className="font-medium text-[hsl(var(--fg))]">{s.count}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
