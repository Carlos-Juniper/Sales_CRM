// ---------------------------------------------------------------------------
// MaterialsCalculator — install-only config-driven formula engine.
//
// Principles:
//   • Rendered only when openEstimate.estimateType === 'install'. The tab bar
//     already hides the tab for maintenance; the component also guards itself.
//   • Each material card is driven by a MaterialCalcRow from the API-fetched
//     material_calcs config (MATERIAL_FORMULA_ROWS is the offline
//     fallback) or the `rows` prop. Adding a material = a DB row, zero code edits.
//   • All compute_type formulas live in buildMaterialCalc (lib/estimating/config):
//     the API supplies compute_type + factors (data); the math stays here.
//   • Blue-cell (#eff6ff/#bfdbfe) convention for estimator-editable inputs.
//   • Margin bands from the config API (never hardcoded 34/28 literals).
//   • Freight tables and volume-price thresholds (44,000 SF+) are future config;
//     a placeholder note is present in the footer.
//   • Factor inputs render as <select> when the row declares discrete options
//     (depthIn from sfPerTonAtDepthIn table, piece length from choices array, …).
// ---------------------------------------------------------------------------

import { useState, useMemo } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildMaterialCalc } from '@/lib/estimating/config'
import { useEstimatingConfig } from '@/hooks/useEstimatingConfig'
import { groupMargin, marginBand } from '@/lib/estimating/calc'
import type { MarginBands, MaterialCalcRow, MaterialComputeInput } from '@/types/estimating'
import { useEstimatingShell } from './useEstimatingShell'

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

/** Blue-cell: estimator-editable override inputs (legacy Excel "edit blue cells"). */
const BLUE_INPUT =
  'rounded-[5px] border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1 text-xs text-[#1e3a8a] ' +
  'font-mono focus:outline-none focus:border-[#2E7D52] focus:ring-2 focus:ring-[#2E7D52]/15 ' +
  'focus:bg-white transition-colors w-full'

/** Computed qty display — brand-green highlight per spec. */
const QTY_CELL =
  'rounded-lg bg-[#d1fae5] border border-[#6ee7b7] px-3 py-2 text-center'

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function gmLabel(gm: number, bands: MarginBands): string {
  const band = marginBand(gm, bands)
  if (band === 'good') return 'text-[#2E7D52]'
  if (band === 'ok') return 'text-amber-600'
  return 'text-red-600'
}

// ---------------------------------------------------------------------------
// Per-material input state
// ---------------------------------------------------------------------------

interface MaterialInputState {
  sqft: string
  linearFt: string
  depthIn: string
  addPct: string
  treeRings: string
  count: string
}

function defaultInputState(): MaterialInputState {
  return { sqft: '', linearFt: '', depthIn: '', addPct: '0', treeRings: '0', count: '0' }
}

function toComputeInput(state: MaterialInputState): MaterialComputeInput {
  return {
    sqft: state.sqft !== '' ? parseFloat(state.sqft) || 0 : 0,
    linearFt: state.linearFt !== '' ? parseFloat(state.linearFt) || 0 : 0,
    depthIn: state.depthIn !== '' ? parseFloat(state.depthIn) || undefined : undefined,
    addPct: parseFloat(state.addPct) / 100 || 0, // addPct is displayed as whole %, e.g. "10" = 0.10
    treeRings: parseFloat(state.treeRings) || 0,
    count: parseFloat(state.count) || 0,
  }
}

// ---------------------------------------------------------------------------
// Discrete depth options from the sfPerTonAtDepthIn factor table
// ---------------------------------------------------------------------------

function depthOptions(row: MaterialCalcRow): string[] {
  const table = row.factors['sfPerTonAtDepthIn']
  if (typeof table === 'object' && table !== null) {
    return Object.keys(table).sort((a, b) => parseFloat(a) - parseFloat(b))
  }
  return []
}

// ---------------------------------------------------------------------------
// MaterialCard — one card per material row
// ---------------------------------------------------------------------------

interface MaterialCardProps {
  row: MaterialCalcRow
  inputState: MaterialInputState
  bands: MarginBands
  onInput: (field: keyof MaterialInputState, value: string) => void
}

