import { Mail, Clock } from 'lucide-react'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import { formatRelativeTime, getInitials, cn } from '@/lib/utils'
import type { Lead } from '@/types'

interface QueueItemProps {
  lead: Lead
  isSelected: boolean
  onClick: () => void
}

const AVATAR_COLORS = ['#2E7D52', '#1d4ed8', '#b45309', '#7e22ce', '#0f766e', '#be123c', '#4338ca']

function avatarHex(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function QueueItem({ lead, isSelected, onClick }: QueueItemProps) {
  const name = lead.contact_name ?? lead.property_name
  const color = avatarHex(name)
  const initials = getInitials(name)
  const isOverdue = !!lead.bid_deadline && new Date(lead.bid_deadline) < new Date()
  const ChannelIcon = Mail // default; update if Lead type exposes last_channel

  const preview = lead.ai_email_draft
    ? `You: ${lead.ai_email_draft.slice(0, 60).replace(/\n/g, ' ')}…`
    : 'No messages yet — draft an opener below.'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isSelected ? 'true' : undefined}
      data-selected={isSelected ? 'true' : undefined}
      className={cn(
        'w-full text-left flex gap-[11px] px-4 py-[13px]',
        'border-b border-[hsl(var(--border))] border-l-[3px] transition-colors',
        isSelected
          ? 'bg-[#2E7D52]/[0.07] border-l-[#2E7D52]'
          : 'border-l-transparent hover:bg-[hsl(var(--muted))]'
      )}
    >
      {/* Avatar */}
      <div
        className="w-[38px] h-[38px] rounded-full flex-shrink-0 flex items-center justify-center text-[13px] font-bold text-white"
        style={{ background: color }}
      >
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name + timestamp */}
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-[13.5px] font-bold text-[hsl(var(--fg))] overflow-hidden text-ellipsis whitespace-nowrap">
            {name}
          </span>
          <span className="text-[11px] text-[hsl(var(--muted-fg))] flex-shrink-0">
            {formatRelativeTime(lead.updated_at)}
          </span>
        </div>

        {/* Property sub — only show when contact name is the primary (avoids duplicate text) */}
        {lead.contact_name && (
          <p className="text-[11.5px] text-[hsl(var(--muted-fg))] mt-[1px] mb-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {lead.property_name}
          </p>
        )}

        {/* Preview row */}
        <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-fg))]">
          <ChannelIcon className="h-3 w-3 flex-shrink-0" />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{preview}</span>
        </div>

        {/* Tags row */}
        <div className="flex items-center gap-[5px] mt-1.5">
          <LeadTypeBadge type={lead.lead_type} />
          {isOverdue && (
            <span className="inline-flex items-center gap-[3px] text-[10.5px] font-bold px-[7px] py-0.5 rounded-full bg-red-100 text-red-700">
              <Clock className="h-[11px] w-[11px]" /> Overdue
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
