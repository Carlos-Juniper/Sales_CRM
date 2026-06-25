import { Mail, Phone, MessageSquare, FileText, Calendar } from 'lucide-react'
import { LinkedinIcon } from '@/components/shared/LinkedinIcon'
import { formatRelativeTime, cn } from '@/lib/utils'
import type { ActivityItem } from '@/types'

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  call: Phone,
  sms: MessageSquare,
  linkedin: LinkedinIcon,
  note: FileText,
  meeting: Calendar,
}

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  call: 'Call',
  sms: 'Text',
  linkedin: 'LinkedIn',
  note: 'Note',
  meeting: 'Meeting',
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface ActivityBubbleProps {
  item: ActivityItem
}

export function ActivityBubble({ item }: ActivityBubbleProps) {
  const isOut = item.direction === 'out'
  const Icon = CHANNEL_ICONS[item.channel] ?? Mail

  return (
    <div
      data-testid={isOut ? 'bubble-out' : 'bubble-in'}
      className={cn('flex mb-3', isOut ? 'justify-end' : 'justify-start')}
    >
      <div className={cn('max-w-[75%] flex flex-col', isOut ? 'items-end' : 'items-start')}>
        {/* Sender + channel badge + time */}
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="text-[11px] font-semibold text-[hsl(var(--muted-fg))]">
            {isOut ? 'You' : item.performed_by}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded-full">
            <Icon className="h-2.5 w-2.5" />
            {CHANNEL_LABELS[item.channel] ?? item.channel}
          </span>
          {item.channel === 'call' && item.duration_seconds != null && (
            <span
              data-testid="call-duration"
              className="text-[10px] text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded-full"
            >
              {formatDuration(item.duration_seconds)}
            </span>
          )}
          <span className="text-[10px] text-[hsl(var(--muted-fg))]">
            {formatRelativeTime(item.performed_at)}
          </span>
        </div>

        {/* Bubble body */}
        <div className={cn(
          'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isOut
            ? 'bg-[#2E7D52] text-white rounded-br-sm'
            : 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--fg))] rounded-bl-sm'
        )}>
          <p className="whitespace-pre-wrap">{item.body}</p>
        </div>

        {/* Audio player for calls with recording */}
        {item.channel === 'call' && item.recording_url && (
          <div className="mt-2 w-full">
            <audio
              controls
              src={item.recording_url}
              className="w-full h-8"
              aria-label="Call recording"
            />
          </div>
        )}

        {/* Transcript summary for calls/SMS */}
        {item.transcript_summary && (
          <div className="mt-1 w-full">
            <span className="text-[10px] text-[hsl(var(--muted-fg))]">Transcript</span>
            <p className="mt-1 text-xs text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] rounded px-2 py-1">
              {item.transcript_summary}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
