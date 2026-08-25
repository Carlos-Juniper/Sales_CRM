// ---------------------------------------------------------------------------
// The ONE shared Estimating toast hook (Handoff 01 / shared conventions).
// Every Estimating feature calls `useToast().show(message)` — do NOT
// reimplement toasts per feature. The provider lives in EstimatingToast.tsx
// and is mounted once by EstimatingPage.
// ---------------------------------------------------------------------------

import { createContext, useContext } from 'react'

export interface EstimatingToastApi {
  /** Show a bottom-center confirmation toast; auto-dismisses after ~2.6s. */
  show: (message: string) => void
}

export const EstimatingToastContext = createContext<EstimatingToastApi | null>(null)

export function useToast(): EstimatingToastApi {
  const ctx = useContext(EstimatingToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within an <EstimatingToastProvider>')
  }
  return ctx
}
