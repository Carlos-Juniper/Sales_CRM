import { useState, useRef, useEffect } from 'react'
import {
  Inbox, Star, Send, FileText, File, Users, Building2,
  Trash2, SlidersHorizontal, ChevronDown, X, Plus, Search, Mail,
} from 'lucide-react'
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

const SECTIONS = [
  { k: 'inbox',     label: 'Inbox',     Icon: Inbox,     filter: (_: Lead) => true },
  { k: 'starred',   label: 'Starred',   Icon: Star,      filter: (l: Lead) => l.lead_type === 'HOA' },
  { k: 'sent',      label: 'Sent',      Icon: Send,      filter: (_: Lead) => true },
  { k: 'drafts',    label: 'Drafts',    Icon: FileText,  filter: (l: Lead) => !!l.ai_email_draft },
  { k: 'proposals', label: 'Proposals', Icon: File,      filter: (_: Lead) => true },
  { k: 'clients',   label: 'Clients',   Icon: Users,     filter: (l: Lead) => (l.score ?? 0) >= 85 },
  { k: 'internal',  label: 'Internal',  Icon: Building2, filter: (_: Lead) => false },
  { k: 'trash',     label: 'Trash',     Icon: Trash2,    filter: (_: Lead) => false },
]

export function ListPane({ selectedLeadId, onSelectLead, onNewMessage }: ListPaneProps) {
  const { queue, isLoading } = useOutreachQueue()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [activeSection, setActiveSection] = useState<string>('inbox')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  // Click-outside to close filter dropdown
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const activeSecDef = SECTIONS.find(s => s.k === activeSection)!

  const filtered = queue.filter((lead: Lead) => {
    const matchesSearch =
      !search ||
      lead.property_name.toLowerCase().includes(search.toLowerCase()) ||
      lead.city.toLowerCase().includes(search.toLowerCase()) ||
      (lead.contact_name ?? '').toLowerCase().includes(search.toLowerCase())

    if (!matchesSearch) return false
    if (!activeSecDef.filter(lead)) return false
    if (activeTab === 'overdue') return true
    if (activeTab === 'unread') return false
    return true
  })

  const overdueCount = queue.filter((lead: Lead) =>
    !!lead.bid_deadline && new Date(lead.bid_deadline) < new Date()
  ).length

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all',     label: 'All',     count: queue.length },
    { key: 'overdue', label: 'Overdue', count: overdueCount },
    { key: 'unread',  label: 'Unread',  count: 0 },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-[hsl(var(--border))]">
        <h2 className="text-base font-bold text-[hsl(var(--fg))] mb-3">Outreach</h2>

        {/* New message button */}
        <Button
          size="sm"
          className="w-full bg-[#2E7D52] hover:bg-[#256644] text-white mb-3"
          onClick={onNewMessage}
        >
          <Plus className="h-4 w-4 mr-1" /> New message
        </Button>

        {/* Search + Filter row */}
        <div className="flex gap-2 items-center">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-fg))]" />
            <input
              type="search"
              placeholder="Search leads, contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm rounded-[9px] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--fg))] focus:outline-none focus:border-[#2E7D52] focus:bg-[hsl(var(--card))]"
            />
          </div>

          {/* Filter button + dropdown */}
          <div className="relative flex-shrink-0" ref={filterRef}>
            <button
              type="button"
              onClick={() => setFilterOpen(o => !o)}
              className={cn(
                'inline-flex items-center gap-[5px] text-[12.5px] font-semibold cursor-pointer',
                'bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-[9px] px-2.5 py-2 transition-colors',
                'hover:text-[hsl(var(--fg))] hover:border-[#2E7D52]',
                (filterOpen || activeSection !== 'inbox')
                  ? 'text-[#2E7D52] border-[#2E7D52] bg-[#2E7D52]/[0.08]'
                  : 'text-[hsl(var(--muted-fg))]'
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filter
              <ChevronDown className="h-3 w-3" />
            </button>

            {filterOpen && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[232px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl shadow-xl p-1.5">
                {SECTIONS.map(({ k, label, Icon }) => {
                  const n = queue.filter(SECTIONS.find(s => s.k === k)!.filter).length
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => { setActiveSection(k); setFilterOpen(false) }}
                      className={cn(
                        'flex items-center gap-2.5 w-full bg-transparent cursor-pointer',
                        'text-sm font-medium px-2.5 py-2 rounded-lg text-left transition-colors',
                        'hover:bg-[hsl(var(--muted))]',
                        activeSection === k
                          ? 'text-[#2E7D52] font-semibold'
                          : 'text-[hsl(var(--fg))]'
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {label}
                      <span className={cn(
                        'ml-auto text-[11px] font-bold',
                        activeSection === k ? 'text-[#2E7D52]' : 'text-[hsl(var(--muted-fg))]'
                      )}>{n}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Active section chip */}
        {activeSection !== 'inbox' && (
          <div className="mt-[9px] flex">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#2E7D52] bg-[#2E7D52]/[0.11] py-1 pl-2.5 pr-1.5 rounded-full">
              {SECTIONS.find(s => s.k === activeSection)?.label}
              <button
                type="button"
                onClick={() => setActiveSection('inbox')}
                className="inline-flex opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* ── Tabs: All / Overdue / Unread ── */}
      <div className="flex-shrink-0 flex border-b border-[hsl(var(--border))] px-3 bg-[hsl(var(--card))]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'appearance-none bg-transparent border-none cursor-pointer font-semibold text-[12.5px]',
              'px-2 py-[11px] border-b-2 inline-flex items-center gap-1.5 transition-colors',
              activeTab === tab.key
                ? 'text-[#2E7D52] border-[#2E7D52]'
                : 'text-[hsl(var(--muted-fg))] border-transparent hover:text-[hsl(var(--fg))]'
            )}
          >
            {tab.label}
            <span className={cn(
              'text-[10.5px] font-bold px-1.5 py-0.5 rounded-full',
              activeTab === tab.key
                ? 'bg-[#2E7D52]/[0.14] text-[#2E7D52]'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-fg))]'
            )}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ── List ── */}
      <ScrollArea className="flex-1">
        <div role="list" aria-label="Conversations">
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
              <div role="listitem" key={lead.id}>
                <QueueItem
                  lead={lead}
                  isSelected={lead.id === selectedLeadId}
                  onClick={() => onSelectLead(lead.id)}
                />
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
