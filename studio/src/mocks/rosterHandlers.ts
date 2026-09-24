import { http, HttpResponse } from 'msw'
import { useAuthStore } from '@/store/authStore'
import { mockUsers } from './data'
import type { ClientReference, TeamMember } from '@/types/proposal'

const API = '/api'

const VIEW_OWN = 'You can view only your own client references and team roster.'
const EDIT_OWN = 'You can edit only your own client references and team roster.'
const OTHER_REP = 'This row belongs to a different rep.'
const PASS_SALES_REP = "Pass a sales rep's id to edit that rep's client references and team roster."
const SALES_ROLE_REQUIRED = 'rep_id must be an active user with the sales role.'
const REP_ID_MISMATCH = 'rep_id and user_id must be the same rep.'
const SALES_REP_NOT_FOUND = 'Sales rep not found.'

type Denied = { ok: false; response: Response }
type RepIdResult = { ok: true; repId: string | null } | Denied
type WriteAuth = { ok: true; ownerId: string | null } | Denied

const teamMemberRows: TeamMember[] = []
const clientReferenceRows: ClientReference[] = []

function detail(status: number, message: string): Denied {
  return { ok: false, response: HttpResponse.json({ detail: message }, { status }) }
}

function callerRole(): string | null {
  const role = useAuthStore.getState().user?.role
  if (!role) return null
  return role === 'outside_sales' ? 'sales' : role
}

function callerId(): string | null {
  return useAuthStore.getState().user?.id ?? null
}

function salesDirectory(id: string): 'ok' | 'missing' | 'not-sales' {
  const user = mockUsers.find((u) => u.id === id)
  if (!user) return 'missing'
  const role = user.role === 'outside_sales' ? 'sales' : user.role
  return role === 'sales' ? 'ok' : 'not-sales'
}

function coalesceRepId(request: Request, bodyRepId?: string | null): RepIdResult {
  const url = new URL(request.url)
  const queryRep = url.searchParams.get('rep_id')
  const queryUser = url.searchParams.get('user_id')
  const ids = [queryRep, queryUser, bodyRepId].filter((v): v is string => !!v)
  if (new Set(ids).size > 1) return detail(400, REP_ID_MISMATCH)
  return { ok: true, repId: ids[0] ?? null }
}

function authorizeRead(repId: string | null): Response | null {
  if (!repId) return null
  const role = callerRole()
  const id = callerId()
  if (role === 'sales') {
    return repId === id ? null : detail(403, VIEW_OWN).response
  }
  if (role === 'marketing' || role === 'admin') {
    const found = salesDirectory(repId)
    if (found === 'missing') return detail(404, SALES_REP_NOT_FOUND).response
    if (found === 'not-sales') return detail(400, SALES_ROLE_REQUIRED).response
    return null
  }
  if (id && repId !== id) return detail(403, VIEW_OWN).response
  return detail(403, PASS_SALES_REP).response
}

function authorizeWrite(repId: string | null): WriteAuth {
  const role = callerRole()
  const id = callerId()
  if (role === 'sales' && (repId === null || repId === id)) {
    return { ok: true, ownerId: id }
  }
  if (role === 'marketing' || role === 'admin') {
    if (!repId) return { ok: true, ownerId: null }
    const found = salesDirectory(repId)
    if (found === 'missing') return detail(404, SALES_REP_NOT_FOUND)
    if (found === 'not-sales') return detail(400, SALES_ROLE_REQUIRED)
    return { ok: true, ownerId: repId }
  }
  if (repId && id && repId === id) return detail(403, PASS_SALES_REP)
  return detail(403, EDIT_OWN)
}

function authorizeRow(ownerUserId: string | null, requestedRepId: string | null): Response | null {
  const role = callerRole()
  const id = callerId()
  if (requestedRepId && ownerUserId !== requestedRepId) return detail(403, OTHER_REP).response
  if (role === 'sales' || (role !== 'marketing' && role !== 'admin')) {
    if (ownerUserId && ownerUserId !== id) return detail(403, EDIT_OWN).response
  }
  return null
}

function readRows<T extends { ownerUserId: string | null }>(request: Request, rows: T[]) {
  const url = new URL(request.url)
  const queryRep = url.searchParams.get('rep_id')
  const queryUser = url.searchParams.get('user_id')
  if (queryRep && queryUser && queryRep !== queryUser) {
    return detail(400, REP_ID_MISMATCH).response
  }
  const repId = queryRep ?? queryUser
  const denied = authorizeRead(repId)
  if (denied) return denied
  const visible = repId ? rows.filter((row) => row.ownerUserId === repId) : rows
  return HttpResponse.json(visible)
}

