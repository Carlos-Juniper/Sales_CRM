// ---------------------------------------------------------------------------
// InstallEditor — the QUANTITY-driven kit engine of the
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
// Materials Calculator seam: material component lines ingest
// through `buildComponent(serviceId, 'material')` + a patch of qty/unitCost —
// see handleAddComponent below.
// ---------------------------------------------------------------------------

import { memo, useCallback, useMemo, useRef, useState } from 'react'
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
  ServiceCategory,
} from '@/types/estimating'
import { marginBand } from '@/lib/estimating/calc'
import { formatCents } from '@/lib/money'
import { persistEstimateTree } from '@/lib/estimating/persistTree'
import { useEstimatingConfig } from '@/hooks/useEstimatingConfig'
import { useServiceCatalog } from '@/hooks/useServiceCatalog'
import {
  type InstallRollup,
  type InstallServiceKit,
  type ItemRollup,
  UNRESOLVED,
  availableInstallCategories,
  buildComponent,
  buildInstallSection,
  coerceNum,
  componentRollups,
  estimateHours,
  estimateRollup,
  formatGmPctOrDash,
  groupSameRateLabor,
  installServiceKitsFromItems,
  kitToService,
  sectionHours,
  sectionNameFor,
  sectionRollup,
  serviceRollup,
} from '@/lib/estimating/install'
import { useToast } from './useToast'
import { useEstimatingShell } from './useEstimatingShell'
import { IntakeAttachmentsPanel } from './IntakeAttachmentsPanel'
import { RushBadge } from './RushIndicators'
import { DisciplineSelect } from './DisciplineSelect'

/** Blue-cell convention: estimator-editable override inputs (legacy Excel). */
const BLUE_CELL = 'bg-[#eff6ff] border-[#bfdbfe] focus-visible:ring-[#2E7D52]'

const cellInput =
  'h-7 rounded-md border px-1.5 text-xs text-[hsl(var(--fg))] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors'

/** Shared 9-column grid: Item | Qty | Comp | Hrs | U/P | TP | Tax | Sub cost | GM % */
const GRID = 'grid grid-cols-[2.6fr_0.9fr_0.5fr_0.6fr_0.9fr_0.9fr_0.5fr_0.9fr_0.7fr] gap-1.5 items-center'

/** GM% text color from the ONE canonical margin-band config (API-fetched). */
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
// Roll-up memoization (Handoff 55 §6). Draft edits replace only the touched
// service object (every other service keeps its identity), so caching by
// object identity recomputes exactly one service row per keystroke. Paired
// with React.memo on ServiceRow / GroupRows and stable callbacks, a quantity
// edit on a 40-item service re-renders that service and its section only.
// ---------------------------------------------------------------------------

const serviceRollupCache = new WeakMap<SectionService, InstallRollup>()
const componentRollupCache = new WeakMap<SectionService, ItemRollup[]>()
const sectionRollupCache = new WeakMap<EstimateSection, InstallRollup>()

function memoServiceRollup(svc: SectionService): InstallRollup {
  let r = serviceRollupCache.get(svc)
  if (!r) {
    r = serviceRollup(svc)
    serviceRollupCache.set(svc, r)
  }
  return r
}

function memoComponentRollups(svc: SectionService): ItemRollup[] {
  let r = componentRollupCache.get(svc)
  if (!r) {
    r = componentRollups(svc)
    componentRollupCache.set(svc, r)
  }
  return r
}

function memoSectionRollup(section: EstimateSection): InstallRollup {
  let r = sectionRollupCache.get(section)
  if (!r) {
    r = sectionRollup(section, section.services.map(memoServiceRollup))
    sectionRollupCache.set(section, r)
  }
  return r
}

/** Cents or "—" for an unresolvable value (never a fake $0.00). */
function centsOrDash(cents: number | null): string {
  return cents === null ? UNRESOLVED : formatCents(cents)
}

/** GM cell class: band color when resolvable, muted for "—". */
function gmCellClass(gm: number | null, bands: MarginBands): string {
  return gm === null ? 'text-[hsl(var(--muted-fg))]' : gmClass(gm, bands)
}

// ---------------------------------------------------------------------------

