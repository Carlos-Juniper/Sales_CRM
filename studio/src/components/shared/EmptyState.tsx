import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: LucideIcon
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({ title, description, icon: Icon = Inbox, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-6 text-center', className)}>
      <div className="rounded-full bg-[hsl(var(--muted))] p-4 mb-4">
        <Icon className="h-8 w-8 text-[hsl(var(--muted-fg))]" />
      </div>
      <h3 className="text-sm font-semibold text-[hsl(var(--fg))] mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-[hsl(var(--muted-fg))] max-w-xs">{description}</p>
      )}
      {action && (
        <Button size="sm" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
