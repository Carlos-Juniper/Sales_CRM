import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { badgeVariants } from '@/components/ui/badge-variants'
import type { VariantProps } from 'class-variance-authority'

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>
import { DeadlineChip } from '@/components/shared/DeadlineChip'
import { AssigneeAvatar } from '@/components/shared/AssigneeAvatar'
import { TableRowSkeleton } from '@/components/shared/LoadingSkeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBids, useUpdateBid, useUsers } from '@/hooks/useBids'
import { formatCurrency, formatDate, daysUntil, cn } from '@/lib/utils'
import { BID_STATUS_LABELS, BID_URGENCY_THRESHOLD_DAYS, MS_PER_DAY } from '@/lib/constants'
import type { Bid, BidStatus } from '@/types'
import { ScrollArea } from '@/components/ui/scroll-area'

const STATUS_BADGE_MAP: Record<BidStatus, { variant: BadgeVariant; label: string }> = {
  pending: { variant: 'zinc', label: 'Pending' },
  pursuing: { variant: 'blue', label: 'Pursuing' },
  submitted: { variant: 'purple', label: 'Submitted' },
  no_bid: { variant: 'zinc', label: 'No Bid' },
  won: { variant: 'green', label: 'Won' },
  lost: { variant: 'red', label: 'Lost' },
}

type SortableCol = 'deadline' | 'estimated_value' | 'status'

function SortTh({ col, label, sortCol, sortDir, onSort, align }: {
  col: SortableCol
  label: string
  sortCol: SortableCol | null
  sortDir: 'asc' | 'desc'
  onSort: (col: SortableCol) => void
  align: 'left' | 'right'
}) {
  const active = sortCol === col
  const Icon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))] cursor-pointer select-none whitespace-nowrap',
        align === 'right' ? 'text-right' : 'text-left',
        active && 'text-[hsl(var(--fg))]'
      )}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {align === 'right' && <Icon className="h-3 w-3 opacity-60" />}
        {label}
        {align === 'left' && <Icon className="h-3 w-3 opacity-60" />}
      </span>
    </th>
  )
}

