import { http, HttpResponse, delay } from 'msw'
import { mockLeads, mockBids, mockUsers, mockSummary, mockMonthlyRevenue, mockConnections } from './data'
import { mockEstimatesV2 } from './estimatingData'
import { PAGE_SIZE } from '../lib/constants'
import type { Lead, Bid } from '@/types'
import type {
  Estimate,
  EstimateSection,
  IntakeSubmission,
  IntakeAttachment,
  AttachmentKind,
  SectionService,
} from '@/types/estimating'
import type {
  ApproveHandBackPayload,
  CreateEstimatePayload,
  UpdateEstimatePayload,
  CreateSectionPayload,
  UpdateSectionPayload,
  CreateServicePayload,
  UpdateServicePayload,
} from '@/api/estimating'
import {
  approveAndHandBack,
  IllegalTransitionError,
  type StatusTransitionRecord,
} from '@/lib/estimating/transitions'

const API = '/api'
const leads = [...mockLeads]
const bids = [...mockBids]

// In-memory store for the new estimating model (Handoff 00).
const estimates: Estimate[] = structuredClone(mockEstimatesV2)

// In-memory app-owned property store (source of truth; pushed to Aspire async).
interface MockProperty {
  id: string
  name: string
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  branchCity: string | null
  customerType: string | null
  managementCompanyId: string | null
  aspirePropertyId: number | null
  aspireSyncStatus: 'pending' | 'synced' | 'failed'
  createdAt: string | null
  updatedAt: string | null
}
const properties: MockProperty[] = []

// Status-transition audit log (Handoff 08 — actor + timestamp per change).
const statusTransitions: StatusTransitionRecord[] = []

// Structured intake submissions (persisted verbatim; NEVER in estimate.notes).
const intakeSubmissions: IntakeSubmission[] = []

// In-memory attachment store (GCS attachment feature).
const attachments: IntakeAttachment[] = []

// In-memory resumable sessions: sessionId → { attachmentId, estimateId }.
const resumableSessions: Map<string, { attachmentId: string; estimateId: string }> = new Map()

let estimatingSeq = 0
function eid(prefix: string): string {
  estimatingSeq += 1
  return `${prefix}-${Date.now()}-${estimatingSeq}`
}

function notFound() {
  return HttpResponse.json({ error: 'Not found' }, { status: 404 })
}

