import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TeamToggleProps {
  showAll: boolean
  onToggle: (next: boolean) => void
  className?: string
}

/**
 * Checkbox toggle that lets managers and admins switch between viewing their
 * own assigned work and all of their team's data. Only render for roles where
 * isTeamManager(user.role) is true — this component has no role gate itself.
 */
export function TeamToggle({ showAll, onToggle, className }: TeamToggleProps) {
  return (
    <label
      className={cn(
        'flex items-center gap-1.5 cursor-pointer select-none text-xs text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] transition-colors',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={showAll}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-[hsl(var(--border))] accent-[#2E7D52] cursor-pointer"
      />
      <Users className="h-3 w-3" />
      All team
    </label>
  )
}