// Live deadline countdown — re-renders every minute
function useNow() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export default function BidTrackerPage() {
  const { data: bids = [], isLoading, refetch } = useBids()
  const { data: users = [] } = useUsers()
  const updateBid = useUpdateBid()
  const [filterStatus, setFilterStatus] = useState<BidStatus | 'all'>('all')
  const [sortCol, setSortCol] = useState<'deadline' | 'estimated_value' | 'status' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  useNow() // trigger re-renders for countdown

  function toggleSort(col: 'deadline' | 'estimated_value' | 'status') {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const STATUS_SORT_ORDER: Record<BidStatus, number> = {
    pending: 0, pursuing: 1, submitted: 2, won: 3, lost: 4, no_bid: 5,
  }

  const base = filterStatus === 'all' ? bids : bids.filter((b: Bid) => b.status === filterStatus)

  const filtered = sortCol == null ? base : [...base].sort((a: Bid, b: Bid) => {
    let cmp = 0
    if (sortCol === 'deadline')        cmp = daysUntil(a.deadline) - daysUntil(b.deadline)
    else if (sortCol === 'estimated_value') cmp = a.estimated_value - b.estimated_value
    else if (sortCol === 'status')     cmp = (STATUS_SORT_ORDER[a.status] ?? 999) - (STATUS_SORT_ORDER[b.status] ?? 999)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const openBids = bids.filter((b: Bid) => ['pending', 'pursuing', 'submitted'].includes(b.status))
  const totalOpenValue = openBids.reduce((s: number, b: Bid) => s + b.estimated_value, 0)

  function getUserById(id: string | null) {
    return users.find(u => u.id === id) ?? null
  }

  async function setStatus(bid: Bid, status: BidStatus) {
    try {
      await updateBid.mutateAsync({ id: bid.id, body: { status } })
    } catch {
      // useUpdateBid onError already surfaces a toast
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="RFP Bid Tracker" subtitle={`${openBids.length} open bids · ${formatCurrency(totalOpenValue)} pipeline`} />

      <ScrollArea className="flex-1">
        <div className="p-5">
          <PageHeader
            title="RFP Bid Tracker"
            description="Track open bids from discovery through submission."
            actions={
              <div className="flex items-center gap-2">
                <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as BidStatus | 'all')}>
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {(Object.entries(BID_STATUS_LABELS) as [BidStatus, string][]).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => refetch()} aria-label="Refresh bids">
                  <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                </Button>
              </div>
            }
          />

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Open bids', value: openBids.length.toString(), color: 'text-[#2E7D52]' },
              { label: 'Total pipeline', value: formatCurrency(totalOpenValue), color: 'text-blue-600 dark:text-blue-400' },
              { label: 'Due this week', value: bids.filter((b: Bid) => { const d = new Date(b.deadline); const now = new Date(); return (d.getTime() - now.getTime()) / MS_PER_DAY <= BID_URGENCY_THRESHOLD_DAYS && b.status !== 'won' && b.status !== 'lost' }).length.toString(), color: 'text-amber-600 dark:text-amber-400' },
              { label: 'Won this month', value: bids.filter((b: Bid) => b.status === 'won').length.toString(), color: 'text-[#2E7D52]' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg p-3">
                <p className="text-xs text-[hsl(var(--muted-fg))]">{label}</p>
                <p className={cn('text-lg font-bold mt-0.5', color)}>{value}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="border border-[hsl(var(--border))] rounded-lg overflow-hidden bg-[hsl(var(--card))]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Bid</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Agency</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Services</th>
                    <SortTh col="deadline"        label="Deadline"   sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} align="left" />
                    <SortTh col="estimated_value" label="Est. Value" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortTh col="status"          label="Status"     sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} align="left" />
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Estimator</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} cols={8} />)}

                  {!isLoading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-sm text-[hsl(var(--muted-fg))]">
                        No bids match the selected filter.
                      </td>
                    </tr>
                  )}

                  {!isLoading && filtered.map((bid: Bid) => {
                    const estimator = getUserById(bid.assigned_estimator_id)
                    const s = STATUS_BADGE_MAP[bid.status]
                    return (
                      <tr key={bid.id} className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--muted))] transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[hsl(var(--fg))] text-xs leading-tight max-w-[200px]">{bid.title}</p>
                          {bid.submission_notes && (
                            <p className="text-[10px] text-[hsl(var(--muted-fg))] mt-0.5 line-clamp-1">{bid.submission_notes}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-[hsl(var(--muted-fg))] whitespace-nowrap">{bid.agency}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {(bid.service_types ?? []).slice(0, 2).map(s => (
                              <span key={s} className="text-[10px] bg-[hsl(var(--muted))] text-[hsl(var(--muted-fg))] px-1.5 py-0.5 rounded">{s}</span>
                            ))}
                            {(bid.service_types ?? []).length > 2 && (
                              <span className="text-[10px] text-[hsl(var(--muted-fg))]">+{(bid.service_types ?? []).length - 2}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="space-y-0.5">
                            <DeadlineChip deadline={bid.deadline} />
                            <p className="text-[10px] text-[hsl(var(--muted-fg))]">{formatDate(bid.deadline)}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-medium text-[hsl(var(--fg))]">{formatCurrency(bid.estimated_value)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <AssigneeAvatar user={estimator} size="sm" unassignedLabel="No estimator assigned" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {bid.status === 'pending' && (
                              <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => setStatus(bid, 'pursuing')}>
                                Pursue
                              </Button>
                            )}
                            {bid.status === 'pursuing' && (
                              <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => setStatus(bid, 'submitted')}>
                                <CheckCircle2 className="h-3 w-3" /> Submit
                              </Button>
                            )}
                            {['pending', 'pursuing'].includes(bid.status) && (
                              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setStatus(bid, 'no_bid')}>
                                <XCircle className="h-3 w-3" /> No-bid
                              </Button>
                            )}
                            {bid.status === 'submitted' && (
                              <>
                                <Button size="sm" className="h-6 text-[10px] px-2 bg-green-600 hover:bg-green-700" onClick={() => setStatus(bid, 'won')}>
                                  Won
                                </Button>
                                <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2" onClick={() => setStatus(bid, 'lost')}>
                                  Lost
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
