import { useState } from 'react'
import { Trophy, X, Search } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { useSalesPerformanceSummary, useWonDeals, useLostDeals, useSalesPerformanceReps } from '@/hooks/useSalesPerformance'
import { useRole } from '@/hooks/useRole'
import { formatCents } from '@/lib/estimating/maintenance'
import { getPeriodDates } from '@/lib/commissions'
import type { Period } from '@/lib/commissions'
import { ASPIRE_LOST_REASONS } from '@/lib/estimating/aspireOptions'
import { cn } from '@/lib/utils'
import type { WonDeal, LostDeal } from '@/types/sales-performance'

// ── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  this_year: 'This Year',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_month: 'This Month',
  last_month: 'Last Month',
  all_time: 'All Time',
}

const LOSS_REASON_COLORS: Record<number, string> = {
  13: 'bg-red-400',
  14: 'bg-amber-400',
  15: 'bg-orange-400',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortCents(cents: number): string {
  if (cents >= 100_000_000) return `$${(cents / 100_000_000).toFixed(1)}M`
  if (cents >= 100_000) return `$${Math.round(cents / 100_000)}k`
  return formatCents(cents)
}

function estimateTypeLabel(type?: string): string {
  if (type === 'maintenance') return 'Maintenance Contract'
  if (type === 'install') return 'Install Contract'
  return 'Contract'
}

function dealDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string
  sublabel: string
  accentColor: string
}

function KpiCard({ label, value, sublabel, accentColor }: KpiCardProps) {
  return (
    <Card className="flex-1 min-w-[120px] overflow-hidden">
      <CardContent className="p-0">
        <div className="px-4 pt-4 pb-3">
          <p className="text-[10px] font-semibold tracking-widest text-[hsl(var(--muted-fg))] uppercase mb-2">
            {label}
          </p>
          <p className="text-2xl font-bold text-[hsl(var(--fg))] leading-none">{value}</p>
          <p className="text-xs text-[hsl(var(--muted-fg))] mt-1.5 truncate">{sublabel}</p>
        </div>
        <div className={cn('h-1 w-full', accentColor)} />
      </CardContent>
    </Card>
  )
}

function WonDealRow({ deal }: { deal: WonDeal }) {
  return (
    <div className="flex gap-3 py-4 border-b border-[hsl(var(--border))] last:border-0">
      <div className="h-8 w-8 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Trophy className="h-3.5 w-3.5 text-amber-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[hsl(var(--fg))] leading-snug">
          {deal.property_name ?? '—'}
        </p>
        <p className="text-xs text-[hsl(var(--muted-fg))] mt-0.5">
          {estimateTypeLabel(deal.estimate_type)}
        </p>
        {deal.notes && (
          <p className="text-xs text-[hsl(var(--muted-fg))] italic mt-1.5 line-clamp-2">
            &ldquo;{deal.notes}&rdquo;
          </p>
        )}
        {deal.rep_name && (
          <div className="flex items-center gap-1.5 mt-2">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
            <span className="text-xs text-[hsl(var(--muted-fg))]">{deal.rep_name}</span>
          </div>
        )}
      </div>
      <div className="text-right flex-shrink-0 pl-2">
        <p className="text-sm font-semibold text-[hsl(var(--fg))]">
          {formatCents(deal.contract_value_cents)}
        </p>
        <p className="text-xs text-[hsl(var(--muted-fg))] mt-1">{dealDate(deal.won_at)}</p>
      </div>
    </div>
  )
}

