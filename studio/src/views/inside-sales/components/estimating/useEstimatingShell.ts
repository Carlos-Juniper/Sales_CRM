// ---------------------------------------------------------------------------
// Estimating shell context (Handoff 01) — the extension point feature tabs
// (Handoffs 02–13) use to talk to the shell:
//
//   const { openEstimate, setOpenEstimate, setActiveTab } = useEstimatingShell()
//
// e.g. the Estimate Queue (Handoff 02) opens an estimate and jumps to the
// editor with `setOpenEstimate(est); setActiveTab('editor')`. Tab visibility
// is derived from `openEstimate.estimateType` (see estimatingTabs.ts) — the
// shell resets to 'queue' if the active tab becomes invisible.
// ---------------------------------------------------------------------------

import { createContext, useContext } from 'react'
import type { Estimate } from '@/types/estimating'
import type { EstimatingTabKey } from './estimatingTabs'

export interface EstimatingShellApi {
  /** The currently rendered tab. */
  activeTab: EstimatingTabKey
  setActiveTab: (key: EstimatingTabKey) => void
  /** The estimate open in the workspace, or null (queue-level browsing). */
  openEstimate: Estimate | null
  setOpenEstimate: (estimate: Estimate | null) => void
}

export const EstimatingShellContext = createContext<EstimatingShellApi | null>(null)

export function useEstimatingShell(): EstimatingShellApi {
  const ctx = useContext(EstimatingShellContext)
  if (!ctx) {
    throw new Error('useEstimatingShell must be used within EstimatingPage')
  }
  return ctx
}
