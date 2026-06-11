import { daysUntil } from '@/lib/utils'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DeadlineChipProps {
  deadline: string | null
  className?: string
}

export function DeadlineChip({ deadline, className }: DeadlineChipProps) {
  if (!deadline) return null
  const days = daysUntil(deadline)

  const { bg, text, label } = (() => {
    if (days < 0) return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Overdue' }
    if (days === 0) return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Today' }
    if (days <= 7) return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: `${days}d left` }
    if (days <= 14) return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', label: `${days}d left` }
    return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: `${days}d left` }
  })()

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', bg, text, className)}>
      <Clock className="h-3 w-3" />
      {label}
    </span>
  )
}