const allHandlers = [
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
      notes: null,
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

  // GET /api/users
  http.get(`${API}/users`, async ({ request }) => {
    await delay(200)
    const url = new URL(request.url)
    const role = url.searchParams.get('role')
    const branchId = url.searchParams.get('branch_id')
    let users = [...mockUsers]
    if (role) users = users.filter(u => u.role === role)
    if (branchId) users = users.filter(u => u.branch_id === branchId)
    return HttpResponse.json(users)
  }),

  // GET /api/analytics/revenue
  http.get(`${API}/analytics/revenue`, async () => {
    await delay(200)
    return HttpResponse.json(mockMonthlyRevenue)
  }),

  // GET /api/dashboard/inside-sales
  http.get(`${API}/dashboard/inside-sales`, async () => {
    await delay(200)
    return HttpResponse.json(mockSummary)
  }),

  // GET /api/settings/connections
  http.get(`${API}/settings/connections`, async () => {
    await delay(150)
    return HttpResponse.json(mockConnections)
  }),

  // ---------------------------------------------------------------------
  // Estimating (Handoff 00) — single-source estimate model
  // ---------------------------------------------------------------------

  // GET /api/estimating/estimates
  http.get(`${API}/estimating/estimates`, async ({ request }) => {
    await delay(150)
    const url = new URL(request.url)
    const estimateType = url.searchParams.get('estimate_type')
    const status = url.searchParams.get('status')
    // Row-level branch scope (BRD I-9.5) — enforced server-side in production.
    const branch = url.searchParams.get('branch')
    let filtered = [...estimates]
    if (estimateType) filtered = filtered.filter((e) => e.estimateType === estimateType)
    if (status) filtered = filtered.filter((e) => e.status === status)
    if (branch) filtered = filtered.filter((e) => e.branch === branch)
    return HttpResponse.json(filtered)
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
    const { intake, serviceLine: _serviceLine, ...estimateBody } = body
    // Server-managed Aspire fields: create returns pending (the push is async),
    // then flips to synced. Simulate the flip so the UI can exercise both states.
    const created = {
      ...estimateBody,
      id,
      sections,
      aspireOpportunityId: null,
      aspireSyncStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    } as Estimate
    estimates.push(created)
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
    return HttpResponse.json(estimate)
  }),

  // PATCH /api/estimating/estimates/:id
  // `estimateType` is IMMUTABLE (Handoff 00 §2): any attempt to change it is
  // rejected at the data-access layer, mirroring the DB trigger in
  // sql/estimating.sql.
  http.patch(`${API}/estimating/estimates/:id`, async ({ params, request }) => {
    await delay(150)
    const idx = estimates.findIndex((e) => e.id === params.id)
    if (idx === -1) return notFound()
    const body = (await request.json()) as UpdateEstimatePayload & { estimateType?: string }
    if (body.estimateType !== undefined && body.estimateType !== estimates[idx].estimateType) {
      return HttpResponse.json(
        { error: 'estimate_type is immutable and cannot be changed after creation' },
        { status: 400 },
      )
    }
    delete body.estimateType
    estimates[idx] = {
      ...estimates[idx],
      ...body,
      updatedAt: new Date().toISOString(),
    } as Estimate
    return HttpResponse.json(estimates[idx])
  }),

  // POST /api/estimating/estimates/:id/approve-handback (Handoff 08)
  // Walks the status machine via the ONE transition module — side effects and
  // auditability are enforced here, never in the UI.
  http.post(`${API}/estimating/estimates/:id/approve-handback`, async ({ params, request }) => {
    await delay(150)
    const idx = estimates.findIndex((e) => e.id === params.id)
    if (idx === -1) return notFound()
    const body = (await request.json()) as ApproveHandBackPayload
    try {
      const { patch, records } = approveAndHandBack(estimates[idx], { actor: body.actor })
      estimates[idx] = {
        ...estimates[idx],
        ...patch,
        ...(body.notifyBmRdOnReturn !== undefined
          ? { approvalSettings: { notifyBmRdOnReturn: body.notifyBmRdOnReturn } }
          : {}),
        updatedAt: new Date().toISOString(),
      } as Estimate
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

  // GET /api/estimating/estimates/:id/intake (structured intake submissions)
  http.get(`${API}/estimating/estimates/:id/intake`, async ({ params }) => {
    await delay(100)
    if (!estimates.some((e) => e.id === params.id)) return notFound()
    return HttpResponse.json(intakeSubmissions.filter((s) => s.estimateId === params.id))
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
      services: (body.services ?? []).map((svc, vi) => ({
        ...svc,
        id: eid('svc'),
        sectionId,
        sortOrder: svc.sortOrder ?? vi,
      })),
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

  // POST /api/properties — local-first create (returns pending), async push.
  http.post(`${API}/properties`, async ({ request }) => {
    await delay(120)
    const body = (await request.json()) as Partial<MockProperty>
    if (!body.name) {
      return HttpResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const row: MockProperty = {
      id: eid('prop'),
      name: body.name,
      address1: body.address1 ?? null,
      address2: body.address2 ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zip: body.zip ?? null,
      branchCity: body.branchCity ?? null,
      customerType: body.customerType ?? null,
      managementCompanyId: body.managementCompanyId ?? null,
      aspirePropertyId: null,
      aspireSyncStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    properties.push(row)
    setTimeout(() => {
      row.aspireSyncStatus = 'synced'
      row.aspirePropertyId = Math.floor(700000 + Math.random() * 50000)
    }, 300)
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
    const sub = intakeSubmissions.find((s) => s.estimateId === estimateId)
    if (!est || !sub) return HttpResponse.json({ error: 'Not found' }, { status: 404 })

    const body = (await request.json()) as {
      kind?: AttachmentKind
      fileName: string
      contentType: string
      sizeBytes: number
    }

    if (body.contentType !== 'application/pdf') {
      return HttpResponse.json({ error: 'Only PDF attachments are supported' }, { status: 400 })
    }
    if (body.sizeBytes > 2 * 1024 * 1024 * 1024) {
      return HttpResponse.json({ error: 'File exceeds the 2 GiB limit' }, { status: 400 })
    }

    const attachmentId = eid('att')
    const objectKey = `estimating/${estimateId}/${attachmentId}.pdf`
    const sessionId = eid('sess')

    const att: IntakeAttachment = {
      id: attachmentId,
      intakeSubmissionId: sub.id,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      kind: body.kind ?? 'other',
      uploadedBy: null,
      status: 'pending',
      objectKey,
      downloadable: false,
      createdAt: new Date().toISOString(),
    }
    attachments.push(att)
    resumableSessions.set(sessionId, { attachmentId, estimateId })

    // Fake resumable upload endpoint URL — MSW intercepts it below.
    const uploadUrl = `http://localhost/__mock_gcs_upload/${sessionId}`
    return HttpResponse.json({ attachmentId, objectKey, uploadUrl }, { status: 201 })
  }),
)

// PUT /__mock_gcs_upload/:sessionId — fake GCS resumable upload endpoint
allHandlers.push(
  http.put('http://localhost/__mock_gcs_upload/:sessionId', ({ params }) => {
    const { sessionId } = params as { sessionId: string }
    const session = resumableSessions.get(sessionId)
    if (!session) return new HttpResponse(null, { status: 404 })
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
        (a) => a.id === attachmentId && a.intakeSubmissionId &&
          intakeSubmissions.some((s) => s.id === a.intakeSubmissionId && s.estimateId === estimateId),
      )
      if (!att) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
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
    const submissionIds = intakeSubmissions
      .filter((s) => s.estimateId === estimateId)
      .map((s) => s.id)
    const result = attachments.filter((a) => submissionIds.includes(a.intakeSubmissionId))
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
        (a) => a.id === attachmentId &&
          intakeSubmissions.some((s) => s.id === a.intakeSubmissionId && s.estimateId === estimateId),
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

export const handlers = import.meta.env.DEV ? allHandlers : []
