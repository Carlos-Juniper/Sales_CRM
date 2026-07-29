// ---------------------------------------------------------------------------
// Maintenance engine helpers (Handoff 03 — Line-Item Editor, maintenance).
//
// Pure logic + config for the hours-driven, section-based editor:
//   • service catalog (sq-ft basis ENFORCED — BRD I-6.5's $3M–$42M acre bug)
//   • company-default complexity + override detection (BRD I-9.7)
//   • section CRUD operations (duplicate / add / remove)
//   • Bidding↔Won lifecycle transition with the Aspire-ownership flip and an
//     audit record, enforced HERE in the handler, never UI-only (BRD §8.1)
//   • estimator-vs-approver field ownership (enforced in logic, not just UI)
//
// All pricing math stays in ./calc — nothing here reimplements it.
// ---------------------------------------------------------------------------

import type {
  AspireOwner,
  Estimate,
  EstimateLifecycle,
  EstimateSection,
  SectionService,
} from '@/types/estimating'
import { per1000SfRead } from './calc'

// ----- Complexity (I-9.7) ----------------------------------------------------

/**
 * Company-set default complexity (hours adder). Rows deviating from it are
 * visually flagged as overrides. TODO(carlos): confirm the final company
 * default value.
 */
export const COMPANY_DEFAULT_COMPLEXITY_PCT = 0.1

/** Dropdown options for the complexity hours-adder. */
export const COMPLEXITY_OPTIONS = [0, 0.05, 0.1, 0.15, 0.2, 0.25]

/** An override is any complexity away from the company norm. */
export function isComplexityOverridden(complexityPct: number): boolean {
  return complexityPct !== COMPANY_DEFAULT_COMPLEXITY_PCT
}

// ----- Service catalog (sq-ft basis, I-6.5) -----------------------------------

/**
 * The ONLY legal pricing basis for maintenance kit services. Acres are
 * intentionally unrepresentable at the type level — a prior acre-based
 * fertilization config produced $3M–$42M errors on a single property.
 */
export type ServiceBasis = 'sqft'

export interface ServiceGranularity {
  /** e.g. "Mower size" — Aspire kit option group (I-9.7). */
  label: string
  options: string[]
  defaultOption: string
}

export interface MaintenanceCatalogService {
  key: string
  label: string
  uom: '/yr'
  basis: ServiceBasis
  /**
   * Blended $/1,000-SF proxy rate (integer cents) from the prototype. Open
   * item (Handoff 00 §3.6): replace with real Aspire production-rate kits —
   * never flat QTY × price.
   */
  rateCentsPer1000Sf: number
  defaultQty: number
  granularity?: ServiceGranularity
}

/** Aspire kit mower-size options (I-9.7). */
export const MOWER_SIZE_OPTIONS = ['36"', '52–60"', '72"']

/**
 * Region-template services an estimator can add ("add line item", I-9.7).
 * Config data — extending the catalog is a row, not a code change.
 */
export const MAINTENANCE_SERVICE_CATALOG: MaintenanceCatalogService[] = [
  {
    key: 'mow',
    label: 'Mowing',
    uom: '/yr',
    basis: 'sqft',
    rateCentsPer1000Sf: 450,
    defaultQty: 42,
    granularity: { label: 'Mower size', options: MOWER_SIZE_OPTIONS, defaultOption: '52–60"' },
  },
  { key: 'trim', label: 'Trimming & edging', uom: '/yr', basis: 'sqft', rateCentsPer1000Sf: 240, defaultQty: 42 },
  { key: 'detail', label: 'Bed detail', uom: '/yr', basis: 'sqft', rateCentsPer1000Sf: 210, defaultQty: 26 },
  { key: 'irr', label: 'Irrigation checks', uom: '/yr', basis: 'sqft', rateCentsPer1000Sf: 320, defaultQty: 12 },
  { key: 'fert', label: 'Fertilizer & pest', uom: '/yr', basis: 'sqft', rateCentsPer1000Sf: 135, defaultQty: 6 },
]

/**
 * Runtime guard mirroring the compile-time `ServiceBasis`: config rows loaded
 * as data (future admin-managed kit config) must still be sq-ft based.
 */
export function assertSqftBasis(row: { key: string; label: string; basis: string }): void {
  if (row.basis !== 'sqft') {
    throw new Error(
      `Maintenance service "${row.label}" must be configured on a square-footage basis, ` +
        `never "${row.basis}" (BRD I-6.5 — acre-based kits caused $3M–$42M estimate errors).`,
    )
  }
}

/** Granularity options for a service label, from the kit catalog config. */
export function granularityFor(label: string): ServiceGranularity | null {
  return MAINTENANCE_SERVICE_CATALOG.find((r) => r.label === label)?.granularity ?? null
}

// ----- Input coercion ----------------------------------------------------------

/** Blank/invalid input coerces to 0; negatives are clamped to 0. */
export function coerceQty(raw: string): number {
  const n = Number(raw)
  if (raw.trim() === '' || Number.isNaN(n) || n < 0) return 0
  return n
}

// ----- Section operations --------------------------------------------------------

let opSeq = 0
function newId(prefix: string): string {
  opSeq += 1
  return `${prefix}-${Date.now()}-${opSeq}`
}

