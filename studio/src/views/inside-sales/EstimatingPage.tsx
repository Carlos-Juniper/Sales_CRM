import { useMemo, useState } from 'react'
import { TopNav } from '@/components/layout/TopNav'
import { EstimateQueue } from './components/estimating/EstimateQueue'
import { LineItemEditor } from './components/estimating/LineItemEditor'
import { MarginAnalysis } from './components/estimating/MarginAnalysis'
import { TabPlaceholder } from './components/estimating/TabPlaceholder'
import { TakeoffInsert } from './components/estimating/TakeoffInsert'
import { DiscrepancyFlag } from './components/estimating/DiscrepancyFlag'
import { ApprovalHandoff } from './components/estimating/ApprovalHandoff'
import { ApprovalQueue } from './components/estimating/ApprovalQueue'
import { EstimatingToastProvider } from './components/estimating/EstimatingToast'
import { EstimatingShellContext, type EstimatingShellApi } from './components/estimating/useEstimatingShell'
import {
  ESTIMATING_TABS,
  visibleTabs,
  type EstimatingTabConfig,
  type EstimatingTabKey,
} from './components/estimating/estimatingTabs'
// Handoff 05 — Materials Calculator
import { MaterialsCalculator } from './components/estimating/MaterialsCalculator'
// Handoff 11 — Maintenance Intake Modal
import {
  MaintenanceIntakeModal,
  type CrmLeadContext,
} from './components/estimating/MaintenanceIntakeModal'
// Handoff 12 — Install Intake Modal
import { InstallIntakeModal } from './components/estimating/InstallIntakeModal'
// Handoff 13 — ITB Tracker
import { ItbTracker } from './components/estimating/ItbTracker'
import { ITB_SCOPE_SEED } from '@/lib/estimating/config'
import type { Estimate } from '@/types/estimating'
import { cn } from '@/lib/utils'

interface EstimatingPageProps {
  /**
   * Seam for tests/deep-links. At runtime the open estimate is set by feature
   * tabs through `useEstimatingShell().setOpenEstimate` (Handoff 02's queue).
   */
  initialOpenEstimate?: Estimate | null
}

/**
 * Estimating shell (Handoff 01): header, config-driven tab bar, shared toast,
 * and the host that mounts each feature tab. The app sidebar is rendered by
 * `AppShell` (components/layout) — not duplicated here.
 *
 * Handoffs 02–13 plug in by swapping their tab's `TabPlaceholder` branch in
 * `renderTab()` below for the real component (tab slots are registered in
 * estimatingTabs.ts).
 */
export default function EstimatingPage({
  initialOpenEstimate = null,
}: EstimatingPageProps) {
  const [activeTab, setActiveTab] = useState<EstimatingTabKey>('queue')
  const [openEstimate, setOpenEstimate] = useState<Estimate | null>(initialOpenEstimate)

  // Handoff 11 — Maintenance Intake Modal state
  const [maintIntakeOpen, setMaintIntakeOpen] = useState(false)
  // Handoff 12 — Install Intake Modal state
  const [installIntakeOpen, setInstallIntakeOpen] = useState(false)
  // Queue refresh key: bump after successful intake to trigger re-fetch.
  const [queueKey, setQueueKey] = useState(0)
  // Stub CRM lead context — in production this would come from the selected pipeline lead.
  const stubCrmLead: CrmLeadContext = {
    leadNumber: 'L-TBD',
    rep: 'Sales Rep',
    winProbability: 0.5,
  }

  const tabs = visibleTabs(openEstimate?.estimateType ?? null)
  // If the open estimate's type hides the active tab, fall back to the queue.
  const currentTab: EstimatingTabKey = tabs.some((t) => t.key === activeTab)
    ? activeTab
    : 'queue'

  const shell: EstimatingShellApi = useMemo(
    () => ({ activeTab: currentTab, setActiveTab, openEstimate, setOpenEstimate }),
    [currentTab, openEstimate],
  )

  function renderTab(tab: EstimatingTabConfig) {
    switch (tab.key) {
      case 'queue':
        // Handoff 02 — opens estimates via the shell (setOpenEstimate + editor tab).
        // Handoff 11: onMaintenanceIntake opens the Maintenance Intake Modal.
        // Handoff 12: onInstallIntake handled by that handoff (do not touch here).
        return (
          <EstimateQueue
            key={queueKey}
            onMaintenanceIntake={() => setMaintIntakeOpen(true)}
            onInstallIntake={() => setInstallIntakeOpen(true)}
          />
        )
      case 'editor':
        // Handoffs 03/04 — engine keyed automatically off openEstimate.estimateType.
        return <LineItemEditor />
      case 'margins':
        // Handoff 07 — reads the open estimate from the shell context.
        return <MarginAnalysis />
      case 'takeoff':
        return <TakeoffInsert />
      case 'discrepancy':
        return <DiscrepancyFlag />
      case 'approval':
        return <ApprovalHandoff />
      case 'approvalQueue':
        // Handoff 09 — approver inbox + review drawer (config-tier routing).
        return <ApprovalQueue />
      case 'materials':
        // Handoff 05 — Materials Calculator (install-only).
        return <MaterialsCalculator />
      case 'itb':
        // Handoff 13 — ITB Tracker. Scopes from config (admin-extensible without migration).
        // TODO(api): replace empty arrays with real API calls once ITB endpoints land.
        return <ItbTracker projects={[]} scopes={ITB_SCOPE_SEED} statuses={[]} />
      default:
        return <TabPlaceholder tab={tab} />
    }
  }

  const activeConfig = ESTIMATING_TABS.find((t) => t.key === currentTab)!

  return (
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider value={shell}>
        <div className="flex flex-col h-full overflow-hidden">
          <TopNav
            title="Estimating"
            subtitle="Intake-driven · manual takeoff · hours-driven kits · value-tiered approval"
          />

          {/* Tab bar — config-driven, scrollable on mobile */}
          <div className="flex-shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg))] overflow-x-auto">
            <div role="tablist" aria-label="Estimating workspaces" className="flex min-w-max px-2">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const active = currentTab === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={tab.label}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer',
                      active
                        ? 'border-[#2E7D52] text-[#2E7D52]'
                        : 'border-transparent text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] hover:border-[hsl(var(--border))]',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">{renderTab(activeConfig)}</div>
        </div>

        {/* Handoff 11 — Maintenance Intake Modal (mounted outside tab content so it
            survives tab switches; controlled by queue's CTA via onMaintenanceIntake) */}
        <MaintenanceIntakeModal
          open={maintIntakeOpen}
          onClose={() => setMaintIntakeOpen(false)}
          crmLead={stubCrmLead}
          onCreated={() => setQueueKey((k) => k + 1)}
        />

        {/* Handoff 12 — Install Intake Modal (Sales-authored; controlled by queue's
            CTA via onInstallIntake; survives tab switches by mounting outside tab content) */}
        <InstallIntakeModal
          open={installIntakeOpen}
          onClose={() => setInstallIntakeOpen(false)}
          onCreated={() => setQueueKey((k) => k + 1)}
        />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>
  )
}
