// ---------------------------------------------------------------------------
// Handoff 17 — Line-Item Editor Persistence: diff-and-apply save.
//
// The editors keep edits in local React state; on Save they reconcile the
// draft tree against the last server-loaded tree and issue the section /
// service / component CRUD calls:
//
//   node in draft but not saved   → create   (POST, ids stripped — server mints)
//   node in both, fields changed  → update   (PATCH, changed fields ONLY)
//   node in saved but not draft   → delete   (DELETE; children cascade)
//
// Diff (not full-replace) was chosen to preserve server ids and the audit
// trail (Handoff 17 §4). sortOrder is diffed like any other field, so
// reordering persists. After persistEstimateTree the caller MUST re-fetch the
// estimate — the server is authoritative (ids, rollups, timestamps).
//
// Ops execute deletes → updates → creates, awaited per batch so a Save is one
// user action: any failure rejects and the editor shows the ONE save-error
// banner (no partial-save states leak to the UI).
// ---------------------------------------------------------------------------

import {
  estimatingApi,
  type CreateComponentPayload,
  type CreateSectionPayload,
  type CreateServicePayload,
  type UpdateComponentPayload,
  type UpdateSectionPayload,
  type UpdateServicePayload,
} from '@/api/estimating'
import type {
  EstimateSection,
  SectionService,
  SectionServiceComponent,
} from '@/types/estimating'

export type TreeOp =
  | { op: 'createSection'; section: EstimateSection }
  | { op: 'updateSection'; sectionId: string; patch: UpdateSectionPayload }
  | { op: 'deleteSection'; sectionId: string }
  | { op: 'createService'; sectionId: string; service: SectionService }
  | { op: 'updateService'; sectionId: string; serviceId: string; patch: UpdateServicePayload }
  | { op: 'deleteService'; sectionId: string; serviceId: string }
  | { op: 'createComponent'; sectionId: string; serviceId: string; component: SectionServiceComponent }
  | {
      op: 'updateComponent'
      sectionId: string
      serviceId: string
      componentId: string
      patch: UpdateComponentPayload
    }
  | { op: 'deleteComponent'; sectionId: string; serviceId: string; componentId: string }

// Diffable scalar fields per level (ids/children handled structurally).
const SECTION_FIELDS = ['name', 'squareFeet', 'sortOrder'] as const
const SERVICE_FIELDS = [
  'catalogItemId',
  'label',
  'qty',
  'uom',
  'complexityPct',
  'unitSellCents',
  'embeddedCostCents',
  'targetGm',
  'hours',
  'sortOrder',
] as const
const COMPONENT_FIELDS = ['kind', 'label', 'qty', 'unitCostCents', 'hours', 'sortOrder'] as const

function changedFields<T, K extends keyof T>(saved: T, draft: T, fields: readonly K[]): Partial<T> {
  const patch: Partial<T> = {}
  for (const f of fields) {
    if (!Object.is(saved[f], draft[f])) patch[f] = draft[f]
  }
  return patch
}

/** Key a list by id for saved↔draft reconciliation. */
function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]))
}

function diffComponents(
  sectionId: string,
  serviceId: string,
  saved: SectionServiceComponent[],
  draft: SectionServiceComponent[],
): TreeOp[] {
  const ops: TreeOp[] = []
  const savedMap = byId(saved)
  const draftMap = byId(draft)
  for (const c of saved) {
    if (!draftMap.has(c.id)) ops.push({ op: 'deleteComponent', sectionId, serviceId, componentId: c.id })
  }
  for (const c of draft) {
    const prev = savedMap.get(c.id)
    if (!prev) {
      ops.push({ op: 'createComponent', sectionId, serviceId, component: c })
      continue
    }
    const patch = changedFields(prev, c, COMPONENT_FIELDS)
    if (Object.keys(patch).length > 0) {
      ops.push({ op: 'updateComponent', sectionId, serviceId, componentId: c.id, patch })
    }
  }
  return ops
}

function diffServices(
  sectionId: string,
  saved: SectionService[],
  draft: SectionService[],
): TreeOp[] {
  const ops: TreeOp[] = []
  const savedMap = byId(saved)
  const draftMap = byId(draft)
  for (const sv of saved) {
    if (!draftMap.has(sv.id)) ops.push({ op: 'deleteService', sectionId, serviceId: sv.id })
  }
  for (const sv of draft) {
    const prev = savedMap.get(sv.id)
    if (!prev) {
      ops.push({ op: 'createService', sectionId, service: sv })
      continue
    }
    const patch = changedFields(prev, sv, SERVICE_FIELDS)
    if (Object.keys(patch).length > 0) {
      ops.push({ op: 'updateService', sectionId, serviceId: sv.id, patch })
    }
    ops.push(...diffComponents(sectionId, sv.id, prev.components, sv.components))
  }
  return ops
}

