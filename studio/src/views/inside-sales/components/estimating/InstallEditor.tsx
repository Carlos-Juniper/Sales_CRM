// ---------------------------------------------------------------------------
// InstallEditor (Handoff 04) — the QUANTITY-driven kit engine of the
// Line-Item Editor. Rendered automatically when the open estimate's
// `estimateType === 'install'` (see LineItemEditor.tsx); never toggled.
//
// Principles wired in here (BRD II-6.8 / II-6.5 / II-9.5 / II-9.7):
//   • TP = QTY × unit sell; every line carries an embedded SUB COST and a
//     live GM%. GM% is the pricing lever.
//   • HOURS are production-planning reads only — nothing here lets hours
//     move a price.
//   • Kit components (labor/material) are the estimator override surface:
//     blue-cell (#eff6ff/#bfdbfe) editable qty + unit cost, live totals.
//   • Install has NO approval matrix yet — estimates are never routed
//     through the maintenance BM/RD/BP/COO ladder (open item with Carlos).
//   • All math via lib/estimating/install + calc; margin bands from the one
//     canonical config (never the prototype's 34/28 literals).
//
// Materials Calculator seam (Handoff 05): material component lines ingest
// through `buildComponent(serviceId, 'material')` + a patch of qty/unitCost —
// see handleAddComponent below.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Info, Merge, Save, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { estimatingApi, type UpdateEstimatePayload } from '@/api/estimating'
import { ApiError } from '@/api/client'
import type {
  ComponentKind,
  EstimateSection,
  InstallEstimate,
  MarginBands,
  SectionService,
  SectionServiceComponent,
} from '@/types/estimating'
import { componentCost, marginBand } from '@/lib/estimating/calc'
import { persistEstimateTree } from '@/lib/estimating/persistTree'
import { useEstimatingConfig } from '@/hooks/useEstimatingConfig'
import {
  type InstallCatalogKit,
  buildComponent,
  coerceNum,
  estimateGm,
  estimateHours,
  estimateSubCostCents,
  formatCents,
  formatGmPct,
  groupSameRateLabor,
  installKitCatalogFromItems,
  kitToService,
  sectionGm,
  sectionHours,
  sectionSubCostCents,
  sectionTotalCents,
  serviceGm,
  serviceSubCostCents,
  serviceTotalCents,
} from '@/lib/estimating/install'
import { useToast } from './useToast'
import { useEstimatingShell } from './useEstimatingShell'
import { IntakeAttachmentsPanel } from './IntakeAttachmentsPanel'
import { DisciplineSelect } from './DisciplineSelect'

/** Blue-cell convention: estimator-editable override inputs (legacy Excel). */
const BLUE_CELL = 'bg-[#eff6ff] border-[#bfdbfe] focus-visible:ring-[#2E7D52]'

const cellInput =
  'h-7 rounded-md border px-1.5 text-xs text-[hsl(var(--fg))] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors'

/** Shared 9-column grid: Item | Qty | Comp | Hrs | U/P | TP | Tax | Sub cost | GM % */
const GRID = 'grid grid-cols-[2.6fr_0.9fr_0.5fr_0.6fr_0.9fr_0.9fr_0.5fr_0.9fr_0.7fr] gap-1.5 items-center'

/** GM% text color from the ONE canonical margin-band config (API-fetched, Handoff 16). */
function gmClass(gm: number, bands: MarginBands): string {
  const band = marginBand(gm, bands)
  if (band === 'good') return 'text-[#2E7D52]'
  if (band === 'ok') return 'text-amber-600'
  return 'text-red-600'
}

export interface InstallEditorProps {
  estimate: InstallEstimate
}

// ---------------------------------------------------------------------------

