// ---------------------------------------------------------------------------
// Estimating tab registry.
//
// The tab bar is CONFIG-DRIVEN: every Estimating workspace registers here as a
// data row (key, label, icon, visibleForTypes) — never as hardcoded JSX in the
// page. Each feature component plugs into the matching slot in
// EstimatingPage's tab-content switch; this file should only change to add or
// re-order tabs.
//
// Per-`estimateType` visibility (open item confirmed defaults):
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
  | 'queue' // Estimate Queue
  | 'editor' // Line-Item Editor (auto by estimateType)
  | 'takeoff' // Takeoff Insert (maintenance)
  | 'materials' // Materials Calculator (install)
  | 'margins' // Margin Analysis
  | 'discrepancy' // Discrepancy Review (install)
  | 'approval' // Approval & Handoff
  | 'approvalQueue' // Approval Queue & Review Drawer
  | 'itb' // ITB Tracker

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
