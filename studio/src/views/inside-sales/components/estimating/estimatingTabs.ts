// ---------------------------------------------------------------------------
// Estimating tab registry (Handoff 01).
//
// The tab bar is CONFIG-DRIVEN: every Estimating workspace registers here as a
// data row (key, label, icon, visibleForTypes) — never as hardcoded JSX in the
// page. Later handoffs plug their feature component into the matching slot in
// EstimatingPage's tab-content switch; this file should only change to add or
// re-order tabs.
//
// Per-`estimateType` visibility (Handoff 01 §1, open item confirmed defaults):
//   - Takeoff Insert is maintenance-only.
//   - Materials Calculator + Discrepancy Review are install-only.
//   - Everything else is visible for both types.
// When NO estimate is open, all tabs render.
// ---------------------------------------------------------------------------

import {
  BarChart2,
  Calculator,
  ClipboardList,
  Image,
  ListChecks,
  Ruler,
  ShieldCheck,
  Table2,
  TriangleAlert,
} from 'lucide-react'
import type { EstimateType } from '@/types/estimating'

export type EstimatingTabKey =
  | 'queue' // Handoff 02 — Estimate Queue
  | 'editor' // Handoffs 03/04 — Line-Item Editor (auto by estimateType)
  | 'takeoff' // Handoff 10 — Takeoff Insert (maintenance)
  | 'materials' // Handoff 05 — Materials Calculator (install)
  | 'margins' // Handoff 07 — Margin Analysis
  | 'discrepancy' // Handoff 06 — Discrepancy Review (install)
  | 'approval' // Handoff 08 — Approval & Handoff
  | 'approvalQueue' // Handoff 09 — Approval Queue & Review Drawer
  | 'itb' // Handoff 13 — ITB Tracker

export interface EstimatingTabConfig {
  key: EstimatingTabKey
  label: string
  /** Compact label for narrow viewports. */
  shortLabel: string
  icon: React.ElementType
  /** Which open-estimate types this tab applies to. */
  visibleForTypes: EstimateType[]
}

const BOTH: EstimateType[] = ['maintenance', 'install']

export const ESTIMATING_TABS: EstimatingTabConfig[] = [
  { key: 'queue', label: 'Estimate Queue', shortLabel: 'Queue', icon: ClipboardList, visibleForTypes: BOTH },
  { key: 'editor', label: 'Line-Item Editor', shortLabel: 'Editor', icon: Calculator, visibleForTypes: BOTH },
  { key: 'takeoff', label: 'Takeoff Insert', shortLabel: 'Takeoff', icon: Image, visibleForTypes: ['maintenance'] },
  { key: 'materials', label: 'Materials Calculator', shortLabel: 'Materials', icon: Ruler, visibleForTypes: ['install'] },
  { key: 'margins', label: 'Margin Analysis', shortLabel: 'Margins', icon: BarChart2, visibleForTypes: BOTH },
  { key: 'discrepancy', label: 'Discrepancy Review', shortLabel: 'Discrepancy', icon: TriangleAlert, visibleForTypes: ['install'] },
  { key: 'approval', label: 'Approval & Handoff', shortLabel: 'Approval', icon: ShieldCheck, visibleForTypes: BOTH },
  { key: 'approvalQueue', label: 'Approval Queue', shortLabel: 'Appr. Queue', icon: ListChecks, visibleForTypes: BOTH },
  { key: 'itb', label: 'ITB Tracker', shortLabel: 'ITB', icon: Table2, visibleForTypes: BOTH },
]

/**
 * The tab set for the current shell state. `null` means no estimate is open —
 * every tab renders. With an open estimate, only type-appropriate tabs render.
 */
export function visibleTabs(openType: EstimateType | null): EstimatingTabConfig[] {
  if (openType === null) return ESTIMATING_TABS
  return ESTIMATING_TABS.filter((t) => t.visibleForTypes.includes(openType))
}
