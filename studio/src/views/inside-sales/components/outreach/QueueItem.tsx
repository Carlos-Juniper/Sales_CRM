import { Mail, Phone, MessageSquare, StickyNote, Calendar } from 'lucide-react'
import { LinkedinIcon } from '@/components/shared/LinkedinIcon'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import { formatRelativeTime, getInitials, cn } from '@/lib/utils'
import type { Lead, OutreachChannel } from '@/types'

const CHANNEL_ICONS: Record<OutreachChannel, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  call: Phone,
  sms: MessageSquare,
  linkedin: LinkedinIcon,
  note: StickyNote,
  meeting: Calendar,
}

// Deterministic color from name — maps to one of 5 hues
const AVATAR_COLORS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-amber-500',
  'bg-rose-500',
]

function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

interface QueueItemProps {
  lead: Lead
  isSelected: boolean
  onClick: () => void
}

export function QueueItem({ lead, isSelected, onClick }: QueueItemProps) {
  const initials = getInitials(lead.contact_name ?? lead.property_name)
  const color = avatarColor(lead.contact_name ?? lead.property_name)

  // Placeholder last-message preview; real thread data loads in ConversationPane
  const preview = lead.ai_email_draft
    ? `You: ${lead.ai_email_draft.slice(0, 60).replace(/\n/g, ' ')}…`
    : 'No messages yet — draft an opener below.'

  const lastChannel: OutreachChannel = 'email'
  const ChannelIcon = CHANNEL_ICONS[lastChannel]

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isSelected || undefined}
      data-selected={isSelected}
      className={cn(
        'w-full text-left px-4 py-3 border-b border-[hsl(var(--border))] transition-colors',
        'hover:bg-[hsl(var(--muted))] flex items-start gap-3',
        isSelected
          ? 'bg-[hsl(var(--muted))] border-l-[3px] border-l-[#2E7D52]'
          : 'border-l-[3px] border-l-transparent'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'h-9 w-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold',
          color
        )}
      >
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <p className="text-sm font-semibold text-[hsl(var(--fg))] truncate leading-tight">
            {lead.property_name}
          </p>
          <span className="text-[10px] text-[hsl(var(--muted-fg))] flex-shrink-0">
            {formatRelativeTime(lead.updated_at)}
          </span>
        </div>
        <p className="text-[11px] text-[hsl(var(--muted-fg))] truncate mb-1">
          {lead.contact_name ?? `${lead.city}, ${lead.state}`}
        </p>
        <div className="flex items-center gap-1.5">
          <ChannelIcon className="h-3 w-3 text-[hsl(var(--muted-fg))] flex-shrink-0" />
          <p className="text-xs text-[hsl(var(--muted-fg))] truncate">{preview}</p>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <LeadTypeBadge type={lead.lead_type} />
        </div>
      </div>
    </button>
  )
}