/** Build a SectionService from a catalog row (sq-ft basis asserted). */
export function catalogToService(
  row: MaintenanceCatalogService,
  sectionId: string,
  sortOrder: number,
): SectionService {
  assertSqftBasis(row)
  return {
    id: newId('svc'),
    sectionId,
    catalogItemId: row.key,
    label: row.label,
    qty: row.defaultQty,
    uom: row.uom,
    complexityPct: COMPANY_DEFAULT_COMPLEXITY_PCT,
    unitSellCents: row.rateCentsPer1000Sf,
    embeddedCostCents: null,
    targetGm: null,
    hours: null,
    sortOrder,
    components: [],
  }
}

/** Default new section, seeded with the core region-template services. */
export function buildDefaultSection(estimateId: string, sortOrder: number): EstimateSection {
  const id = newId('sec')
  const seedKeys = ['mow', 'trim', 'fert']
  const services = MAINTENANCE_SERVICE_CATALOG.filter((r) => seedKeys.includes(r.key)).map(
    (row, i) => catalogToService(row, id, i),
  )
  return { id, estimateId, name: 'New region', squareFeet: 100_000, sortOrder, services }
}

/** Deep-clone `sectionId`, append " (copy)", insert right after the source. */
export function duplicateSection(
  sections: EstimateSection[],
  sectionId: string,
): EstimateSection[] {
  const idx = sections.findIndex((s) => s.id === sectionId)
  if (idx === -1) return sections
  const source = sections[idx]
  const copyId = newId('sec')
  const copy: EstimateSection = {
    ...source,
    id: copyId,
    name: `${source.name} (copy)`,
    services: source.services.map((svc) => ({
      ...svc,
      id: newId('svc'),
      sectionId: copyId,
      components: svc.components.map((c) => ({ ...c, id: newId('cmp') })),
    })),
  }
  const next = [...sections]
  next.splice(idx + 1, 0, copy)
  return next
}

export function removeSection(sections: EstimateSection[], sectionId: string): EstimateSection[] {
  return sections.filter((s) => s.id !== sectionId)
}

// ----- Lifecycle & ownership (BRD §8.1) --------------------------------------------

/** Ownership always DERIVES from lifecycle — it cannot be set independently. */
export function aspireOwnerFor(lifecycle: EstimateLifecycle): AspireOwner {
  return lifecycle === 'won' ? 'crm' : 'estimating'
}

export interface LifecycleAuditRecord {
  estimateId: string
  from: EstimateLifecycle
  to: EstimateLifecycle
  aspireOwnerFrom: AspireOwner
  aspireOwnerTo: AspireOwner
  actor: string
  at: string
}

/**
 * In-memory audit log. Open item: persist through a backend audit endpoint
 * once one exists (none is defined in the Handoff 00 API surface yet).
 */
export const lifecycleAuditLog: LifecycleAuditRecord[] = []

export function clearLifecycleAuditLog(): void {
  lifecycleAuditLog.length = 0
}

/**
 * THE status-transition handler. Flips `lifecycle`, derives `aspireOwner`,
 * and writes the audit record. Returns null for a no-op transition. The UI
 * banner merely reflects the state this handler produces.
 */
export function transitionLifecycle<E extends Estimate>(
  estimate: E,
  to: EstimateLifecycle,
  actor: string,
): { estimate: E; audit: LifecycleAuditRecord } | null {
  if (estimate.lifecycle === to) return null
  const audit: LifecycleAuditRecord = {
    estimateId: estimate.id,
    from: estimate.lifecycle,
    to,
    aspireOwnerFrom: aspireOwnerFor(estimate.lifecycle),
    aspireOwnerTo: aspireOwnerFor(to),
    actor,
    at: new Date().toISOString(),
  }
  lifecycleAuditLog.push(audit)
  return { estimate: { ...estimate, lifecycle: to, aspireOwner: aspireOwnerFor(to) }, audit }
}

// ----- Field ownership (estimator vs approver) ---------------------------------------

export type EstimatingRole = 'estimator' | 'approver'

export type OwnedField =
  | 'lineItems'
  | 'qty'
  | 'squareFeet'
  | 'sectionName'
  | 'complexity'
  | 'margin'

/** Estimator-owned scope fields; approvers may only adjust complexity + margin. */
const FIELD_OWNERSHIP: Record<OwnedField, EstimatingRole[]> = {
  lineItems: ['estimator'],
  qty: ['estimator'],
  squareFeet: ['estimator'],
  sectionName: ['estimator'],
  complexity: ['estimator', 'approver'],
  margin: ['approver'],
}

export function canEditField(role: EstimatingRole, field: OwnedField): boolean {
  return FIELD_OWNERSHIP[field].includes(role)
}

export function assertCanEdit(role: EstimatingRole, field: OwnedField): void {
  if (!canEditField(role, field)) {
    const owner = FIELD_OWNERSHIP[field].join('/')
    throw new Error(`"${field}" is ${owner}-owned — a ${role} may not edit it.`)
  }
}

// ----- Display reads --------------------------------------------------------------

/** Exact dollars from integer cents: 2_494_800 → "$24,948.00". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Per-line ¢/SF read (recomputed as complexity changes, I-9.7). Derived from
 * the shared per-1,000-SF read in calc.ts — no local pricing math.
 */
export function lineCentsPerSqft(lineTotalCents: number, sqft: number): number {
  return per1000SfRead(lineTotalCents, sqft) / 1000
}
