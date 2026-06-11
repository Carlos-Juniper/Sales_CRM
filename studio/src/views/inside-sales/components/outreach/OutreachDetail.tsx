import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Phone, BellOff, ExternalLink, CheckCircle2 } from 'lucide-react'
import { LinkedinIcon } from '@/components/shared/LinkedinIcon'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import { useUIStore } from '@/store/uiStore'
import { useLead, useOutreachHistory, useSendOutreach } from '@/hooks/useLeads'
import { formatCurrency, formatRelativeTime, daysUntil, cn } from '@/lib/utils'
import { STRONG_FIT_SCORE, GOOD_FIT_SCORE } from '@/lib/constants'
import type { OutreachChannel } from '@/types'

const CHANNEL_ICONS = {
  email: Mail,
  linkedin: LinkedinIcon,
  phone: Phone,
}

const CHANNEL_LABELS: Record<OutreachChannel, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  phone: 'Phone',
}

interface OutreachDetailProps {
  leadId: string
}

export function OutreachDetail({ leadId }: OutreachDetailProps) {
  const navigate = useNavigate()
  const { data: lead, isLoading: leadLoading } = useLead(leadId)
  const { data: history = [] } = useOutreachHistory(leadId)
  const sendOutreach = useSendOutreach()
  const selectLead = useUIStore((s) => s.selectLead)
  const toast = useUIStore((s) => s.toast)

  const [activeChannel, setActiveChannel] = useState<OutreachChannel>('email')
  const [draft, setDraft] = useState<string | null>(null)

  function handleViewLead() {
    selectLead(leadId)
    navigate('/inside-sales/leads')
  }

  const currentDraft = draft ?? (
    activeChannel === 'email' ? lead?.ai_email_draft :
    activeChannel === 'linkedin' ? lead?.ai_linkedin_draft :
    ''
  ) ?? ''

  const nextStep = history.length + 1

  const scoreColorClass = !lead ? '' :
    (lead.score ?? 0) >= STRONG_FIT_SCORE ? 'text-[#2E7D52]' :
    (lead.score ?? 0) >= GOOD_FIT_SCORE ? 'text-amber-600' :
    'text-orange-600'

  async function handleSend() {
    if (!lead || !currentDraft.trim()) return
    try {
      await sendOutreach.mutateAsync({
        lead_id: lead.id,
        channel: activeChannel,
        message: currentDraft,
      })
      setDraft(null)
    } catch {
      // error toast shown by useSendOutreach's onError
    }
  }

  function handleSnooze() {
    if (!lead) return
    toast(`${lead.property_name} snoozed 3 days`, { variant: 'info' })
  }

  if (leadLoading || !lead) {
    return (
      <div className="flex-1 flex flex-col p-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`h-4 rounded skeleton-shimmer ${i % 3 === 0 ? 'w-1/2' : 'w-full'}`} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-5 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-[hsl(var(--fg))]">{lead.property_name}</h2>
            <LeadTypeBadge type={lead.lead_type} />
          </div>
          <button
            type="button"
            onClick={handleViewLead}
            className="flex items-center gap-1 text-xs text-[#2E7D52] hover:underline flex-shrink-0"
          >
            View lead <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        <p className="text-xs text-[hsl(var(--muted-fg))] mb-3">
          {lead.city}, {lead.state}
          {lead.contact_name ? ` · Contact: ${lead.contact_name}` : ''}
        </p>

        {/* Metric chips */}
        <div className="flex items-center gap-3 flex-wrap">
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
      </div>

      {/* ── Scrollable body ── */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold text-[hsl(var(--muted-fg))] uppercase tracking-widest mb-4">
            Outreach History
          </p>

          {history.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-fg))] italic mb-6">No outreach sent yet.</p>
          ) : (
            <div className="space-y-0 mb-4">
              {history.map((item, idx) => {
                const Icon = CHANNEL_ICONS[item.channel] ?? Mail
                return (
                  <div key={item.id} className="relative pl-8 pb-5">
                    {idx < history.length - 1 && (
                      <div className="absolute left-3.5 top-7 bottom-0 w-px bg-[hsl(var(--border))]" />
                    )}
                    <div className="absolute left-0 top-0 h-7 w-7 rounded-full border-2 border-[hsl(var(--border))] bg-[hsl(var(--card))] flex items-center justify-center">
                      <Icon className="h-3 w-3 text-[hsl(var(--muted-fg))]" />
                    </div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-[hsl(var(--fg))]">
                        Step {item.sequence_step} — {CHANNEL_LABELS[item.channel]}
                      </span>
                      <span className="text-[10px] text-[hsl(var(--muted-fg))]">
                        {formatRelativeTime(item.sent_at)}
                      </span>
                      {item.response_received ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-green-600">
                          <CheckCircle2 className="h-3 w-3" /> Response received
                        </span>
                      ) : (
                        <span className="text-[10px] text-[hsl(var(--muted-fg))]">No response</span>
                      )}
                    </div>
                    <div className="rounded-lg bg-[hsl(var(--muted))] px-3 py-2.5">
                      <p className="text-xs text-[hsl(var(--fg))] leading-relaxed whitespace-pre-wrap line-clamp-4">
                        {item.message}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Next action divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-[hsl(var(--border))]" />
            <span className="text-[10px] font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide whitespace-nowrap">
              Next action — Step {nextStep}
            </span>
            <div className="flex-1 h-px bg-[hsl(var(--border))]" />
          </div>

          {/* Channel selector */}
          <div className="flex items-center gap-1 mb-3">
            <span className="text-xs text-[hsl(var(--muted-fg))] mr-1.5">Send via</span>
            {(['email', 'linkedin', 'phone'] as OutreachChannel[]).map((ch) => {
              const Icon = CHANNEL_ICONS[ch]
              return (
                <button
                  type="button"
                  key={ch}
                  onClick={() => { setActiveChannel(ch); setDraft(null) }}
                  className={cn(
                    'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border transition-colors',
                    activeChannel === ch
                      ? 'border-[#2E7D52] bg-[#2E7D52]/10 text-[#2E7D52] font-medium'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--muted-fg))] hover:border-[hsl(var(--fg))]'
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {CHANNEL_LABELS[ch]}
                </button>
              )
            })}
          </div>

          {/* Draft textarea */}
          <div className="relative mb-3">
            <Textarea
              value={currentDraft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              placeholder={`Write a ${CHANNEL_LABELS[activeChannel]} message…`}
              className="text-xs resize-none pr-20"
            />
            {currentDraft && (
              <span className="absolute top-2 right-2 text-[10px] text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] px-2 py-0.5 rounded-full">
                AI-generated
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              className="flex-1 bg-[#2E7D52] hover:bg-[#256644] text-white"
              onClick={handleSend}
              disabled={sendOutreach.isPending || !currentDraft.trim()}
            >
              {activeChannel === 'email' && <Mail className="h-4 w-4" />}
              {activeChannel === 'linkedin' && <LinkedinIcon className="h-4 w-4" />}
              {activeChannel === 'phone' && <Phone className="h-4 w-4" />}
              {sendOutreach.isPending ? 'Sending…' : `Send ${CHANNEL_LABELS[activeChannel]}`}
            </Button>
            <Button
              variant="outline"
              className="flex-shrink-0"
              onClick={handleSnooze}
            >
              <BellOff className="h-4 w-4" />
              Snooze 3d
            </Button>
          </div>

          <div className="h-4" />
        </div>
      </ScrollArea>
    </div>
  )
}
