import { apiClient } from './client'
import type {
  ApprovalTier,
  AspireOpportunitySummary,
  BranchOption,
  CatalogItem,
  CreatePropertyPayload,
  Estimate,
  EstimateApprovalSettings,
  EstimateSection,
  EstimateStatus,
  EstimateType,
  IntakeDraft,
  IntakeSubmission,
  ItbProject,
  ItbScope,
  ItbScopeStatus,
  ItbStatusCode,
  KitType,
  MarginBandRow,
  MaterialCalcRow,
  Property,
  SectionService,
  SectionServiceComponent,
  TakeoffLine,
} from '@/types/estimating'
import type { EstimateLifecycle } from '@/types/estimating'
import type { OccurrenceCountKey } from '@/lib/estimating/occurrences'
import type { StatusTransitionRecord } from '@/lib/estimating/transitions'

// Omit that distributes over the Estimate discriminated union so the
// estimateType discriminant survives.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Server assigns id/timestamps AND the Aspire push fields (aspireOpportunityId,
 * aspireSyncStatus) — those land asynchronously via the background sync, so the
 * client never sends them. `propertyId` IS sent (from the property selector).
 */
export type CreateEstimatePayload = DistributiveOmit<
  Estimate,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'aspireOpportunityId'
  | 'aspireSyncStatus'
  // Server-computed from dueBackDate. Never sent by the client.
  | 'isRush'
  // Optional on create: omit stores null. A sent 0 stays 0.
  | 'homesBudget'
  | 'commonAreaBudget'
  // Optional on create: omit or null stores NULL. Install intake omits them.
  | OccurrenceCountKey
> &
  Partial<Pick<Estimate, OccurrenceCountKey>> & {
  /** Homes budget in dollars. Omit or null → unknown. 0 stays 0. */
  homesBudget?: number | null
  /** Common-area budget in dollars. Omit or null → unknown. 0 stays 0. */
  commonAreaBudget?: number | null
  /**
   * Opportunity service line (→ Aspire DivisionID). Not persisted on the estimate
   * row; the backend reads it to build the opportunity payload. Defaults per type.
   */
  serviceLine?: string
  /**
   * Structured intake form payload. Persisted verbatim to intake_submissions —
   * NEVER to `notes` (that column is a short human queue note). Attachment file
   * bytes are future scope; only names travel, inside `payload`.
   */
  intake?: IntakeSubmissionInput
}

/** Structured intake payload sent alongside estimate creation (→ intake_submissions). */
export interface IntakeSubmissionInput {
  payload: Record<string, unknown>
  /** Attachment metadata; file bytes/URLs are future scope, so this is optional. */
  attachments?: { fileName: string; contentType?: string; sizeBytes?: number; url?: string }[]
}

/**
 * `estimateType` is intentionally absent — it is immutable after creation
 * and the data-access layer exposes no update path for it.
 */
export type UpdateEstimatePayload = Partial<{
  name: string
  aspireNumber: string | null
  clientName: string
  /** Aspire BranchID (identity). */
  aspireBranchId: number | null
  /** Display city label mirroring the legacy `estimates.branch` column. */
  branchCity: string | null
  customerType: Estimate['customerType']
  acreage: number | null
  /** Yearly visit counts. Omit to leave unchanged; null clears; 0 stores 0. */
  mowingOccurrences: number | null
  pruningOccurrences: number | null
  turfFertOccurrences: number | null
  shrubFertOccurrences: number | null
  ipmOccurrences: number | null
  irrigationOccurrences: number | null
  contractValueCents: number
  targetMargin: number
  status: EstimateStatus
  lifecycle: Estimate['lifecycle']
  aspireOwner: Estimate['aspireOwner']
  priority: Estimate['priority']
  winProbability: number
  siteWalkDate: string | null
  dueBackDate: string
  anticipatedCloseDate: string | null
  serviceStartDate: string | null
  assignedLsEstimator: string | null
  assignedIrrEstimator: string | null
  crmRep: string | null
  /** Tracked RFI status (capture/display only; never gates approval). */
  rfiStatus: string | null
  /** Manual takeoff metadata (Beam AI is the future source; paused). */
  turfAreaAcres: number | null
  curbMiles: number | null
  approvalSettings: EstimateApprovalSettings
  /**
   * Captured at the `lost` transition (→ Aspire OpportunityLostReasonID). Not a
   * persisted display column; the backend stores it for the write-back + sweep.
   */
  lostReasonId: number
  /**
   * Homes budget in dollars. Omit to keep the stored value. Null or blank
   * clears it back to unknown. 0 stores 0. Estimator-owned.
   */
  homesBudget: number | null
  /** Common-area budget in dollars. Same omit / null / 0 rules as homesBudget. */
  commonAreaBudget: number | null
}>

