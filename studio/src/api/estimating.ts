import { apiClient } from './client'
import type {
  AspireOpportunitySummary,
  CreatePropertyPayload,
  Estimate,
  EstimateApprovalSettings,
  EstimateSection,
  EstimateStatus,
  EstimateType,
  IntakeSubmission,
  Property,
  SectionService,
} from '@/types/estimating'
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
  'id' | 'createdAt' | 'updatedAt' | 'aspireOpportunityId' | 'aspireSyncStatus'
> & {
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
 * (Handoff 00 §2) and the data-access layer exposes no update path for it.
 */
export type UpdateEstimatePayload = Partial<{
  name: string
  aspireNumber: string | null
  clientName: string
  branch: string
  customerType: Estimate['customerType']
  acreage: number | null
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
  approvalSettings: EstimateApprovalSettings
  /**
   * Captured at the `lost` transition (→ Aspire OpportunityLostReasonID). Not a
   * persisted display column; the backend stores it for the write-back + sweep.
   */
  lostReasonId: number
}>

/** Handoff 08 — "Approve & hand back to Sales" (in-platform, not email). */
export interface ApproveHandBackPayload {
  actor: string
  /** Optionally persist the notify-both setting alongside the approval. */
  notifyBmRdOnReturn?: boolean
}

export interface ApproveHandBackResponse {
  estimate: Estimate
  /** Audit records written for this action (actor + timestamp per step). */
  transitions: StatusTransitionRecord[]
}

export type CreateSectionPayload = Omit<EstimateSection, 'id' | 'estimateId' | 'services'> &
  Partial<Pick<EstimateSection, 'services'>>
export type UpdateSectionPayload = Partial<Omit<EstimateSection, 'id' | 'estimateId' | 'services'>>
export type CreateServicePayload = Omit<SectionService, 'id' | 'sectionId'>
export type UpdateServicePayload = Partial<Omit<SectionService, 'id' | 'sectionId' | 'components'>>

export interface ListEstimatesParams {
  estimateType?: EstimateType
  status?: EstimateStatus
  /**
   * Row-level scope (BRD I-9.5). Enforced server-side; the client passes the
   * user's branch so mocks/dev mirror the scoped query.
   */
  branch?: string
}

/** Runtime guard backing the compile-time omission of `estimateType`. */
function assertNoEstimateTypeMutation(body: object): void {
  if ('estimateType' in body) {
    throw new Error('estimateType is immutable and cannot be updated after creation')
  }
}

export const estimatingApi = {
  list: (params?: ListEstimatesParams) => {
    const qs = new URLSearchParams()
    if (params?.estimateType) qs.set('estimate_type', params.estimateType)
    if (params?.status) qs.set('status', params.status)
    if (params?.branch) qs.set('branch', params.branch)
    const q = qs.toString()
    return apiClient.get<Estimate[]>(`/estimating/estimates${q ? `?${q}` : ''}`)
  },
  get: (id: string) => apiClient.get<Estimate>(`/estimating/estimates/${id}`),
  create: (body: CreateEstimatePayload) =>
    apiClient.post<Estimate>('/estimating/estimates', body),
  update: async (id: string, body: UpdateEstimatePayload) => {
    assertNoEstimateTypeMutation(body)
    return apiClient.patch<Estimate>(`/estimating/estimates/${id}`, body)
  },

  /**
   * Handoff 08: approve the estimate and hand it back to the salesperson via
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

  /** Structured intake submissions for an estimate (the estimator's raw form data). */
  listIntake: (id: string) =>
    apiClient.get<IntakeSubmission[]>(`/estimating/estimates/${id}/intake`),

  /** Manually re-trigger the best-effort Aspire push for a pending/failed estimate. */
  retryAspireSync: (id: string) =>
    apiClient.post<{ status: string }>(`/estimating/estimates/${id}/retry-aspire-sync`, {}),

  /** Presign a GCS resumable upload session for a single PDF attachment. */
  presignAttachment: (
    estimateId: string,
    body: { kind: import('@/types/estimating').AttachmentKind; fileName: string; contentType: string; sizeBytes: number },
  ) =>
    apiClient.post<{ attachmentId: string; objectKey: string; uploadUrl: string }>(
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
}

/**
 * Properties data-access layer. The LOCAL table is the source of truth: search
 * reads it, create writes it (returning a pending row) and the Aspire push runs
 * in the background. `opportunities` is a best-effort Aspire read for the intake
 * dedup panel — it returns [] when sync is disabled or the property is unsynced.
 */
export const propertiesApi = {
  list: (search?: string) =>
    apiClient.get<Property[]>(
      `/properties${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    ),
  create: (body: CreatePropertyPayload) => apiClient.post<Property>('/properties', body),
  opportunities: (propertyId: string) =>
    apiClient.get<AspireOpportunitySummary[]>(`/properties/${propertyId}/opportunities`),
}
