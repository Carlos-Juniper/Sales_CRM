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
        <div className="flex h-screen w-screen overflow-hidden bg-[hsl(var(--bg))]">
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-hidden">
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
