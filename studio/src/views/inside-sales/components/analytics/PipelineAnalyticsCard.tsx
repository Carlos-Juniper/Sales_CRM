import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { useAllLeads } from '@/hooks/useLeads'
import { formatCurrency } from '@/lib/utils'
import { PIPELINE_STAGES, stageForStatus } from '@/lib/pipelineStages'
import type { Lead } from '@/types'

// Statuses counted toward "made it past initial qualification" for the win-rate
// denominator — everything from Qualified onward, including the post-approval
// proposal_sent/won terminal states.
const QUALIFIED_OR_LATER = new Set(['qualified', 'estimating', 'op_review', 'approved', 'proposal_sent', 'won'])

interface StageRow {
  label: string
  stageKey: string
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
    const leads: Lead[] = leadsData?.data ?? []

    // Bucket by kanban stage for the visible 4 stages; hidden/terminal
    // statuses (won/lost/disqualified/proposal_sent) keep their own raw key
    // so the win-rate calc below can still read them directly.
    const stageCounts: Record<string, { count: number; value: number }> = {}
    for (const lead of leads) {
      const key = stageForStatus(lead.status)?.key ?? lead.status
      if (!stageCounts[key]) stageCounts[key] = { count: 0, value: 0 }
      stageCounts[key].count += 1
      stageCounts[key].value += lead.estimated_contract_value
    }

    const rows: StageRow[] = PIPELINE_STAGES.map((stage, i) => {
      const curr = stageCounts[stage.key] ?? { count: 0, value: 0 }
      const prev = i > 0 ? (stageCounts[PIPELINE_STAGES[i - 1].key] ?? { count: 0 }) : null
      const conversionRate = prev && prev.count > 0
        ? Math.round((curr.count / prev.count) * 100)
        : null
      return { label: stage.label, stageKey: stage.key, color: stage.hexColor, ...curr, conversionRate }
    })

    const totalQualified = leads.filter((l) => QUALIFIED_OR_LATER.has(l.status)).length
    const wonLeads = leads.filter((l) => l.status === 'won')
    const wonCount = wonLeads.length
    const wonValue = wonLeads.reduce((s, l) => s + l.estimated_contract_value, 0)

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
                  <Cell key={s.stageKey} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* Stage conversion chips */}
        {!isLoading && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {stages.map((s) => (
              <div key={s.stageKey} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--muted))]">
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