/** Body for POST /api/estimating/intake/drafts. */
export interface SaveIntakeDraftPayload {
  estimateType: EstimateType
  /** Partial intake form state, persisted verbatim. */
  payload: Record<string, unknown>
  /** Update an existing draft in place instead of creating a new row. */
  draftId?: string
}

/** "Approve & hand back to Sales" (in-platform, not email). */
export interface ApproveHandBackPayload {
  /**
   * DEPRECATED: the server derives the actor from the JWT and
   * ignores this field. Kept optional for wire compatibility only.
   */
  actor?: string
  /** Optionally persist the notify-both setting alongside the approval. */
  notifyBmRdOnReturn?: boolean
}

export interface ApproveHandBackResponse {
  estimate: Estimate
  /** Audit records written for this action (actor + timestamp per step). */
  transitions: StatusTransitionRecord[]
}

/** Body for POST /estimates/:id/adjustments (one lever change). */
export interface CreateAdjustmentPayload {
  field: import('@/types/estimating').AdjustmentField
  /** Decimals (0.22 = 22%). Revert-to-original is a reversing row (current → original). */
  fromValue: number
  toValue: number
  /**
   * DEPRECATED: the server derives the actor from the JWT and
   * ignores this field. Kept optional for wire compatibility only.
   */
  actor?: string
}

// Create payloads carry NO ids anywhere in the tree — the server assigns them
// down every level (sections → services → components) and the editors reload
// after Save, so local draft ids never leak to the wire.
export type CreateComponentPayload = Omit<SectionServiceComponent, 'id' | 'sectionServiceId'>
export type UpdateComponentPayload = Partial<CreateComponentPayload>
export type CreateServicePayload = Omit<SectionService, 'id' | 'sectionId' | 'components'> & {
  components?: CreateComponentPayload[]
}
export type UpdateServicePayload = Partial<Omit<SectionService, 'id' | 'sectionId' | 'components'>>
export type CreateSectionPayload = Omit<EstimateSection, 'id' | 'estimateId' | 'services'> & {
  services?: CreateServicePayload[]
}
export type UpdateSectionPayload = Partial<Omit<EstimateSection, 'id' | 'estimateId' | 'services'>>

/**
 * Takeoff lines. Derived fields come back RECOMPUTED server-side
 * (client-sent derived values are ignored); the Discrepancy Review tab still
 * re-derives live against its threshold slider via lib/estimating/discrepancy.
 */
export interface TakeoffLineWithDerived extends TakeoffLine {
  bidQty: number
  flagged: boolean
  deltaVsOpp: number
}
export type CreateTakeoffLinePayload = Omit<TakeoffLine, 'id' | 'estimateId'>
export type UpdateTakeoffLinePayload = Partial<CreateTakeoffLinePayload>

/**
 * Response of the persisted Bidding↔Won flip. `transition`
 * is null when the flip was a no-op (already in the requested lifecycle).
 * Lifecycle edges ride the ONE status-transition audit trail with a
 * `lifecycle:` prefix — there is no separate audit table.
 */
export interface LifecycleTransitionResult {
  estimate: Estimate
  transition: StatusTransitionRecord | null
}

export interface ListEstimatesParams {
  estimateType?: EstimateType
  status?: EstimateStatus
  /**
   * Row-level scope (BRD I-9.5) is derived SERVER-side from the session;
   * this param is ignored for non-exec roles and survives only
   * as an optional narrowing filter for cross-branch (admin/VP/CEO) roles.
   */
  branch?: string
  /**
   * Filter to estimates belonging to a specific lead (Handoff 37 §7).
   * Added to avoid client-side filtering of the full list when BidTab needs
   * only the approved estimate for a given lead.
   */
  leadId?: string
}

/** Runtime guard backing the compile-time omission of `estimateType`. */
function assertNoEstimateTypeMutation(body: object): void {
  if ('estimateType' in body) {
    throw new Error('estimateType is immutable and cannot be updated after creation')
  }
}

