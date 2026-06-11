import { useState, useMemo } from 'react'
import { Calendar, ChevronUp, ChevronDown, User, AlertTriangle, Clock, CheckCircle2, RotateCcw, Plus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { mockEstimateQueue } from '@/mocks/estimatingData'
import { mockUsers } from '@/mocks/data'
import { formatDate, formatCurrency, cn, daysUntil } from '@/lib/utils'
import type { EstimatePriority, EstimateStatus } from '@/types/estimating'

const PRIORITY_CONFIG: Record<EstimatePriority, { label: string; className: string }> = {
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  high: { label: 'High', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  medium: { label: 'Medium', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  low: { label: 'Low', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
}

const STATUS_CONFIG: Record<EstimateStatus, { label: string; icon: React.ElementType; className: string }> = {
  queued: { label: 'Queued', icon: Clock, className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  in_progress: { label: 'In Progress', icon: RotateCcw, className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  review: { label: 'Review', icon: AlertTriangle, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  approved: { label: 'Approved', icon: CheckCircle2, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  sent: { label: 'Sent', icon: CheckCircle2, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
}

type SortKey = 'deadline' | 'acreage' | 'value' | 'priority'
const PRIORITY_ORDER: Record<EstimatePriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

interface Props {
  onSelectItem: (id: string) => void
  selectedId: string | null
}

export function EstimateQueue({ onSelectItem, selectedId }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const items = useMemo(() => {
    let filtered = mockEstimateQueue
    if (statusFilter !== 'all') filtered = filtered.filter((i) => i.status === statusFilter)

    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'deadline') cmp = new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
      else if (sortKey === 'acreage') cmp = a.estimated_acreage - b.estimated_acreage
      else if (sortKey === 'value') cmp = a.estimated_contract_value - b.estimated_contract_value
      else if (sortKey === 'priority') cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [sortKey, sortDir, statusFilter])

  const stats = useMemo(() => ({
    total: mockEstimateQueue.length,
    urgent: mockEstimateQueue.filter((i) => i.priority === 'urgent' || i.priority === 'high').length,
    inProgress: mockEstimateQueue.filter((i) => i.status === 'in_progress' || i.status === 'review').length,
    totalValue: mockEstimateQueue.reduce((s, i) => s + i.estimated_contract_value, 0),
  }), [])

  function SortIcon({ field }: { field: SortKey }) {
    if (sortKey !== field) return null
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Queue', value: stats.total, sub: 'estimates pending' },
          { label: 'Needs Attention', value: stats.urgent, sub: 'urgent or high priority', urgent: stats.urgent > 0 },
          { label: 'Active', value: stats.inProgress, sub: 'in progress or review' },
          { label: 'Queue Value', value: formatCurrency(stats.totalValue), sub: 'est. contract value' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-[hsl(var(--muted-fg))]">{s.label}</p>
              <p className={cn('text-xl font-bold mt-0.5', s.urgent ? 'text-red-500' : 'text-[hsl(var(--fg))]')}>{s.value}</p>
              <p className="text-[10px] text-[hsl(var(--muted-fg))] mt-0.5">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 ml-auto text-xs text-[hsl(var(--muted-fg))]">
          Sort by:
          {(['priority', 'deadline', 'value', 'acreage'] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => toggleSort(k)}
              className={cn(
                'flex items-center gap-0.5 px-2 py-1 rounded capitalize hover:bg-[hsl(var(--muted))] transition-colors',
                sortKey === k && 'bg-[hsl(var(--muted))] font-medium text-[hsl(var(--fg))]'
              )}
            >
              {k} <SortIcon field={k} />
            </button>
          ))}
        </div>

        <Button size="sm" className="h-8 text-xs gap-1 ml-1">
          <Plus className="h-3.5 w-3.5" /> Add Item
        </Button>
      </div>

      {/* Queue list */}
      <div className="flex flex-col gap-2 overflow-y-auto pb-4">
        {items.map((item) => {
          const days = daysUntil(item.deadline)
          const overdue = days < 0
          const urgent = days <= 3 && !overdue
          const assignee = mockUsers.find((u) => u.id === item.assigned_to)
          const statusCfg = STATUS_CONFIG[item.status]
          const StatusIcon = statusCfg.icon
          const priCfg = PRIORITY_CONFIG[item.priority]
          const isSelected = selectedId === item.id

          return (
            <Card
              key={item.id}
              onClick={() => onSelectItem(item.id)}
              className={cn(
                'cursor-pointer transition-all hover:shadow-md',
                isSelected && 'ring-2 ring-[#2E7D52]',
                (overdue || urgent) && 'border-red-300 dark:border-red-700'
              )}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Top row */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold', priCfg.className)}>
                        {priCfg.label}
                      </span>
                      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', statusCfg.className)}>
                        <StatusIcon className="h-2.5 w-2.5" />{statusCfg.label}
                      </span>
                      <span className="text-[10px] text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded">
                        {item.lead_type}
                      </span>
                    </div>

                    <p className="font-semibold text-sm text-[hsl(var(--fg))] truncate">{item.property_name}</p>

                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      <span className="text-xs text-[hsl(var(--muted-fg))]">{item.estimated_acreage} ac</span>
                      <span className="text-xs font-medium text-[hsl(var(--fg))]">{formatCurrency(item.estimated_contract_value)}</span>
                      {item.site_walk_date && (
                        <span className="text-xs text-[hsl(var(--muted-fg))]">
                          Walk: {formatDate(item.site_walk_date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right column */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
                    <div className={cn('flex items-center gap-1 text-xs font-medium', overdue ? 'text-red-600' : urgent ? 'text-orange-600' : 'text-[hsl(var(--muted-fg))]')}>
                      <Calendar className="h-3.5 w-3.5" />
                      {overdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`}
                    </div>
                    {assignee ? (
                      <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-fg))]">
                        <div className="h-5 w-5 rounded-full bg-[#2E7D52] flex items-center justify-center text-white text-[8px] font-bold">
                          {assignee.avatar_initials}
                        </div>
                        {assignee.name.split(' ')[0]}
                      </div>
                    ) : (
                      <span className="text-[10px] text-[hsl(var(--muted-fg))] flex items-center gap-1">
                        <User className="h-3 w-3" /> Unassigned
                      </span>
                    )}
                  </div>
                </div>

                {item.site_walk_notes && (
                  <p className="mt-2 text-xs text-[hsl(var(--muted-fg))] line-clamp-2 italic">
                    "{item.site_walk_notes}"
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
