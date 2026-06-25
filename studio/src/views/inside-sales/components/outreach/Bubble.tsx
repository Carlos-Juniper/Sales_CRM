import { Mail, Phone, CheckCheck, Check } from 'lucide-react'
import { LinkedinIcon } from '@/components/shared/LinkedinIcon'
import { formatRelativeTime, cn } from '@/lib/utils'
import type { OutreachHistory } from '@/types'

const CHANNEL_ICONS = { email: Mail, linkedin: LinkedinIcon, phone: Phone }
const CHANNEL_LABELS = { email: 'Email', linkedin: 'LinkedIn', phone: 'Text' }

interface BubbleProps {
  item: OutreachHistory
}

export function Bubble({ item }: BubbleProps) {
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
            {isOut ? 'You' : (item.sender_name ?? 'Contact')}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-fg))] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded-full">
            <Icon className="h-2.5 w-2.5" />
            {CHANNEL_LABELS[item.channel]}
          </span>
          <span className="text-[10px] text-[hsl(var(--muted-fg))]">
            {formatRelativeTime(item.sent_at)}
          </span>
        </div>

        {/* Bubble body */}
        <div className={cn(
          'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isOut
            ? 'bg-[#2E7D52] text-white rounded-br-sm'
            : 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--fg))] rounded-bl-sm'
        )}>
          <p className="whitespace-pre-wrap">{item.message}</p>
        </div>

        {/* Status line */}
        <div className="flex items-center gap-1 mt-1">
          {isOut ? (
            item.response_received ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[#2E7D52]">
                <CheckCheck className="h-3 w-3" /> Read
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-fg))]">
                <Check className="h-3 w-3" /> Sent
              </span>
            )
          ) : (
            <span className="text-[10px] text-[hsl(var(--muted-fg))]">
              Response received
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