/** `isRush` is computed by the server. Drop it if a caller still has it. */
function stripIsRush<T extends object>(body: T): T {
  if (!('isRush' in body)) return body
  const copy = { ...body }
  delete (copy as { isRush?: unknown }).isRush
  return copy
}

export const estimatingApi = {
  list: (params?: ListEstimatesParams) => {
    const qs = new URLSearchParams()
    if (params?.estimateType) qs.set('estimate_type', params.estimateType)
    if (params?.status) qs.set('status', params.status)
    if (params?.branch) qs.set('branch', params.branch)
    // Handoff 37 §7: backend added leadId filter in Slice 4 (api/estimating.py list_estimates)
    if (params?.leadId) qs.set('leadId', params.leadId)
    const q = qs.toString()
    return apiClient.get<Estimate[]>(`/estimating/estimates${q ? `?${q}` : ''}`)
  },
  get: (id: string) => apiClient.get<Estimate>(`/estimating/estimates/${id}`),
  create: (body: CreateEstimatePayload) =>
    apiClient.post<Estimate>('/estimating/estimates', stripIsRush(body)),
  update: async (id: string, body: UpdateEstimatePayload) => {
    assertNoEstimateTypeMutation(body)
    return apiClient.patch<Estimate>(`/estimating/estimates/${id}`, stripIsRush(body))
  },

  /**
   * Approve the estimate and hand it back to the salesperson via
   * status change. The server walks the transition machine
   * (lib/estimating/transitions.ts) and writes one audit record per step.
   */
  approveAndHandBack: (id: string, body: ApproveHandBackPayload) =>
    apiClient.post<ApproveHandBackResponse>(
      `/estimating/estimates/${id}/approve-handback`,
      body,
    ),
  /** Audit trail of status transitions (actor + timestamp), oldest first. */
  listStatusTransitions: (id: string) =>
    apiClient.get<StatusTransitionRecord[]>(`/estimating/estimates/${id}/status-transitions`),

  /**
   * Persist one audited approver lever change (complexity or
   * margin) to estimate_adjustments. Approver-only server-side; the actor is
   * derived from the JWT. This is the audited companion of the estimate PATCH
   * that moves targetMargin/contractValueCents — one approver action may write
   * both an adjustment row and a status transition (approve-handback).
   */
  createAdjustment: (id: string, body: CreateAdjustmentPayload) =>
    apiClient.post<import('@/types/estimating').EstimateAdjustment>(
      `/estimating/estimates/${id}/adjustments`,
      body,
    ),
  /** The persisted adjustments audit trail (BRD III-1), oldest first. */
  listAdjustments: (id: string) =>
    apiClient.get<import('@/types/estimating').EstimateAdjustment[]>(
      `/estimating/estimates/${id}/adjustments`,
    ),

  /** Structured intake submissions for an estimate (the estimator's raw form data). */
  listIntake: (id: string) =>
    apiClient.get<IntakeSubmission[]>(`/estimating/estimates/${id}/intake`),

  /**
   * Backend Save-draft (replaces localStorage). A draft is a
   * partial intake persisted per-user (device-independent); it creates no
   * estimate and triggers no Aspire push. Pass `draftId` to update in place.
   */
  saveIntakeDraft: (body: SaveIntakeDraftPayload) =>
    apiClient.post<IntakeDraft>('/estimating/intake/drafts', body),
  /** The caller's saved drafts, newest first (resume on any device). */
  listIntakeDrafts: (estimateType?: EstimateType) =>
    apiClient.get<IntakeDraft[]>(
      `/estimating/intake/drafts${estimateType ? `?estimate_type=${estimateType}` : ''}`,
    ),
  /** Discard a draft (e.g. after the real submission succeeds). */
  deleteIntakeDraft: (draftId: string) =>
    apiClient.delete<void>(`/estimating/intake/drafts/${draftId}`),

  /** Manually re-trigger the best-effort Aspire push for a pending/failed estimate. */
  retryAspireSync: (id: string) =>
    apiClient.post<{ status: string }>(`/estimating/estimates/${id}/retry-aspire-sync`, {}),

  /**
   * Presign a GCS resumable upload session. RFP (`kind: "rfp"`) accepts PDF,
   * Word, and Excel; every other kind stays on its own allowlist. The returned
   * `contentType` is the MIME the browser PUT must send.
   */
  presignAttachment: (
    estimateId: string,
    body: { kind: import('@/types/estimating').AttachmentKind; fileName: string; contentType: string; sizeBytes: number },
  ) =>
    apiClient.post<{ attachmentId: string; objectKey: string; uploadUrl: string; contentType: string }>(
      `/estimating/estimates/${estimateId}/attachments/presign`,
      body,
    ),

  /** Confirm that the browser PUT to the resumable session completed successfully. */
  confirmAttachment: (estimateId: string, attachmentId: string) =>
    apiClient.post<import('@/types/estimating').IntakeAttachment>(
      `/estimating/estimates/${estimateId}/attachments/${attachmentId}/confirm`,
      {},
    ),

  /** List all attachments for an estimate (stored, pending, and legacy name-only rows). */
  listAttachments: (estimateId: string) =>
    apiClient.get<import('@/types/estimating').IntakeAttachment[]>(
      `/estimating/estimates/${estimateId}/attachments`,
    ),

  /** Get a short-lived signed download URL (10 min) for a stored attachment. */
  getAttachmentDownloadUrl: (estimateId: string, attachmentId: string) =>
    apiClient.get<{ url: string; expiresIn: number }>(
      `/estimating/estimates/${estimateId}/attachments/${attachmentId}/download-url`,
    ),

  /** Reorder an 'other' proposal attachment (Handoff 47) — sortOrder only. */
  patchAttachmentSortOrder: (estimateId: string, attachmentId: string, sortOrder: number) =>
    apiClient.patch<import('@/types/estimating').IntakeAttachment>(
      `/estimating/estimates/${estimateId}/attachments/${attachmentId}`,
      { sortOrder },
    ),

  /** Soft-delete an attachment and remove its GCS object (Handoff 47). */
  deleteAttachment: (estimateId: string, attachmentId: string) =>
    apiClient.delete<void>(
      `/estimating/estimates/${estimateId}/attachments/${attachmentId}`,
    ),

  // ── Lead-scoped proposal attachment routes (WS2) ─────────────────────────
  // Used when generating a proposal before an estimate exists. Mirrors the
  // estimate-scoped presign/confirm/list routes but targets /api/leads/{leadId}.

  /** Presign a GCS resumable upload session for a lead-scoped proposal document. */
  presignLeadAttachment: (
    leadId: string,
    body: { kind: import('@/types/estimating').AttachmentKind; fileName: string; contentType: string; sizeBytes: number },
  ) =>
    apiClient.post<{ attachmentId: string; objectKey: string; uploadUrl: string; contentType?: string }>(
      `/leads/${leadId}/attachments/presign`,
      body,
    ),

  /** Confirm a lead-scoped proposal document upload (flips status to 'stored'). */
  confirmLeadAttachment: (leadId: string, attachmentId: string) =>
    apiClient.post<import('@/types/estimating').IntakeAttachment>(
      `/leads/${leadId}/attachments/${attachmentId}/confirm`,
      {},
    ),

  /** List lead-scoped proposal document attachments (proposal kinds only). */
  listLeadAttachments: (leadId: string) =>
    apiClient.get<import('@/types/estimating').IntakeAttachment[]>(
      `/leads/${leadId}/attachments`,
    ),

  /** Soft-delete a lead-scoped proposal document attachment (C1-1). */
  deleteLeadAttachment: (leadId: string, attachmentId: string) =>
    apiClient.delete<void>(`/leads/${leadId}/attachments/${attachmentId}`),

  createSection: (estimateId: string, body: CreateSectionPayload) =>
    apiClient.post<EstimateSection>(`/estimating/estimates/${estimateId}/sections`, body),
  updateSection: (estimateId: string, sectionId: string, body: UpdateSectionPayload) =>
    apiClient.patch<EstimateSection>(
      `/estimating/estimates/${estimateId}/sections/${sectionId}`,
      body,
    ),
  deleteSection: (estimateId: string, sectionId: string) =>
    apiClient.delete<void>(`/estimating/estimates/${estimateId}/sections/${sectionId}`),

  createService: (estimateId: string, sectionId: string, body: CreateServicePayload) =>
    apiClient.post<SectionService>(
      `/estimating/estimates/${estimateId}/sections/${sectionId}/services`,
      body,
    ),
  updateService: (
    estimateId: string,
    sectionId: string,
    serviceId: string,
    body: UpdateServicePayload,
  ) =>
    apiClient.patch<SectionService>(
      `/estimating/estimates/${estimateId}/sections/${sectionId}/services/${serviceId}`,
      body,
    ),
  deleteService: (estimateId: string, sectionId: string, serviceId: string) =>
    apiClient.delete<void>(
      `/estimating/estimates/${estimateId}/sections/${sectionId}/services/${serviceId}`,
    ),

  // Component CRUD — the kit labor/material breakdown level.
  createComponent: (
    estimateId: string,
    sectionId: string,
    serviceId: string,
    body: CreateComponentPayload,
  ) =>
    apiClient.post<SectionServiceComponent>(
      `/estimating/estimates/${estimateId}/sections/${sectionId}/services/${serviceId}/components`,
      body,
    ),
  updateComponent: (
    estimateId: string,
    sectionId: string,
    serviceId: string,
    componentId: string,
    body: UpdateComponentPayload,
  ) =>
    apiClient.patch<SectionServiceComponent>(
      `/estimating/estimates/${estimateId}/sections/${sectionId}/services/${serviceId}/components/${componentId}`,
      body,
    ),
  deleteComponent: (
    estimateId: string,
    sectionId: string,
    serviceId: string,
    componentId: string,
  ) =>
    apiClient.delete<void>(
      `/estimating/estimates/${estimateId}/sections/${sectionId}/services/${serviceId}/components/${componentId}`,
    ),

  // Takeoff-line CRUD (Discrepancy Review persistence). All qty
  // fields, including opportunityQty, are estimator-writable local values —
  // opportunityQty is NEVER read from Aspire. The Aspire qty push happens
  // backend-side on estimate Save (PATCH update), not from these calls.
  listTakeoffLines: (estimateId: string) =>
    apiClient.get<TakeoffLineWithDerived[]>(
      `/estimating/estimates/${estimateId}/takeoff-lines`,
    ),
  createTakeoffLine: (estimateId: string, body: CreateTakeoffLinePayload) =>
    apiClient.post<TakeoffLineWithDerived>(
      `/estimating/estimates/${estimateId}/takeoff-lines`,
      body,
    ),
  updateTakeoffLine: (estimateId: string, lineId: string, body: UpdateTakeoffLinePayload) =>
    apiClient.patch<TakeoffLineWithDerived>(
      `/estimating/estimates/${estimateId}/takeoff-lines/${lineId}`,
      body,
    ),
  deleteTakeoffLine: (estimateId: string, lineId: string) =>
    apiClient.delete<void>(`/estimating/estimates/${estimateId}/takeoff-lines/${lineId}`),

  /**
   * Persist the Bidding↔Won flip server-side. The server
   * derives aspireOwner from the lifecycle and records the edge in
   * estimate_status_transitions (actor from the JWT) — the ONE audit trail
   * (the old client-side in-memory log was deleted).
   */
  setLifecycle: (id: string, to: EstimateLifecycle) =>
    apiClient.post<LifecycleTransitionResult>(`/estimating/estimates/${id}/lifecycle`, { to }),
}

