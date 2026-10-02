import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ToastProvider, ToastViewport, Toast } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useUIStore } from '@/store/uiStore'
import { useTheme } from '@/hooks/useTheme'

export function AppShell() {
  useTheme()
  const toasts = useUIStore((s) => s.toasts)
  const dismissToast = useUIStore((s) => s.dismissToast)
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen)
  const location = useLocation()

  // Close the mobile drawer whenever the user navigates
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  return (
    <TooltipProvider delayDuration={400}>
      <ToastProvider swipeDirection="right">
        {/* data-app-shell / data-app-shell-main are print hooks: the fixed
            h-screen + overflow-hidden chain clips print output to one page, so
            ProposalPreview's print CSS unclips these two nodes. */}
        <div data-app-shell className="flex h-screen w-screen overflow-hidden bg-[hsl(var(--bg))]">
          {/* Static sidebar — hidden on mobile, replaced by the Sheet drawer below */}
          <div className="max-md:hidden h-full flex-shrink-0">
            <Sidebar />
          </div>
          <main data-app-shell-main className="flex-1 flex flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>

        {/* Mobile nav drawer */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent>
            <Sidebar inDrawer />
          </SheetContent>
        </Sheet>

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