function ComponentRow({
  component,
  onChange,
}: {
  component: SectionServiceComponent
  onChange: (patch: Partial<SectionServiceComponent>) => void
}) {
  const tp = componentCost(component.qty, component.unitCostCents)
  const isLabor = component.kind === 'labor'
  return (
    <div
      data-testid={`install-component-${component.label}`}
      className={cn(GRID, 'py-1 pl-12 pr-3 border-t border-[hsl(var(--border))]/40 bg-[hsl(var(--muted))]/30 text-[11px]')}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span
          className={cn(
            'text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded flex-shrink-0',
            isLabor ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#e0f2fe] text-[#0369a1]',
          )}
        >
          {isLabor ? 'LABOR' : 'MATERIAL'}
        </span>
        <span className="text-[#1d4ed8] truncate">{component.label}</span>
      </span>
      <span className="flex items-center justify-center gap-1">
        <input
          type="number"
          min={0}
          step="any"
          aria-label={`Component qty for ${component.label}`}
          className={cn(cellInput, BLUE_CELL, 'w-14 text-right')}
          value={component.qty}
          onChange={(e) => onChange({ qty: coerceNum(e.target.value) })}
        />
        <span className="text-[10px] text-[hsl(var(--muted-fg))]">{isLabor ? 'HR' : 'EA'}</span>
      </span>
      <span />
      <span className="text-right text-[hsl(var(--muted-fg))] tabular-nums">
        {component.hours !== null ? component.hours.toFixed(2) : '—'}
      </span>
      <span className="text-right">
        <input
          type="number"
          min={0}
          step="any"
          aria-label={`Unit cost for ${component.label}`}
          className={cn(cellInput, BLUE_CELL, 'w-20 text-right')}
          value={component.unitCostCents / 100}
          onChange={(e) => onChange({ unitCostCents: Math.round(coerceNum(e.target.value) * 100) })}
        />
      </span>
      <span className="text-right font-semibold tabular-nums">{formatCents(tp)}</span>
      <span className="text-right text-[hsl(var(--muted-fg))]">—</span>
      <span className="text-right text-[hsl(var(--muted-fg))] tabular-nums">{formatCents(tp)}</span>
      <span className="text-right text-[hsl(var(--muted-fg))]">—</span>
    </div>
  )
}