type ServiceChange = (sectionId: string, serviceId: string, patch: Partial<SectionService>) => void
type ComponentChange = (
  sectionId: string,
  serviceId: string,
  componentId: string,
  patch: Partial<SectionServiceComponent>,
) => void

function ComponentRow({
  component,
  rollup,
  bands,
  onChange,
}: {
  component: SectionServiceComponent
  /** Extended item cost / apportioned price / GM (install.componentRollups). */
  rollup: ItemRollup
  bands: MarginBands
  onChange: (patch: Partial<SectionServiceComponent>) => void
}) {
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
        {component.hours !== null ? component.hours.toFixed(2) : UNRESOLVED}
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
      <span
        data-testid={`install-component-price-${component.label}`}
        className="text-right font-semibold tabular-nums"
      >
        {centsOrDash(rollup.priceCents)}
      </span>
      <span className="text-right text-[hsl(var(--muted-fg))]">{UNRESOLVED}</span>
      <span
        data-testid={`install-component-cost-${component.label}`}
        className="text-right text-[hsl(var(--muted-fg))] tabular-nums"
      >
        {formatCents(rollup.costCents)}
      </span>
      <span
        data-testid={`install-component-gm-${component.label}`}
        className={cn('text-right tabular-nums', gmCellClass(rollup.gm, bands))}
      >
        {formatGmPctOrDash(rollup.gm)}
      </span>
    </div>
  )
}

