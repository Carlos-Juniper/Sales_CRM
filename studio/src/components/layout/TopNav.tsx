import type React from 'react'
import { Bell, Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useInsideSalesDashboard } from '@/hooks/useBids'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface TopNavProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function TopNav({ title, subtitle, actions }: TopNavProps) {
  const { theme, setTheme } = useTheme()
  const { data: summary } = useInsideSalesDashboard()
  const overdueCount = summary?.overdue_follow_ups ?? 0

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  return (
    <header className="h-12 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] flex items-center px-4 gap-3 flex-shrink-0">
      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-semibold text-[hsl(var(--fg))] truncate">{title}</h1>
        {subtitle && <p className="text-xs text-[hsl(var(--muted-fg))] truncate">{subtitle}</p>}
      </div>

      {actions && <div className="flex-shrink-0">{actions}</div>}

      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Toggle theme">
              <ThemeIcon className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme('light')}>
              <Sun className="h-4 w-4 mr-2" /> Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>
              <Moon className="h-4 w-4 mr-2" /> Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>
              <Monitor className="h-4 w-4 mr-2" /> System
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications">
          <Bell className="h-3.5 w-3.5" />
          {overdueCount > 0 && (
            <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-red-500" />
          )}
        </Button>
      </div>
    </header>
  )
}
