import { useState } from 'react'
import { Mail, Phone, MessageSquare, StickyNote, Calendar, BellOff, RefreshCw } from 'lucide-react'
import { LinkedinIcon } from '@/components/shared/LinkedinIcon'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useLead, useSendOutreach } from '@/hooks/useLeads'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import type { OutreachChannel } from '@/types'

const CHANNEL_ICONS: Record<OutreachChannel, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  call: Phone,
  sms: MessageSquare,
  linkedin: LinkedinIcon,
  note: StickyNote,
  meeting: Calendar,
}
const CHANNEL_LABELS: Record<OutreachChannel, string> = {
  email: 'Email',
  call: 'Call',
  sms: 'SMS',
  linkedin: 'LinkedIn',
  note: 'Note',
  meeting: 'Meeting',
}

interface ComposerProps {
  leadId: string
  contactName?: string | null
  onSent?: () => void
  /** When false, channel buttons render without role="tab" (avoids conflicts when Composer is embedded inside a component that also has role="tab" elements). Defaults to true. */
  composeRole?: boolean
}

export function Composer({ leadId, contactName, onSent, composeRole = true }: ComposerProps) {
  const { data: lead } = useLead(leadId)
  const sendOutreach = useSendOutreach()
  const toast = useUIStore((s) => s.toast)

  const [activeChannel, setActiveChannel] = useState<OutreachChannel>('email')
  const [draft, setDraft] = useState<string | null>(null)
  const [aiDismissed, setAiDismissed] = useState(false)
  const [hasEdited, setHasEdited] = useState(false)

  const aiDraft =
    activeChannel === 'email' ? (lead?.ai_email_draft ?? '') :
    activeChannel === 'linkedin' ? (lead?.ai_linkedin_draft ?? '') : ''

  const currentDraft = draft ?? aiDraft

  // Banner shows only when: not dismissed, user hasn't started editing, AI draft exists, and we're on the AI draft (no manual draft set)
  const showAiBanner = !aiDismissed && !hasEdited && !!aiDraft && draft === null

  function handleChannelChange(ch: OutreachChannel) {
    setActiveChannel(ch)
    setDraft(null)
    setAiDismissed(false)
    setHasEdited(false)
  }

  function handleEdit(val: string) {
    setDraft(val)
    setHasEdited(true)
  }

  function handleDismissBanner() {
    setAiDismissed(true)
  }

  function handleRegenerate() {
    setDraft(null)
    setAiDismissed(false)
    setHasEdited(false)
  }

  async function handleSend() {
    if (!currentDraft.trim()) return
    try {
      await sendOutreach.mutateAsync({
        lead_id: leadId,
        channel: activeChannel,
        message: currentDraft,
      })
      setDraft(null)
      setHasEdited(false)
      setAiDismissed(false)
      onSent?.()
    } catch {
      // error toast handled by useSendOutreach
    }
  }

  function handleSnooze() {
    if (!lead) return
    toast(`${lead.property_name} snoozed 3 days`, { variant: 'info' })
  }

  // 1-based index of channel in the sequence order
  const stepNum = (['email', 'linkedin', 'call'] as OutreachChannel[]).indexOf(activeChannel) + 1

  return (
    <div className="flex-shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 pt-3 pb-4">
      {/* Channel tabs */}
      <div
        {...(composeRole ? { role: 'tablist' as const, 'aria-label': 'Compose channel' } : {})}
        className="flex items-center gap-1 mb-2"
      >
        {(['email', 'linkedin', 'call'] as OutreachChannel[]).map((ch) => {
          const Icon = CHANNEL_ICONS[ch]
          return (
            <button
              type="button"
              key={ch}
              {...(composeRole ? { role: 'tab', 'aria-selected': activeChannel === ch } : {})}
              onClick={() => handleChannelChange(ch)}
              className={cn(
                'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-t border-b-2 transition-colors',
                activeChannel === ch
                  ? 'border-[#2E7D52] text-[#2E7D52] font-medium bg-[#2E7D52]/5'
                  : 'border-transparent text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {CHANNEL_LABELS[ch]}
            </button>
          )
        })}
        {contactName && (
          <span className="ml-auto text-[11px] text-[hsl(var(--muted-fg))]">
            Step {stepNum} · to {contactName}
          </span>
        )}
      </div>

      {/* AI draft banner */}
      {showAiBanner && (
        <div className="flex items-center justify-between mb-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <span className="text-[11px] text-amber-700 dark:text-amber-300">
            AI-generated draft — review before sending
          </span>
          <button
            type="button"
            onClick={handleDismissBanner}
            className="text-[11px] text-amber-600 hover:text-amber-800 font-medium ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Textarea */}
      <Textarea
        value={currentDraft}
        onChange={(e) => handleEdit(e.target.value)}
        rows={6}
        placeholder={`Write a ${CHANNEL_LABELS[activeChannel]} message…`}
        className="text-sm resize-none mb-2"
      />

      {/* Action toolbar */}
      <div className="flex items-center gap-2">
        <Button
          className="flex-1 bg-[#2E7D52] hover:bg-[#256644] text-white gap-1.5"
          onClick={handleSend}
          disabled={sendOutreach.isPending || !currentDraft.trim()}
        >
          {(() => {
            const Icon = CHANNEL_ICONS[activeChannel]
            return <Icon className="h-4 w-4" />
          })()}
          {sendOutreach.isPending ? 'Sending…' : `Send ${CHANNEL_LABELS[activeChannel]}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRegenerate}
          className="gap-1"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Regenerate with AI
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSnooze}
          className="gap-1"
        >
          <BellOff className="h-3.5 w-3.5" />
          Snooze 3d
        </Button>
      </div>
    </div>
  )
}