function LostDealRow({ deal }: { deal: LostDeal }) {
  const reason = ASPIRE_LOST_REASONS.find(r => r.id === deal.aspire_lost_reason_id)
  return (
    <div className="flex gap-3 py-4 border-b border-[hsl(var(--border))] last:border-0">
      <div className="h-8 w-8 rounded-full bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0 mt-0.5">
        <X className="h-3.5 w-3.5 text-red-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[hsl(var(--fg))] leading-snug">
          {deal.property_name ?? '—'}
        </p>
        <p className="text-xs text-[hsl(var(--muted-fg))] mt-0.5">
          {estimateTypeLabel(deal.estimate_type)}
        </p>
        {deal.notes && (
          <p className="text-xs text-[hsl(var(--muted-fg))] italic mt-1.5 line-clamp-2">
            &ldquo;{deal.notes}&rdquo;
          </p>
        )}
        {reason && (
          <Badge
            variant="outline"
            className="mt-1.5 text-[10px] px-1.5 py-0 font-medium bg-red-50 text-red-700 border-red-200"
          >
            {reason.label}
          </Badge>
        )}
        {deal.rep_name && (
          <div className="flex items-center gap-1.5 mt-2">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 flex-shrink-0" />
            <span className="text-xs text-[hsl(var(--muted-fg))]">{deal.rep_name}</span>
          </div>
        )}
      </div>
      <div className="text-right flex-shrink-0 pl-2">
        <p className="text-sm font-semibold text-[hsl(var(--fg))]">
          {formatCents(deal.contract_value_cents)}
        </p>
        <p className="text-xs text-[hsl(var(--muted-fg))] mt-1">{dealDate(deal.lost_at)}</p>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SalesPerformancePage() {
  const { canViewRepSelector } = useRole()

  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined)
  const [period, setPeriod] = useState<Period>('this_year')
  const [searchQuery, setSearchQuery] = useState('')

  const queryFilters = {
    ...getPeriodDates(period),
    user_id: canViewRepSelector ? selectedUserId : undefined,
  }

  const { data: summary, isLoading: summaryLoading } = useSalesPerformanceSummary(queryFilters)
  const { data: wonDeals = [], isLoading: wonLoading } = useWonDeals(queryFilters)
  const { data: lostDeals = [], isLoading: lostLoading } = useLostDeals(queryFilters)
  const { data: reps } = useSalesPerformanceReps()

  const filteredWon = searchQuery
    ? wonDeals.filter(d => (d.property_name ?? '').toLowerCase().includes(searchQuery.toLowerCase()))
    : wonDeals

  const filteredLost = searchQuery
    ? lostDeals.filter(d => (d.property_name ?? '').toLowerCase().includes(searchQuery.toLowerCase()))
    : lostDeals

  const lossCategories = summary?.loss_categories ?? []
  const maxCatCents = Math.max(...lossCategories.map(c => c.total_cents), 1)

  const topCategoryNames = lossCategories
    .slice(0, 2)
    .map(c => ASPIRE_LOST_REASONS.find(r => r.id === c.aspire_lost_reason_id)?.label ?? 'Unknown')
    .join(', ') + (lossCategories.length > 2 ? '…' : '')

  const winRatePct = Math.round((summary?.win_rate ?? 0) * 100)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="Sales Performance" />

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">

          {/* ── Filter bar ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[hsl(var(--muted-fg))]" />
              <Input
                placeholder="Search deals..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-9 w-[200px] text-sm"
              />
            </div>

            {canViewRepSelector && reps && reps.length > 0 && (
              <Select value={selectedUserId ?? 'all'} onValueChange={v => setSelectedUserId(v === 'all' ? undefined : v)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All Reps" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Reps</SelectItem>
                  {reps.map(rep => (
                    <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={period} onValueChange={v => setPeriod(v as Period)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                  <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Inline summary strip */}
            {!summaryLoading && summary && (
              <p className="text-sm text-[hsl(var(--muted-fg))] ml-auto whitespace-nowrap">
                <span className="font-semibold text-green-600">
                  {summary.won_count} won &middot; {shortCents(summary.won_total_cents)}
                </span>
                <span className="mx-2 opacity-40">|</span>
                <span className="font-semibold text-red-500">
                  {summary.lost_count} lost &middot; {shortCents(summary.lost_total_cents)}
                </span>
                <span className="mx-2 opacity-40">|</span>
                Win rate{' '}
                <span className="font-semibold text-[hsl(var(--fg))]">{winRatePct}%</span>
              </p>
            )}
          </div>

          {/* ── KPI cards ─────────────────────────────────────────────── */}
          <div className="flex gap-3 flex-wrap">
            {summaryLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 flex-1 min-w-[120px]" />
              ))
            ) : (
              <>
                <KpiCard
                  label="Total Won"
                  value={shortCents(summary?.won_total_cents ?? 0)}
                  sublabel={`${summary?.won_count ?? 0} deals`}
                  accentColor="bg-green-500"
                />
                <KpiCard
                  label="Avg Deal Size"
                  value={shortCents(summary?.won_avg_cents ?? 0)}
                  sublabel="per closed deal"
                  accentColor="bg-green-400"
                />
                <KpiCard
                  label="Win Rate"
                  value={`${winRatePct}%`}
                  sublabel={`${summary?.won_count ?? 0} won vs ${(summary?.won_count ?? 0) + (summary?.lost_count ?? 0)} total`}
                  accentColor="bg-green-300"
                />
                <KpiCard
                  label="Total Lost"
                  value={shortCents(summary?.lost_total_cents ?? 0)}
                  sublabel={`${summary?.lost_count ?? 0} deals`}
                  accentColor="bg-red-500"
                />
                <KpiCard
                  label="Avg Deal Lost"
                  value={shortCents(summary?.lost_avg_cents ?? 0)}
                  sublabel="per lost deal"
                  accentColor="bg-red-400"
                />
                <KpiCard
                  label="Loss Categories"
                  value={`${lossCategories.length}`}
                  sublabel={topCategoryNames || 'No losses'}
                  accentColor="bg-amber-400"
                />
              </>
            )}
          </div>

          {/* ── Win Rate & Loss Reasons ────────────────────────────────── */}
          {!summaryLoading && (
            <Card>
              <CardContent className="p-5">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {/* Win rate */}
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest text-[hsl(var(--muted-fg))] uppercase mb-3">
                      Win Rate &amp; Loss Reasons
                    </p>
                    <p className="text-5xl font-bold text-[hsl(var(--fg))]">{winRatePct}%</p>
                    <p className="text-sm text-[hsl(var(--muted-fg))] mt-1.5">
                      {summary?.won_count ?? 0} won · {summary?.lost_count ?? 0} lost overall
                    </p>
                  </div>

                  {/* Loss category bars */}
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest text-[hsl(var(--muted-fg))] uppercase mb-3">
                      Loss Category Breakdown
                    </p>
                    {lossCategories.length === 0 ? (
                      <p className="text-xs text-[hsl(var(--muted-fg))]">No losses in this period</p>
                    ) : (
                      <div className="space-y-3">
                        {lossCategories.map(cat => {
                          const reason = ASPIRE_LOST_REASONS.find(r => r.id === cat.aspire_lost_reason_id)
                          const label = reason?.label ?? 'Unknown'
                          const barColor = LOSS_REASON_COLORS[cat.aspire_lost_reason_id ?? 0] ?? 'bg-gray-400'
                          const pct = Math.min(100, (cat.total_cents / maxCatCents) * 100)
                          return (
                            <div key={cat.aspire_lost_reason_id ?? 'null'} className="flex items-center gap-3">
                              <span className="w-28 text-xs text-[hsl(var(--muted-fg))] shrink-0 truncate">
                                {label}
                              </span>
                              <div className="flex-1 h-2 bg-[hsl(var(--muted))] rounded-full overflow-hidden">
                                <div
                                  className={cn('h-full rounded-full transition-all duration-500', barColor)}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono text-[hsl(var(--fg))] w-14 text-right shrink-0">
                                {shortCents(cat.total_cents)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Won + Lost deal lists ──────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

            {/* Won Deals */}
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-amber-500" />
                    <h2 className="text-sm font-semibold text-[hsl(var(--fg))]">Won Deals</h2>
                    {!wonLoading && (
                      <span className="text-xs text-[hsl(var(--muted-fg))]">
                        {filteredWon.length}
                      </span>
                    )}
                  </div>
                  {!wonLoading && (
                    <span className="text-sm font-semibold text-green-600">
                      {shortCents(filteredWon.reduce((s, d) => s + d.contract_value_cents, 0))}
                    </span>
                  )}
                </div>
                <div className="px-4">
                  {wonLoading ? (
                    <div className="py-4 space-y-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : filteredWon.length === 0 ? (
                    <p className="py-10 text-center text-sm text-[hsl(var(--muted-fg))]">
                      No won deals in this period
                    </p>
                  ) : (
                    filteredWon.map(deal => <WonDealRow key={deal.id} deal={deal} />)
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Lost Deals */}
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="flex items-center gap-2">
                    <X className="h-4 w-4 text-red-500" />
                    <h2 className="text-sm font-semibold text-[hsl(var(--fg))]">Lost Deals</h2>
                    {!lostLoading && (
                      <span className="text-xs text-[hsl(var(--muted-fg))]">
                        {filteredLost.length}
                      </span>
                    )}
                  </div>
                  {!lostLoading && (
                    <span className="text-sm font-semibold text-red-500">
                      {shortCents(filteredLost.reduce((s, d) => s + d.contract_value_cents, 0))}
                    </span>
                  )}
                </div>
                <div className="px-4">
                  {lostLoading ? (
                    <div className="py-4 space-y-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : filteredLost.length === 0 ? (
                    <p className="py-10 text-center text-sm text-[hsl(var(--muted-fg))]">
                      No lost deals in this period
                    </p>
                  ) : (
                    filteredLost.map(deal => <LostDealRow key={deal.id} deal={deal} />)
                  )}
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
