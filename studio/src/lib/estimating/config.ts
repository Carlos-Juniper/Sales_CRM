// ---------------------------------------------------------------------------
// Estimating config seeds (Handoff 00 §3.7 / §3.9 / §3.10 / §3.13).
//
// Approval tiers, ITB scopes, material formulas, margin bands, and the
// discrepancy threshold are DATA ROWS, not literals scattered in code.
// Changing behavior means adding/editing a row here (and, in production, in
// the corresponding config table) — never a code edit.
// ---------------------------------------------------------------------------

import type {
  ApprovalTier,
  EstimateType,
  ItbScope,
  MarginBands,
  MaterialCalc,
  MaterialCalcRow,
  MaterialComputeInput,
  MaterialComputeResult,
  MaterialComputeType,
} from '@/types/estimating'

// ----- Margin bands (§3.13) --------------------------------------------------

/**
 * The one canonical band set every view reads — resolves the prototype's
 * three conflicting definitions (18/10, 20/12, 34/28).
 * TODO(carlos): confirm final thresholds before ship. Seeded per Handoff 00
 * defaults: good ≥ 20%, ok ≥ 12%.
 */
export const DEFAULT_MARGIN_BANDS: MarginBands = {
  goodMin: 0.2,
  okMin: 0.12,
}

// ----- Discrepancy threshold (§3.8) -------------------------------------------

/**
 * Takeoff discrepancy threshold config: default 10%, adjustable 1–25%.
 * Ported from the Project Summary Template defaults (BRD §3.1).
 */
export const DISCREPANCY_THRESHOLD = {
  defaultPct: 0.1,
  minPct: 0.01,
  maxPct: 0.25,
} as const

// ----- Approval tiers (§3.9) ---------------------------------------------------

/**
 * Maintenance ladder per BRD I-7: BM <$100K · RD $100K–$250K · BP $250K–$1M ·
 * COO >$1M. Values in integer cents; min inclusive, max exclusive, null max
 * unbounded.
 *
 * Install has NO approval matrix yet (open item) — when defined, it is added
 * here as rows with `estimateType: 'install'`; no code change required.
 */
export const APPROVAL_TIER_SEED: ApprovalTier[] = [
  { id: 'tier-maint-bm', roleKey: 'branch_manager', label: 'Branch Manager', minValueCents: 0, maxValueCents: 10_000_000, order: 1, estimateType: 'maintenance' },
  { id: 'tier-maint-rd', roleKey: 'regional_director', label: 'Regional Director', minValueCents: 10_000_000, maxValueCents: 25_000_000, order: 2, estimateType: 'maintenance' },
  { id: 'tier-maint-bp', roleKey: 'bp', label: 'Business Partner', minValueCents: 25_000_000, maxValueCents: 100_000_000, order: 3, estimateType: 'maintenance' },
  { id: 'tier-maint-coo', roleKey: 'coo', label: 'COO', minValueCents: 100_000_000, maxValueCents: null, order: 4, estimateType: 'maintenance' },
]

/** Ladder for one estimate type. Empty ⇒ "no approval matrix defined". */
export function tiersForType(tiers: ApprovalTier[], estimateType: EstimateType): ApprovalTier[] {
  return tiers.filter((t) => t.estimateType === estimateType)
}

// ----- ITB scopes (§3.10) --------------------------------------------------------

/** Config-driven ITB scope columns — admin-extensible without migration. */
export const ITB_SCOPE_SEED: ItbScope[] = [
  { id: 'scope-landscape', key: 'landscape', label: 'Landscape', group: 'estimating', order: 1 },
  { id: 'scope-irrigation', key: 'irrigation', label: 'Irrigation', group: 'estimating', order: 2 },
  { id: 'scope-trees', key: 'trees', label: 'Trees', group: 'estimating', order: 3 },
  { id: 'scope-sod', key: 'sod', label: 'Sod', group: 'estimating', order: 4 },
  { id: 'scope-maintenance', key: 'maintenance', label: 'Maintenance', group: 'outside_dept', order: 5 },
  { id: 'scope-arbor', key: 'arbor', label: 'Arbor Care', group: 'outside_dept', order: 6 },
  { id: 'scope-hardscape', key: 'hardscape', label: 'Hardscape', group: 'vendor_only', order: 7 },
  { id: 'scope-fencing', key: 'fencing', label: 'Fencing', group: 'vendor_only', order: 8 },
  { id: 'scope-lighting', key: 'lighting', label: 'Landscape Lighting', group: 'vendor_only', order: 9 },
]

// ----- Material formulas (§3.7) ---------------------------------------------------

const CY_SF_IN = 324 // 1 cubic yard covers 324 sqft at 1" depth

function num(factors: MaterialCalcRow['factors'], key: string, fallback = 0): number {
  const v = factors[key]
  return typeof v === 'number' ? v : fallback
}

function table(factors: MaterialCalcRow['factors'], key: string): Record<string, number> {
  const v = factors[key]
  return typeof v === 'object' && v !== null ? v : {}
}

/**
 * The formula engine: `compute_type` + `factors` → units. Adding a material
 * is a data change (a new row); the engine never needs editing for that.
 *
 * All formulas apply the estimator's `addPct` waste factor (default 0) before
 * computing order quantity. This matches the handoff §2 specification where
 * every formula is `ceil(measurement × (1+add%) / conversion)`.
 */
