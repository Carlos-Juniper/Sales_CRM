import { useMemo, useState } from 'react'
import './MarginAnalysis.css'
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { mockEstimates } from '@/mocks/estimatingData'
import { formatCurrency, cn } from '@/lib/utils'
import type { LineItemCategory, Estimate, MarginCategoryBreakdown } from '@/types/estimating'

const CATEGORY_META: Record<LineItemCategory, { label: string; color: string; historicalAvg: number; target: number }> = {
  labor: { label: 'Labor', color: '#2E7D52', historicalAvg: 22, target: 20 },
  materials: { label: 'Materials', color: '#2563eb', historicalAvg: 28, target: 25 },
  equipment: { label: 'Equipment', color: '#7c3aed', historicalAvg: 15, target: 15 },
  overhead: { label: 'Overhead', color: '#d97706', historicalAvg: 12, target: 12 },
  subcontractor: { label: 'Subcontractor', color: '#dc2626', historicalAvg: 18, target: 20 },
}

function buildBreakdown(estimate: Estimate): MarginCategoryBreakdown[] {
  const totalPrice = estimate.total_price
  const categories = Object.keys(CATEGORY_META) as LineItemCategory[]

  return categories.map((cat) => {
    const items = estimate.line_items.filter((i) => i.category === cat)
    const cost = items.reduce((s, i) => s + i.total_cost, 0)
    const price = items.reduce((s, i) => s + i.total_price, 0)
    const margin_pct = price > 0 ? ((price - cost) / price) * 100 : 0
    const weight_pct = totalPrice > 0 ? (price / totalPrice) * 100 : 0
    const meta = CATEGORY_META[cat]
    return {
      category: cat,
      label: meta.label,
      cost,
      price,
      margin_pct,
      target_margin_pct: meta.target,
      historical_avg_pct: meta.historicalAvg,
      weight_pct,
    }
  }).filter((b) => b.price > 0)
}

interface MarginBarProps {
  breakdown: MarginCategoryBreakdown
  maxMargin: number
}