/** Filters for GET /api/estimating/service-kits (alias: /catalog-items). */
export interface ListCatalogItemsParams {
  branch?: string
  kitType?: KitType
  active?: boolean
}

/**
 * Config-Table Read APIs. The seeded config tables
 * (approval_tiers, margin_bands, material_calcs, itb_scopes, service_kits)
 * are the source of truth; the config.ts literals are only the offline
 * fallback. READ-ONLY by locked decision — there are no write endpoints.
 */
export const estimatingConfigApi = {
  approvalTiers: (estimateType?: EstimateType) =>
    apiClient.get<ApprovalTier[]>(
      `/estimating/config/approval-tiers${estimateType ? `?estimate_type=${estimateType}` : ''}`,
    ),
  marginBands: () => apiClient.get<MarginBandRow[]>('/estimating/config/margin-bands'),
  materialCalcs: () => apiClient.get<MaterialCalcRow[]>('/estimating/config/material-calcs'),
  itbScopes: () => apiClient.get<ItbScope[]>('/estimating/config/itb-scopes'),
  /** Aspire-derived branch list for the intake dropdowns. */
  branches: (kind: 'install' | 'maintenance') =>
    apiClient.get<BranchOption[]>(`/estimating/config/branches?kind=${kind}`),
  catalogItems: (params?: ListCatalogItemsParams) => {
    const qs = new URLSearchParams()
    if (params?.branch) qs.set('branch', params.branch)
    if (params?.kitType) qs.set('kit_type', params.kitType)
    if (params?.active !== undefined) qs.set('active', String(params.active))
    const q = qs.toString()
    return apiClient.get<CatalogItem[]>(`/estimating/service-kits${q ? `?${q}` : ''}`)
  },
}

