import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

const ToastProvider = ToastPrimitive.Provider
const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn('fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:max-w-[380px]', className)}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitive.Viewport.displayName

type ToastVariant = 'default' | 'success' | 'error' | 'info'

const toastVariantStyles: Record<ToastVariant, string> = {
  default: 'border-[hsl(var(--border))] bg-[hsl(var(--card))]',
  success: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
  error: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950',
  info: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950',
}

interface ToastProps extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  variant?: ToastVariant
  title?: string
  description?: string
}

const Toast = React.forwardRef<React.ElementRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, variant = 'default', title, description, children, ...props }, ref) => {
    const Icon = variant === 'success' ? CheckCircle2 : variant === 'error' ? AlertCircle : Info
    const iconColor = variant === 'success' ? 'text-green-600' : variant === 'error' ? 'text-red-600' : 'text-blue-600'

    return (
      <ToastPrimitive.Root
        ref={ref}
        className={cn(
          'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-4 shadow-lg transition-all',
          'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-bottom-full',
          toastVariantStyles[variant],
          className
        )}
        {...props}
      >
        {variant !== 'default' && <Icon className={cn('h-4 w-4 mt-0.5 flex-shrink-0', iconColor)} />}
        <div className="flex-1 min-w-0">
          {title && <ToastPrimitive.Title className="text-sm font-medium text-[hsl(var(--fg))]">{title}</ToastPrimitive.Title>}
          {description && <ToastPrimitive.Description className="text-xs text-[hsl(var(--muted-fg))] mt-0.5">{description}</ToastPrimitive.Description>}
          {children}
        </div>
        <ToastPrimitive.Close className="flex-shrink-0 opacity-50 hover:opacity-100 cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Root>
    )
  }
)
Toast.displayName = 'Toast'

export { ToastProvider, ToastViewport, Toast }
export type { ToastVariant }