function ServiceRow({
  svc,
  expanded,
  bands,
  onToggle,
  onChange,
  onComponentChange,
  onAddComponent,
  onGroupLabor,
}: {
  svc: SectionService
  expanded: boolean
  bands: MarginBands
  onToggle: () => void
  onChange: (patch: Partial<SectionService>) => void
  onComponentChange: (componentId: string, patch: Partial<SectionServiceComponent>) => void
  onAddComponent: (kind: ComponentKind) => void
  onGroupLabor: () => void
}) {
  const tp = serviceTotalCents(svc)
  const subCost = serviceSubCostCents(svc)
  const gm = serviceGm(svc)
  const hasComponents = svc.components.length > 0
  const laborGroupable = groupSameRateLabor(svc.components).length < svc.components.length

  return (
    <>
      <div
        data-testid={`install-row-${svc.label}`}
        className={cn(GRID, 'py-1.5 pl-8 pr-3 border-t border-[hsl(var(--border))]/50 text-xs')}
      >
        <span className="flex items-center gap-1 min-w-0 text-[#1d4ed8]">
          {hasComponents ? (
            <button
              type="button"
              aria-label={`Toggle components for ${svc.label}`}
              aria-expanded={expanded}
              onClick={onToggle}
              className="inline-flex items-center text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] cursor-pointer flex-shrink-0"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 flex-shrink-0" />
          )}
          <span className="truncate">{svc.label}</span>
          <DisciplineSelect
            label={svc.label}
            value={svc.discipline ?? null}
            onChange={(discipline) => onChange({ discipline })}
            className="h-5 flex-shrink-0 border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1 text-[10px] text-[hsl(var(--muted-fg))]"
          />
        </span>
        <span className="flex items-center justify-center gap-1">
          <input
            type="number"
            min={0}
            step="any"
            aria-label={`Qty for ${svc.label}`}
            className={cn(cellInput, BLUE_CELL, 'w-16 text-right')}
            value={svc.qty}
            onChange={(e) => onChange({ qty: coerceNum(e.target.value) })}
          />
          <span className="text-[10px] text-[hsl(var(--muted-fg))]">{svc.uom}</span>
        </span>
        <span />
        <span className="text-right">
          <input
            type="number"
            min={0}
            step="any"
            aria-label={`Hours for ${svc.label} (production planning only — never price)`}
            title="Tracked for production planning only — hours never move price"
            className={cn(cellInput, 'w-14 text-right border-[hsl(var(--border))] bg-[hsl(var(--card))]')}
            value={svc.hours ?? 0}
            onChange={(e) => onChange({ hours: coerceNum(e.target.value) })}
          />
        </span>
        <span className="text-right">
          <span className="inline-block border border-[#fcd34d] bg-[#fffdf5] rounded-md px-1.5 py-0.5 text-[11px] tabular-nums">
            {formatCents(svc.unitSellCents ?? 0)}
          </span>
        </span>
        <span className="text-right font-medium tabular-nums">{formatCents(tp)}</span>
        <span className="text-right text-[hsl(var(--muted-fg))]">0.00</span>
        <span className="text-right text-[hsl(var(--muted-fg))] tabular-nums">{formatCents(subCost)}</span>
        <span
          data-testid={`install-gm-${svc.label}`}
          className={cn('text-right font-semibold tabular-nums', gmClass(gm, bands))}
        >
          {formatGmPct(gm)}
        </span>
      </div>

      {expanded && (
        <>
          {svc.components.map((c) => (
            <ComponentRow key={c.id} component={c} onChange={(patch) => onComponentChange(c.id, patch)} />
          ))}
          <div className="flex items-center gap-2.5 py-1.5 pl-12 pr-3 border-t border-[hsl(var(--border))]/40 bg-[hsl(var(--muted))]/30">
            <select
              aria-label={`Add labor / cost line for ${svc.label}`}
              className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1.5 text-[11px] font-semibold text-[#2E7D52] cursor-pointer"
              value=""
              onChange={(e) => {
                if (e.target.value === 'labor' || e.target.value === 'material') {
                  onAddComponent(e.target.value)
                }
              }}
            >
              <option value="">+ Add labor / cost line…</option>
              <option value="labor">Labor line</option>
              <option value="material">Material / cost line</option>
            </select>
            {laborGroupable && (
              <button
                type="button"
                onClick={onGroupLabor}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2E7D52] hover:underline cursor-pointer"
              >
                <Merge className="h-3 w-3" />
                Group same-rate labor
              </button>
            )}
            <span className="text-[10px] text-[hsl(var(--muted-fg))]">
              Break the kit price into separate labor &amp; material cost lines.
            </span>
          </div>
        </>
      )}
    </>
  )
}

