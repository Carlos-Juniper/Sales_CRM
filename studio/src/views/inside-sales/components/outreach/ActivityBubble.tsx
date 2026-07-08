import { Mail, MessageSquare, Phone, FileText, Calendar, Check } from 'lucide-react'
import { formatRelativeTime, cn } from '@/lib/utils'
import type { ActivityItem } from '@/types'

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  call: Phone,
  sms: MessageSquare,
  note: FileText,
  meeting: Calendar,
}

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  call: 'Call',
  sms: 'Text',
  note: 'Note',
  meeting: 'Meeting',
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const INBOUND_COLORS = ['#1d4ed8', '#b45309', '#7e22ce', '#0f766e', '#be123c']

function inboundAvatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return INBOUND_COLORS[h % INBOUND_COLORS.length]
}

function initials(name: string): string {
  return name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()
}

interface ActivityBubbleProps {
  item: ActivityItem
}

function EmailCard({ item }: { item: ActivityItem }) {
  const isOut = item.direction === 'out'
  const senderName = isOut ? 'You' : item.performed_by
  const avatarBg = isOut ? '#2E7D52' : inboundAvatarColor(item.performed_by)

  return (
    <div
      className={cn(
        'border border-[hsl(var(--border))] rounded-2xl bg-[hsl(var(--card))]',
        'px-[18px] py-4 mb-4 shadow-sm',
        isOut && 'border-l-[3px] border-l-[#2E7D52]',
      )}
    >
      {/* Header: avatar + name/sub + time */}
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
          style={{ background: avatarBg }}
        >
          {initials(senderName)}
        </div>
        <div>
          <div className="text-[13px] font-bold text-[hsl(var(--fg))]">{senderName}</div>
          <div className="text-[11px] text-[hsl(var(--muted-fg))]">
            {isOut ? `to ${item.performed_by}` : 'to You'} · Email
          </div>
        </div>
        <div className="ml-auto text-[11px] text-[hsl(var(--muted-fg))]">
          {formatRelativeTime(item.performed_at)}
        </div>
      </div>

      {/* Subject */}
      {item.subject && (
        <div className="text-[13.5px] font-bold text-[hsl(var(--fg))] mb-1.5">
          {item.subject}
        </div>
      )}

      {/* Body */}
      <div className="text-[13px] leading-relaxed text-[hsl(var(--fg))] whitespace-pre-wrap">
        {item.body}
      </div>

      {/* Status (outbound only) */}
      {isOut && (
        <div className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[hsl(var(--muted-fg))] mt-2.5">
          <Check className="h-3 w-3" /> Delivered
        </div>
      )}
    </div>
  )
}

function SmsBubble({ item }: { item: ActivityItem }) {
  const isOut = item.direction === 'out'
  return (
    <div className={cn('flex mb-2.5', isOut ? 'justify-end' : 'justify-start')}>
      <div style={{ maxWidth: '62%' }}>
        <div
          className={cn(
            'px-3.5 py-[9px] text-[13px] leading-[1.5] rounded-[18px]',
            isOut
              ? 'bg-[#2E7D52] text-white rounded-br-[5px]'
              : 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--fg))] rounded-bl-[5px]',
          )}
        >
          {item.body}
        </div>
        <div
          className={cn(
            'text-[10px] text-[hsl(var(--muted-fg))] mt-[3px] mx-1',
            isOut ? 'text-right' : 'text-left',
          )}
        >
          {isOut
            ? `Delivered · ${formatRelativeTime(item.performed_at)} · Text`
            : `${item.performed_by} · ${formatRelativeTime(item.performed_at)} · Text`}
        </div>
      </div>
    </div>
  )
}

export function ActivityBubble({ item }: ActivityBubbleProps) {
  // Email → card
  if (item.channel === 'email') {
    return <EmailCard item={item} />
  }

  // SMS → iMessage-style bubble
  if (item.channel === 'sms') {
    return <SmsBubble item={item} />
  }

  // Call → bubble with duration + audio + transcript
  if (item.channel === 'call') {
    const isOut = item.direction === 'out'
    return (
      <div
        data-testid={isOut ? 'bubble-out' : 'bubble-in'}
        className={cn('flex mb-3', isOut ? 'justify-end' : 'justify-start')}
      >
        <div className={cn('max-w-[75%] flex flex-col', isOut ? 'items-end' : 'items-start')}>
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-[11px] font-semibold text-[hsl(var(--muted-fg))]">
              {isOut ? 'You' : item.performed_by}
            </span>
            <span className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded-full">
              <Phone className="h-2.5 w-2.5" /> Call
            </span>
            {item.duration_seconds != null && (
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
          <div
            className={cn(
              'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
              isOut
                ? 'bg-[#2E7D52] text-white rounded-br-sm'
                : 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--fg))] rounded-bl-sm',
            )}
          >
            <p className="whitespace-pre-wrap">{item.body}</p>
          </div>
          {item.recording_url && (
            <div className="mt-2 w-full">
              <audio
                controls
                src={item.recording_url}
                className="w-full h-8"
                aria-label="Call recording"
              />
            </div>
          )}
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

  // Note / Meeting → generic bubble
  const isOut = item.direction === 'out'
  const Icon = CHANNEL_ICONS[item.channel] ?? Mail
  return (
    <div
      data-testid={isOut ? 'bubble-out' : 'bubble-in'}
      className={cn('flex mb-3', isOut ? 'justify-end' : 'justify-start')}
    >
      <div className={cn('max-w-[75%] flex flex-col', isOut ? 'items-end' : 'items-start')}>
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="text-[11px] font-semibold text-[hsl(var(--muted-fg))]">
            {isOut ? 'You' : item.performed_by}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded-full">
            <Icon className="h-2.5 w-2.5" />
            {CHANNEL_LABELS[item.channel] ?? item.channel}
          </span>
          <span className="text-[10px] text-[hsl(var(--muted-fg))]">
            {formatRelativeTime(item.performed_at)}
          </span>
        </div>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isOut
              ? 'bg-[#2E7D52] text-white rounded-br-sm'
              : 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--fg))] rounded-bl-sm',
          )}
        >
          <p className="whitespace-pre-wrap">{item.body}</p>
        </div>
      </div>
    </div>
  )
}
