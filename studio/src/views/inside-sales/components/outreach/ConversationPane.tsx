import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import { useUIStore } from '@/store/uiStore'
import { useLead, useOutreachHistory } from '@/hooks/useLeads'
import { formatCurrency, formatRelativeTime, daysUntil, cn } from '@/lib/utils'
import { STRONG_FIT_SCORE, GOOD_FIT_SCORE } from '@/lib/constants'
import { Bubble } from './Bubble'
import { Composer } from './Composer'
import type { OutreachChannel, OutreachHistory } from '@/types'

type ChannelFilter = 'all' | OutreachChannel

const CHANNEL_TAB_LABELS: Record<ChannelFilter, string> = {
  all: 'All',
  email: 'Email',
  call: 'Call',
  sms: 'SMS',
  linkedin: 'LinkedIn',
  note: 'Note',
  meeting: 'Meeting',
}

interface ConversationPaneProps {
  leadId: string
}

export function ConversationPane({ leadId }: ConversationPaneProps) {
  const navigate = useNavigate()
  const { data: lead, isLoading: leadLoading } = useLead(leadId)
  const { data: history = [], isLoading: historyLoading } = useOutreachHistory(leadId)
  const selectLead = useUIStore((s) => s.selectLead)

  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')

  function handleViewLead() {
    selectLead(leadId)
    navigate('/inside-sales/leads')
  }

  const isLoading = leadLoading || historyLoading

  const visibleMessages = channelFilter === 'all'
    ? history
    : history.filter((m: OutreachHistory) => m.channel === channelFilter)

  // Overdue: any message has a next_follow_up in the past
  const isOverdue = history.some(
    (m: OutreachHistory) => m.next_follow_up && new Date(m.next_follow_up) < new Date()
  )

  const scoreColorClass = !lead ? '' :
    (lead.score ?? 0) >= STRONG_FIT_SCORE ? 'text-[#2E7D52]' :
    (lead.score ?? 0) >= GOOD_FIT_SCORE ? 'text-amber-600' :
    'text-orange-600'

  if (isLoading || !lead) {
    return (
      <div className="flex flex-col h-full" aria-busy="true">
        <div className="flex-shrink-0 px-5 py-4 border-b border-[hsl(var(--border))]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-4 rounded mb-2 animate-pulse bg-[hsl(var(--muted))] skeleton-shimmer',
                i === 0 ? 'w-1/2' : 'w-full'
              )}
            />
          ))}
        </div>
        <div className="flex-1 px-5 py-4 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded animate-pulse bg-[hsl(var(--muted))] skeleton-shimmer" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-5 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-[hsl(var(--fg))]">{lead.property_name}</h2>
            <LeadTypeBadge type={lead.lead_type} />
          </div>
          <button
            type="button"
            role="link"
            onClick={handleViewLead}
            className="flex items-center gap-1 text-xs text-[#2E7D52] hover:underline flex-shrink-0"
          >
            View lead <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        <p className="text-xs text-[hsl(var(--muted-fg))] mb-3">
          {lead.city}, {lead.state}
          {lead.contact_name ? ` · ${lead.contact_name}` : ''}
        </p>

        {/* Metric chips */}
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <span className="text-xs font-semibold text-[hsl(var(--fg))]">
            {formatCurrency(lead.estimated_contract_value)}
          </span>
          <span className="text-[hsl(var(--muted-fg))] text-xs">·</span>
          <span className="text-xs text-[hsl(var(--muted-fg))]">
            Score <span className={cn('font-semibold', scoreColorClass)}>{lead.score}</span>
          </span>
          {lead.bid_deadline && (
            <>
              <span className="text-[hsl(var(--muted-fg))] text-xs">·</span>
              <span className="text-xs text-[hsl(var(--muted-fg))]">
                Bid Due <span className="font-semibold text-orange-500">{daysUntil(lead.bid_deadline)}d</span>
              </span>
            </>
          )}
          <span className="text-[hsl(var(--muted-fg))] text-xs">·</span>
          <span className="text-xs text-[hsl(var(--muted-fg))]">
            Last contact: <span className="font-medium">{formatRelativeTime(lead.updated_at)}</span>
          </span>
        </div>

        {/* Channel filter tabs */}
        <div role="tablist" aria-label="Filter messages by channel" className="flex gap-0">
          {(['all', 'email', 'linkedin', 'call', 'sms', 'note', 'meeting'] as ChannelFilter[]).map((ch) => (
            <button
              key={ch}
              role="tab"
              aria-selected={channelFilter === ch}
              onClick={() => setChannelFilter(ch)}
              className={cn(
                'text-xs px-3 py-1.5 border-b-2 transition-colors mr-1',
                channelFilter === ch
                  ? 'border-[#2E7D52] text-[#2E7D52] font-medium'
                  : 'border-transparent text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]'
              )}
            >
              {CHANNEL_TAB_LABELS[ch]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Thread ── */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4">
          {visibleMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-[hsl(var(--fg))] mb-1">
                Start the conversation
              </p>
              <p className="text-xs text-[hsl(var(--muted-fg))]">
                Your AI-drafted opener is waiting below.
              </p>
            </div>
          ) : (
            <>
              {visibleMessages.map((msg: OutreachHistory) => (
                <Bubble key={msg.id} item={msg} />
              ))}
            </>
          )}

          {/* Overdue divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-[hsl(var(--border))]" />
            <span className={cn(
              'text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
              isOverdue ? 'text-red-500' : 'text-[hsl(var(--muted-fg))]'
            )}>
              {isOverdue
                ? 'Follow-up overdue — draft ready below'
                : 'Awaiting next step'}
            </span>
            <div className="flex-1 h-px bg-[hsl(var(--border))]" />
          </div>
        </div>
      </ScrollArea>

      {/* ── Composer ── */}
      <Composer leadId={leadId} contactName={lead.contact_name} composeRole={false} />
    </div>
  )
}