function GroupRows({
  section,
  expanded,
  bands,
  onToggle,
  onServiceChange,
  onComponentChange,
  onAddComponent,
  onGroupLabor,
  onAddKit,
  kits,
}: {
  section: EstimateSection
  expanded: Record<string, boolean>
  bands: MarginBands
  onToggle: (serviceId: string) => void
  onServiceChange: (serviceId: string, patch: Partial<SectionService>) => void
  onComponentChange: (
    serviceId: string,
    componentId: string,
    patch: Partial<SectionServiceComponent>,
  ) => void
  onAddComponent: (serviceId: string, kind: ComponentKind) => void
  onGroupLabor: (serviceId: string) => void
  onAddKit: (kitId: string) => void
  /** Handoff 22 — kits from GET /catalog-items (literal = offline fallback). */
  kits: InstallCatalogKit[]
}) {
  return (
    <>
      <div
        data-testid={`install-group-${section.id}`}
        className={cn(GRID, 'py-2 pl-6 pr-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-xs')}
      >
        <span className="flex items-center gap-1.5 font-semibold text-[#1d4ed8]">
          <ChevronDown className="h-3.5 w-3.5 text-[hsl(var(--muted-fg))]" />
          {section.name}
        </span>
        <span />
        <span className="text-center text-[11px] text-[hsl(var(--muted-fg))]">0.00%</span>
        <span className="text-right tabular-nums">{sectionHours(section).toFixed(2)}</span>
        <span />
        <span className="text-right">
          <span className="inline-block border border-[#b7e4c7] bg-[#ecfdf3] text-[#1d6f42] font-semibold rounded-md px-2 py-0.5 tabular-nums">
            {formatCents(sectionTotalCents(section))}
          </span>
        </span>
        <span className="text-right text-[11px] text-[hsl(var(--muted-fg))]">0.00</span>
        <span className="text-right text-[hsl(var(--muted-fg))] tabular-nums">
          {formatCents(sectionSubCostCents(section))}
        </span>
        <span className={cn('text-right font-semibold tabular-nums', gmClass(sectionGm(section), bands))}>
          {formatGmPct(sectionGm(section))}
        </span>
      </div>

      {section.services.map((svc) => (
        <ServiceRow
          key={svc.id}
          svc={svc}
          expanded={!!expanded[svc.id]}
          bands={bands}
          onToggle={() => onToggle(svc.id)}
          onChange={(patch) => onServiceChange(svc.id, patch)}
          onComponentChange={(componentId, patch) => onComponentChange(svc.id, componentId, patch)}
          onAddComponent={(kind) => onAddComponent(svc.id, kind)}
          onGroupLabor={() => onGroupLabor(svc.id)}
        />
      ))}

      <div className="flex items-center gap-2.5 py-1.5 pl-8 pr-3 border-t border-[hsl(var(--border))]/50">
        <select
          aria-label={`Add line item from catalog to ${section.name}`}
          className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1.5 text-[11px] font-semibold text-[#2E7D52] cursor-pointer"
          value=""
          onChange={(e) => e.target.value && onAddKit(e.target.value)}
        >
          <option value="">+ Add line item from catalog…</option>
          {kits.filter((k) => k.active).map((k) => (
            <option key={k.id} value={k.id}>
              {k.description}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-[hsl(var(--muted-fg))]">
          Kit sell / cost / GM% come from catalog_items — cost basis averages live vendor prices.
        </span>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

export function InstallEditor({ estimate }: InstallEditorProps) {
  const { setOpenEstimate } = useEstimatingShell()
  const toast = useToast()
  // The ONE canonical margin-band set + kit catalog — API-fetched config
  // (Handoffs 16 + 22); the literals are only the offline fallback.
  const { marginBands, catalogItems } = useEstimatingConfig()
  const kitCatalog = useMemo(() => installKitCatalogFromItems(catalogItems), [catalogItems])

  const [draft, setDraft] = useState<InstallEstimate>(estimate)
  const savedRef = useRef<InstallEstimate>(estimate)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** View-local expansion state (spec §5) — never persisted. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const contractCents = draft.sections.reduce((s, sec) => s + sectionTotalCents(sec), 0)
  const blendedGm = estimateGm(draft)
  const totalHours = estimateHours(draft)

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

  function patchComponent(
    sectionId: string,
    serviceId: string,
    componentId: string,
    patch: Partial<SectionServiceComponent>,
  ) {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              services: s.services.map((v) =>
                v.id === serviceId
                  ? {
                      ...v,
                      components: v.components.map((c) =>
                        c.id === componentId ? { ...c, ...patch } : c,
                      ),
                    }
                  : v,
              ),
            }
          : s,
      ),
    }))
  }

  function handleAddComponent(sectionId: string, serviceId: string, kind: ComponentKind) {
    const section = draft.sections.find((s) => s.id === sectionId)
    const svc = section?.services.find((v) => v.id === serviceId)
    if (!svc) return
    patchService(sectionId, serviceId, {
      components: [...svc.components, buildComponent(serviceId, kind, svc.components.length)],
    })
    setExpanded((e) => ({ ...e, [serviceId]: true }))
    toast.show(kind === 'labor' ? 'Labor line added' : 'Material line added')
  }

  function handleGroupLabor(sectionId: string, serviceId: string) {
    const section = draft.sections.find((s) => s.id === sectionId)
    const svc = section?.services.find((v) => v.id === serviceId)
    if (!svc) return
    patchService(sectionId, serviceId, { components: groupSameRateLabor(svc.components) })
    toast.show('Same-rate labor grouped into one line')
  }

  function handleAddKit(sectionId: string, kitId: string) {
    const kit = kitCatalog.find((k) => k.id === kitId)
    const section = draft.sections.find((s) => s.id === sectionId)
    if (!kit || !section) return
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === sectionId
          ? { ...s, services: [...s.services, kitToService(kit, s.id, s.services.length)] }
          : s,
      ),
    }))
    toast.show(`${kit.description} added`)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    const toSave: InstallEstimate = { ...draft, contractValueCents: contractCents }
    try {
      // Handoff 17: persist the FULL tree (diff-and-apply against the last
      // server-loaded state), then the scalar fields, then reload from the
      // server so the editor reflects persisted state — never local state.
      await persistEstimateTree(toSave.id, savedRef.current.sections, toSave.sections)
      // Handoff 18 ownership split: targetMargin/contractValueCents are
      // approver-owned levers server-side (an estimator PATCH touching them
      // 403s). Only send them when this Save actually changed them so the
      // routine estimator Save never trips the approver guard.
      const scalars: UpdateEstimatePayload = { name: toSave.name }
      if (toSave.contractValueCents !== savedRef.current.contractValueCents)
        scalars.contractValueCents = toSave.contractValueCents
      if (toSave.targetMargin !== savedRef.current.targetMargin)
        scalars.targetMargin = toSave.targetMargin
      await estimatingApi.update(toSave.id, scalars)
      const fresh = (await estimatingApi.get(toSave.id)) as InstallEstimate
      savedRef.current = fresh
      setDraft(fresh)
      setOpenEstimate(fresh)
      toast.show('Estimate saved')
    } catch (err) {
      // 422 = a server-side save guard rejection — surface its specific message.
      if (err instanceof ApiError && err.status === 422) {
        setSaveError(err.message)
      } else {
        setSaveError('The estimate couldn’t be saved. Check your connection and retry.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="install-editor" aria-busy={saving} className="flex flex-col gap-4">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="m-0 text-base font-semibold text-[hsl(var(--fg))]">{draft.name}</h3>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#eff6ff] text-[#1d4ed8] border border-[#bfdbfe]">
              Install — quantity-driven kits
            </span>
          </div>
          <p className="mt-1 text-xs text-[hsl(var(--muted-fg))]">
            {draft.clientName} · {draft.branch} ·{' '}
            <span className="font-medium text-[hsl(var(--fg))]">{formatCents(contractCents)}</span>{' '}
            · {totalHours.toFixed(2)} hrs planned
          </p>
          {/* Handoff 24 §3.2 — tracked RFI status, display only (no gating). */}
          {draft.rfiStatus && (
            <p
              data-testid="install-rfi-status"
              className="mt-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block"
            >
              <span className="font-semibold">RFI:</span> {draft.rfiStatus}
            </p>
          )}
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
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

      {/* ---- Engine explainer (II-6.8) ---- */}
      <div className="flex items-start gap-2 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2">
        <Info className="h-4 w-4 flex-shrink-0 text-[#1d4ed8] mt-0.5" />
        <p className="m-0 text-xs text-[#1e40af]">
          Install kits are <strong>quantity-driven</strong>: line price = QTY × unit sell price,
          each line carrying its own GM% over an embedded sub-cost. Hours are{' '}
          <strong>tracked for production planning only</strong> — they don&rsquo;t move price.
        </p>
      </div>

      {/* ---- Nested Parent → Group → Row → Components table ---- */}
      {draft.sections.length === 0 ? (
        <div
          data-testid="install-empty"
          className="rounded-xl border border-dashed border-[hsl(var(--border))] px-6 py-10 text-center"
        >
          <p className="m-0 text-sm text-[hsl(var(--muted-fg))]">
            No groups yet — install groups arrive from the takeoff / proposal request, or are added
            from the kit catalog.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden shadow-sm bg-[hsl(var(--card))]">
          {/* column header */}
          <div
            data-testid="install-columns"
            className={cn(
              GRID,
              'py-2 px-3 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))] text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-fg))]',
            )}
          >
            <span>Item</span>
            <span className="text-center">Qty</span>
            <span className="text-center">Comp</span>
            <span className="text-right">Hrs</span>
            <span className="text-right">U/P</span>
            <span className="text-right">TP</span>
            <span className="text-right">Tax</span>
            <span className="text-right">Sub cost</span>
            <span className="text-right">GM %</span>
          </div>

          {/* parent total row */}
          <div
            data-testid="install-parent-row"
            className={cn(GRID, 'py-2.5 px-3 bg-[#f0faf4] border-b border-[hsl(var(--border))] text-sm')}
          >
            <span className="flex items-center gap-2 font-bold">
              <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
              {draft.name}
            </span>
            <span />
            <span />
            <span className="text-right tabular-nums text-xs text-[hsl(var(--muted-fg))]">
              {totalHours.toFixed(2)}
            </span>
            <span />
            <span className="text-right font-bold tabular-nums">{formatCents(contractCents)}</span>
            <span className="text-right text-xs text-[hsl(var(--muted-fg))]">0.00</span>
            <span className="text-right text-xs text-[hsl(var(--muted-fg))] tabular-nums">
              {formatCents(estimateSubCostCents(draft))}
            </span>
            <span className={cn('text-right font-bold tabular-nums', gmClass(blendedGm, marginBands))}>
              {formatGmPct(blendedGm)}
            </span>
          </div>

          {draft.sections.map((section) => (
            <GroupRows
              key={section.id}
              section={section}
              expanded={expanded}
              bands={marginBands}
              onToggle={(serviceId) => setExpanded((e) => ({ ...e, [serviceId]: !e[serviceId] }))}
              onServiceChange={(serviceId, patch) => patchService(section.id, serviceId, patch)}
              onComponentChange={(serviceId, componentId, patch) =>
                patchComponent(section.id, serviceId, componentId, patch)
              }
              onAddComponent={(serviceId, kind) => handleAddComponent(section.id, serviceId, kind)}
              onGroupLabor={(serviceId) => handleGroupLabor(section.id, serviceId)}
              onAddKit={(kitId) => handleAddKit(section.id, kitId)}
              kits={kitCatalog}
            />
          ))}
        </div>
      )}

      {/* ---- Kit editability note (II-9.5, deferred surface) ---- */}
      <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/60 px-3 py-2">
        <Info className="h-4 w-4 flex-shrink-0 text-[hsl(var(--muted-fg))] mt-0.5" />
        <p className="m-0 text-xs text-[hsl(var(--muted-fg))]">
          Kit <em>defaults</em> (unit price, cost, target GM%) are edited by authorized
          Estimating/Operations users in catalog admin — no developer deploy. The blue cells here
          override a single estimate only.
        </p>
      </div>

      {/* ---- Intake attachments (site plans, RFPs) ---- */}
      <IntakeAttachmentsPanel estimateId={estimate.id} />
    </div>
  )
}