export const rosterHandlers = [
  http.get(`${API}/proposals/config/team-members`, ({ request }) =>
    readRows(request, teamMemberRows),
  ),
  http.get(`${API}/proposals/config/client-references`, ({ request }) =>
    readRows(request, clientReferenceRows),
  ),

  http.post(`${API}/settings/team-members`, async ({ request }) => {
    const body = (await request.json()) as Partial<TeamMember> & { repId?: string }
    const coalesced = coalesceRepId(request, body.repId ?? null)
    if (!coalesced.ok) return coalesced.response
    const auth = authorizeWrite(coalesced.repId)
    if (!auth.ok) return auth.response
    const row: TeamMember = {
      id: `tm-${teamMemberRows.length + 1}`,
      name: body.name ?? '',
      title: body.title ?? 'account_manager',
      teamType: body.teamType ?? 'branch',
      aspireBranchId: body.aspireBranchId ?? null,
      userId: body.userId ?? null,
      ownerUserId: auth.ownerId,
      location: body.location ?? null,
      bio: body.bio ?? '',
      headshotObjectKey: null,
      active: true,
      sortOrder: body.sortOrder ?? 0,
    }
    teamMemberRows.push(row)
    return HttpResponse.json(row, { status: 201 })
  }),

  http.post(`${API}/settings/team-members/:id/headshot`, async ({ params, request }) => {
    const row = teamMemberRows.find((member) => member.id === params.id)
    if (!row) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const coalesced = coalesceRepId(request, null)
    if (!coalesced.ok) return coalesced.response
    const denied = authorizeRow(row.ownerUserId, coalesced.repId)
    if (denied) return denied
    const auth = authorizeWrite(coalesced.repId ?? row.ownerUserId)
    if (!auth.ok) return auth.response
    row.headshotObjectKey = `proposal/headshots/${row.id}.jpg`
    return HttpResponse.json({ id: row.id, headshotObjectKey: row.headshotObjectKey })
  }),

  http.delete(`${API}/settings/team-members/:id/headshot`, ({ params, request }) => {
    const row = teamMemberRows.find((member) => member.id === params.id)
    if (!row) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const coalesced = coalesceRepId(request, null)
    if (!coalesced.ok) return coalesced.response
    const denied = authorizeRow(row.ownerUserId, coalesced.repId)
    if (denied) return denied
    const auth = authorizeWrite(coalesced.repId ?? row.ownerUserId)
    if (!auth.ok) return auth.response
    row.headshotObjectKey = null
    return HttpResponse.json({ id: row.id, headshotObjectKey: null })
  }),

  http.patch(`${API}/settings/team-members/:id`, async ({ params, request }) => {
    const row = teamMemberRows.find((member) => member.id === params.id)
    if (!row) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const coalesced = coalesceRepId(request, null)
    if (!coalesced.ok) return coalesced.response
    const denied = authorizeRow(row.ownerUserId, coalesced.repId)
    if (denied) return denied
    const auth = authorizeWrite(coalesced.repId ?? row.ownerUserId)
    if (!auth.ok) return auth.response
    const body = (await request.json()) as Partial<TeamMember>
    Object.assign(row, body, { ownerUserId: row.ownerUserId })
    return HttpResponse.json(row)
  }),

  http.delete(`${API}/settings/team-members/:id`, ({ params, request }) => {
    const row = teamMemberRows.find((member) => member.id === params.id)
    if (!row) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const coalesced = coalesceRepId(request, null)
    if (!coalesced.ok) return coalesced.response
    const denied = authorizeRow(row.ownerUserId, coalesced.repId)
    if (denied) return denied
    const auth = authorizeWrite(coalesced.repId ?? row.ownerUserId)
    if (!auth.ok) return auth.response
    row.active = false
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(`${API}/settings/client-references`, async ({ request }) => {
    const body = (await request.json()) as Partial<ClientReference> & { repId?: string }
    const coalesced = coalesceRepId(request, body.repId ?? null)
    if (!coalesced.ok) return coalesced.response
    const auth = authorizeWrite(coalesced.repId)
    if (!auth.ok) return auth.response
    const row: ClientReference = {
      id: `cr-${clientReferenceRows.length + 1}`,
      aspireBranchId: body.aspireBranchId ?? null,
      ownerUserId: auth.ownerId,
      propertyName: body.propertyName ?? '',
      servicesProvided: body.servicesProvided ?? '',
      contactName: body.contactName ?? '',
      contactTitle: body.contactTitle ?? null,
      phone: body.phone ?? '',
      email: body.email ?? '',
      address: body.address ?? '',
      clientSinceYear: body.clientSinceYear ?? new Date().getFullYear(),
      active: true,
    }
    clientReferenceRows.push(row)
    return HttpResponse.json(row, { status: 201 })
  }),

  http.patch(`${API}/settings/client-references/:id`, async ({ params, request }) => {
    const row = clientReferenceRows.find((ref) => ref.id === params.id)
    if (!row) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const coalesced = coalesceRepId(request, null)
    if (!coalesced.ok) return coalesced.response
    const denied = authorizeRow(row.ownerUserId, coalesced.repId)
    if (denied) return denied
    const auth = authorizeWrite(coalesced.repId ?? row.ownerUserId)
    if (!auth.ok) return auth.response
    const body = (await request.json()) as Partial<ClientReference>
    Object.assign(row, body, { ownerUserId: row.ownerUserId })
    return HttpResponse.json(row)
  }),

  http.delete(`${API}/settings/client-references/:id`, ({ params, request }) => {
    const row = clientReferenceRows.find((ref) => ref.id === params.id)
    if (!row) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const coalesced = coalesceRepId(request, null)
    if (!coalesced.ok) return coalesced.response
    const denied = authorizeRow(row.ownerUserId, coalesced.repId)
    if (denied) return denied
    const auth = authorizeWrite(coalesced.repId ?? row.ownerUserId)
    if (!auth.ok) return auth.response
    row.active = false
    return new HttpResponse(null, { status: 204 })
  }),
]
