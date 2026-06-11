import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { useRevenueAnalytics } from '@/hooks/useAnalytics'
import { formatCurrency } from '@/lib/utils'
import type { MonthlyRevenue } from '@/types'

interface CustomTooltipProps {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-[hsl(var(--fg))] mb-1.5">{label}</p>
      {payload.map((p) => (
        p.value > 0 && (
          <p key={p.name} style={{ color: p.color }} className="mb-0.5">
            {p.name}: {formatCurrency(p.value)}
          </p>
        )
      ))}
    </div>
  )
}

export function RevenueForecastCard() {
  const { data, isLoading } = useRevenueAnalytics()

  const forecastTotal = (data ?? []).reduce((sum, m: MonthlyRevenue) => sum + m.forecast, 0)
  const wonTotal = (data ?? []).reduce((sum, m: MonthlyRevenue) => sum + m.won, 0)

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Revenue Forecast</CardTitle>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <p className="text-[10px] text-[hsl(var(--muted-fg))] uppercase tracking-wide">YTD Won</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(wonTotal)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[hsl(var(--muted-fg))] uppercase tracking-wide">Projected</p>
              <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(forecastTotal)}</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data} barCategoryGap="30%">
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-fg))' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-fg))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(v)}
                width={52}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              />
              <Bar dataKey="won" name="Won" fill="#34d399" radius={[3, 3, 0, 0]} />
              <Bar dataKey="forecast" name="Forecast" fill="#818cf8" radius={[3, 3, 0, 0]} />
              <Line
                dataKey="pipeline"
                name="Pipeline"
                type="monotone"
                stroke="#94a3b8"
                strokeWidth={2}
                dot={false}
                strokeDasharray="4 2"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