/** GET /api/estimating/itb/projects row: a project + its scope statuses. */
export interface ItbProjectWithStatuses extends ItbProject {
  statuses: ItbScopeStatus[]
}

/**
 * ITB tracker backend. Projects are AUTO-GENERATED (one per
 * estimate, at intake); there is no create endpoint. `projects` returns all
 * ACTIVE estimates' projects (status not won/lost), branch-scoped server-side.
 * Scope DEFINITIONS come from estimatingConfigApi.itbScopes.
 */
export const estimatingItbApi = {
  projects: () => apiClient.get<ItbProjectWithStatuses[]>('/estimating/itb/projects'),
  updateScopeStatus: (projectId: string, scopeId: string, statusCode: ItbStatusCode) =>
    apiClient.patch<ItbScopeStatus>(
      `/estimating/itb/projects/${projectId}/scopes/${scopeId}`,
      { statusCode },
    ),
}

/**
 * CANONICAL properties data-access layer. The LOCAL table is the
 * source of truth: search reads it; create writes it LOCAL-ONLY as an upsert on
 * (sourceType, sourceId) — the row stays 'unsynced' and the Aspire push fires
 * only when an estimate is submitted for it. `opportunities` is a best-effort
 * Aspire read for the intake dedup panel — it returns [] when sync is disabled
 * or the property is unsynced. `promote` is create-lead-from-property (the
 * generalized promote path).
 */
