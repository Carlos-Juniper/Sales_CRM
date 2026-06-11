import { STATUS_COLORS, LEAD_STATUS_LABELS } from '@/lib/constants'
import type { LeadStatus } from '@/types'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status: LeadStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colors = STATUS_COLORS[status] ?? { bg: 'bg-zinc-100 dark:bg-zinc-800', text: 'text-zinc-500 dark:text-zinc-400' }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        colors.bg,
        colors.text,
        className
      )}
    >
      {LEAD_STATUS_LABELS[status]}
    </span>
  )
}
