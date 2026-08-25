import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
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
import { MaterialsCalculator } from './components/estimating/MaterialsCalculator'
import { MaintenanceIntakeModal } from './components/estimating/MaintenanceIntakeModal'
// real CRM lead context (replaces the L-TBD stub)
import { crmLeadFromLead } from '@/lib/estimating/crmLead'
import { InstallIntakeModal } from './components/estimating/InstallIntakeModal'
import { ItbTracker } from './components/estimating/ItbTracker'
// config-table read APIs (itb_scopes et al.), literals as fallback
import { useEstimatingConfig } from '@/hooks/useEstimatingConfig'
// ITB projects + scope statuses from the API (auto-generated per estimate)
import { useItbProjects } from '@/hooks/useItbProjects'
import { ESTIMATES_KEY, useEstimate } from '@/hooks/useEstimate'
import type { Estimate, Property } from '@/types/estimating'
import type { Lead } from '@/types'
import { cn } from '@/lib/utils'

interface EstimatingPageProps {
  /**
   * Test-only seam: seeds the query cache with this estimate on first render
   * so a bare `<EstimatingPage initialOpenEstimate={...} />` (rendered with no
   * router match, i.e. no `:estimateId` in the URL) still opens with it. Real
   * navigation always drives the open estimate from the URL — this prop is
   * never read again after the initial seed.
   */
  initialOpenEstimate?: Estimate | null
}

/**
 * Estimating shell: header, config-driven tab bar, shared toast,
 * and the host that mounts each feature tab. The app sidebar is rendered by
 * `AppShell` (components/layout) — not duplicated here.
 *
 * Feature tabs plug in by swapping their tab's `TabPlaceholder` branch in
 * `renderTab()` below for the real component (tab slots are registered in
 * estimatingTabs.ts).
 */
