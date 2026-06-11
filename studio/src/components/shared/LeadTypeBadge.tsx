import { LEAD_TYPE_COLORS } from '@/lib/constants'
import type { LeadType } from '@/types'
import { cn } from '@/lib/utils'

interface LeadTypeBadgeProps {
  type: LeadType
  className?: string
}

const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  HOA: 'HOA',
  commercial: 'Commercial',
  deathcare: 'Deathcare',
  resort: 'Resort',
}

export function LeadTypeBadge({ type, className }: LeadTypeBadgeProps) {
  const colors = LEAD_TYPE_COLORS[type] ?? { bg: 'bg-zinc-100', text: 'text-zinc-600', border: 'border-zinc-200' }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        colors.bg,
        colors.text,
        colors.border,
        className
      )}
    >
      {LEAD_TYPE_LABELS[type] ?? type}
    </span>
  )
}
