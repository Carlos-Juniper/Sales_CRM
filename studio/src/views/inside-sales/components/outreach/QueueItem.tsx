import { Clock, Mail, Phone } from 'lucide-react'
import { LinkedinIcon } from '@/components/shared/LinkedinIcon'
import { ScoreMeter } from '@/components/shared/ScoreMeter'
import { formatCurrency, formatRelativeTime, daysUntil, cn } from '@/lib/utils'
import { STRONG_FIT_SCORE, GOOD_FIT_SCORE } from '@/lib/constants'
import type { Lead } from '@/types'

interface QueueItemProps {
  lead: Lead
  isSelected: boolean
  onClick: () => void
}

export function QueueItem({ lead, isSelected, onClick }: QueueItemProps) {
  const isOverdue = true // simplified for demo
  const isDueToday = false

  const scoreColorClass =
    lead.score !== null && lead.score >= STRONG_FIT_SCORE ? 'text-[#2E7D52]' :
    lead.score !== null && lead.score >= GOOD_FIT_SCORE ? 'text-amber-600' :
    'text-orange-600'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-3 border-b border-[hsl(var(--border))] transition-colors hover:bg-[hsl(var(--muted))]',
        isSelected ? 'bg-[hsl(var(--muted))] border-l-2 border-l-[#2E7D52]' : 'border-l-2 border-l-transparent'
      )}
    >
      {/* Row 1: status + channel badges */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {isOverdue ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded px-1.5 py-0.5">
            <Clock className="h-2.5 w-2.5" /> Overdue
          </span>
        ) : isDueToday ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded px-1.5 py-0.5">
            Due today
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded px-1.5 py-0.5">
          <Mail className="h-2.5 w-2.5" /> Email
        </span>
        {lead.contact_linkedin && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#0077B5] bg-blue-50 dark:bg-blue-900/20 rounded px-1.5 py-0.5">
            <LinkedinIcon className="h-2.5 w-2.5" /> LinkedIn
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-1.5 py-0.5">
          <Phone className="h-2.5 w-2.5" /> Phone
        </span>
      </div>

      {/* Row 2: property name */}
      <p className="text-sm font-semibold text-[hsl(var(--fg))] truncate leading-tight mb-0.5">
        {lead.property_name}
      </p>

      {/* Row 3: city + contact */}
      <p className="text-xs text-[hsl(var(--muted-fg))] truncate mb-2">
        {lead.city}, {lead.state}
        {lead.contact_name ? ` · ${lead.contact_name}` : ''}
      </p>

      {/* Row 4: metrics */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-[hsl(var(--fg))]">
          {formatCurrency(lead.estimated_contract_value)}
        </span>
        <div className="flex-1 min-w-0">
          <ScoreMeter score={lead.score} factors={lead.score_factors} size="sm" showLabel={false} />
        </div>
        {lead.score !== null && (
          <span className={cn('text-[10px] flex-shrink-0', scoreColorClass)}>
            {lead.score}
          </span>
        )}
        {lead.bid_deadline && (
          <span className="text-[10px] text-orange-500 flex-shrink-0 whitespace-nowrap">
            Bid {daysUntil(lead.bid_deadline)}d
          </span>
        )}
        <span className="text-[10px] text-[hsl(var(--muted-fg))] flex-shrink-0 whitespace-nowrap">
          {formatRelativeTime(lead.updated_at)}
        </span>
      </div>
    </button>
  )
}
