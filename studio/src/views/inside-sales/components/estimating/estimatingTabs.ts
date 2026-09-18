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
import type { UserRole } from '@/types'
import { ESTIMATOR_ROLES, ESTIMATING_NAV_ROLES } from '@/lib/roles'

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
  /**
   * Which roles may see this tab (Handoff 50 §2). Stays config-driven: the
   * role gate is a data field on the row, NOT an `if (role === …)` branch in
   * visibleTabs(). `sales` sees only the estimate queue (plus the intake-form
   * modals, which are launched FROM the queue and are not tabs); every
   * estimating persona — the two estimator roles and the manager-tier
   * approvers, plus `admin` — sees every tab. Server-side authz is the real
   * boundary (api/authz.py require_estimate_viewer / require_estimator); this
   * only shapes the tab bar.
   */
  visibleForRoles: readonly UserRole[]
}

const BOTH: EstimateType[] = ['maintenance', 'install']

// The estimating personas: both estimator disciplines plus the manager-tier
// approvers who may also edit (Handoff 28), and admin. Reuses the canonical
// ESTIMATOR_ROLES from lib/roles.ts (mirrors the backend LINE_ITEM_EDIT_ROLES
// set that gates the estimate-detail surface).
const ESTIMATING_ROLES = ESTIMATOR_ROLES

// Everyone who can reach the Estimating page (ESTIMATING_NAV_ROLES) sees at
// least the queue. This structurally eliminates the empty-tabs fallback bug:
// no role in ESTIMATING_NAV_ROLES can ever get zero visible tabs.
const QUEUE_ROLES = ESTIMATING_NAV_ROLES

export const ESTIMATING_TABS: EstimatingTabConfig[] = [
  { key: 'queue', label: 'Estimate Queue', shortLabel: 'Queue', icon: ClipboardList, visibleForTypes: BOTH, visibleForRoles: QUEUE_ROLES },
  { key: 'editor', label: 'Line-Item Editor', shortLabel: 'Editor', icon: Calculator, visibleForTypes: BOTH, visibleForRoles: ESTIMATING_ROLES },
  { key: 'takeoff', label: 'Takeoff Insert', shortLabel: 'Takeoff', icon: Image, visibleForTypes: ['maintenance'], visibleForRoles: ESTIMATING_ROLES },
  { key: 'materials', label: 'Materials Calculator', shortLabel: 'Materials', icon: Ruler, visibleForTypes: ['install'], visibleForRoles: ESTIMATING_ROLES },
  { key: 'margins', label: 'Margin Analysis', shortLabel: 'Margins', icon: BarChart2, visibleForTypes: BOTH, visibleForRoles: ESTIMATING_ROLES },
  { key: 'discrepancy', label: 'Discrepancy Review', shortLabel: 'Discrepancy', icon: TriangleAlert, visibleForTypes: ['install'], visibleForRoles: ESTIMATING_ROLES },
  { key: 'approval', label: 'Approval & Handoff', shortLabel: 'Approval', icon: ShieldCheck, visibleForTypes: BOTH, visibleForRoles: ESTIMATING_ROLES },
  { key: 'approvalQueue', label: 'Approval Queue', shortLabel: 'Appr. Queue', icon: ListChecks, visibleForTypes: BOTH, visibleForRoles: ESTIMATING_ROLES },
  { key: 'itb', label: 'ITB Tracker', shortLabel: 'ITB', icon: Table2, visibleForTypes: BOTH, visibleForRoles: ESTIMATING_ROLES },
]

/**
 * The tab set for the current shell state, filtered by BOTH the open estimate's
 * type and the current user's role (Handoff 50 §2). `null` type means no
 * estimate is open — every type-appropriate tab is a candidate; the role gate
 * still applies (a sales user with no estimate open still sees only the queue).
 *
 * PURE function over config: it reads `visibleForTypes` and `visibleForRoles`
 * off each row and never special-cases a role by name.
 */
export function visibleTabs(
  openType: EstimateType | null,
  role: UserRole | null,
): EstimatingTabConfig[] {
  return ESTIMATING_TABS.filter((t) => {
    const typeOk = openType === null || t.visibleForTypes.includes(openType)
    const roleOk = role !== null && t.visibleForRoles.includes(role)
    return typeOk && roleOk
  })
}