const ServiceRow = memo(function ServiceRow({
  sectionId,
  svc,
  expanded,
  bands,
  onToggle,
  onChange,
  onComponentChange,
  onAddComponent,
  onGroupLabor,
}: {
  sectionId: string
  svc: SectionService
  expanded: boolean
  bands: MarginBands
  onToggle: (serviceId: string) => void
  onChange: ServiceChange
  onComponentChange: ComponentChange
  onAddComponent: (sectionId: string, serviceId: string, kind: ComponentKind) => void
  onGroupLabor: (sectionId: string, serviceId: string) => void
}) {
  const { costCents, priceCents, gm } = memoServiceRollup(svc)
  const itemRollups = expanded ? memoComponentRollups(svc) : null
  const hasComponents = svc.components.length > 0
  const laborGroupable = groupSameRateLabor(svc.components).length < svc.components.length
  const patch = (p: Partial<SectionService>) => onChange(sectionId, svc.id, p)

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
              onClick={() => onToggle(svc.id)}
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
            onChange={(discipline) => patch({ discipline })}
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
            onChange={(e) => patch({ qty: coerceNum(e.target.value) })}
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
            onChange={(e) => patch({ hours: coerceNum(e.target.value) })}
          />
        </span>
        <span className="text-right">
          <span className="inline-block border border-[#fcd34d] bg-[#fffdf5] rounded-md px-1.5 py-0.5 text-[11px] tabular-nums">
            {formatCents(svc.unitSellCents ?? 0)}
          </span>
        </span>
        <span className="text-right font-medium tabular-nums">{formatCents(priceCents)}</span>
        <span className="text-right text-[hsl(var(--muted-fg))]">0.00</span>
        <span
          data-testid={`install-cost-${svc.label}`}
          className="text-right text-[hsl(var(--muted-fg))] tabular-nums"
        >
          {centsOrDash(costCents)}
        </span>
        <span
          data-testid={`install-gm-${svc.label}`}
          className={cn('text-right font-semibold tabular-nums', gmCellClass(gm, bands))}
        >
          {formatGmPctOrDash(gm)}
        </span>
      </div>

      {expanded && itemRollups && (
        <>
          {svc.components.map((c, i) => (
            <ComponentRow
              key={c.id}
              component={c}
              rollup={itemRollups[i]}
              bands={bands}
              onChange={(p) => onComponentChange(sectionId, svc.id, c.id, p)}
            />
          ))}
          <div className="flex items-center gap-2.5 py-1.5 pl-12 pr-3 border-t border-[hsl(var(--border))]/40 bg-[hsl(var(--muted))]/30">
            <select
              aria-label={`Add labor / cost line for ${svc.label}`}
              className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1.5 text-[11px] font-semibold text-[#2E7D52] cursor-pointer"
              value=""
              onChange={(e) => {
                if (e.target.value === 'labor' || e.target.value === 'material') {
                  onAddComponent(sectionId, svc.id, e.target.value)
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
                onClick={() => onGroupLabor(sectionId, svc.id)}
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
})

const GroupRows = memo(function GroupRows({
  section,
  expanded,
  collapsed,
  bands,
  onToggleSection,
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
  /** View-local section collapse (never persisted). */
  collapsed: boolean
  bands: MarginBands
  onToggleSection: (sectionId: string) => void
  onToggle: (serviceId: string) => void
  onServiceChange: ServiceChange
  onComponentChange: ComponentChange
  onAddComponent: (sectionId: string, serviceId: string, kind: ComponentKind) => void
  onGroupLabor: (sectionId: string, serviceId: string) => void
  onAddKit: (sectionId: string, kitId: string) => void
  /** Kits from GET /service-kits (literal = offline fallback). */
  kits: InstallServiceKit[]
}) {
  const rollup = memoSectionRollup(section)
  return (
    <>
      <div
        data-testid={`install-group-${section.id}`}
        className={cn(GRID, 'py-2 pl-6 pr-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-xs')}
      >
        <span className="flex items-center gap-1.5 font-semibold text-[#1d4ed8]">
          <button
            type="button"
            aria-label={`Toggle section ${section.name}`}
            aria-expanded={!collapsed}
            onClick={() => onToggleSection(section.id)}
            className="inline-flex items-center text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] cursor-pointer flex-shrink-0"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {section.name}
        </span>
        <span />
        <span className="text-center text-[11px] text-[hsl(var(--muted-fg))]">0.00%</span>
        <span className="text-right tabular-nums">{sectionHours(section).toFixed(2)}</span>
        <span />
        <span className="text-right">
          <span className="inline-block border border-[#b7e4c7] bg-[#ecfdf3] text-[#1d6f42] font-semibold rounded-md px-2 py-0.5 tabular-nums">
            {formatCents(rollup.priceCents)}
          </span>
        </span>
        <span className="text-right text-[11px] text-[hsl(var(--muted-fg))]">0.00</span>
        <span
          data-testid={`install-group-cost-${section.id}`}
          className="text-right text-[hsl(var(--muted-fg))] tabular-nums"
        >
          {centsOrDash(rollup.costCents)}
        </span>
        <span
          data-testid={`install-group-gm-${section.id}`}
          className={cn('text-right font-semibold tabular-nums', gmCellClass(rollup.gm, bands))}
        >
          {formatGmPctOrDash(rollup.gm)}
        </span>
      </div>

      {!collapsed && (
        <>
          {section.services.map((svc) => (
            <ServiceRow
              key={svc.id}
              sectionId={section.id}
              svc={svc}
              expanded={!!expanded[svc.id]}
              bands={bands}
              onToggle={onToggle}
              onChange={onServiceChange}
              onComponentChange={onComponentChange}
              onAddComponent={onAddComponent}
              onGroupLabor={onGroupLabor}
            />
          ))}

          <div className="flex items-center gap-2.5 py-1.5 pl-8 pr-3 border-t border-[hsl(var(--border))]/50">
            <select
              aria-label={`Add line item from catalog to ${section.name}`}
              className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1.5 text-[11px] font-semibold text-[#2E7D52] cursor-pointer"
              value=""
              onChange={(e) => e.target.value && onAddKit(section.id, e.target.value)}
            >
              <option value="">+ Add line item from catalog…</option>
              {kits.filter((k) => k.active).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.description}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-[hsl(var(--muted-fg))]">
              Kit sell / cost / GM% come from the service kit catalog — cost basis averages live vendor prices.
            </span>
          </div>
        </>
      )}
    </>
  )
})

// ---------------------------------------------------------------------------
// Handoff 55 §3 — "Add section" picks from the install service categories
// instead of free text. estimate_sections.name keeps the (optionally
// suffixed) category name; serviceCategoryId carries the real link.
// ---------------------------------------------------------------------------

function AddSectionPicker({
  sections,
  onAdd,
}: {
  sections: EstimateSection[]
  onAdd: (category: ServiceCategory, suffix: string) => void
}) {
  const { data: categories, isLoading, isError } = useServiceCatalog('install')
  const options = useMemo(
    () => availableInstallCategories(categories ?? [], sections),
    [categories, sections],
  )
  const [categoryId, setCategoryId] = useState('')
  const [suffix, setSuffix] = useState('')
  const selected = options.find((c) => c.id === categoryId) ?? null

  function add() {
    if (!selected) return
    onAdd(selected, suffix)
    setCategoryId('')
    setSuffix('')
  }

  const unavailable = isError || (!isLoading && categories === undefined)
  return (
    <div data-testid="install-add-section" className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Add section"
        className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 text-xs font-semibold text-[#2E7D52] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        value={selected ? selected.id : ''}
        disabled={isLoading || unavailable || options.length === 0}
        onChange={(e) => setCategoryId(e.target.value)}
      >
        <option value="">
          {isLoading
            ? 'Loading sections…'
            : unavailable
              ? 'Section catalog unavailable'
              : options.length === 0
                ? 'Every section is already on this estimate'
                : '+ Add section…'}
        </option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        type="text"
        aria-label="Section area suffix (optional)"
        placeholder="Area (optional), e.g. Amenity Center"
        maxLength={120}
        className="h-8 w-56 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 text-xs"
        value={suffix}
        onChange={(e) => setSuffix(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
      />
      <Button size="sm" variant="outline" onClick={add} disabled={!selected}>
        Add section
      </Button>
      {selected && (
        <span data-testid="install-add-section-preview" className="text-[11px] text-[hsl(var(--muted-fg))]">
          {sectionNameFor(selected.name, suffix)}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function InstallEditor({ estimate }: InstallEditorProps) {
  const { setOpenEstimate } = useEstimatingShell()
  const toast = useToast()
  // The ONE canonical margin-band set + kit catalog — API-fetched config;
  // the literals are only the offline fallback.
  const { marginBands, serviceKits } = useEstimatingConfig()
  const kitCatalog = useMemo(() => installServiceKitsFromItems(serviceKits), [serviceKits])

  const [draft, setDraft] = useState<InstallEstimate>(estimate)
  const savedRef = useRef<InstallEstimate>(estimate)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** View-local expansion state (spec §5) — never persisted. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  /** View-local section / parent collapse (Handoff 55 §5/§6) — never persisted. */
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [parentCollapsed, setParentCollapsed] = useState(false)

  const sectionRollups = draft.sections.map(memoSectionRollup)
  const totals = estimateRollup(draft, sectionRollups)
  const contractCents = totals.priceCents
  const totalHours = estimateHours(draft)

  const patchService = useCallback(
    (sectionId: string, serviceId: string, patch: Partial<SectionService>) => {
      setDraft((d) => ({
        ...d,
        sections: d.sections.map((s) =>
          s.id === sectionId
            ? { ...s, services: s.services.map((v) => (v.id === serviceId ? { ...v, ...patch } : v)) }
            : s,
        ),
      }))
    },
    [],
  )

  /** Functional update of one service (reads the latest draft, stable identity). */
  const updateService = useCallback(
    (sectionId: string, serviceId: string, fn: (v: SectionService) => SectionService) => {
      setDraft((d) => ({
        ...d,
        sections: d.sections.map((s) =>
          s.id === sectionId
            ? { ...s, services: s.services.map((v) => (v.id === serviceId ? fn(v) : v)) }
            : s,
        ),
      }))
    },
    [],
  )

  const patchComponent = useCallback(
    (
      sectionId: string,
      serviceId: string,
      componentId: string,
      patch: Partial<SectionServiceComponent>,
    ) => {
      updateService(sectionId, serviceId, (v) => ({
        ...v,
        components: v.components.map((c) => (c.id === componentId ? { ...c, ...patch } : c)),
      }))
    },
    [updateService],
  )

  const handleAddComponent = useCallback(
    (sectionId: string, serviceId: string, kind: ComponentKind) => {
      updateService(sectionId, serviceId, (v) => ({
        ...v,
        components: [...v.components, buildComponent(serviceId, kind, v.components.length)],
      }))
      setExpanded((e) => ({ ...e, [serviceId]: true }))
      toast.show(kind === 'labor' ? 'Labor line added' : 'Material line added')
    },
    [updateService, toast],
  )

  const handleGroupLabor = useCallback(
    (sectionId: string, serviceId: string) => {
      updateService(sectionId, serviceId, (v) => ({
        ...v,
        components: groupSameRateLabor(v.components),
      }))
      toast.show('Same-rate labor grouped into one line')
    },
    [updateService, toast],
  )

  const handleAddKit = useCallback(
    (sectionId: string, kitId: string) => {
      const kit = kitCatalog.find((k) => k.id === kitId)
      if (!kit) return
      setDraft((d) => ({
        ...d,
        sections: d.sections.map((s) =>
          s.id === sectionId
            ? { ...s, services: [...s.services, kitToService(kit, s.id, s.services.length)] }
            : s,
        ),
      }))
      toast.show(`${kit.description} added`)
    },
    [kitCatalog, toast],
  )

  const handleAddSection = useCallback(
    (category: ServiceCategory, suffix: string) => {
      setDraft((d) => ({
        ...d,
        sections: [
          ...d.sections,
          buildInstallSection(d.id, category, suffix, d.sections.length),
        ],
      }))
      toast.show(`${sectionNameFor(category.name, suffix)} added`)
    },
    [toast],
  )

  const toggleService = useCallback(
    (serviceId: string) => setExpanded((e) => ({ ...e, [serviceId]: !e[serviceId] })),
    [],
  )
  const toggleSection = useCallback(
    (sectionId: string) => setCollapsedSections((c) => ({ ...c, [sectionId]: !c[sectionId] })),
    [],
  )

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    const toSave: InstallEstimate = { ...draft, contractValueCents: contractCents }
    try {
      // Persist the FULL tree (diff-and-apply against the last
      // server-loaded state), then the scalar fields, then reload from the
      // server so the editor reflects persisted state — never local state.
      await persistEstimateTree(toSave.id, savedRef.current.sections, toSave.sections)
      // Ownership split: targetMargin/contractValueCents are
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
            {draft.isRush && <RushBadge />}
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#eff6ff] text-[#1d4ed8] border border-[#bfdbfe]">
              Install — quantity-driven kits
            </span>
          </div>
          <p className="mt-1 text-xs text-[hsl(var(--muted-fg))]">
            {draft.clientName} · {draft.branchCity} ·{' '}
            <span className="font-medium text-[hsl(var(--fg))]">{formatCents(contractCents)}</span>{' '}
            · {totalHours.toFixed(2)} hrs planned
          </p>
          {/* §3.2 — tracked RFI status, display only (no gating). */}
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
          <p className="m-0 mb-3 text-sm text-[hsl(var(--muted-fg))]">
            No sections yet — add one from the install service catalog.
          </p>
          <div className="flex justify-center">
            <AddSectionPicker sections={draft.sections} onAdd={handleAddSection} />
          </div>
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
              <button
                type="button"
                aria-label="Toggle all groups"
                aria-expanded={!parentCollapsed}
                onClick={() => setParentCollapsed((c) => !c)}
                className="inline-flex items-center text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] cursor-pointer flex-shrink-0"
              >
                {parentCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
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
            <span
              data-testid="install-parent-cost"
              className="text-right text-xs text-[hsl(var(--muted-fg))] tabular-nums"
            >
              {centsOrDash(totals.costCents)}
            </span>
            <span
              data-testid="install-parent-gm"
              className={cn('text-right font-bold tabular-nums', gmCellClass(totals.gm, marginBands))}
            >
              {formatGmPctOrDash(totals.gm)}
            </span>
          </div>

          {!parentCollapsed &&
            draft.sections.map((section) => (
              <GroupRows
                key={section.id}
                section={section}
                expanded={expanded}
                collapsed={!!collapsedSections[section.id]}
                bands={marginBands}
                onToggleSection={toggleSection}
                onToggle={toggleService}
                onServiceChange={patchService}
                onComponentChange={patchComponent}
                onAddComponent={handleAddComponent}
                onGroupLabor={handleGroupLabor}
                onAddKit={handleAddKit}
                kits={kitCatalog}
              />
            ))}
          <div className="py-2 px-3 border-t border-[hsl(var(--border))]">
            <AddSectionPicker sections={draft.sections} onAdd={handleAddSection} />
          </div>
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