function MarginBar({ breakdown: b, maxMargin }: MarginBarProps) {
  const meta = CATEGORY_META[b.category]
  const aboveTarget = b.margin_pct >= b.target_margin_pct
  const barWidth = maxMargin > 0 ? (b.margin_pct / maxMargin) * 100 : 0
  const targetPos = maxMargin > 0 ? (b.target_margin_pct / maxMargin) * 100 : 0
  const histPos = maxMargin > 0 ? (b.historical_avg_pct / maxMargin) * 100 : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm margin-category-dot" style={{ '--dot-color': meta.color } as React.CSSProperties} />
          <span className="text-sm font-medium text-[hsl(var(--fg))]">{b.label}</span>
          <span className="text-xs text-[hsl(var(--muted-fg))]">{b.weight_pct.toFixed(0)}% of bid</span>
        </div>
        <div className="flex items-center gap-2">
          {aboveTarget ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
          <span className={cn('text-sm font-bold', aboveTarget ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400')}>
            {b.margin_pct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-5 bg-[hsl(var(--muted))] rounded-full overflow-visible">
        {/* Actual margin bar */}
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-500 margin-bar-fill"
          style={{ '--bar-width': `${barWidth}%`, '--bar-color': meta.color } as React.CSSProperties}
        />

        {/* Target line */}
        <div
          className="absolute top-0 h-full w-0.5 bg-zinc-700 dark:bg-zinc-300 margin-target-line"
          style={{ '--target-pos': `${targetPos}%` } as React.CSSProperties}
          title={`Target: ${b.target_margin_pct}%`}
        />

        {/* Historical avg line */}
        <div
          className="absolute top-0 h-full w-0.5 bg-zinc-400/60 margin-hist-line"
          style={{ '--hist-pos': `${histPos}%` } as React.CSSProperties}
          title={`Historical avg: ${b.historical_avg_pct}%`}
        />
      </div>

      <div className="flex justify-between text-[10px] text-[hsl(var(--muted-fg))]">
        <span>Cost: {formatCurrency(b.cost)}</span>
        <div className="flex gap-3">
          <span className="flex items-center gap-0.5">
            <span className="inline-block h-2 w-0.5 bg-zinc-700 dark:bg-zinc-300" />
            Target {b.target_margin_pct}%
          </span>
          <span className="flex items-center gap-0.5">
            <span className="inline-block h-2 w-0.5 bg-zinc-400" />
            Hist. avg {b.historical_avg_pct}%
          </span>
        </div>
        <span>Price: {formatCurrency(b.price)}</span>
      </div>
    </div>
  )
}

interface Props {
  selectedQueueId: string | null
}

export function MarginAnalysis({ selectedQueueId }: Props) {
  const [selectedEstimateId, setSelectedEstimateId] = useState<string>(mockEstimates[0]?.id ?? '')

  const estimate = useMemo(() => {
    if (selectedQueueId) {
      const match = mockEstimates.find((e) => e.queue_item_id === selectedQueueId)
      if (match) return match
    }
    return mockEstimates.find((e) => e.id === selectedEstimateId) ?? mockEstimates[0]
  }, [selectedQueueId, selectedEstimateId])

  const breakdown = useMemo(() => estimate ? buildBreakdown(estimate) : [], [estimate])
  const maxMargin = Math.max(...breakdown.map((b) => Math.max(b.margin_pct, b.target_margin_pct, b.historical_avg_pct)), 40)

  const overallVsTarget = estimate ? estimate.margin_pct - estimate.target_margin_pct : 0
  const aboveTarget = overallVsTarget >= 0

  if (!estimate) return <div className="py-8 text-center text-[hsl(var(--muted-fg))]">No estimates available.</div>

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      {/* Estimate selector */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={estimate.id} onValueChange={setSelectedEstimateId}>
          <SelectTrigger className="w-64 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {mockEstimates.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.property_name} (v{e.version})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-[hsl(var(--muted-fg))]">{estimate.ai_generated ? '🤖 AI-generated' : '✏️ Manual'}</span>
      </div>

      {/* Overall summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-[hsl(var(--muted-fg))]">Total Bid Price</p>
            <p className="text-lg font-bold text-[hsl(var(--fg))]">{formatCurrency(estimate.total_price)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-[hsl(var(--muted-fg))]">Total Cost</p>
            <p className="text-lg font-bold text-[hsl(var(--fg))]">{formatCurrency(estimate.total_cost)}</p>
          </CardContent>
        </Card>
        <Card className={cn(aboveTarget ? 'border-green-300 dark:border-green-700' : 'border-amber-300 dark:border-amber-700')}>
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-[hsl(var(--muted-fg))]">Overall Margin</p>
            <p className={cn('text-lg font-bold', aboveTarget ? 'text-green-600' : 'text-amber-600')}>
              {estimate.margin_pct.toFixed(1)}%
            </p>
            <p className="text-[10px] text-[hsl(var(--muted-fg))] flex items-center gap-0.5">
              {aboveTarget ? <TrendingUp className="h-3 w-3 text-green-500" /> : <TrendingDown className="h-3 w-3 text-amber-500" />}
              {aboveTarget ? '+' : ''}{overallVsTarget.toFixed(1)}% vs target
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-[hsl(var(--muted-fg))]">Target Margin</p>
            <p className="text-lg font-bold text-[hsl(var(--fg))]">{estimate.target_margin_pct}%</p>
            <p className="text-[10px] text-[hsl(var(--muted-fg))]">company standard</p>
          </CardContent>
        </Card>
      </div>

      {/* Category breakdown */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Margin by Category</CardTitle>
        </CardHeader>
        <CardContent className="pb-4 space-y-5">
          {breakdown.map((b) => (
            <MarginBar key={b.category} breakdown={b} maxMargin={maxMargin} />
          ))}
        </CardContent>
      </Card>

      {/* Category mix donut via pure CSS */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Cost Mix by Category</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              {breakdown.map((b) => (
                <div key={b.category} className="flex items-center gap-2">
                  <div className="h-2.5 rounded-full flex-shrink-0 margin-mix-bar" style={{ '--mix-width': `${b.weight_pct}%`, '--mix-color': CATEGORY_META[b.category].color } as React.CSSProperties} />
                  <span className="text-xs text-[hsl(var(--muted-fg))] truncate">{b.label}</span>
                  <span className="text-xs font-medium text-[hsl(var(--fg))] ml-auto">{b.weight_pct.toFixed(0)}%</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {breakdown.map((b) => (
                <div key={b.category} className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm margin-category-dot" style={{ '--dot-color': CATEGORY_META[b.category].color } as React.CSSProperties} />
                  <span className="text-[hsl(var(--muted-fg))]">{b.label}: {formatCurrency(b.price)}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts */}
      {breakdown.filter((b) => b.margin_pct < b.target_margin_pct).length > 0 && (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Categories below target margin
            </p>
            {breakdown.filter((b) => b.margin_pct < b.target_margin_pct).map((b) => (
              <p key={b.category} className="text-xs text-[hsl(var(--muted-fg))]">
                • <span className="font-medium">{b.label}</span>: {b.margin_pct.toFixed(1)}% (target {b.target_margin_pct}%) — consider adjusting pricing or reducing cost
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
