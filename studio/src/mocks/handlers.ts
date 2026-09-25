import { http, HttpResponse, delay } from 'msw'
import { useAuthStore } from '@/store/authStore'
import { normalizeRole } from '@/hooks/useRole'
import { ANALYTICS_NAV_ROLES } from '@/lib/roles'
import { mockLeads, mockBids, mockUsers, mockSummary, mockMonthlyRevenue, mockConnections, mockProposalPackages } from './data'
import { MOCK_BRANCH_COVERAGE } from './proposalRoster'
import { rosterHandlers } from './rosterHandlers'
import { CATALOG_ITEM_SEED, mockEstimatesV2, buildTakeoffLines } from './estimatingData'
import { PAGE_SIZE } from '../lib/constants'
import type { Lead, Bid, UserRole } from '@/types'
import type { ProposalPackageSummary } from '@/types/proposal'
import type {
  Estimate,
  EstimateAdjustment,
  EstimateSection,
  IntakeDraft,
  IntakeSubmission,
  IntakeAttachment,
  AttachmentKind,
  ItbProject,
  ItbScopeStatus,
  ItbStatusCode,
  SectionService,
  SectionServiceComponent,
  TakeoffLine,
} from '@/types/estimating'
import { LEAD_NOTES_MAX_LENGTH } from '@/api/leads'
import type {
  ApproveHandBackPayload,
  CreateAdjustmentPayload,
  CreateEstimatePayload,
  UpdateEstimatePayload,
  CreateSectionPayload,
  UpdateSectionPayload,
  CreateServicePayload,
  UpdateServicePayload,
  CreateComponentPayload,
  UpdateComponentPayload,
  CreateTakeoffLinePayload,
  UpdateTakeoffLinePayload,
} from '@/api/estimating'
import { deriveTakeoffLine } from '@/lib/estimating/discrepancy'
import {
  OCCURRENCE_COUNT_FIELDS,
  emptyOccurrenceCounts,
  occurrenceCountError,
} from '@/lib/estimating/occurrences'
import {
  approveAndHandBack,
  canTransition,
  IllegalTransitionError,
  type StatusTransitionRecord,
} from '@/lib/estimating/transitions'
import { coerceBudgetPatch, resolveContractBudgets } from '@/lib/estimating/contractBudgets'
import {
  APPROVAL_TIER_SEED,
  ITB_SCOPE_SEED,
  MATERIAL_FORMULA_ROWS,
} from '@/lib/estimating/config'
import {
  extensionForStoredContentType,
  normalizeContentType,
  validateAttachmentSize,
  validateRfpDocument,
} from '@/lib/estimating/rfpContentTypes'
import {
  DUE_BACK_PAST_MESSAGE,
  SLA_CONFIG,
  businessDateOnly,
  defaultDueBackDate,
  isPastCalendarDate,
  isRushWindowDate,
} from '@/lib/estimating/sla'

const API = '/api'

type IntakeTypeName = 'maintenance' | 'install'

const DEFAULT_ALLOWED_INTAKE: IntakeTypeName[] = ['maintenance', 'install']

/**
 * Mock session read by GET /api/auth/me and the intake lock.
 * Tests that need a locked role mutate `allowed_intake_types` and reset it.
 */
export const mockAuthSession: {
  role: UserRole
  allowed_intake_types: IntakeTypeName[]
} = {
  role: 'sales',
  allowed_intake_types: [...DEFAULT_ALLOWED_INTAKE],
}

export function resetMockAuthSession() {
  mockAuthSession.role = 'sales'
  mockAuthSession.allowed_intake_types = [...DEFAULT_ALLOWED_INTAKE]
}

/** 403 when the mock session may not submit this intake type. Null when allowed. */
function denyDisallowedIntake(estimateType: string) {
  if (mockAuthSession.allowed_intake_types.includes(estimateType as IntakeTypeName)) return null
  const only = mockAuthSession.allowed_intake_types
  const detail = only.length === 1
    ? `Role may only submit ${only[0]} intakes.`
    : 'Role may not submit this intake type.'
  return HttpResponse.json({ detail }, { status: 403 })
}

/** `?role=sales` is the five sales roles plus legacy sales / outside_sales. */
const SALES_GROUP_ROLES = new Set([
  'inside_sales',
  'maintenance_sales',
  'install_sales',
  'regional_sales',
  'vp_sales',
  'sales',
  'outside_sales',
])
const leads = [...mockLeads]
const bids = [...mockBids]
const proposalPackages: ProposalPackageSummary[] = [...mockProposalPackages]

// In-memory store for the new estimating model.
const estimates: Estimate[] = structuredClone(mockEstimatesV2)

// In-memory CANONICAL property store (source of truth; a row is
// local-only/'unsynced' until an estimate submission triggers the Aspire push).
interface MockProperty {
  id: string
  name: string
  propertyType: string | null
  sourceType: string | null
  sourceId: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  branchCity: string | null
  customerType: string | null
  managementCompanyId: string | null
  acreage: number | null
  units: number | null
  aspirePropertyId: number | null
  aspireSyncStatus: 'unsynced' | 'pending' | 'synced' | 'failed'
  createdAt: string | null
  updatedAt: string | null
}
const properties: MockProperty[] = []

// Status-transition audit log (actor + timestamp per change).
const statusTransitions: StatusTransitionRecord[] = []

// Persisted approver-lever audit (estimate_adjustments).
const estimateAdjustments: EstimateAdjustment[] = []
let adjustmentSeq = 0

// Structured intake submissions (persisted verbatim; NEVER in estimate.notes).
const intakeSubmissions: IntakeSubmission[] = []

// Server-side intake drafts ("Save draft"). Per-user and
// device-independent; a draft never creates an estimate or fires an Aspire push.
const intakeDrafts: IntakeDraft[] = []

// In-memory attachment store (GCS attachment feature).
const attachments: IntakeAttachment[] = []

// In-memory resumable sessions: sessionId → { attachmentId, estimateId }.
const resumableSessions: Map<string, { attachmentId: string; estimateId: string }> = new Map()

// Content-Type the browser actually PUT, keyed by attachment id. Confirm
// compares it to the presigned type and returns 400 when they disagree.
const uploadedContentTypeByAttachment = new Map<string, string>()

/** Attachment authz: linked directly (takeoff scans) or via the intake submission. */
function attachmentBelongsTo(a: IntakeAttachment, estimateId: string): boolean {
  if (a.estimateId === estimateId) return true
  return intakeSubmissions.some(
    (s) => s.id === a.intakeSubmissionId && s.estimateId === estimateId,
  )
}

// Takeoff lines (Discrepancy Review persistence). Lazily seeded
// per estimate with the sample fixture on first GET so the dev experience
// matches the old fixture-seeded tab; derived fields are recomputed on the
// way out (mirrors the backend, which never trusts client-sent derived values).
const takeoffLines: TakeoffLine[] = []
const seededTakeoffEstimates = new Set<string>()
function ensureTakeoffSeed(estimateId: string): void {
  if (seededTakeoffEstimates.has(estimateId)) return
  seededTakeoffEstimates.add(estimateId)
  takeoffLines.push(...buildTakeoffLines(estimateId))
}

let estimatingSeq = 0
function eid(prefix: string): string {
  estimatingSeq += 1
  return `${prefix}-${Date.now()}-${estimatingSeq}`
}

function notFound() {
  return HttpResponse.json({ error: 'Not found' }, { status: 404 })
}

/** 422 detail when a present occurrence count is not an integer 0–366 or null. */
function occurrenceDetail(body: object): string | null {
  const record = body as Record<string, unknown>
  for (const { key } of OCCURRENCE_COUNT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const message = occurrenceCountError(key, record[key])
    if (message) return message
  }
  return null
}

/** Mirror the server: isRush is computed, never trusted from the client. */
function withRush(estimate: Estimate): Estimate {
  const copy = { ...estimate }
  delete (copy as { isRush?: boolean }).isRush
  return {
    ...copy,
    isRush: isRushWindowDate(
      estimate.dueBackDate ?? '',
      SLA_CONFIG.returnWindowDays,
      businessDateOnly(),
    ),
  }
}

