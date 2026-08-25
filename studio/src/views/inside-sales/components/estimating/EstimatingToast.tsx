import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { EstimatingToastContext } from './useToast'

/** Design spec: auto-dismiss ~2.6s (Estimating - Combined `flashToast`). */
export const TOAST_DURATION_MS = 2600

/**
 * The single shared Estimating toast: bottom-center dark pill
 * with a green check, auto-dismissing after ~2.6s. Mounted once by
 * EstimatingPage; features trigger it via `useToast().show(message)`.
 */
export function EstimatingToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current)
    setMessage(msg)
    timer.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const value = useMemo(() => ({ show }), [show])

  return (
    <EstimatingToastContext.Provider value={value}>
      {children}
      {message !== null && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-[10px] bg-[hsl(var(--fg))] px-4 py-[11px] text-[13px] text-[hsl(var(--card))] shadow-2xl"
        >
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-400" />
          {message}
        </div>
      )}
    </EstimatingToastContext.Provider>
  )
}
