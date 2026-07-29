// ---------------------------------------------------------------------------
// Line-Item Editor (Handoffs 03/04) — the engine dispatcher.
//
// HARD REQUIREMENT (product owner): there is NO manual Maintenance/Install
// mode toggle — no switch, no tab, no dropdown, ever. The engine is chosen
// implicitly from the open estimate's immutable `estimateType`:
//
//   'maintenance' → <MaintenanceEditor>  (Handoff 03 — hours-driven, sections)
//   'install'     → <InstallEditor>      (Handoff 04 — quantity-driven kits)
// ---------------------------------------------------------------------------

import { Calculator } from 'lucide-react'
import { useEstimatingShell } from './useEstimatingShell'
import { MaintenanceEditor } from './MaintenanceEditor'
import { InstallEditor } from './InstallEditor'

/**
 * Mounted by EstimatingPage's `case 'editor':`. Reads the open estimate from
 * the shell; with none open it renders a graceful empty state.
 */
export function LineItemEditor() {
  const { openEstimate } = useEstimatingShell()

  if (!openEstimate) {
    return (
      <div
        data-testid="editor-empty"
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-6 py-16 text-center"
      >
        <Calculator className="h-8 w-8 text-[hsl(var(--muted-fg))]" />
        <p className="m-0 text-sm font-medium text-[hsl(var(--fg))]">No estimate open</p>
        <p className="m-0 text-xs text-[hsl(var(--muted-fg))]">
          Open an estimate from the Estimate Queue to start editing line items.
        </p>
      </div>
    )
  }

  // Engine selection is implicit and exhaustive — keyed off the immutable
  // discriminant, never a UI mode.
  switch (openEstimate.estimateType) {
    case 'maintenance':
      // key: reset draft state when a different estimate is opened.
      return <MaintenanceEditor key={openEstimate.id} estimate={openEstimate} />
    case 'install':
      // key: reset draft state when a different estimate is opened.
      return <InstallEditor key={openEstimate.id} estimate={openEstimate} />
  }
}
