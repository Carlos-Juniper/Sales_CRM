import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, Mail, MessageSquare, Phone, FileText, Calendar, Send, Clock } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import { useUIStore } from '@/store/uiStore'
import { useLead, useOutreachHistory, useSendOutreach } from '@/hooks/useLeads'
import { useLeadActivity } from '@/hooks/useActivity'
import { formatCurrency, daysUntil, cn } from '@/lib/utils'
import { STRONG_FIT_SCORE, GOOD_FIT_SCORE } from '@/lib/constants'
import { ActivityBubble } from './ActivityBubble'
import { ConsentBadge } from './ConsentBadge'
import type { CommChannel, ActivityItem, OutreachHistory } from '@/types'

type ChannelFilter = 'all' | CommChannel

const CHANNEL_TAB_LABELS: Record<string, string> = {
  all: 'All',
  email: 'Email',
  call: 'Call',
  sms: 'Text',
  note: 'Note',
  meeting: 'Meeting',
}

const CHANNEL_TABS: ChannelFilter[] = ['all', 'email', 'call', 'sms', 'note', 'meeting']

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()
}

interface ConversationPaneProps {
  leadId: string
  onOpenFullComposer: () => void
}

export function ConversationPane({ leadId, onOpenFullComposer }: ConversationPaneProps) {
  const navigate = useNavigate()
  const { data: lead, isLoading: leadLoading } = useLead(leadId)
  const { data: activity = [], isLoading: activityLoading } = useLeadActivity(leadId)
  const { data: history = [] } = useOutreachHistory(leadId)
  const selectLead = useUIStore((s) => s.selectLead)
  const sendOutreach = useSendOutreach()

  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [dockChannel, setDockChannel] = useState<'email' | 'sms'>('email')
  const [dockText, setDockText] = useState('')

  function handleViewLead() {
    selectLead(leadId)
    navigate('/inside-sales/leads')
  }

  async function handleDockSend() {
    if (!dockText.trim()) return
    try {
      await sendOutreach.mutateAsync({
        lead_id: leadId,
        channel: dockChannel,
        message: dockText.trim(),
      })
      setDockText('')
    } catch {
      // error toast handled by useSendOutreach
    }
  }

  const isLoading = leadLoading || activityLoading

  const visibleItems = channelFilter === 'all'
    ? activity
    : activity.filter((item: ActivityItem) => item.channel === channelFilter)

  // Overdue: any old outreach message has a next_follow_up in the past
  const isOverdue = (history as OutreachHistory[]).some(
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

  const channelIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    email: Mail, call: Phone, sms: MessageSquare, note: FileText, meeting: Calendar,
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-[22px] py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {/* Title row: avatar + name + badges + view link */}
        <div className="flex items-center gap-[9px] mb-1">
          {/* Small avatar */}
          <div
            className="w-[30px] h-[30px] rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: '#2E7D52' }}
          >
            {getInitials(lead.contact_name ?? lead.property_name)}
          </div>
          <h2 className="text-base font-bold text-[hsl(var(--fg))]">
            {lead.contact_name ?? lead.property_name}
          </h2>
          <LeadTypeBadge type={lead.lead_type} />
          {/* Overdue chip */}
          {isOverdue && (
            <span className="inline-flex items-center gap-[3px] text-[10.5px] font-bold px-[7px] py-0.5 rounded-full bg-red-100 text-red-700">
              <Clock className="h-[11px] w-[11px]" /> Follow-up overdue
            </span>
          )}
          <button
            type="button"
            onClick={handleViewLead}
            className="ml-auto flex items-center gap-1 text-xs text-[#2E7D52] hover:underline flex-shrink-0"
          >
            View lead <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2.5 flex-wrap text-xs text-[hsl(var(--muted-fg))] mb-3">
          <span>{lead.property_name}</span>
          <span className="opacity-40">·</span>
          <span>{lead.city}, {lead.state}</span>
          <span className="opacity-40">·</span>
          <span>Value <b className="text-[hsl(var(--fg))] font-bold">{formatCurrency(lead.estimated_contract_value)}</b></span>
          <span className="opacity-40">·</span>
          <span>Fit <b className={cn('font-bold', scoreColorClass)}>{lead.score}</b></span>
          {lead.bid_deadline && (
            <>
              <span className="opacity-40">·</span>
              <span>Bid due <b className="font-bold text-orange-500">{daysUntil(lead.bid_deadline)}d</b></span>
            </>
          )}
        </div>

        {/* ConsentBadge */}
        <ConsentBadge contactId={lead.contact_id} />

        {/* Channel filter pills */}
        <div className="flex gap-1 flex-wrap mt-3">
          {CHANNEL_TABS.map((ch) => {
            const Icon = channelIcons[ch]
            return (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={cn(
                  'border border-[hsl(var(--border))] bg-[hsl(var(--card))] cursor-pointer',
                  'text-[11.5px] font-semibold',
                  'px-3 py-[5px] rounded-full inline-flex items-center gap-[5px] transition-colors',
                  'hover:border-[#2E7D52] hover:text-[hsl(var(--fg))]',
                  channelFilter === ch
                    ? 'bg-[#2E7D52] border-[#2E7D52] text-white hover:text-white'
                    : 'text-[hsl(var(--muted-fg))]'
                )}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {CHANNEL_TAB_LABELS[ch]}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Thread ── */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4">
          {visibleItems.length === 0 ? (
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
              {visibleItems.map((item: ActivityItem) => (
                <ActivityBubble key={item.id} item={item} />
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

      {/* ── Dock bar ── */}
      <div className="flex-shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-[18px] py-3">
        <div className="flex items-center gap-2.5">
          {/* Email / Text segmented toggle */}
          <div className="flex gap-1 bg-[hsl(var(--muted))] rounded-full p-[3px] flex-shrink-0">
            {(['email', 'sms'] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setDockChannel(ch)}
                className={cn(
                  'text-xs font-semibold px-3 py-1.5 rounded-full',
                  'inline-flex items-center gap-[5px] transition-colors',
                  dockChannel === ch
                    ? 'bg-[hsl(var(--card))] text-[#2E7D52] shadow-sm'
                    : 'text-[hsl(var(--muted-fg))]'
                )}
              >
                {ch === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                {ch === 'email' ? 'Email' : 'Text'}
              </button>
            ))}
          </div>

          {/* Quick reply input */}
          <input
            type="text"
            placeholder={dockChannel === 'email' ? 'Quick reply by email…' : 'Quick text reply…'}
            value={dockText}
            onChange={(e) => setDockText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleDockSend() }}
            className="flex-1 px-3.5 py-[9px] border border-[hsl(var(--border))] rounded-full text-sm bg-[hsl(var(--muted))] text-[hsl(var(--fg))] outline-none focus:border-[#2E7D52] focus:bg-[hsl(var(--card))]"
          />

          {/* Full composer button */}
          <button
            type="button"
            onClick={onOpenFullComposer}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--muted-fg))] border border-[hsl(var(--border))] rounded-[9px] px-3 py-[9px] bg-transparent hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--fg))] transition-colors flex-shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Full composer
          </button>

          {/* Send */}
          <Button
            className="bg-[#2E7D52] hover:bg-[#256644] text-white gap-1.5 flex-shrink-0"
            onClick={() => void handleDockSend()}
            disabled={sendOutreach.isPending || !dockText.trim()}
          >
            <Send className="h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
