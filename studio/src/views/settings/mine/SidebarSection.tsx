import { useUIStore } from '@/store/uiStore'

export function SidebarSection() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed)

  return (
    <div data-testid="settings-section-sidebar" className="space-y-4 max-w-sm">
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg)] mb-1">Sidebar</h2>
        <p className="text-xs text-[var(--fg)] opacity-60">
          Control the default state of the navigation sidebar.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <input
          id="mine-sidebar-collapsed"
          type="checkbox"
          checked={sidebarCollapsed}
          onChange={(e) => setSidebarCollapsed(e.target.checked)}
          className="h-4 w-4 rounded border-[var(--border)]"
          aria-label="Collapse sidebar"
        />
        <label
          htmlFor="mine-sidebar-collapsed"
          className="text-sm text-[var(--fg)] cursor-pointer"
        >
          Collapse sidebar by default
        </label>
      </div>
    </div>
  )
}