/** 400 when a written dueBackDate is before business today. Blank is allowed. */
function pastDueResponse(dueBackDate: string | null | undefined) {
  if (!dueBackDate) return null
  if (isPastCalendarDate(dueBackDate, businessDateOnly())) {
    return HttpResponse.json({ detail: DUE_BACK_PAST_MESSAGE }, { status: 400 })
  }
  return null
}

/** Create stores NULL for omitted keys. 0 is preserved; null stays null. */
function occurrenceColumns(body: object): ReturnType<typeof emptyOccurrenceCounts> {
  const record = body as Record<string, unknown>
  const counts = emptyOccurrenceCounts()
  for (const { key } of OCCURRENCE_COUNT_FIELDS) {
    if (record[key] !== undefined) counts[key] = record[key] as number | null
  }
  return counts
}

// ---------------------------------------------------------------------------
// ITB tracker store. One project per estimate, AUTO-GENERATED at
// estimate creation (LOCKED decision — either intake form). Scope statuses are
// initialized to DEFAULT_ITB_STATUS for every config scope.
// ---------------------------------------------------------------------------

interface MockItbProject extends ItbProject {
  statuses: ItbScopeStatus[]
}

const ITB_STATUS_CODES: ItbStatusCode[] = ['P', 'C', 'S', 'R', 'U', 'X', '-']
// Default initial scope status: 'P' Pending (confirmed with Carlos 2026-08-06).
const DEFAULT_ITB_STATUS: ItbStatusCode = 'P'

function quarterFor(isoDate: string): string {
  const month = Number(isoDate.slice(5, 7))
  return `Q${Math.floor((month - 1) / 3) + 1}`
}

/** Mirror the server's auto-generation: estimate → ITB row. */
function itbProjectForEstimate(e: Estimate): MockItbProject {
  const id = eid('itb')
  const due = (e.dueBackDate ?? new Date().toISOString()).slice(0, 10)
  return {
    id,
    estimateId: e.id,
    name: e.name,
    aspireNumber: e.aspireNumber ?? null,
    branch: e.branchCity ?? '',
    salesRep: e.crmRep ?? null,
    lsEstimator: e.assignedLsEstimator ?? null,
    irrEstimator: e.assignedIrrEstimator ?? null,
    irrDesigner: null,
    bidNumber: null,
    itbDate: (e.createdAt ?? new Date().toISOString()).slice(0, 10),
    dueDate: due,
    rebid: false,
    estTotalCents: e.contractValueCents ?? 0,
    // Intake carries no LS/IR split — the full value defaults to the LS side
    // (same flagged assumption as the server).
    estLsCents: e.contractValueCents ?? 0,
    estIrCents: 0,
    client: e.clientName,
    quarter: quarterFor(due),
    notes: null,
    statuses: ITB_SCOPE_SEED.map((s) => ({
      projectId: id,
      scopeId: s.id,
      statusCode: DEFAULT_ITB_STATUS,
    })),
  }
}

// Seeded estimates get their auto-generated projects too.
const itbProjects: MockItbProject[] = estimates.map(itbProjectForEstimate)

/** Match POST /api/leads: blank notes become null; over-max is a 422. */
function notesForCreate(raw: unknown): { ok: true; notes: string | null } | { ok: false } {
  if (typeof raw !== 'string') return { ok: true, notes: null }
  if (raw.length > LEAD_NOTES_MAX_LENGTH) return { ok: false }
  const trimmed = raw.trim()
  return { ok: true, notes: trimmed.length > 0 ? trimmed : null }
}

