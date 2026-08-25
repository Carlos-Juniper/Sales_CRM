// ---------------------------------------------------------------------------
// MaintenanceEditor — the hours-driven, section-based engine of
// the Line-Item Editor. Rendered automatically when the open estimate's
// `estimateType === 'maintenance'` (see LineItemEditor.tsx); never toggled.
//
// Principles wired in here:
//   • Hours vs price: complexity adjusts HOURS; margin is the commercial
//     lever. Nothing here nudges hours to hit a number.
//   • All math via lib/estimating/calc; approval tier via the config table.
//   • Bidding↔Won persists via estimatingApi.setLifecycle — the server flips
//     Aspire ownership (aspireOwnerFor derivation) and writes the audit record.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react'
import { Info, Plus, RotateCcw, Save, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { estimatingApi, type UpdateEstimatePayload } from '@/api/estimating'
import { ApiError } from '@/api/client'
import type { EstimateLifecycle, MaintenanceEstimate, SectionService } from '@/types/estimating'
import { LostTransition } from './LostTransition'
import { acresFromSqft, contractTotal, tierForValue } from '@/lib/estimating/calc'
import { tiersForType } from '@/lib/estimating/config'
import { useEstimatingConfig } from '@/hooks/useEstimatingConfig'
import {
  buildDefaultSection,
  catalogToService,
  duplicateSection,
  formatCents,
  maintenanceCatalogFromItems,
  removeSection,
  unresolvedProductionRateLabels,
} from '@/lib/estimating/maintenance'
import { persistEstimateTree } from '@/lib/estimating/persistTree'
import { useToast } from './useToast'
import { useEstimatingShell } from './useEstimatingShell'
import { SectionCard } from './SectionCard'
import { IntakeAttachmentsPanel } from './IntakeAttachmentsPanel'
import { cn } from '@/lib/utils'

const TARGET_MARGIN_DEFAULT = 0.22

export interface MaintenanceEditorProps {
  estimate: MaintenanceEstimate
}

export function MaintenanceEditor({ estimate }: MaintenanceEditorProps) {
  const { setOpenEstimate } = useEstimatingShell()
  const toast = useToast()
  // Actor identity for the lifecycle audit comes from the JWT server-side —
  // the client no longer sends or records it.
  // approval_tiers + catalog_items come from the API-fetched config;
  // the config.ts / maintenance.ts literals are only the offline fallback.
  const { approvalTiers, catalogItems } = useEstimatingConfig()

  const [draft, setDraft] = useState<MaintenanceEstimate>(estimate)
  /** Snapshot Reset restores to (last saved state). */
  const savedRef = useRef<MaintenanceEstimate>(estimate)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  /** UI-only kit granularity picks (I-9.7); persistence is a kit-config open item. */
  const [granularity, setGranularity] = useState<Record<string, string>>({})

  const contractCents = contractTotal(draft)
  const totalSqft = draft.sections.reduce((s, sec) => s + sec.squareFeet, 0)
  const maintenanceTiers = useMemo(
    () => tiersForType(approvalTiers, 'maintenance'),
    [approvalTiers],
  )
  // Kits come from GET /catalog-items; literal = offline fallback.
  const maintCatalog = useMemo(() => maintenanceCatalogFromItems(catalogItems), [catalogItems])
  const tier = tierForValue(contractCents, maintenanceTiers)
  const removeTarget = draft.sections.find((s) => s.id === confirmRemoveId) ?? null

  function patchSection(sectionId: string, patch: Partial<(typeof draft.sections)[number]>) {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    }))
  }

  function patchService(sectionId: string, serviceId: string, patch: Partial<SectionService>) {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === sectionId
          ? { ...s, services: s.services.map((v) => (v.id === serviceId ? { ...v, ...patch } : v)) }
          : s,
      ),
    }))
  }

  async function handleLifecycle(to: EstimateLifecycle) {
    if (draft.lifecycle === to) return // no-op — never spam the audit trail
    try {
      // Persisted server-side: the server flips lifecycle,
      // derives aspireOwner, and records the edge in estimate_status_transitions.
      const res = await estimatingApi.setLifecycle(draft.id, to)
      const flip = {
        lifecycle: res.estimate.lifecycle,
        aspireOwner: res.estimate.aspireOwner,
      } as const
      // Merge ONLY the lifecycle fields — unsaved tree edits stay local.
      const next = { ...draft, ...flip }
      savedRef.current = { ...savedRef.current, ...flip }
      setDraft(next)
      setOpenEstimate(next)
      toast.show(
        to === 'won' ? 'Won — Aspire ownership transferred to CRM' : 'Back to Bidding — Estimating owns Aspire',
      )
    } catch {
      toast.show('Lifecycle change failed — check your connection and retry')
    }
  }

  function handleReset() {
    setDraft({ ...savedRef.current, targetMargin: TARGET_MARGIN_DEFAULT })
    setSaveError(null)
    toast.show('Reset — margin to target, sections to saved state')
  }

  async function handleSave() {
    // Save guard (client half — the server enforces it with a 422):
    // every maintenance line must resolve a production rate (kit) or hours.
    const unresolved = unresolvedProductionRateLabels(draft.sections, catalogItems)
    if (unresolved.length > 0) {
      setSaveError(
        `No production rate resolves for ${unresolved.map((l) => `“${l}”`).join(', ')}. ` +
          'Pick a kit with a production rate or enter hours — the line can’t be saved without one.',
      )
      return
    }
    setSaving(true)
    setSaveError(null)
    const toSave: MaintenanceEstimate = { ...draft, contractValueCents: contractTotal(draft) }
    try {
      // Persist the FULL tree (diff-and-apply against the last
      // server-loaded state), then the scalar fields, then reload from the
      // server so the editor reflects persisted state — never local state.
      await persistEstimateTree(toSave.id, savedRef.current.sections, toSave.sections)
      // Ownership split: targetMargin/contractValueCents are
      // approver-owned levers server-side (an estimator PATCH touching them
      // 403s). Only send them when this Save actually changed them so the
      // routine estimator Save never trips the approver guard.
      const scalars: UpdateEstimatePayload = {
        name: toSave.name,
        lifecycle: toSave.lifecycle,
        aspireOwner: toSave.aspireOwner,
      }
      if (toSave.contractValueCents !== savedRef.current.contractValueCents)
        scalars.contractValueCents = toSave.contractValueCents
      if (toSave.targetMargin !== savedRef.current.targetMargin)
        scalars.targetMargin = toSave.targetMargin
      await estimatingApi.update(toSave.id, scalars)
      const fresh = (await estimatingApi.get(toSave.id)) as MaintenanceEstimate
      savedRef.current = fresh
      setDraft(fresh)
      setOpenEstimate(fresh)
      toast.show('Estimate saved')
    } catch (err) {
      // A 422 is the server-side production-rate guard — surface its message
      // (it names the offending line) instead of the generic connection copy.
      if (err instanceof ApiError && err.status === 422) {
        setSaveError(err.message)
      } else {
        setSaveError('The estimate couldn’t be saved. Check your connection and retry.')
      }
    } finally {
      setSaving(false)
    }
  }

  function handleAddSection() {
    setDraft((d) => ({
      ...d,
      sections: [...d.sections, buildDefaultSection(d.id, d.sections.length, maintCatalog)],
    }))
    toast.show('Section added')
  }

  function handleConfirmRemove() {
    if (!confirmRemoveId) return
    setDraft((d) => ({ ...d, sections: removeSection(d.sections, confirmRemoveId) }))
    setConfirmRemoveId(null)
    toast.show('Section removed')
  }

  const lifecycleBtn = (value: EstimateLifecycle, label: string) => {
    const active = draft.lifecycle === value
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => handleLifecycle(value)}
        className={cn(
          'px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer',
          active
            ? 'bg-[#2E7D52] text-white shadow-sm'
            : 'text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]',
        )}
      >
        {label}
      </button>
    )
  }

  return (
    <div data-testid="maintenance-editor" className="flex flex-col gap-4">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="m-0 text-base font-semibold text-[hsl(var(--fg))]">{draft.name}</h3>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#ecfdf3] text-[#1d6f42] border border-[#b7e4c7]">
              Draft — foundation, not final
            </span>
          </div>
          <p className="mt-1 text-xs text-[hsl(var(--muted-fg))]">
            ≈ {acresFromSqft(totalSqft).toFixed(1)} ac · {formatCents(contractCents)} ·{' '}
            <span className="font-medium text-[hsl(var(--fg))]">{draft.branch}</span>{' '}
            · Target margin {Math.round(draft.targetMargin * 100)}%
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-0.5">
            <span className="px-2 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-fg))]">
              Lifecycle
            </span>
            {lifecycleBtn('bidding', 'Bidding')}
            {lifecycleBtn('won', 'Won')}
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <LostTransition
            estimateId={draft.id}
            status={draft.status}
            onLost={async () => {
              const fresh = (await estimatingApi.get(draft.id)) as MaintenanceEstimate
              savedRef.current = fresh
              setDraft(fresh)
              setOpenEstimate(fresh)
              toast.show('Estimate marked Lost')
            }}
          />
        </div>
      </div>

      {/* ---- Save error (design-added state) ---- */}
      {saveError && (
        <div
          data-testid="save-error"
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          <TriangleAlert className="h-4 w-4 flex-shrink-0 text-red-600" />
          <span className="flex-1">{saveError}</span>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
            Retry
          </Button>
        </div>
      )}

      {/* ---- Ownership banner (BRD §8.1) — reflects handler-enforced state ---- */}
      <div
        data-testid="ownership-banner"
        className={cn(
          'rounded-lg border px-3 py-2 text-xs',
          draft.lifecycle === 'won'
            ? 'border-[#b7e4c7] bg-[#ecfdf3] text-[#1d6f42]'
            : 'border-blue-200 bg-blue-50 text-blue-900',
        )}
      >
        {draft.lifecycle === 'won' ? (
          <p className="m-0">
            <span className="font-semibold">Won</span> — Aspire ownership transferred to CRM.
            Estimating retains a quantities-assist role only.
          </p>
        ) : (
          <p className="m-0">
            Before WON, addendums route to both CRM and Estimating.{' '}
            <span className="font-semibold">Estimating owns Aspire.</span>
          </p>
        )}
        <p className="m-0 mt-0.5 opacity-75">
          Aspire owner · {draft.aspireOwner === 'crm' ? 'CRM' : 'Estimating'}
        </p>
      </div>

      {/* ---- Ancillary division of labor (BRD I-6.6) ---- */}
      <div
        data-testid="ancillary-banner"
        className="flex items-start gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/60 px-3 py-2"
      >
        <Info className="h-4 w-4 flex-shrink-0 text-[hsl(var(--muted-fg))] mt-0.5" />
        <p className="m-0 text-xs text-[hsl(var(--muted-fg))]">
          Estimating sets occurrences for core RFP-driven services only. Ancillary items
          (pet-waste stations, trash collection, tree cycles) are left unpriced for the branch to
          size from field knowledge.
        </p>
      </div>

      {/* ---- Sections ---- */}
      {draft.sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-6 py-10 text-center">
          <p className="m-0 text-sm text-[hsl(var(--muted-fg))]">
            No sections yet — add one to start pricing this property by region.
          </p>
        </div>
      ) : (
        draft.sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            onRename={(name) => patchSection(section.id, { name })}
            onSqftChange={(squareFeet) => patchSection(section.id, { squareFeet })}
            onServiceChange={(serviceId, patch) => patchService(section.id, serviceId, patch)}
            catalog={maintCatalog}
            onAddLineItem={(catalogKey) => {
              const row = maintCatalog.find((r) => r.key === catalogKey)
              if (!row) return
              patchSection(section.id, {
                services: [
                  ...section.services,
                  catalogToService(row, section.id, section.services.length),
                ],
              })
              toast.show(`${row.label} added`)
            }}
            onDuplicate={() => {
              setDraft((d) => ({ ...d, sections: duplicateSection(d.sections, section.id) }))
              toast.show('Section duplicated')
            }}
            onRemoveRequest={() => setConfirmRemoveId(section.id)}
            granularity={granularity}
            onGranularityChange={(serviceId, value) =>
              setGranularity((g) => ({ ...g, [serviceId]: value }))
            }
          />
        ))
      )}

      <button
        type="button"
        onClick={handleAddSection}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm font-medium text-[hsl(var(--muted-fg))] hover:text-[#2E7D52] hover:border-[#2E7D52]/40 transition-colors cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        Add section
      </button>

      {/* ---- Contract roll-up ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
          <p className="m-0 text-[11px] text-[hsl(var(--muted-fg))]">Sections</p>
          <p data-testid="rollup-sections" className="m-0 mt-1 text-lg font-bold text-[hsl(var(--fg))]">
            {draft.sections.length}
          </p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
          <p className="m-0 text-[11px] text-[hsl(var(--muted-fg))]">Total square footage</p>
          <p data-testid="rollup-sqft" className="m-0 mt-1 text-lg font-bold tabular-nums text-[hsl(var(--fg))]">
            {totalSqft.toLocaleString('en-US')}
          </p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
          <p className="m-0 text-[11px] text-[hsl(var(--muted-fg))]">Approval routing</p>
          <p data-testid="rollup-approval" className="m-0 mt-1 text-lg font-bold text-[hsl(var(--fg))]">
            {tier?.label ?? 'No matrix defined'}
          </p>
          <p className="m-0 text-[10px] text-[hsl(var(--muted-fg))]">By total contract value · config-driven tiers</p>
        </div>
        <div className="rounded-xl bg-[hsl(var(--fg))] px-4 py-3">
          <p className="m-0 text-[11px] text-[hsl(var(--card))]/70">Contract total</p>
          <p data-testid="contract-total" className="m-0 mt-1 text-lg font-bold tabular-nums text-[hsl(var(--card))]">
            {formatCents(contractCents)}
          </p>
          <p className="m-0 text-[10px] text-[hsl(var(--card))]/60">Σ section totals</p>
        </div>
      </div>

      {/* ---- Destructive-remove confirm (design-added; prototype had none) ---- */}
      <Dialog open={confirmRemoveId !== null} onOpenChange={(open) => !open && setConfirmRemoveId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove section?</DialogTitle>
            <DialogDescription>
              {removeTarget
                ? `“${removeTarget.name}” and its ${removeTarget.services.length} service line${
                    removeTarget.services.length === 1 ? '' : 's'
                  } will be removed from this estimate. This cannot be undone.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemoveId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmRemove}>
              Remove section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Intake attachments (site plans, RFPs) ---- */}
      <IntakeAttachmentsPanel estimateId={estimate.id} />
    </div>
  )
}