/**
 * Reconcile the draft tree against the last server-loaded tree and return the
 * minimal CRUD op list. Pure — no I/O — so the reconciliation is unit-testable.
 */
export function diffEstimateTree(
  saved: EstimateSection[],
  draft: EstimateSection[],
): TreeOp[] {
  const ops: TreeOp[] = []
  const savedMap = byId(saved)
  const draftMap = byId(draft)
  for (const s of saved) {
    if (!draftMap.has(s.id)) ops.push({ op: 'deleteSection', sectionId: s.id })
  }
  for (const s of draft) {
    const prev = savedMap.get(s.id)
    if (!prev) {
      ops.push({ op: 'createSection', section: s })
      continue
    }
    const patch = changedFields(prev, s, SECTION_FIELDS)
    if (Object.keys(patch).length > 0) {
      ops.push({ op: 'updateSection', sectionId: s.id, patch })
    }
    ops.push(...diffServices(s.id, prev.services, s.services))
  }
  return ops
}

// ── Payload builders (strip local/draft ids — the server mints real ones) ────

function toComponentPayload(c: SectionServiceComponent): CreateComponentPayload {
  return {
    kind: c.kind,
    label: c.label,
    qty: c.qty,
    unitCostCents: c.unitCostCents,
    hours: c.hours,
    sortOrder: c.sortOrder,
  }
}

function toServicePayload(sv: SectionService): CreateServicePayload {
  return {
    catalogItemId: sv.catalogItemId,
    label: sv.label,
    qty: sv.qty,
    uom: sv.uom,
    complexityPct: sv.complexityPct,
    unitSellCents: sv.unitSellCents,
    embeddedCostCents: sv.embeddedCostCents,
    targetGm: sv.targetGm,
    hours: sv.hours,
    sortOrder: sv.sortOrder,
    components: sv.components.map(toComponentPayload),
  }
}

function toSectionPayload(s: EstimateSection): CreateSectionPayload {
  return {
    name: s.name,
    squareFeet: s.squareFeet,
    sortOrder: s.sortOrder,
    services: s.services.map(toServicePayload),
  }
}

/**
 * Execute the diff through the typed client: deletes, then updates, then
 * creates (each batch awaited before the next so deletes can never race the
 * creates that replace them). Rejects on the first failure — callers surface
 * the save-error banner and the user retries the whole Save.
 */
export async function persistEstimateTree(
  estimateId: string,
  saved: EstimateSection[],
  draft: EstimateSection[],
): Promise<void> {
  const ops = diffEstimateTree(saved, draft)

  const run = (o: TreeOp): Promise<unknown> => {
    switch (o.op) {
      case 'deleteSection':
        return estimatingApi.deleteSection(estimateId, o.sectionId)
      case 'deleteService':
        return estimatingApi.deleteService(estimateId, o.sectionId, o.serviceId)
      case 'deleteComponent':
        return estimatingApi.deleteComponent(estimateId, o.sectionId, o.serviceId, o.componentId)
      case 'updateSection':
        return estimatingApi.updateSection(estimateId, o.sectionId, o.patch)
      case 'updateService':
        return estimatingApi.updateService(estimateId, o.sectionId, o.serviceId, o.patch)
      case 'updateComponent':
        return estimatingApi.updateComponent(
          estimateId,
          o.sectionId,
          o.serviceId,
          o.componentId,
          o.patch,
        )
      case 'createSection':
        return estimatingApi.createSection(estimateId, toSectionPayload(o.section))
      case 'createService':
        return estimatingApi.createService(estimateId, o.sectionId, toServicePayload(o.service))
      case 'createComponent':
        return estimatingApi.createComponent(
          estimateId,
          o.sectionId,
          o.serviceId,
          toComponentPayload(o.component),
        )
    }
  }

  const phase = (pred: (o: TreeOp) => boolean) => Promise.all(ops.filter(pred).map(run))
  await phase((o) => o.op.startsWith('delete'))
  await phase((o) => o.op.startsWith('update'))
  await phase((o) => o.op.startsWith('create'))
}