const allHandlers = [
  // GET /api/auth/me — mock session so the app shell can boot under VITE_MOCK
  http.get(`${API}/auth/me`, async () => {
    return HttpResponse.json({
      id: 'u2',
      email: 'morgan.lee@example.com',
      name: 'Morgan Lee',
      role: mockAuthSession.role,
      branch_id: 'c1',
      avatar_initials: 'ML',
      allowed_intake_types: mockAuthSession.allowed_intake_types,
    })
  }),

  // GET /api/leads
  http.get(`${API}/leads`, async ({ request }) => {
    await delay(300)
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const leadType = url.searchParams.get('lead_type')
    const leadTypes = url.searchParams.get('lead_types')
    const search = url.searchParams.get('search')
    const states = url.searchParams.get('states')
    const minScore = url.searchParams.get('min_score')
    const page = parseInt(url.searchParams.get('page') ?? '1')
    const pageSize = parseInt(url.searchParams.get('page_size') ?? String(PAGE_SIZE))
    const sortBy = url.searchParams.get('sort_by') ?? 'score'
    const sortDir = url.searchParams.get('sort_dir') ?? 'desc'

    let filtered = [...leads]
    if (status) filtered = filtered.filter(l => l.status === status)
    if (leadTypes) {
      const types = leadTypes.split(',')
      filtered = filtered.filter(l => types.includes(l.lead_type))
    } else if (leadType) {
      filtered = filtered.filter(l => l.lead_type === leadType)
    }
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(l =>
        l.property_name.toLowerCase().includes(q) || l.city.toLowerCase().includes(q)
      )
    }
    if (states) {
      const stateList = states.split(',')
      filtered = filtered.filter(l => stateList.includes(l.state))
    }
    if (minScore) filtered = filtered.filter(l => l.score !== null && l.score >= parseInt(minScore))
    // Property engagement: leads queryable by canonical property_id
    const propertyId = url.searchParams.get('property_id')
    if (propertyId) filtered = filtered.filter(l => l.property_id === propertyId)
    // Public Leads queue: hide leads once assigned (never deleted)
    if (url.searchParams.get('unassigned_only') === 'true') {
      filtered = filtered.filter(l => l.assigned_to == null)
    }

    filtered.sort((a, b) => {
      const av = a[sortBy as keyof Lead] as number | string
      const bv = b[sortBy as keyof Lead] as number | string
      if (av == null) return 1
      if (bv == null) return -1
      return sortDir === 'desc' ? (av > bv ? -1 : 1) : (av > bv ? 1 : -1)
    })

    const total = filtered.length
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)
    return HttpResponse.json({ data: paginated, total, page, page_size: pageSize })
  }),

  // POST /api/leads
  http.post(`${API}/leads`, async ({ request }) => {
    await delay(300)
    const body = await request.json() as Partial<Lead>
    const notesResult = notesForCreate(body.notes)
    if (!notesResult.ok) {
      return HttpResponse.json(
        {
          detail: [{
            type: 'string_too_long',
            loc: ['body', 'notes'],
            msg: `String should have at most ${LEAD_NOTES_MAX_LENGTH} characters`,
            ctx: { max_length: LEAD_NOTES_MAX_LENGTH },
          }],
        },
        { status: 422 },
      )
    }
    const newLead: Lead = {
      id: `l${Date.now()}`,
      property_name: body.property_name ?? 'Unnamed Lead',
      address: body.address ?? '',
      city: body.city ?? '',
      state: body.state ?? 'AZ',
      zip: body.zip ?? '',
      lat: 0, lng: 0,
      lead_type: body.lead_type ?? 'commercial',
      score: 50,
      score_factors: [],
      estimated_acreage: body.estimated_acreage ?? 0,
      estimated_contract_value: body.estimated_contract_value ?? 0,
      contact_name: body.contact_name ?? null,
      contact_email: body.contact_email ?? null,
      contact_linkedin: null,
      current_provider: null,
      source: 'manual',
      source_url: null,
      bid_deadline: null,
      status: body.status ?? 'new',
      assigned_to: null,
      notes: notesResult.notes,
      handoff_notes: null,
      ai_linkedin_draft: null,
      branch_id: 'b1',
      distance_miles: 0,
      aspire_opportunity_id: null,
      division_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    leads.push(newLead)
    return HttpResponse.json(newLead, { status: 201 })
  }),

  // GET /api/leads/:id/attachments — proposal documents when no estimate is linked
  http.get(`${API}/leads/:id/attachments`, async () => {
    return HttpResponse.json([])
  }),

  // GET /api/leads/:id
  http.get(`${API}/leads/:id`, async ({ params }) => {
    await delay(150)
    const lead = leads.find(l => l.id === params.id)
    if (!lead) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
    return HttpResponse.json(lead)
  }),

  // DELETE /api/leads/:id
  http.delete(`${API}/leads/:id`, async ({ params }) => {
    await delay(200)
    const idx = leads.findIndex(l => l.id === params.id)
    if (idx === -1) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
    leads.splice(idx, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  // PATCH /api/leads/:id
  http.patch(`${API}/leads/:id`, async ({ params, request }) => {
    await delay(250)
    const body = await request.json() as Partial<Lead>
    const idx = leads.findIndex(l => l.id === params.id)
    if (idx === -1) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
    leads[idx] = { ...leads[idx], ...body, updated_at: new Date().toISOString() }
    return HttpResponse.json(leads[idx])
  }),

  // GET /api/bids
  http.get(`${API}/bids`, async ({ request }) => {
    await delay(300)
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const leadId = url.searchParams.get('lead_id')
    let filtered = [...bids]
    if (status) filtered = filtered.filter(b => b.status === status)
    if (leadId) filtered = filtered.filter(b => b.lead_id === leadId)
    return HttpResponse.json(filtered)
  }),

  // POST /api/bids
  http.post(`${API}/bids`, async ({ request }) => {
    await delay(300)
    const body = await request.json() as Partial<Bid>
    const newBid: Bid = {
      id: `b${Date.now()}`,
      title: body.title ?? 'New Bid',
      agency: body.agency ?? '',
      service_types: body.service_types ?? [],
      deadline: body.deadline ?? new Date(Date.now() + 30 * 24 * 3600000).toISOString(),
      estimated_value: body.estimated_value ?? 0,
      status: 'pending',
      branch_id: body.branch_id ?? 'b1',
      assigned_estimator_id: null,
      lead_id: body.lead_id ?? null,
      submission_notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    bids.push(newBid)
    return HttpResponse.json(newBid, { status: 201 })
  }),

  // PATCH /api/bids/:id
  http.patch(`${API}/bids/:id`, async ({ params, request }) => {
    await delay(250)
    const body = await request.json() as Partial<Bid>
    const idx = bids.findIndex(b => b.id === params.id)
    if (idx === -1) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
    bids[idx] = { ...bids[idx], ...body, updated_at: new Date().toISOString() }
    return HttpResponse.json(bids[idx])
  }),

  // GET /api/proposals/packages — Proposals list (no section chips).
  // exclude_status is applied before the response, matching the API.
  http.get(`${API}/proposals/packages`, async ({ request }) => {
    await delay(200)
    const exclude = new URL(request.url).searchParams.get('exclude_status') ?? ''
    const excluded = new Set(exclude.split(',').map((s) => s.trim()).filter(Boolean))
    // A won/lost row still inside its 7-day grace window (closedAt set) survives
    // the exclude filter so the queue can show its Won/Lost badge, matching the
    // backend's grace behaviour; once grace lapses (closedAt null) it drops out.
    const rows = excluded.size
      ? proposalPackages.filter(
          (pkg) => !pkg.status || !excluded.has(pkg.status) || pkg.closedAt != null,
        )
      : proposalPackages
    return HttpResponse.json(rows)
  }),

  // POST /api/proposals — same lead + property constraint as the API
  http.post(`${API}/proposals`, async ({ request }) => {
    await delay(200)
    const body = await request.json() as { leadId?: string; estimateId?: string | null; createdBy?: string; signerUserId?: string }
    if (!body.leadId) {
      return HttpResponse.json({ detail: 'Missing required fields: leadId' }, { status: 400 })
    }
    const lead = leads.find((l) => l.id === body.leadId)
    if (!lead) {
      return HttpResponse.json(
        { detail: `Lead '${body.leadId}' was not found. Attach this proposal to an existing lead.` },
        { status: 422 },
      )
    }
    if (!lead.property_id) {
      return HttpResponse.json(
        { detail: 'A property must be attached to the lead before a proposal can be created.' },
        { status: 422 },
      )
    }
    const now = new Date().toISOString()
    const created = {
      id: `prop-${Date.now()}`,
      leadId: body.leadId,
      estimateId: body.estimateId ?? null,
      createdBy: body.createdBy ?? 'u1',
      sections: [],
      orgChart: {},
      startupPlan: {},
      teamMemberIds: [],
      executiveTeamMemberIds: [],
      clientReferenceIds: [],
      portfolioPropertyIds: [],
      chapterOrder: null,
      signerUserId: body.signerUserId ?? body.createdBy ?? 'u1',
      createdAt: now,
      updatedAt: now,
    }
    proposalPackages.unshift({
      id: created.id,
      leadId: lead.id,
      propertyId: lead.property_id,
      title: lead.property_name,
      subtitle: [lead.city, lead.state].filter(Boolean).join(', ') || null,
      amount: lead.estimated_contract_value,
      status: lead.status,
      updatedAt: now,
      code: `P-${now.slice(0, 4)}-${created.id.slice(-6).toUpperCase()}`,
      version: null,
      pageCount: null,
      closedAt: null,
      assignee: null,
    })
    return HttpResponse.json(created, { status: 201 })
  }),

  http.get(`${API}/proposals/config/branch-coverage`, () => HttpResponse.json(MOCK_BRANCH_COVERAGE)),
  // Rep-scoped team roster and client references (reads, writes, 403/400/404).
  // Reads without rep_id keep the region-filtered shared roster. Portfolio stays unscoped.
  ...rosterHandlers,
  http.get(`${API}/proposals/config/portfolio`, async () => HttpResponse.json([])),

  // GET /api/users
  http.get(`${API}/users`, async ({ request }) => {
    await delay(200)
    const url = new URL(request.url)
    const role = url.searchParams.get('role')
    const branchId = url.searchParams.get('branch_id')
    let users = [...mockUsers]
    if (role === 'sales' || role === 'outside_sales') {
      users = users.filter((u) => SALES_GROUP_ROLES.has(u.role))
    } else if (role) {
      users = users.filter((u) => u.role === role)
    }
    if (branchId) users = users.filter(u => u.branch_id === branchId)
    return HttpResponse.json(users)
  }),

  // GET /api/analytics/revenue
  http.get(`${API}/analytics/revenue`, async () => {
    await delay(200)
    return HttpResponse.json(mockMonthlyRevenue)
  }),

  // GET /api/dashboard/inside-sales — management only, matching
  // require_analytics_dashboard. The route guard hides the page; this 403
  // is what a direct call gets for every other role.
  http.get(`${API}/dashboard/inside-sales`, async () => {
    await delay(200)
    const user = useAuthStore.getState().user
    const role = user ? normalizeRole(user.role) : null
    if (!role || !ANALYTICS_NAV_ROLES.includes(role)) {
      return HttpResponse.json(
        { detail: 'The analytics dashboard is limited to admin and management.' },
        { status: 403 },
      )
    }
    return HttpResponse.json(mockSummary)
  }),

  // GET /api/settings/connections
  http.get(`${API}/settings/connections`, async () => {
    await delay(150)
    return HttpResponse.json(mockConnections)
  }),

  // GET /api/settings/company — company_settings singleton (migration 020).
  // Intake rush notes read sla_return_window_days from here. Tests override
  // with server.use() when they need a different window.
  http.get(`${API}/settings/company`, async () => {
    return HttpResponse.json({
      id: 1,
      sla_return_window_days: SLA_CONFIG.returnWindowDays,
      sla_at_risk_threshold_days: SLA_CONFIG.atRiskThresholdDays,
      discrepancy_threshold_pct: 0.1,
      default_target_margin: 0.22,
      default_win_probability: 0.2,
      default_priority: 'medium',
      default_notify_bm_rd_on_return: 1,
    })
  }),

  // GET /api/settings/branches — the Settings branch-picker source (Slice 9).
  // Scope + roster filtering is server-side; this mock returns two operating
  // branches sorted by name. Tests override with server.use() as needed.
  http.get(`${API}/settings/branches`, async () => {
    await delay(50)
    return HttpResponse.json([
      { aspireBranchId: 1403, branchName: 'Bonita Springs', city: 'Bonita Springs' },
      { aspireBranchId: 3696, branchName: 'Fort Myers', city: 'Fort Myers' },
    ])
  }),

  // ---------------------------------------------------------------------
  // Estimating config read APIs — read-only; the seeded config
  // tables mirrored here. Tests override with server.use() to simulate DB
  // row edits reaching the UI with no code change.
  // ---------------------------------------------------------------------

  // GET /api/estimating/config/approval-tiers?estimate_type=
  http.get(`${API}/estimating/config/approval-tiers`, async ({ request }) => {
    await delay(50)
    const estimateType = new URL(request.url).searchParams.get('estimate_type')
    const rows = estimateType
      ? APPROVAL_TIER_SEED.filter((t) => t.estimateType === estimateType)
      : APPROVAL_TIER_SEED
    return HttpResponse.json([...rows].sort((a, b) => a.order - b.order))
  }),

  // GET /api/estimating/config/margin-bands
  http.get(`${API}/estimating/config/margin-bands`, async () => {
    await delay(50)
    return HttpResponse.json([{ id: 'mb-default', name: 'default', goodMin: 0.2, okMin: 0.12 }])
  }),

  // GET /api/estimating/config/material-calcs
  http.get(`${API}/estimating/config/material-calcs`, async () => {
    await delay(50)
    return HttpResponse.json(MATERIAL_FORMULA_ROWS)
  }),

  // GET /api/estimating/config/itb-scopes
  http.get(`${API}/estimating/config/itb-scopes`, async () => {
    await delay(50)
    return HttpResponse.json([...ITB_SCOPE_SEED].sort((a, b) => a.order - b.order))
  }),

  // GET /api/estimating/config/branches?kind=install|maintenance
  // Returns a representative subset of the Aspire branch map for tests.
  http.get(`${API}/estimating/config/branches`, async ({ request }) => {
    await delay(50)
    const kind = new URL(request.url).searchParams.get('kind')
    const INSTALL_BRANCHES = [
      { city: 'Bradenton, FL', aspire_branch_id: 1374 },
      { city: 'Fort Myers, FL', aspire_branch_id: 1403 },
      { city: 'Orlando, FL', aspire_branch_id: 3579 },
      { city: 'Raleigh, NC', aspire_branch_id: 3689 },
    ]
    const MAINTENANCE_BRANCHES = [
      { city: 'Bradenton, FL', aspire_branch_id: 3684 },
      { city: 'Fort Myers, FL', aspire_branch_id: 3696 },
      { city: 'Orlando, FL', aspire_branch_id: 3668 },
      { city: 'Raleigh, NC', aspire_branch_id: 3688 },
    ]
    return HttpResponse.json(kind === 'install' ? INSTALL_BRANCHES : MAINTENANCE_BRANCHES)
  }),

  // ---------------------------------------------------------------------
  // ITB tracker — read + scope-status update. Projects are
  // auto-generated (no create endpoint); "active" = the linked estimate's
  // status is not won/lost.
  // ---------------------------------------------------------------------

  // GET /api/estimating/itb/projects
  http.get(`${API}/estimating/itb/projects`, async () => {
    await delay(80)
    const active = itbProjects.filter((p) => {
      const est = estimates.find((e) => e.id === p.estimateId)
      return est != null && est.status !== 'won' && est.status !== 'lost'
    })
    return HttpResponse.json(active)
  }),

  // PATCH /api/estimating/itb/projects/:projectId/scopes/:scopeId
  http.patch(
    `${API}/estimating/itb/projects/:projectId/scopes/:scopeId`,
    async ({ params, request }) => {
      await delay(50)
      const { statusCode } = (await request.json()) as { statusCode?: ItbStatusCode }
      if (!statusCode || !ITB_STATUS_CODES.includes(statusCode)) {
        return HttpResponse.json(
          { error: `statusCode must be one of ${ITB_STATUS_CODES.join(', ')}` },
          { status: 400 },
        )
      }
      const project = itbProjects.find((p) => p.id === params.projectId)
      if (!project) return notFound()
      const scopeId = String(params.scopeId)
      if (!ITB_SCOPE_SEED.some((s) => s.id === scopeId)) return notFound()
      const row = project.statuses.find((s) => s.scopeId === scopeId)
      // Upsert, so scopes added after the project was created still accept status.
      if (row) row.statusCode = statusCode
      else project.statuses.push({ projectId: project.id, scopeId, statusCode })
      return HttpResponse.json({ projectId: project.id, scopeId, statusCode })
    },
  ),

  // GET /api/estimating/catalog-items — kit catalog (seeded from
  // the workbook rows; mirrors the backend's branch/kit_type/active filters).
  http.get(`${API}/estimating/catalog-items`, async ({ request }) => {
    await delay(50)
    const url = new URL(request.url)
    const branch = url.searchParams.get('branch')
    const kitType = url.searchParams.get('kit_type')
    const active = url.searchParams.get('active')
    let rows = CATALOG_ITEM_SEED
    if (branch) rows = rows.filter((r) => r.branch === branch)
    if (kitType) rows = rows.filter((r) => r.kitType === kitType)
    if (active !== null) rows = rows.filter((r) => r.active === (active === 'true' || active === '1'))
    return HttpResponse.json(rows)
  }),

  // ---------------------------------------------------------------------
  // Estimating — single-source estimate model
  // ---------------------------------------------------------------------

  // GET /api/estimating/estimates
  http.get(`${API}/estimating/estimates`, async ({ request }) => {
    await delay(150)
    const url = new URL(request.url)
    const estimateType = url.searchParams.get('estimate_type')
    const status = url.searchParams.get('status')
    // Row-level branch scope (BRD I-9.5) — enforced server-side in production.
    const branch = url.searchParams.get('branch')
    const leadId = url.searchParams.get('leadId')
    let filtered = [...estimates]
    if (estimateType) filtered = filtered.filter((e) => e.estimateType === estimateType)
    if (status) filtered = filtered.filter((e) => e.status === status)
    if (branch) filtered = filtered.filter((e) => e.branchCity === branch)
    if (leadId) filtered = filtered.filter((e) => e.leadId === leadId)
    return HttpResponse.json(filtered.map(withRush))
  }),

  // POST /api/estimating/estimates
  http.post(`${API}/estimating/estimates`, async ({ request }) => {
    await delay(150)
    const body = (await request.json()) as CreateEstimatePayload
    if (body.estimateType !== 'maintenance' && body.estimateType !== 'install') {
      return HttpResponse.json(
        { error: 'estimateType must be maintenance or install' },
        { status: 400 },
      )
    }
    const denied = denyDisallowedIntake(body.estimateType)
    if (denied) return denied
    const past = pastDueResponse(body.dueBackDate)
    if (past) return past
    // Dollars, not cents. Blank / omitted / null → null. 0 stays 0.
    // Top-level homesBudget / commonAreaBudget win over intake.payload.
    // Reject before insert so a 400 persists nothing.
    const budgets = resolveContractBudgets(body)
    if (!budgets.ok) {
      return HttpResponse.json({ detail: budgets.error }, { status: 400 })
    }
    const occurrenceError = occurrenceDetail(body)
    if (occurrenceError) {
      return HttpResponse.json({ detail: occurrenceError }, { status: 422 })
    }
    const id = eid('est')
    const now = new Date().toISOString()
    const sections: EstimateSection[] = (body.sections ?? []).map((section, si) => {
      const sectionId = eid('sec')
      return {
        ...section,
        id: sectionId,
        estimateId: id,
        sortOrder: section.sortOrder ?? si,
        services: (section.services ?? []).map((svc, vi) => {
          const serviceId = eid('svc')
          return {
            ...svc,
            id: serviceId,
            sectionId,
            sortOrder: svc.sortOrder ?? vi,
            components: (svc.components ?? []).map((c, ci) => ({
              ...c,
              id: eid('cmp'),
              sectionServiceId: serviceId,
              sortOrder: c.sortOrder ?? ci,
            })),
          }
        }),
      }
    })
    // Structured intake payload is persisted to its own store — it must NOT ride
    // along on the estimate row (mirrors the server splitting it into
    // intake_submissions). Strip it before building the estimate.
    const raw = body as CreateEstimatePayload & { isRush?: boolean }
    const intake = raw.intake
    const estimateBody = { ...raw }
    delete estimateBody.intake
    delete estimateBody.serviceLine
    delete estimateBody.isRush
    // Server-managed Aspire fields: create returns pending (the push is async),
    // then flips to synced. Simulate the flip so the UI can exercise both states.
    const created = withRush({
      ...estimateBody,
      ...occurrenceColumns(estimateBody),
      // Omitted on create defaults to business today + the SLA window, not a rush.
      dueBackDate: estimateBody.dueBackDate || defaultDueBackDate(),
      id,
      sections,
      homesBudget: budgets.homesBudget,
      commonAreaBudget: budgets.commonAreaBudget,
      aspireOpportunityId: null,
      aspireSyncStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    } as Estimate)
    estimates.push(created)
    // Auto-generate the 1:1 ITB project for EITHER intake type.
    itbProjects.push(itbProjectForEstimate(created))
    if (intake?.payload) {
      intakeSubmissions.push({
        id: eid('ins'),
        estimateId: id,
        estimateType: created.estimateType,
        payload: intake.payload,
        submittedBy: 'mock-user',
        createdAt: now,
      })
    }
    // Mimic the background push landing shortly after.
    setTimeout(() => {
      const row = estimates.find((e) => e.id === id)
      if (row) {
        row.aspireSyncStatus = 'synced'
        row.aspireOpportunityId = Math.floor(600000 + Math.random() * 100000)
        row.aspireNumber = row.aspireNumber ?? String(400000 + Math.floor(Math.random() * 20000))
      }
    }, 300)
    return HttpResponse.json(created, { status: 201 })
  }),

  // GET /api/estimating/estimates/:id
  http.get(`${API}/estimating/estimates/:id`, async ({ params }) => {
    await delay(100)
    const estimate = estimates.find((e) => e.id === params.id)
    if (!estimate) return notFound()
    return HttpResponse.json(withRush(estimate))
  }),

  // PATCH /api/estimating/estimates/:id
  // `estimateType` is IMMUTABLE: any attempt to change it is
  // rejected at the data-access layer, mirroring the DB trigger in
  // sql/estimating.sql.
  http.patch(`${API}/estimating/estimates/:id`, async ({ params, request }) => {
    await delay(150)
    const idx = estimates.findIndex((e) => e.id === params.id)
    if (idx === -1) return notFound()
    const body = (await request.json()) as UpdateEstimatePayload & { estimateType?: string }
    // Same budget rules as create. Absent keys are left absent (keep).
    // Null or blank clears. A bad value 400s without mutating the row.
    const budgetPatch = coerceBudgetPatch(body as Record<string, unknown>)
    if (!budgetPatch.ok) {
      return HttpResponse.json({ detail: budgetPatch.error }, { status: 400 })
    }
    const occurrenceError = occurrenceDetail(body)
    if (occurrenceError) {
      return HttpResponse.json({ detail: occurrenceError }, { status: 422 })
    }
    if (body.estimateType !== undefined && body.estimateType !== estimates[idx].estimateType) {
      return HttpResponse.json(
        { error: 'estimate_type is immutable and cannot be changed after creation' },
        { status: 400 },
      )
    }
    delete body.estimateType
    delete (body as { isRush?: boolean }).isRush
    const past = pastDueResponse(body.dueBackDate)
    if (past) return past
    // The mock mirrors the server: every status write walks the
    // ONE transition module. Illegal edges 409 (same shape as approve-handback);
    // re-sending the current status is an idempotent no-op.
    const currentStatus = estimates[idx].status
    if (
      body.status !== undefined &&
      body.status !== currentStatus &&
      !canTransition(currentStatus, body.status)
    ) {
      return HttpResponse.json(
        { error: new IllegalTransitionError(currentStatus, body.status).message },
        { status: 409 },
      )
    }
    estimates[idx] = withRush({
      ...estimates[idx],
      ...body,
      updatedAt: new Date().toISOString(),
    } as Estimate)
    return HttpResponse.json(estimates[idx])
  }),

  // POST /api/estimating/estimates/:id/approve-handback
  // Walks the status machine via the ONE transition module — side effects and
  // auditability are enforced here, never in the UI.
  http.post(`${API}/estimating/estimates/:id/approve-handback`, async ({ params, request }) => {
    await delay(150)
    const idx = estimates.findIndex((e) => e.id === params.id)
    if (idx === -1) return notFound()
    const body = (await request.json()) as ApproveHandBackPayload
    try {
      // In production the server derives the actor from the JWT;
      // the mock falls back to a session placeholder when the client omits it.
      const { patch, records } = approveAndHandBack(estimates[idx], {
        actor: body.actor ?? 'Session Approver',
      })
      estimates[idx] = withRush({
        ...estimates[idx],
        ...patch,
        ...(body.notifyBmRdOnReturn !== undefined
          ? { approvalSettings: { notifyBmRdOnReturn: body.notifyBmRdOnReturn } }
          : {}),
        updatedAt: new Date().toISOString(),
      } as Estimate)
      statusTransitions.push(...records)
      return HttpResponse.json({ estimate: estimates[idx], transitions: records })
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        return HttpResponse.json({ error: err.message }, { status: 409 })
      }
      throw err
    }
  }),

  // GET /api/estimating/estimates/:id/status-transitions (audit trail)
  http.get(`${API}/estimating/estimates/:id/status-transitions`, async ({ params }) => {
    await delay(100)
    if (!estimates.some((e) => e.id === params.id)) return notFound()
    return HttpResponse.json(statusTransitions.filter((t) => t.estimateId === params.id))
  }),

  // POST /api/estimating/estimates/:id/adjustments
  // Persists one audited approver lever change (complexity|margin). In
  // production the server derives the actor from the JWT and enforces the
  // approver-only guard; the mock mirrors the wire shape and falls back to a
  // session placeholder when the client omits the deprecated actor field.
  http.post(`${API}/estimating/estimates/:id/adjustments`, async ({ params, request }) => {
    await delay(100)
    if (!estimates.some((e) => e.id === params.id)) return notFound()
    const body = (await request.json()) as CreateAdjustmentPayload
    if (body.field !== 'complexity' && body.field !== 'margin') {
      return HttpResponse.json(
        { error: 'field must be complexity or margin' },
        { status: 400 },
      )
    }
    adjustmentSeq += 1
    const record: EstimateAdjustment = {
      id: `adj-${adjustmentSeq}`,
      estimateId: String(params.id),
      actor: body.actor ?? 'Session Approver',
      field: body.field,
      fromValue: body.fromValue,
      toValue: body.toValue,
      createdAt: new Date().toISOString(),
    }
    estimateAdjustments.push(record)
    return HttpResponse.json(record, { status: 201 })
  }),

  // GET /api/estimating/estimates/:id/adjustments (audit trail, BRD III-1)
  http.get(`${API}/estimating/estimates/:id/adjustments`, async ({ params }) => {
    await delay(100)
    if (!estimates.some((e) => e.id === params.id)) return notFound()
    return HttpResponse.json(estimateAdjustments.filter((a) => a.estimateId === params.id))
  }),

  // GET /api/estimating/estimates/:id/intake (structured intake submissions)
  http.get(`${API}/estimating/estimates/:id/intake`, async ({ params }) => {
    await delay(100)
    if (!estimates.some((e) => e.id === params.id)) return notFound()
    return HttpResponse.json(intakeSubmissions.filter((s) => s.estimateId === params.id))
  }),

  // ── Intake drafts ────────────────────────────────────────────────────────
  // "Save draft" persists a partial intake server-side (per-user, resumable on
  // any device). Never creates an estimate; never fires an Aspire push.

  // POST /api/estimating/intake/drafts
  http.post(`${API}/estimating/intake/drafts`, async ({ request }) => {
    await delay(100)
    const body = (await request.json()) as {
      estimateType: Estimate['estimateType']
      payload: Record<string, unknown>
      draftId?: string
    }
    if (body.estimateType !== 'maintenance' && body.estimateType !== 'install') {
      return HttpResponse.json(
        { error: 'estimateType must be maintenance or install' },
        { status: 400 },
      )
    }
    const denied = denyDisallowedIntake(body.estimateType)
    if (denied) return denied
    const draftBudgets = coerceBudgetPatch(body.payload)
    if (!draftBudgets.ok) {
      return HttpResponse.json({ detail: draftBudgets.error }, { status: 400 })
    }
    if (body.draftId) {
      const existing = intakeDrafts.find((d) => d.id === body.draftId)
      if (!existing) return notFound()
      // Resuming a draft of the other type is the same lock as creating one.
      const deniedStored = denyDisallowedIntake(existing.estimateType)
      if (deniedStored) return deniedStored
      existing.payload = body.payload
      return HttpResponse.json(existing)
    }
    const draft: IntakeDraft = {
      id: eid('draft'),
      estimateType: body.estimateType,
      payload: body.payload,
      submittedBy: 'mock-user',
      isDraft: true,
      createdAt: new Date().toISOString(),
    }
    intakeDrafts.push(draft)
    return HttpResponse.json(draft, { status: 201 })
  }),

  // GET /api/estimating/intake/drafts
  http.get(`${API}/estimating/intake/drafts`, async ({ request }) => {
    await delay(100)
    const estimateType = new URL(request.url).searchParams.get('estimate_type')
    const rows = intakeDrafts
      .filter((d) => !estimateType || d.estimateType === estimateType)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return HttpResponse.json(rows)
  }),

  // DELETE /api/estimating/intake/drafts/:id
  http.delete(`${API}/estimating/intake/drafts/:id`, async ({ params }) => {
    await delay(100)
    const idx = intakeDrafts.findIndex((d) => d.id === params.id)
    if (idx === -1) return notFound()
    intakeDrafts.splice(idx, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  // POST /api/estimating/estimates/:id/sections
  http.post(`${API}/estimating/estimates/:id/sections`, async ({ params, request }) => {
    await delay(100)
    const estimate = estimates.find((e) => e.id === params.id)
    if (!estimate) return notFound()
    const body = (await request.json()) as CreateSectionPayload
    const sectionId = eid('sec')
    const section: EstimateSection = {
      name: body.name,
      squareFeet: body.squareFeet,
      sortOrder: body.sortOrder ?? estimate.sections.length,
      id: sectionId,
      estimateId: estimate.id,
      services: (body.services ?? []).map((svc, vi) => {
        const serviceId = eid('svc')
        return {
          ...svc,
          id: serviceId,
          sectionId,
          sortOrder: svc.sortOrder ?? vi,
          components: (svc.components ?? []).map((c, ci) => ({
            ...c,
            id: eid('cmp'),
            sectionServiceId: serviceId,
            sortOrder: c.sortOrder ?? ci,
          })),
        }
      }),
    }
    estimate.sections.push(section)
    estimate.updatedAt = new Date().toISOString()
    return HttpResponse.json(section, { status: 201 })
  }),

  // PATCH /api/estimating/estimates/:id/sections/:sectionId
  http.patch(
    `${API}/estimating/estimates/:id/sections/:sectionId`,
    async ({ params, request }) => {
      await delay(100)
      const estimate = estimates.find((e) => e.id === params.id)
      const section = estimate?.sections.find((s) => s.id === params.sectionId)
      if (!estimate || !section) return notFound()
      const body = (await request.json()) as UpdateSectionPayload
      Object.assign(section, body)
      estimate.updatedAt = new Date().toISOString()
      return HttpResponse.json(section)
    },
  ),

  // DELETE /api/estimating/estimates/:id/sections/:sectionId
  http.delete(`${API}/estimating/estimates/:id/sections/:sectionId`, async ({ params }) => {
    await delay(100)
    const estimate = estimates.find((e) => e.id === params.id)
    if (!estimate) return notFound()
    const idx = estimate.sections.findIndex((s) => s.id === params.sectionId)
    if (idx === -1) return notFound()
    estimate.sections.splice(idx, 1)
    estimate.updatedAt = new Date().toISOString()
    return new HttpResponse(null, { status: 204 })
  }),

  // POST /api/estimating/estimates/:id/sections/:sectionId/services
  http.post(
    `${API}/estimating/estimates/:id/sections/:sectionId/services`,
    async ({ params, request }) => {
      await delay(100)
      const estimate = estimates.find((e) => e.id === params.id)
      const section = estimate?.sections.find((s) => s.id === params.sectionId)
      if (!estimate || !section) return notFound()
      const body = (await request.json()) as CreateServicePayload
      const serviceId = eid('svc')
      const service: SectionService = {
        ...body,
        id: serviceId,
        sectionId: section.id,
        sortOrder: body.sortOrder ?? section.services.length,
        components: (body.components ?? []).map((c, ci) => ({
          ...c,
          id: eid('cmp'),
          sectionServiceId: serviceId,
          sortOrder: c.sortOrder ?? ci,
        })),
      }
      section.services.push(service)
      estimate.updatedAt = new Date().toISOString()
      return HttpResponse.json(service, { status: 201 })
    },
  ),

  // PATCH /api/estimating/estimates/:id/sections/:sectionId/services/:serviceId
  http.patch(
    `${API}/estimating/estimates/:id/sections/:sectionId/services/:serviceId`,
    async ({ params, request }) => {
      await delay(100)
      const estimate = estimates.find((e) => e.id === params.id)
      const section = estimate?.sections.find((s) => s.id === params.sectionId)
      const service = section?.services.find((sv) => sv.id === params.serviceId)
      if (!estimate || !section || !service) return notFound()
      const body = (await request.json()) as UpdateServicePayload
      Object.assign(service, body)
      estimate.updatedAt = new Date().toISOString()
      return HttpResponse.json(service)
    },
  ),

  // DELETE /api/estimating/estimates/:id/sections/:sectionId/services/:serviceId
  http.delete(
    `${API}/estimating/estimates/:id/sections/:sectionId/services/:serviceId`,
    async ({ params }) => {
      await delay(100)
      const estimate = estimates.find((e) => e.id === params.id)
      const section = estimate?.sections.find((s) => s.id === params.sectionId)
      if (!estimate || !section) return notFound()
      const idx = section.services.findIndex((sv) => sv.id === params.serviceId)
      if (idx === -1) return notFound()
      section.services.splice(idx, 1)
      estimate.updatedAt = new Date().toISOString()
      return new HttpResponse(null, { status: 204 })
    },
  ),

  // ── Component CRUD (kit labor/material breakdown) ──────────────────────────

  // POST /api/estimating/estimates/:id/sections/:sectionId/services/:serviceId/components
  http.post(
    `${API}/estimating/estimates/:id/sections/:sectionId/services/:serviceId/components`,
    async ({ params, request }) => {
      await delay(100)
      const estimate = estimates.find((e) => e.id === params.id)
      const section = estimate?.sections.find((s) => s.id === params.sectionId)
      const service = section?.services.find((sv) => sv.id === params.serviceId)
      if (!estimate || !section || !service) return notFound()
      const body = (await request.json()) as CreateComponentPayload
      const component: SectionServiceComponent = {
        ...body,
        id: eid('cmp'),
        sectionServiceId: service.id,
        sortOrder: body.sortOrder ?? service.components.length,
      }
      service.components.push(component)
      estimate.updatedAt = new Date().toISOString()
      return HttpResponse.json(component, { status: 201 })
    },
  ),

  // PATCH /api/estimating/estimates/:id/sections/:sectionId/services/:serviceId/components/:componentId
  http.patch(
    `${API}/estimating/estimates/:id/sections/:sectionId/services/:serviceId/components/:componentId`,
    async ({ params, request }) => {
      await delay(100)
      const estimate = estimates.find((e) => e.id === params.id)
      const section = estimate?.sections.find((s) => s.id === params.sectionId)
      const service = section?.services.find((sv) => sv.id === params.serviceId)
      const component = service?.components.find((c) => c.id === params.componentId)
      if (!estimate || !section || !service || !component) return notFound()
      const body = (await request.json()) as UpdateComponentPayload
      Object.assign(component, body)
      estimate.updatedAt = new Date().toISOString()
      return HttpResponse.json(component)
    },
  ),

  // DELETE /api/estimating/estimates/:id/sections/:sectionId/services/:serviceId/components/:componentId
  http.delete(
    `${API}/estimating/estimates/:id/sections/:sectionId/services/:serviceId/components/:componentId`,
    async ({ params }) => {
      await delay(100)
      const estimate = estimates.find((e) => e.id === params.id)
      const section = estimate?.sections.find((s) => s.id === params.sectionId)
      const service = section?.services.find((sv) => sv.id === params.serviceId)
      if (!estimate || !section || !service) return notFound()
      const idx = service.components.findIndex((c) => c.id === params.componentId)
      if (idx === -1) return notFound()
      service.components.splice(idx, 1)
      estimate.updatedAt = new Date().toISOString()
      return new HttpResponse(null, { status: 204 })
    },
  ),

  // POST /api/estimating/estimates/:id/lifecycle
  // Persists the Bidding↔Won flip: derives aspireOwner from the lifecycle and
  // records the edge in the ONE status-transition audit trail (`lifecycle:`
  // prefix). This server-side trail is the ONLY audit source (the old
  // client-side in-memory log was deleted).
  http.post(`${API}/estimating/estimates/:id/lifecycle`, async ({ params, request }) => {
    await delay(100)
    const estimate = estimates.find((e) => e.id === params.id)
    if (!estimate) return notFound()
    const body = (await request.json()) as { to: Estimate['lifecycle'] }
    if (body.to !== 'bidding' && body.to !== 'won') {
      return HttpResponse.json({ error: 'to must be bidding or won' }, { status: 400 })
    }
    if (estimate.lifecycle === body.to) {
      return HttpResponse.json({ estimate: withRush(estimate), transition: null })
    }
    const from = estimate.lifecycle
    estimate.lifecycle = body.to
    estimate.aspireOwner = body.to === 'won' ? 'crm' : 'estimating'
    estimate.updatedAt = new Date().toISOString()
    const transition: StatusTransitionRecord = {
      estimateId: estimate.id,
      from: `lifecycle:${from}`,
      to: `lifecycle:${body.to}`,
      actor: 'mock-user',
      at: new Date().toISOString(),
    }
    statusTransitions.push(transition)
    return HttpResponse.json({ estimate: withRush(estimate), transition })
  }),

  // ── Takeoff-line CRUD (Discrepancy Review persistence) ────────────────────
  // opportunityQty is a LOCAL, estimator-editable value (never read from
  // Aspire); the Aspire qty push rides estimate Save on the real backend.

  // GET /api/estimating/estimates/:id/takeoff-lines
  http.get(`${API}/estimating/estimates/:id/takeoff-lines`, async ({ params }) => {
    await delay(100)
    const estimateId = String(params.id)
    ensureTakeoffSeed(estimateId)
    const rows = takeoffLines.filter((l) => l.estimateId === estimateId)
    return HttpResponse.json(rows.map((l) => deriveTakeoffLine(l)))
  }),

  // POST /api/estimating/estimates/:id/takeoff-lines
  http.post(`${API}/estimating/estimates/:id/takeoff-lines`, async ({ params, request }) => {
    await delay(100)
    const estimateId = String(params.id)
    const body = (await request.json()) as CreateTakeoffLinePayload
    const line: TakeoffLine = {
      id: eid('tk'),
      estimateId,
      description: body.description ?? '',
      uom: body.uom ?? '',
      planQty: body.planQty ?? 0,
      addPct: body.addPct ?? 0,
      measuredQty: body.measuredQty ?? 0,
      opportunityQty: body.opportunityQty ?? 0,
      catalogItemId: body.catalogItemId ?? null,
    }
    ensureTakeoffSeed(estimateId)
    takeoffLines.push(line)
    return HttpResponse.json(deriveTakeoffLine(line), { status: 201 })
  }),

  // PATCH /api/estimating/estimates/:id/takeoff-lines/:lineId
  http.patch(
    `${API}/estimating/estimates/:id/takeoff-lines/:lineId`,
    async ({ params, request }) => {
      await delay(100)
      const line = takeoffLines.find(
        (l) => l.id === params.lineId && l.estimateId === params.id,
      )
      if (!line) return notFound()
      const body = (await request.json()) as UpdateTakeoffLinePayload
      // Only the writable columns — client-sent derived values are ignored.
      if (body.description !== undefined) line.description = body.description
      if (body.uom !== undefined) line.uom = body.uom
      if (body.planQty !== undefined) line.planQty = body.planQty
      if (body.addPct !== undefined) line.addPct = body.addPct
      if (body.measuredQty !== undefined) line.measuredQty = body.measuredQty
      if (body.opportunityQty !== undefined) line.opportunityQty = body.opportunityQty
      if (body.catalogItemId !== undefined) line.catalogItemId = body.catalogItemId
      return HttpResponse.json(deriveTakeoffLine(line))
    },
  ),

  // DELETE /api/estimating/estimates/:id/takeoff-lines/:lineId
  http.delete(
    `${API}/estimating/estimates/:id/takeoff-lines/:lineId`,
    async ({ params }) => {
      await delay(100)
      const idx = takeoffLines.findIndex(
        (l) => l.id === params.lineId && l.estimateId === params.id,
      )
      if (idx === -1) return notFound()
      takeoffLines.splice(idx, 1)
      return new HttpResponse(null, { status: 204 })
    },
  ),

  // POST /api/estimating/estimates/:id/retry-aspire-sync
  http.post(`${API}/estimating/estimates/:id/retry-aspire-sync`, async ({ params }) => {
    await delay(100)
    const estimate = estimates.find((e) => e.id === params.id)
    if (!estimate) return notFound()
    // Simulate the retried push landing.
    setTimeout(() => {
      estimate.aspireSyncStatus = 'synced'
      estimate.aspireOpportunityId = estimate.aspireOpportunityId ?? Math.floor(600000 + Math.random() * 100000)
      estimate.aspireNumber = estimate.aspireNumber ?? String(400000 + Math.floor(Math.random() * 20000))
    }, 200)
    return HttpResponse.json({ status: 'queued' }, { status: 202 })
  }),

  // GET /api/properties?search= — local table is the source of truth.
  http.get(`${API}/properties`, async ({ request }) => {
    await delay(100)
    const search = new URL(request.url).searchParams.get('search')?.toLowerCase() ?? ''
    const rows = properties.filter(
      (p) =>
        !search ||
        p.name.toLowerCase().includes(search) ||
        (p.address1 ?? '').toLowerCase().includes(search) ||
        (p.city ?? '').toLowerCase().includes(search),
    )
    return HttpResponse.json(rows)
  }),

  // GET /api/properties/:id/opportunities — best-effort Aspire dedup panel.
  http.get(`${API}/properties/:id/opportunities`, async ({ params }) => {
    await delay(100)
    const property = properties.find((p) => p.id === params.id)
    if (!property) return notFound()
    // Sync disabled in the mock ⇒ no prior opportunities surfaced.
    return HttpResponse.json([])
  }),

  // POST /api/properties — LOCAL-ONLY create: upsert on
  // (sourceType, sourceId); the row stays 'unsynced' — NO auto Aspire push.
  // The only sync trigger is estimate submission.
  http.post(`${API}/properties`, async ({ request }) => {
    await delay(120)
    const body = (await request.json()) as Partial<MockProperty>
    if (!body.name) {
      return HttpResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const sourceType = body.sourceType ?? 'manual'
    const sourceId = body.sourceId ?? null
    if (sourceId != null) {
      const existing = properties.find(
        (p) => p.sourceType === sourceType && p.sourceId === sourceId,
      )
      if (existing) return HttpResponse.json(existing, { status: 201 })
    }
    const now = new Date().toISOString()
    const row: MockProperty = {
      id: eid('prop'),
      name: body.name,
      propertyType: body.propertyType ?? (sourceType !== 'manual' ? sourceType : 'manual'),
      sourceType,
      sourceId,
      address1: body.address1 ?? null,
      address2: body.address2 ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zip: body.zip ?? null,
      branchCity: body.branchCity ?? null,
      customerType: body.customerType ?? null,
      managementCompanyId: body.managementCompanyId ?? null,
      acreage: body.acreage ?? null,
      units: body.units ?? null,
      aspirePropertyId: null,
      aspireSyncStatus: 'unsynced',
      createdAt: now,
      updatedAt: now,
    }
    properties.push(row)
    return HttpResponse.json(row, { status: 201 })
  }),
]

// ---------------------------------------------------------------------
// Attachment routes (GCS upload feature)
// ---------------------------------------------------------------------

// POST /api/estimating/estimates/:estimateId/attachments/presign
allHandlers.push(
  http.post(`${API}/estimating/estimates/:estimateId/attachments/presign`, async ({ params, request }) => {
    const { estimateId } = params as { estimateId: string }
    const est = estimates.find((e) => e.id === estimateId)
    if (!est) return HttpResponse.json({ detail: 'Estimate not found' }, { status: 404 })

    const body = (await request.json()) as {
      kind?: AttachmentKind
      fileName: string
      contentType: string
      sizeBytes: number
    }
    const kind = body.kind ?? 'other'

    // Estimate-scoped kinds (takeoff scans + the three proposal kinds) need no
    // intake submission. RFP accepts PDF, Word, and Excel when the extension
    // and MIME agree. measurements/other/takeoff_scan may be images. The
    // contract and every other intake kind stay PDF-only.
    const scanTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    const estimateScoped = ['takeoff_scan', 'proposal_contract', 'proposal_measurements', 'proposal_other']
    const imageOrPdf = ['takeoff_scan', 'proposal_measurements', 'proposal_other']
    let contentType = body.contentType
    if (kind === 'rfp') {
      const checked = validateRfpDocument(body.fileName, body.contentType)
      if (!checked.ok) {
        return HttpResponse.json({ detail: checked.detail }, { status: 400 })
      }
      contentType = checked.contentType
    } else if (imageOrPdf.includes(kind)) {
      if (!scanTypes.includes(body.contentType)) {
        return HttpResponse.json(
          { detail: 'This attachment must be PNG, JPEG, WebP, or PDF' },
          { status: 400 },
        )
      }
    } else if (body.contentType !== 'application/pdf') {
      return HttpResponse.json({ detail: 'Only PDF attachments are supported' }, { status: 400 })
    }
    const sizeError = validateAttachmentSize(body.sizeBytes)
    if (sizeError) {
      return HttpResponse.json({ detail: sizeError }, { status: 400 })
    }

    const sub = intakeSubmissions.find((s) => s.estimateId === estimateId)
    if (!estimateScoped.includes(kind) && !sub) {
      return HttpResponse.json(
        { detail: 'No intake submission found for this estimate' },
        { status: 404 },
      )
    }

    const attachmentId = eid('att')
    const ext = extensionForStoredContentType(contentType)
    const objectKey = `estimating/${estimateId}/${attachmentId}.${ext}`
    const sessionId = eid('sess')

    const att: IntakeAttachment = {
      id: attachmentId,
      intakeSubmissionId: estimateScoped.includes(kind) ? null : (sub?.id ?? null),
      estimateId,
      fileName: body.fileName,
      contentType,
      sizeBytes: body.sizeBytes,
      kind,
      uploadedBy: null,
      status: 'pending',
      objectKey,
      downloadable: false,
      sortOrder: 0,
      pageCount: null,
      createdAt: new Date().toISOString(),
    }
    attachments.push(att)
    resumableSessions.set(sessionId, { attachmentId, estimateId })

    // Fake resumable upload endpoint URL — MSW intercepts it below.
    const uploadUrl = `http://localhost/__mock_gcs_upload/${sessionId}`
    return HttpResponse.json({ attachmentId, objectKey, uploadUrl, contentType }, { status: 201 })
  }),
)

// PUT /__mock_gcs_upload/:sessionId — fake GCS resumable upload endpoint
allHandlers.push(
  http.put('http://localhost/__mock_gcs_upload/:sessionId', ({ params, request }) => {
    const { sessionId } = params as { sessionId: string }
    const session = resumableSessions.get(sessionId)
    if (!session) return new HttpResponse(null, { status: 404 })
    uploadedContentTypeByAttachment.set(
      session.attachmentId,
      request.headers.get('content-type') ?? '',
    )
    // Mark the object as uploaded so confirm can succeed.
    const att = attachments.find((a) => a.id === session.attachmentId)
    if (att) att.status = 'pending'  // still pending until confirm fires
    return new HttpResponse(null, { status: 200 })
  }),
)

// POST /api/estimating/estimates/:estimateId/attachments/:attachmentId/confirm
allHandlers.push(
  http.post(
    `${API}/estimating/estimates/:estimateId/attachments/:attachmentId/confirm`,
    ({ params }) => {
      const { estimateId, attachmentId } = params as { estimateId: string; attachmentId: string }
      const att = attachments.find(
        (a) => a.id === attachmentId && attachmentBelongsTo(a, estimateId),
      )
      if (!att) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
      const uploadedType = uploadedContentTypeByAttachment.get(attachmentId)
      if (
        uploadedType != null &&
        (normalizeContentType(uploadedType) !== normalizeContentType(att.contentType) || !att.sizeBytes)
      ) {
        att.status = 'failed'
        return HttpResponse.json({ detail: 'Upload validation failed' }, { status: 400 })
      }
      att.status = 'stored'
      att.downloadable = true
      return HttpResponse.json(att)
    },
  ),
)

// GET /api/estimating/estimates/:estimateId/attachments
allHandlers.push(
  http.get(`${API}/estimating/estimates/:estimateId/attachments`, ({ params }) => {
    const { estimateId } = params as { estimateId: string }
    const est = estimates.find((e) => e.id === estimateId)
    if (!est) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
    const result = attachments.filter((a) => attachmentBelongsTo(a, estimateId))
    return HttpResponse.json(result)
  }),
)

// GET /api/estimating/estimates/:estimateId/attachments/:attachmentId/download-url
allHandlers.push(
  http.get(
    `${API}/estimating/estimates/:estimateId/attachments/:attachmentId/download-url`,
    ({ params }) => {
      const { estimateId, attachmentId } = params as { estimateId: string; attachmentId: string }
      const att = attachments.find(
        (a) => a.id === attachmentId && attachmentBelongsTo(a, estimateId),
      )
      if (!att) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
      if (att.status !== 'stored') return HttpResponse.json({ error: 'Not stored' }, { status: 409 })
      return HttpResponse.json({
        url: `http://localhost/__mock_gcs_download/${att.objectKey}`,
        expiresIn: 600,
      })
    },
  ),
)

// PATCH /api/estimating/estimates/:estimateId/attachments/:attachmentId
// Handoff 47: reorder an 'other' proposal attachment (sortOrder only).
allHandlers.push(
  http.patch(
    `${API}/estimating/estimates/:estimateId/attachments/:attachmentId`,
    async ({ params, request }) => {
      const { estimateId, attachmentId } = params as { estimateId: string; attachmentId: string }
      const att = attachments.find(
        (a) => a.id === attachmentId && attachmentBelongsTo(a, estimateId),
      )
      if (!att) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
      const body = (await request.json()) as { sortOrder?: number }
      if (body.sortOrder == null) {
        return HttpResponse.json({ error: 'sortOrder is required' }, { status: 400 })
      }
      att.sortOrder = body.sortOrder
      return HttpResponse.json(att)
    },
  ),
)

// DELETE /api/estimating/estimates/:estimateId/attachments/:attachmentId
// Handoff 47: soft-delete an attachment (status='deleted') and remove the object.
allHandlers.push(
  http.delete(
    `${API}/estimating/estimates/:estimateId/attachments/:attachmentId`,
    ({ params }) => {
      const { estimateId, attachmentId } = params as { estimateId: string; attachmentId: string }
      const att = attachments.find(
        (a) => a.id === attachmentId && attachmentBelongsTo(a, estimateId),
      )
      if (!att) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
      att.status = 'deleted'
      return new HttpResponse(null, { status: 204 })
    },
  ),
)

// Commissions + sales performance. Rep lists are only fetched by roles in
// REP_SELECTOR_ROLES (api/authz.py REP_VIEWER_ROLES); summary and list
// endpoints auto-scope when no user_id is supplied.
const mockReps = [
  {
    id: 'rep-1',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    commission_rate: 0.05,
    effective_date: '2026-01-01',
  },
]

allHandlers.push(
  http.get(`${API}/commissions/reps`, () => HttpResponse.json(mockReps)),
  http.get(`${API}/commissions/summary`, () =>
    HttpResponse.json({ scheduled_ytd_cents: 125_000, paid_ytd_cents: 80_000 }),
  ),
  http.get(`${API}/commissions/list`, () => HttpResponse.json([])),
  http.get(`${API}/sales-performance/reps`, () =>
    HttpResponse.json(mockReps.map(({ id, name, email }) => ({ id, name, email }))),
  ),
  http.get(`${API}/sales-performance/summary`, () =>
    HttpResponse.json({
      won_count: 2,
      won_total_cents: 500_000,
      won_avg_cents: 250_000,
      lost_count: 1,
      lost_total_cents: 100_000,
      lost_avg_cents: 100_000,
      win_rate: 0.67,
      loss_categories: [],
    }),
  ),
  http.get(`${API}/sales-performance/won-deals`, () => HttpResponse.json([])),
  http.get(`${API}/sales-performance/lost-deals`, () => HttpResponse.json([])),
)

export const handlers = import.meta.env.DEV ? allHandlers : []
