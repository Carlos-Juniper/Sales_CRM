import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Inbox, FileText, GitBranch,
  ChevronLeft, ChevronRight, LogOut, Leaf, Settings,
  Map, Calculator, Building, Calendar, Globe,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { useRole } from '@/hooks/useRole'
import { cn } from '@/lib/utils'
import { AssigneeAvatar } from '@/components/shared/AssigneeAvatar'
import type { User, UserRole } from '@/types'

interface NavItem {
  label: string
  icon: React.ElementType
  href: string
  badge?: number
  roles: UserRole[]
}

// Canonical roles. `admin` sees everything via canAccess.
const SALES_NAV: UserRole[] = ['sales', 'inside_sales', 'manager']
// The public/government feed is the inside-sales qualification queue; CRMs work
// their own assigned leads on the Leads tab instead.
const PUBLIC_LEADS_NAV: UserRole[] = ['inside_sales']
const ESTIMATING_NAV: UserRole[] = [
  'sales',
  'manager',
  'maintenance_estimating',
  'install_estimating',
  'regional_director',
  'vice_president',
  'ceo',
  'procurement',
]

const navItems: NavItem[] = [
  { label: 'Analytics', icon: LayoutDashboard, href: '/inside-sales', roles: SALES_NAV },
  { label: 'Public Leads', icon: Globe, href: '/inside-sales/leads', roles: PUBLIC_LEADS_NAV },
  { label: 'Leads', icon: Inbox, href: '/inside-sales/my-leads', roles: SALES_NAV },
  { label: 'Bid Tracker', icon: FileText, href: '/inside-sales/bids', roles: SALES_NAV },
  { label: 'Pipeline', icon: GitBranch, href: '/inside-sales/pipeline', roles: SALES_NAV },
  { label: 'Calendar', icon: Calendar, href: '/inside-sales/calendar', roles: SALES_NAV },
  { label: 'Accounts', icon: Building, href: '/inside-sales/accounts', roles: SALES_NAV },
  { label: 'Map View', icon: Map, href: '/inside-sales/map', roles: SALES_NAV },
  { label: 'Estimating', icon: Calculator, href: '/inside-sales/estimating', roles: ESTIMATING_NAV },
]

function NavItemComp({ item, collapsed, overdueBadge }: { item: NavItem; collapsed: boolean; overdueBadge?: number }) {
  const location = useLocation()
  const isActive = location.pathname === item.href || (item.href !== '/inside-sales' && location.pathname.startsWith(item.href))

  return (
    <NavLink
      to={item.href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sidebar-active-bg)]',
        isActive
          ? 'bg-[var(--sidebar-active-bg)] text-white'
          : 'text-[var(--sidebar-fg)] opacity-75 hover:opacity-100 hover:bg-[var(--sidebar-hover-bg)]'
      )}
      title={collapsed ? item.label : undefined}
    >
      <item.icon className={cn('flex-shrink-0', collapsed ? 'h-5 w-5' : 'h-4 w-4')} />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {overdueBadge != null && overdueBadge > 0 && (
            <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {overdueBadge > 99 ? '99+' : overdueBadge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const { collapsed, toggle, user, logout } = {
    collapsed: useUIStore((s) => s.sidebarCollapsed),
    toggle: useUIStore((s) => s.toggleSidebar),
    user: useAuthStore((s) => s.user),
    logout: useAuthStore((s) => s.logout),
  }
  const { role, canAccess } = useRole()

  const visibleItems = navItems.filter((item) => {
    if (!role) return false
    return canAccess(item.roles)
  })

  const user_ = user as User | null

  return (
    <aside
      className={cn(
        'flex flex-col h-full transition-all duration-200',
        'bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)]',
        collapsed ? 'w-14' : 'w-56'
      )}
    >
      {/* Logo + Collapse toggle */}
      <div className={cn('flex items-center gap-2 px-3 py-4 border-b border-[var(--sidebar-border)] flex-shrink-0', collapsed && 'justify-center')}>
        <div className="flex-shrink-0 h-7 w-7 rounded-lg bg-[#2E7D52] flex items-center justify-center">
          <Leaf className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--sidebar-fg)] truncate">Sales Studio</p>
            <p className="text-[10px] text-[var(--sidebar-fg)] opacity-50 truncate">Juniper Landscaping</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          className="flex-shrink-0 p-1 rounded text-[var(--sidebar-fg)] opacity-60 hover:opacity-100 hover:bg-[var(--sidebar-hover-bg)] transition-colors cursor-pointer"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {visibleItems.map((item) => (
          <NavItemComp key={item.href} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Bottom */}
      <div className="flex-shrink-0 border-t border-[var(--sidebar-border)] p-2 space-y-1">
        {/* Settings */}
        {!collapsed && (
          <NavLink
            to="/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[var(--sidebar-fg)] opacity-60 hover:opacity-100 hover:bg-[var(--sidebar-hover-bg)] transition-colors"
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </NavLink>
        )}

        {/* User profile */}
        {user_ && (
          <div className={cn('flex items-center gap-2 px-3 py-2', collapsed && 'justify-center')}>
            <AssigneeAvatar user={user_} size="sm" />
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--sidebar-fg)] truncate">{user_.name}</p>
                <p className="text-[10px] text-[var(--sidebar-fg)] opacity-50 capitalize truncate">{user_.role.replace('_', ' ')}</p>
              </div>
            )}
            {!collapsed && (
              <button
                type="button"
                onClick={logout}
                className="flex-shrink-0 p-1 rounded text-[var(--sidebar-fg)] opacity-50 hover:opacity-100 hover:text-red-400 transition-colors cursor-pointer"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
