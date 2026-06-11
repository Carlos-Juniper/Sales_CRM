import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { User } from '@/types'

interface AssigneeAvatarProps {
  user: User | null | undefined
  size?: 'sm' | 'md'
  unassignedLabel?: string
}

const colors = [
  'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500',
  'bg-teal-500', 'bg-orange-500', 'bg-cyan-500',
]

function hashColor(name: string) {
  let hash = 0
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export function AssigneeAvatar({ user, size = 'md', unassignedLabel = 'Unassigned' }: AssigneeAvatarProps) {
  const sizeClass = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs'

  if (!user) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('rounded-full border-2 border-dashed border-[hsl(var(--border))] flex items-center justify-center text-[hsl(var(--muted-fg))]', sizeClass)}>
            ?
          </div>
        </TooltipTrigger>
        <TooltipContent>{unassignedLabel}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('rounded-full flex items-center justify-center text-white font-semibold cursor-default flex-shrink-0', hashColor(user.name), sizeClass)}>
          {user.avatar_initials}
        </div>
      </TooltipTrigger>
      <TooltipContent>{user.name}</TooltipContent>
    </Tooltip>
  )
}