const FORMULA_ENGINE: Record<
  MaterialComputeType,
  (input: MaterialComputeInput, row: MaterialCalcRow) => number
> = {
  // linear feet × (1+add%) ÷ piece length (edging, root barrier)
  divPiece: ({ linearFt = 0, addPct = 0 }, row) =>
    Math.ceil((linearFt * (1 + addPct)) / Math.max(num(row.factors, 'pieceLengthFt', 1), 0.0001)),
  // square feet × (1+add%) ÷ roll coverage (weed barrier)
  divRoll: ({ sqft = 0, addPct = 0 }, row) =>
    Math.ceil((sqft * (1 + addPct)) / Math.max(num(row.factors, 'rollSf', 1), 0.0001)),
  // square feet × (1+add%) ÷ SF-per-ton at depth (rock/aggregate depth table)
  aggregate: ({ sqft = 0, depthIn, addPct = 0 }, row) => {
    const depths = table(row.factors, 'sfPerTonAtDepthIn')
    const depth = depthIn ?? num(row.factors, 'defaultDepthIn', 2)
    const sfPerTon = depths[String(depth)] ?? depths[String(num(row.factors, 'defaultDepthIn', 2))] ?? 100
    return Math.ceil((sqft * (1 + addPct)) / sfPerTon)
  },
  // square feet × (1+add%) ÷ pallet coverage
  sod: ({ sqft = 0, addPct = 0 }, row) =>
    Math.ceil((sqft * (1 + addPct)) / Math.max(num(row.factors, 'palletSf', 1), 0.0001)),
  // area × (1+add%) × depth → cubic yards
  mulch: ({ sqft = 0, depthIn, addPct = 0 }, row) => {
    const depth = depthIn ?? num(row.factors, 'defaultDepthIn', 2)
    return Math.ceil((sqft * (1 + addPct) * depth) / CY_SF_IN)
  },
  // square feet × (1+add%) ÷ bag coverage
  fert: ({ sqft = 0, addPct = 0 }, row) =>
    Math.ceil((sqft * (1 + addPct)) / Math.max(num(row.factors, 'coverageSfPerBag', 1), 0.0001)),
  // area × (1+add%) × depth → cubic yards, inflated by compaction factor
  backfill: ({ sqft = 0, depthIn, addPct = 0 }, row) => {
    const depth = depthIn ?? num(row.factors, 'defaultDepthIn', 6)
    const compaction = num(row.factors, 'compactionPct', 0)
    return Math.ceil(((sqft * (1 + addPct) * depth) / CY_SF_IN) * (1 + compaction))
  },
}

/** Hydrate a config row with its `compute` function. */
export function buildMaterialCalc(row: MaterialCalcRow): MaterialCalc {
  return {
    ...row,
    compute: (input: MaterialComputeInput): MaterialComputeResult => ({
      units: FORMULA_ENGINE[row.computeType](input, row),
      uom: row.uom,
    }),
  }
}

/**
 * Seed rows for every material key in Handoff 00 §3.7. Factors are the
 * configurable knobs; freight tables / 44,000 SF+ volume-quote thresholds are
 * future config via `volumeQuoteThresholdSf`.
 */
export const MATERIAL_FORMULA_ROWS: MaterialCalcRow[] = [
  { id: 'mc-edging', materialKey: 'edging', label: 'Steel Edging', computeType: 'divPiece', factors: { pieceLengthFt: 16 }, unitSellCents: 3200, unitCostCents: 1900, uom: 'pcs' },
  { id: 'mc-weed-barrier', materialKey: 'weed_barrier', label: 'Weed Barrier Fabric', computeType: 'divRoll', factors: { rollSf: 300 }, unitSellCents: 8900, unitCostCents: 5400, uom: 'rolls' },
  { id: 'mc-aggregate', materialKey: 'aggregate', label: 'Decorative Rock / Aggregate', computeType: 'aggregate', factors: { sfPerTonAtDepthIn: { '2': 120, '3': 80 }, defaultDepthIn: 2 }, unitSellCents: 9800, unitCostCents: 6200, uom: 'tons', volumeQuoteThresholdSf: 44000 },
  { id: 'mc-sod', materialKey: 'sod', label: 'Sod', computeType: 'sod', factors: { palletSf: 450 }, unitSellCents: 28500, unitCostCents: 19500, uom: 'pallets' },
  { id: 'mc-mulch', materialKey: 'mulch', label: 'Mulch', computeType: 'mulch', factors: { defaultDepthIn: 2 }, unitSellCents: 6800, unitCostCents: 4100, uom: 'cy' },
  { id: 'mc-fert', materialKey: 'fert', label: 'Fertilizer', computeType: 'fert', factors: { coverageSfPerBag: 5000 }, unitSellCents: 5200, unitCostCents: 3300, uom: 'bags' },
  { id: 'mc-backfill', materialKey: 'backfill', label: 'Backfill Soil', computeType: 'backfill', factors: { defaultDepthIn: 6, compactionPct: 0.15 }, unitSellCents: 5500, unitCostCents: 3400, uom: 'cy' },
  { id: 'mc-root-barrier', materialKey: 'root_barrier', label: 'Root Barrier', computeType: 'divPiece', factors: { pieceLengthFt: 24 }, unitSellCents: 14500, unitCostCents: 9800, uom: 'pcs' },
]
