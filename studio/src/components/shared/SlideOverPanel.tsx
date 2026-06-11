import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SlideOverPanelProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  width?: 'sm' | 'md' | 'lg'
}

const widthMap = {
  sm: 'w-full sm:max-w-md',
  md: 'w-full sm:max-w-xl',
  lg: 'w-full sm:max-w-2xl',
}

export function SlideOverPanel({ isOpen, onClose, title, children, width = 'md' }: SlideOverPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) panelRef.current?.focus()
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[1200] flex justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative flex flex-col h-full bg-[hsl(var(--card))] border-l border-[hsl(var(--border))] shadow-2xl slide-in-right overflow-hidden',
          widthMap[width]
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))] flex-shrink-0">
          {title && <h2 className="text-base font-semibold text-[hsl(var(--fg))] truncate pr-4">{title}</h2>}
          <button
            onClick={onClose}
            className="ml-auto flex-shrink-0 rounded-md p-1 text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E7D52] cursor-pointer"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
