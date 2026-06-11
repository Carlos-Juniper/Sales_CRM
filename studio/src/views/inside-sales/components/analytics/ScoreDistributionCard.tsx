import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Target } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { useAllLeads } from '@/hooks/useLeads'
import { formatCompact } from '@/lib/utils'


const TIERS = [
  { label: '0–40',  min: 0,  max: 40,  color: '#ef4444', dotClass: 'bg-red-500',     name: 'Low' },
  { label: '41–60', min: 41, max: 60,  color: '#f59e0b', dotClass: 'bg-amber-500',   name: 'Fair' },
  { label: '61–75', min: 61, max: 75,  color: '#3b82f6', dotClass: 'bg-blue-500',    name: 'Good' },
  { label: '76–90', min: 76, max: 90,  color: '#8b5cf6', dotClass: 'bg-violet-500',  name: 'Strong' },
  { label: '91–100',min: 91, max: 100, color: '#10b981', dotClass: 'bg-emerald-500', name: 'Hot' },
]

interface TierDatum {
  label: string
  name: string
  count: number
  value: number
  color: string
  dotClass: string
}

interface TooltipPayload {
  payload: TierDatum
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-md px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[hsl(var(--fg))] mb-1">{d.name} <span className="font-normal text-[hsl(var(--muted-fg))]">({d.label})</span></p>
      <p className="text-[hsl(var(--muted-fg))]">{d.count} lead{d.count !== 1 ? 's' : ''}</p>
      <p className="text-[hsl(var(--muted-fg))]">{formatCompact(d.value)} pipeline</p>
    </div>
  )
}

export function ScoreDistributionCard() {
  const { data: leadsData, isLoading } = useAllLeads()

  const { tiers, hotCount, avgScore } = useMemo(() => {
    const leads = leadsData?.data ?? []

    const tiers: TierDatum[] = TIERS.map((t) => {
      const bucket = leads.filter((l) => l.score >= t.min && l.score <= t.max)
      return {
        label: t.label,
        name: t.name,
        count: bucket.length,
        value: bucket.reduce((s, l) => s + l.estimated_contract_value, 0),
        color: t.color,
        dotClass: t.dotClass,
      }
    })

    const hotCount = tiers[4].count + tiers[3].count
    const totalScore = leads.reduce((s, l) => s + l.score, 0)
    const avgScore = leads.length > 0 ? Math.round(totalScore / leads.length) : 0

    return { tiers, hotCount, avgScore }
  }, [leadsData])

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <Target className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Lead Quality</CardTitle>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <p className="text-[10px] text-[hsl(var(--muted-fg))] uppercase tracking-wide">Avg Score</p>
              <p className="text-lg font-bold text-[hsl(var(--fg))]">{avgScore}</p>
            </div>
            <div>
              <p className="text-[10px] text-[hsl(var(--muted-fg))] uppercase tracking-wide">Strong+</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{hotCount}</p>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={tiers} barCategoryGap="25%">
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-fg))' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-fg))' }}
                  axisLine={false}
                  tickLine={false}
                  width={24}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {tiers.map((t) => <Cell key={t.label} fill={t.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Tier legend with pipeline value */}
            <div className="grid grid-cols-5 gap-1 mt-2">
              {tiers.map((t) => (
                <div key={t.label} className="text-center">
                  <div className={`h-1.5 rounded-full mx-auto w-8 mb-1 ${t.dotClass}`} />
                  <p className="text-[9px] font-medium text-[hsl(var(--fg))]">{t.name}</p>
                  <p className="text-[9px] text-[hsl(var(--muted-fg))]">{formatCompact(t.value)}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
