import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ToastProvider, ToastViewport, Toast } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useUIStore } from '@/store/uiStore'
import { useTheme } from '@/hooks/useTheme'

export function AppShell() {
  useTheme()
  const toasts = useUIStore((s) => s.toasts)
  const dismissToast = useUIStore((s) => s.dismissToast)

  return (
    <TooltipProvider delayDuration={400}>
      <ToastProvider swipeDirection="right">
        {/* data-app-shell / data-app-shell-main are print hooks: the fixed
            h-screen + overflow-hidden chain clips print output to one page, so
            ProposalPreview's print CSS unclips these two nodes. */}
        <div data-app-shell className="flex h-screen w-screen overflow-hidden bg-[hsl(var(--bg))]">
          <Sidebar />
          <main data-app-shell-main className="flex-1 flex flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>

        {toasts.map((t) => (
          <Toast
            key={t.id}
            open={t.open}
            onOpenChange={(open) => { if (!open) dismissToast(t.id) }}
            variant={t.variant}
            title={t.title}
            description={t.description}
          />
        ))}
        <ToastViewport />
      </ToastProvider>
    </TooltipProvider>
  )
}