function MaterialCard({ row, inputState, bands, onInput }: MaterialCardProps) {
  const calc = useMemo(() => buildMaterialCalc(row), [row])
  const input = toComputeInput(inputState)
  const { units, uom } = calc.compute(input)

  const lineTotalCents = Math.round(units * row.unitSellCents)
  const costCents = Math.round(units * row.unitCostCents)
  const gm = groupMargin(lineTotalCents, costCents)

  // Determine which primary measurement field to show
  const needsSqft =
    row.computeType === 'divRoll' ||
    row.computeType === 'sod' ||
    row.computeType === 'mulch' ||
    row.computeType === 'fert' ||
    row.computeType === 'backfill' ||
    row.computeType === 'aggregate'
  const needsLinearFt = row.computeType === 'divPiece'

  // Discrete depth options (for aggregate mainly)
  const discreteDepths = depthOptions(row)
  const hasDiscreteDepth = discreteDepths.length > 0
  const showDepthField = row.computeType === 'aggregate' || row.computeType === 'mulch' || row.computeType === 'backfill'

  // Default depthIn when it's a depth-based formula with no discrete options
  const defaultDepth =
    typeof row.factors['defaultDepthIn'] === 'number' ? String(row.factors['defaultDepthIn']) : ''

  // Initialise depthIn display to default if not yet set
  const displayDepth = inputState.depthIn !== '' ? inputState.depthIn : defaultDepth

  return (
    <div
      data-testid={`material-card-${row.materialKey}`}
      className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden"
    >
      {/* Card header */}
      <div className="px-4 py-2.5 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
        <h3 className="text-sm font-semibold text-[hsl(var(--fg))]">{row.label}</h3>
        <span className="text-[10px] text-[hsl(var(--muted-fg))] font-mono uppercase">{row.uom}</span>
      </div>

      {/* 3-column layout: Inputs | Computed Qty | Pricing */}
      <div className="grid grid-cols-3 divide-x divide-[hsl(var(--border))]">

        {/* Column 1 — Inputs (blue cells) */}
        <div className="px-3 py-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] mb-1">Inputs</p>

          {needsSqft && (
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-[hsl(var(--muted-fg))]">Area (SF)</span>
              <input
                data-testid="input-sqft"
                type="number"
                min="0"
                className={BLUE_INPUT}
                value={inputState.sqft}
                onChange={(e) => onInput('sqft', e.target.value)}
                placeholder="0"
              />
            </label>
          )}

          {needsLinearFt && (
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-[hsl(var(--muted-fg))]">Length (LF)</span>
              <input
                data-testid="input-linearFt"
                type="number"
                min="0"
                className={BLUE_INPUT}
                value={inputState.linearFt}
                onChange={(e) => onInput('linearFt', e.target.value)}
                placeholder="0"
              />
            </label>
          )}

          {showDepthField && (
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-[hsl(var(--muted-fg))]">Depth (in)</span>
              {hasDiscreteDepth ? (
                <select
                  data-testid="select-depthIn"
                  className={BLUE_INPUT}
                  value={displayDepth}
                  onChange={(e) => onInput('depthIn', e.target.value)}
                >
                  {discreteDepths.map((d) => (
                    <option key={d} value={d}>{d}"</option>
                  ))}
                </select>
              ) : (
                <input
                  data-testid="input-depthIn"
                  type="number"
                  min="0"
                  step="0.5"
                  className={BLUE_INPUT}
                  value={displayDepth}
                  onChange={(e) => onInput('depthIn', e.target.value)}
                  placeholder={defaultDepth || '0'}
                />
              )}
            </label>
          )}

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-[hsl(var(--muted-fg))]">Add / Waste %</span>
            <input
              data-testid="input-addPct"
              type="number"
              min="0"
              max="50"
              step="1"
              className={BLUE_INPUT}
              value={inputState.addPct}
              onChange={(e) => onInput('addPct', e.target.value)}
              placeholder="0"
            />
          </label>
        </div>

        {/* Column 2 — Computed order qty */}
        <div className="px-3 py-3 flex flex-col items-center justify-center gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] mb-1">Order Qty</p>
          <div className={QTY_CELL}>
            <p
              data-testid="computed-qty"
              className="text-2xl font-bold text-[#2E7D52] tabular-nums"
            >
              {units.toLocaleString()}
            </p>
            <p className="text-[10px] text-[#2E7D52]/70 font-mono uppercase">{uom}</p>
          </div>
          {row.volumeQuoteThresholdSf !== undefined && (
            <p className="text-[9px] text-amber-600 text-center mt-1">
              44,000 SF+ → exact quote required
            </p>
          )}
        </div>

        {/* Column 3 — Pricing */}
        <div className="px-3 py-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] mb-1">Pricing</p>

          <div className="flex justify-between text-[11px]">
            <span className="text-[hsl(var(--muted-fg))]">Unit sell</span>
            <span className="font-mono tabular-nums">{formatCents(row.unitSellCents)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[hsl(var(--muted-fg))]">Unit cost</span>
            <span className="font-mono tabular-nums">{formatCents(row.unitCostCents)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[hsl(var(--muted-fg))]">GM %</span>
            <span
              data-testid="margin-gm"
              className={cn('font-semibold tabular-nums', gmLabel(gm, bands))}
            >
              {(gm * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between text-[11.5px] font-semibold pt-1 border-t border-[hsl(var(--border))]">
            <span>Line total</span>
            <span
              data-testid="line-total"
              className="tabular-nums font-mono"
            >
              {formatCents(lineTotalCents)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MaterialsCalculator — main export
// ---------------------------------------------------------------------------

export interface MaterialsCalculatorProps {
  /**
   * Config rows to render. Defaults to the API-fetched material_calcs config
   * (MATERIAL_FORMULA_ROWS is the offline fallback). Accepting
   * this as a prop makes the component config-extensible in tests without
   * code edits — a new row in the array renders a new card.
   */
  rows?: MaterialCalcRow[]
}

export function MaterialsCalculator({ rows: rowsProp }: MaterialsCalculatorProps) {
  const { openEstimate } = useEstimatingShell()
  const { materialCalcs, marginBands } = useEstimatingConfig()
  const rows = rowsProp ?? materialCalcs

  // Guard: this calculator is install-only.
  if (openEstimate && openEstimate.estimateType !== 'install') {
    return null
  }

  return <MaterialsCalculatorInner rows={rows} bands={marginBands} />
}

// Inner component holds state (avoids hook-order issues with the guard above).
function MaterialsCalculatorInner({ rows, bands }: { rows: MaterialCalcRow[]; bands: MarginBands }) {
  // Per-material input state keyed by materialKey
  const [inputs, setInputs] = useState<Record<string, MaterialInputState>>(
    () => Object.fromEntries(rows.map((r) => [r.materialKey, defaultInputState()])),
  )

  function handleInput(materialKey: string, field: keyof MaterialInputState, value: string) {
    setInputs((prev) => ({
      ...prev,
      [materialKey]: { ...(prev[materialKey] ?? defaultInputState()), [field]: value },
    }))
  }

  // Subtotal: sum of all line totals
  const subtotalCents = useMemo(() => {
    return rows.reduce((sum, row) => {
      const state = inputs[row.materialKey] ?? defaultInputState()
      const calc = buildMaterialCalc(row)
      const { units } = calc.compute(toComputeInput(state))
      return sum + Math.round(units * row.unitSellCents)
    }, 0)
  }, [rows, inputs])

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>
          <strong>Install-only.</strong> Each material declares its own driving factors and
          conversion — not flat QTY × unit price. Blue cells are estimator overrides. Formulas
          require LS Estimating sign-off before finalizing.
        </span>
      </div>

      {/* Material cards */}
      <div className="space-y-3">
        {rows.map((row) => {
          const state = inputs[row.materialKey] ?? defaultInputState()
          return (
            <MaterialCard
              key={row.id}
              row={row}
              inputState={state}
              bands={bands}
              onInput={(field, value) => handleInput(row.materialKey, field, value)}
            />
          )
        })}
      </div>

      {/* Materials subtotal */}
      <div
        data-testid="materials-subtotal"
        className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--fg))] text-[hsl(var(--bg))] px-4 py-3 flex items-center justify-between"
      >
        <span className="text-sm font-semibold">Materials Subtotal</span>
        <span className="text-base font-bold tabular-nums font-mono">
          {formatCents(subtotalCents)}
        </span>
      </div>

      {/* Freight / volume-price placeholder note */}
      <div
        data-testid="freight-placeholder-note"
        className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800"
      >
        <strong>Note:</strong> Freight tables &amp; volume-price thresholds apply on top (44,000 SF+
        → exact quote). Walk this sheet with LS Estimating before submitting.{' '}
        <em>Future config: freight and volume-price tiers will be data rows, not code.</em>
      </div>
    </div>
  )
}
