import { http, HttpResponse, delay } from 'msw'
import { mockLeads, mockBids, mockUsers, mockOutreach, mockSummary, mockMonthlyRevenue } from './data'
import { PAGE_SIZE } from '../lib/constants'
import type { Lead, Bid } from '@/types'

const API = '/api'
let leads = [...mockLeads]
let bids = [...mockBids]

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
      ai_email_draft: null,
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

  // GET /api/outreach/:lead_id
  http.get(`${API}/outreach/:lead_id`, async ({ params }) => {
    await delay(200)
    const history = mockOutreach[params.lead_id as string] ?? []
    return HttpResponse.json(history)
  }),

  // POST /api/outreach/send
  http.post(`${API}/outreach/send`, async ({ request }) => {
    await delay(400)
    const body = await request.json() as { lead_id: string; channel: string; message: string }
    // Update lead status to contacted if it's new
    const idx = leads.findIndex(l => l.id === body.lead_id)
    if (idx !== -1 && leads[idx].status === 'new') {
      leads[idx] = { ...leads[idx], status: 'contacted', updated_at: new Date().toISOString() }
    }
    return HttpResponse.json({ success: true, message_id: `msg_${Date.now()}` })
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

  // POST /api/auth/login (mock)
  http.post(`${API}/auth/login`, async ({ request }) => {
    await delay(500)
    const body = await request.json() as { email: string; password: string }
    const user = mockUsers.find(u => u.email === body.email)
    if (!user || body.password !== 'demo') {
      return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    return HttpResponse.json({
      ...user,
      token: `mock_jwt_${user.id}_${Date.now()}`,
    })
  }),
]

export const handlers = import.meta.env.DEV ? allHandlers : []
