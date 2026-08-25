// ---------------------------------------------------------------------------
// Estimating shell context — the extension point feature tabs
// use to talk to the shell:
//
//   const { openEstimate, setOpenEstimate, setActiveTab } = useEstimatingShell()
//
// The open estimate is a URL-driven, React Query-backed value (see
// hooks/useEstimate.ts + EstimatingPage.tsx) — NOT a detached local-state
// snapshot. That means it can never go stale relative to a mutation made
// elsewhere in the tree, and it survives navigating away and back (or a
// refresh) because it's keyed off `:estimateId` in the route.
//
//   • `setOpenEstimate(fresh)` — write an in-place update (save/mutation
//     result) for the estimate that's ALREADY open. Writes straight into the
//     query cache; no navigation.
//   • `openEstimateAt(estimate, tab)` — open a (possibly different, possibly
//     just-created) estimate and jump straight to one of its tabs. Navigates
//     the shell URL to `/inside-sales/estimating/:id/:tab`.
//
// Tab visibility is derived from `openEstimate.estimateType` (see
// estimatingTabs.ts) — the shell falls back to 'queue' if the active tab
// becomes invisible for the newly-open estimate's type.
// ---------------------------------------------------------------------------

import { createContext, useContext } from 'react'
import type { Estimate } from '@/types/estimating'
import type { EstimatingTabKey } from './estimatingTabs'

export interface EstimatingShellApi {
  /** The currently rendered tab. */
  activeTab: EstimatingTabKey
  setActiveTab: (key: EstimatingTabKey) => void
  /** The estimate open in the workspace (from the query cache), or null (queue-level browsing). */
  openEstimate: Estimate | null
  /** In-place update for the estimate that's already open — cache write only, no navigation. */
  setOpenEstimate: (estimate: Estimate | null) => void
  /** Open a (possibly different/just-created) estimate and jump to one of its tabs. */
  openEstimateAt: (estimate: Estimate, tab: EstimatingTabKey) => void
}

export const EstimatingShellContext = createContext<EstimatingShellApi | null>(null)

export function useEstimatingShell(): EstimatingShellApi {
  const ctx = useContext(EstimatingShellContext)
  if (!ctx) {
    throw new Error('useEstimatingShell must be used within EstimatingPage')
  }
  return ctx
}
