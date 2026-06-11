import { formatCurrency, formatRelativeTime, formatDate, daysUntil } from '@/lib/utils'
import { ScoreMeter } from './ScoreMeter'
import { LeadTypeBadge } from './LeadTypeBadge'
import { StatusBadge } from './StatusBadge'
import { MapPin, DollarSign, Clock, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Lead } from '@/types'

interface LeadCardProps {
  lead: Lead
  onClick?: () => void
  compact?: boolean
  isSelected?: boolean
}

export function LeadCard({ lead, onClick, compact = false, isSelected = false }: LeadCardProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group w-full text-left p-4 rounded-lg border bg-[hsl(var(--card))] transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-[#2E7D52]/30',
        isSelected && 'border-[#2E7D52] ring-1 ring-[#2E7D52]/20',
        !isSelected && 'border-[hsl(var(--border))]'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className={cn('font-medium text-[hsl(var(--fg))] truncate', compact ? 'text-sm' : 'text-sm')}>
            {lead.property_name}
          </h3>
          <div className="flex items-center gap-1 mt-0.5 text-xs text-[hsl(var(--muted-fg))]">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{lead.city}, {lead.state}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <LeadTypeBadge type={lead.lead_type} />
        </div>
      </div>

      <div className="mb-2">
        <ScoreMeter score={lead.score} factors={lead.score_factors} size="sm" />
      </div>

      <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-fg))]">
        <div className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          <span className="font-medium text-[hsl(var(--fg))]">{formatCurrency(lead.estimated_contract_value)}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={lead.status} />
          {!compact && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formatRelativeTime(lead.created_at)}</span>
            </div>
          )}
        </div>
      </div>

      {lead.bid_deadline && (
        <div className={cn(
          'mt-1.5 flex items-center gap-1 text-xs',
          daysUntil(lead.bid_deadline) <= 14 ? 'text-orange-500' : 'text-[hsl(var(--muted-fg))]'
        )}>
          <Calendar className="h-3 w-3 flex-shrink-0" />
          <span>Bid due {formatDate(lead.bid_deadline)} · {daysUntil(lead.bid_deadline)}d</span>
        </div>
      )}

      {!compact && lead.distance_miles != null && (
        <div className="mt-1.5 text-xs text-[hsl(var(--muted-fg))]">
          {lead.distance_miles.toFixed(1)} mi from nearest branch
        </div>
      )}
    </Tag>
  )
}