export default function EstimatingPage({
  initialOpenEstimate = null,
}: EstimatingPageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { estimateId: routeEstimateId, tab: routeTab } = useParams<{
    estimateId?: string
    tab?: string
  }>()

  // Test-only seam (see EstimatingPageProps.initialOpenEstimate doc): seed the
  // cache once, synchronously, so a direct render with no route match still
  // opens with it. Real navigation always supplies `:estimateId` instead.
  const [seededEstimateId] = useState<string | null>(() => {
    if (initialOpenEstimate) {
      queryClient.setQueryData([ESTIMATES_KEY, initialOpenEstimate.id], initialOpenEstimate)
      return initialOpenEstimate.id
    }
    return null
  })

  const estimateId = routeEstimateId ?? seededEstimateId
  // The ONE source of truth for the open estimate — React Query cache, keyed
  // by the URL id. Never a detached local-state snapshot (see
  // useEstimatingShell.ts for why that used to go stale).
  const { data: openEstimate = null } = useEstimate(estimateId)

  // API-fetched config; config.ts seeds only as offline fallback.
  const { itbScopes } = useEstimatingConfig()
  // Real ITB data: one auto-generated project per active estimate.
  const { projects: itbProjects, statuses: itbStatuses } = useItbProjects()

  // "Request estimate" from the property/Accounts UI navigates
  // here with the canonical property AND its lead in router state; the
  // maintenance intake modal opens pre-filled with both. The action is gated on
  // a lead existing, so property arrivals always carry one.
  const location = useLocation()
  const navState = location.state as {
    requestEstimateProperty?: Property
    requestEstimateLead?: Lead
  } | null
  const incomingProperty = navState?.requestEstimateProperty ?? null
  const incomingLead = navState?.requestEstimateLead ?? null
  // REAL CRM lead context (the L-TBD stub is gone). Null when the
  // intake is opened from the queue CTA; the modal then sources the lead from
  // leads.property_id once a property is selected.
  const incomingCrmLead = incomingLead ? crmLeadFromLead(incomingLead) : null

  const [maintIntakeOpen, setMaintIntakeOpen] = useState(incomingProperty != null)
  const [installIntakeOpen, setInstallIntakeOpen] = useState(false)
  // Queue refresh key: bump after successful intake to trigger re-fetch.
  const [queueKey, setQueueKey] = useState(0)

  const tabs = visibleTabs(openEstimate?.estimateType ?? null)
  const requestedTab = (routeTab as EstimatingTabKey | undefined) ?? 'queue'
  // If the open estimate's type hides the requested tab, fall back to the queue.
  const currentTab: EstimatingTabKey = tabs.some((t) => t.key === requestedTab)
    ? requestedTab
    : 'queue'

  function estimateUrl(id: string, tab: EstimatingTabKey): string {
    return `/inside-sales/estimating/${id}/${tab}`
  }

  /** Tab-bar clicks and feature tabs both drive the tab through the URL. */
  function setActiveTab(tab: EstimatingTabKey) {
    navigate(estimateId ? estimateUrl(estimateId, tab) : '/inside-sales/estimating')
  }

  /**
   * In-place update for the estimate that's ALREADY open (post-save/mutation
   * result) — writes straight into the query cache, no navigation. Passing
   * `null` closes the workspace back to the queue.
   */
  function setOpenEstimate(estimate: Estimate | null) {
    if (!estimate) {
      navigate('/inside-sales/estimating')
      return
    }
    queryClient.setQueryData([ESTIMATES_KEY, estimate.id], estimate)
    // The detail cache above already has the fresh data (no wasted refetch);
    // only the separate list query needs to know it might be stale.
    queryClient.invalidateQueries({ queryKey: [ESTIMATES_KEY, 'list'] })
  }

  /** Open a (possibly different/just-created) estimate and jump to one of its tabs. */
  function openEstimateAt(estimate: Estimate, tab: EstimatingTabKey) {
    queryClient.setQueryData([ESTIMATES_KEY, estimate.id], estimate)
    queryClient.invalidateQueries({ queryKey: [ESTIMATES_KEY, 'list'] })
    navigate(estimateUrl(estimate.id, tab))
  }

  const shell: EstimatingShellApi = useMemo(
    () => ({ activeTab: currentTab, setActiveTab, openEstimate, setOpenEstimate, openEstimateAt }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTab, openEstimate, estimateId],
  )

  function renderTab(tab: EstimatingTabConfig) {
    switch (tab.key) {
      case 'queue':
        // Opens estimates via the shell (setOpenEstimate + editor tab).
        // onMaintenanceIntake opens the Maintenance Intake Modal.
        // onInstallIntake handled elsewhere (do not touch here).
        return (
          <EstimateQueue
            key={queueKey}
            onMaintenanceIntake={() => setMaintIntakeOpen(true)}
            onInstallIntake={() => setInstallIntakeOpen(true)}
          />
        )
      case 'editor':
        // Engine keyed automatically off openEstimate.estimateType.
        return <LineItemEditor />
      case 'margins':
        // Reads the open estimate from the shell context.
        return <MarginAnalysis />
      case 'takeoff':
        return <TakeoffInsert />
      case 'discrepancy':
        return <DiscrepancyFlag />
      case 'approval':
        return <ApprovalHandoff />
      case 'approvalQueue':
        // Approver inbox + review drawer (config-tier routing).
        return <ApprovalQueue />
      case 'materials':
        // Materials Calculator (install-only).
        return <MaterialsCalculator />
      case 'itb':
        // ITB Tracker. Scopes from the config API (admin-extensible
        // without migration); projects + scope statuses from the ITB
        // endpoints (auto-generated, all active estimates).
        return <ItbTracker projects={itbProjects} scopes={itbScopes} statuses={itbStatuses} />
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

        {/* Maintenance Intake Modal (mounted outside tab content so it
            survives tab switches; controlled by queue's CTA via onMaintenanceIntake) */}
        <MaintenanceIntakeModal
          open={maintIntakeOpen}
          onClose={() => setMaintIntakeOpen(false)}
          crmLead={incomingCrmLead}
          onCreated={() => setQueueKey((k) => k + 1)}
          initialProperty={incomingProperty}
        />

        {/* Install Intake Modal (Sales-authored; controlled by queue's
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
