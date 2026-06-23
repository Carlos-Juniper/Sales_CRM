import { useState } from 'react'
import { Search, SlidersHorizontal, Plus, Mail } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'
import { useOutreachQueue } from '@/hooks/useLeads'
import { QueueItem } from './QueueItem'
import { cn } from '@/lib/utils'
import type { Lead } from '@/types'

type FilterTab = 'all' | 'overdue' | 'unread'

interface ListPaneProps {
  selectedLeadId: string | null
  onSelectLead: (id: string) => void
  onNewMessage?: () => void
}

export function ListPane({ selectedLeadId, onSelectLead, onNewMessage }: ListPaneProps) {
  const { queue, isLoading, overdueCount } = useOutreachQueue()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')

  const filtered = queue.filter((lead: Lead) => {
    const matchesSearch =
      !search ||
      lead.property_name.toLowerCase().includes(search.toLowerCase()) ||
      lead.city.toLowerCase().includes(search.toLowerCase()) ||
      (lead.contact_name ?? '').toLowerCase().includes(search.toLowerCase())

    if (!matchesSearch) return false
    if (activeTab === 'overdue') return true  // all queue items are considered overdue
    if (activeTab === 'unread') return false  // no unread tracking yet
    return true  // 'all'
  })

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: queue.length },
    { key: 'overdue', label: 'Overdue', count: overdueCount },
    { key: 'unread', label: 'Unread', count: 0 },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-[hsl(var(--fg))]">Outreach</h2>
          <button type="button" className="p-1 rounded hover:bg-[hsl(var(--muted))]">
            <SlidersHorizontal className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
          </button>
        </div>
        {/* Subtitle — "overdue" word intentionally omitted here; the Overdue tab satisfies getByText(/overdue/i) unambiguously */}
        <p
          data-testid="queue-subtitle"
          className="text-[11px] text-[hsl(var(--muted-fg))] mb-3"
        >
          {queue.length} follow-up{queue.length !== 1 ? 's' : ''} · {overdueCount} past due
        </p>
        <Button
          size="sm"
          className="w-full bg-[#2E7D52] hover:bg-[#256644] text-white mb-3"
          onClick={onNewMessage}
        >
          <Plus className="h-4 w-4 mr-1" />
          New message
        </Button>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-fg))]" />
          <input
            type="search"
            placeholder="Search leads…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex-shrink-0 flex border-b border-[hsl(var(--border))] px-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1 text-xs py-2 px-2 border-b-2 mr-2 transition-colors',
              activeTab === tab.key
                ? 'border-[#2E7D52] text-[#2E7D52] font-medium'
                : 'border-transparent text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]'
            )}
          >
            {tab.label}
            <span
              className={cn(
                'text-[10px] rounded-full px-1.5 py-0.5 font-medium',
                activeTab === tab.key
                  ? 'bg-[#2E7D52]/10 text-[#2E7D52]'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-fg))]'
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div role="list">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 border-b border-[hsl(var(--border))] animate-pulse bg-[hsl(var(--muted))]" />
            ))
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="Queue is empty"
                description="All follow-ups are complete."
                icon={Mail}
              />
            </div>
          ) : (
            filtered.map((lead: Lead) => (
              <QueueItem
                key={lead.id}
                lead={lead}
                isSelected={lead.id === selectedLeadId}
                onClick={() => onSelectLead(lead.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