export const propertiesApi = {
  list: (search?: string) =>
    apiClient.get<Property[]>(
      `/properties${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    ),
  create: (body: CreatePropertyPayload) => apiClient.post<Property>('/properties', body),
  opportunities: (propertyId: string) =>
    apiClient.get<AspireOpportunitySummary[]>(`/properties/${propertyId}/opportunities`),
  promote: (propertyId: string) =>
    apiClient.post<{ id: string; property_id: string; status: string }>(
      `/properties/${propertyId}/promote`,
      {},
    ),
}

// ── Beam / Attentive AI takeoff ─────────────────────────────────────────────

export interface BeamOutput {
  id: string
  featureName: string
  measurementName: string
  value: number | null
  unit: string | null
  geometryType: number | null
  isCustom: boolean
  appliedToSectionId: string | null
  appliedValue: number | null
  appliedUnit: string | null
  outputUpdatedAt: string | null
}

/** A measurement Beam returned that has no mapping — surfaced, never dropped. */
export interface BeamUnmapped {
  featureName: string
  unit: string | null
}

export interface BeamRequest {
  id: string
  propertyId: string
  estimateId: string | null
  attentiveRequestId: string | null
  /** Deep link into Attentive's editor; null until the draft exists there. */
  editorUrl: string | null
  status:
    | 'unordered'
    | 'draft'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'queued'
    | 'investigating'
    | 'resubmitted'
  /** What Attentive will charge. Shown BEFORE generate — generate is billable. */
  costCents: number | null
  etaSeconds: number | null
  parcelAreaSqft: number | null
  address: string | null
  submittedAt: string | null
  completedAt: string | null
  syncStatus: string | null
  syncError: string | null
  unmapped: BeamUnmapped[]
  outputs?: BeamOutput[]
}

/**
 * Beam takeoff ordering and review.
 *
 * `createDraft` is free; `generate` is the ONLY call in the app that spends
 * money, which is why cost is fetched and displayed first and why the server
 * gates it on the estimator role and makes it idempotent.
 */
export const beamApi = {
  /** The estimate's most recent takeoff request, or null if none has been created. */
  forEstimate: (estimateId: string) =>
    apiClient.get<BeamRequest | null>(`/estimating/estimates/${estimateId}/beam`),
  createDraft: (estimateId: string, address: string) =>
    apiClient.post<BeamRequest>(`/estimating/estimates/${estimateId}/beam/draft`, { address }),
  get: (beamRequestId: string) =>
    apiClient.get<BeamRequest>(`/estimating/beam/requests/${beamRequestId}`),
  generate: (beamRequestId: string) =>
    apiClient.post<BeamRequest>(`/estimating/beam/requests/${beamRequestId}/generate`, {}),
  acceptChanges: (beamRequestId: string) =>
    apiClient.post<BeamRequest>(`/estimating/beam/requests/${beamRequestId}/accept`, {}),
}
