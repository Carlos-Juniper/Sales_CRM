import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  useLeads,
  useLead,
  useCreateLead,
  useUpdateLead,
  useDeleteLead,
} from '@/hooks/useLeads'
import { useLeadsStore } from '@/store/leadsStore'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { createWrapper, makeUser } from '../utils'
import { ApiError } from '@/api/client'
import { LEAD_NOTES_MAX_LENGTH } from '@/api/leads'
import type { Lead } from '@/types'

const defaultLeadsResponse = {
  data: [
    {
      id: 'l1', property_name: 'Silverleaf HOA', address: '1234 Desert Ridge', city: 'Phoenix',
      state: 'AZ', zip: '85050', lat: 33.69, lng: -111.97, lead_type: 'HOA', score: 88,
      score_factors: [], estimated_acreage: 45, estimated_contract_value: 185000,
      contact_name: 'Jennifer Walsh', contact_email: 'jwalsh@test.com', contact_linkedin: null,
      current_provider: null, source: 'hoa_usa', source_url: null, bid_deadline: null,
      status: 'new', assigned_to: null, notes: null, handoff_notes: null,
      ai_linkedin_draft: null, branch_id: 'b1', distance_miles: 8.4,
      aspire_opportunity_id: null, division_id: null,
      created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    } as Lead,
  ],
  total: 1,
  page: 1,
  page_size: 25,
}

const defaultResetState = {
  filters: { search: '', leadTypes: [], minScore: 0, states: [], assignedOnly: false, unassignedOnly: false },
  sortBy: 'score' as const,
  sortDir: 'desc' as const,
  page: 1,
  optimisticUpdates: {},
}

beforeEach(() => {
  useLeadsStore.setState(defaultResetState)
  useAuthStore.setState({ user: makeUser(), isLoading: false })
  useUIStore.setState({ toasts: [] })
})

describe('useLeads', () => {
  it('returns leads data after fetching', async () => {
    server.use(http.get('/api/leads', () => HttpResponse.json(defaultLeadsResponse)))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(1)
    expect(result.current.data?.data[0].property_name).toBe('Silverleaf HOA')
  })

  it('isPending is true initially', () => {
    server.use(http.get('/api/leads', () => HttpResponse.json(defaultLeadsResponse)))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    expect(result.current.isPending).toBe(true)
  })

  it('isError becomes true when server returns 500', async () => {
    server.use(http.get('/api/leads', () => HttpResponse.json({ error: 'Server Error' }, { status: 500 })))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('passes sort_by from store as query param', async () => {
    useLeadsStore.setState({ ...defaultResetState, sortBy: 'created_at' })
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(defaultLeadsResponse)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('sort_by')).toBe('created_at')
  })

  it('passes sort_dir from store as query param', async () => {
    useLeadsStore.setState({ ...defaultResetState, sortDir: 'asc' })
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(defaultLeadsResponse)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('sort_dir')).toBe('asc')
  })

  it('passes page from store as query param', async () => {
    useLeadsStore.setState({ ...defaultResetState, page: 3 })
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json({ ...defaultLeadsResponse, page: 3 })
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('page')).toBe('3')
  })

  it('passes search filter as query param', async () => {
    useLeadsStore.setState({ ...defaultResetState, filters: { ...defaultResetState.filters, search: 'tempe' } })
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(defaultLeadsResponse)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('search')).toBe('tempe')
  })

  it('passes lead_types filter as comma-separated query param', async () => {
    useLeadsStore.setState({ ...defaultResetState, filters: { ...defaultResetState.filters, leadTypes: ['HOA', 'commercial'] } })
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(defaultLeadsResponse)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('lead_types')).toBe('HOA,commercial')
  })

  it('passes states filter as comma-separated query param', async () => {
    useLeadsStore.setState({ ...defaultResetState, filters: { ...defaultResetState.filters, states: ['FL', 'TX'] } })
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(defaultLeadsResponse)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('states')).toBe('FL,TX')
  })

  it('passes min_score when > 0', async () => {
    useLeadsStore.setState({ ...defaultResetState, filters: { ...defaultResetState.filters, minScore: 70 } })
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(defaultLeadsResponse)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('min_score')).toBe('70')
  })

  it('omits min_score when 0', async () => {
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(defaultLeadsResponse)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('min_score')).toBeNull()
  })

  it('passes page_size=25', async () => {
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/leads', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(defaultLeadsResponse)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLeads(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('page_size')).toBe('25')
  })
})

describe('useLead', () => {
  it('fetches a single lead by id', async () => {
    server.use(
      http.get('/api/leads/l1', () => HttpResponse.json(defaultLeadsResponse.data[0]))
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLead('l1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('l1')
  })

  it('is disabled (does not fetch) when id is null', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useLead(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })
})

describe('useCreateLead', () => {
  it('fires POST /api/leads with the payload', async () => {
    let capturedBody: unknown
    server.use(
      http.post('/api/leads', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ...defaultLeadsResponse.data[0], id: 'new-lead' }, { status: 201 })
      })
    )
    server.use(http.get('/api/leads', () => HttpResponse.json(defaultLeadsResponse)))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateLead(), { wrapper })

    result.current.mutate({
      property_name: 'New Property',
      city: 'Dallas',
      state: 'TX',
      lead_type: 'commercial',
      estimated_contract_value: 50000,
      estimated_acreage: 5,
      status: 'new',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((capturedBody as Record<string, unknown>)?.property_name).toBe('New Property')
  })

  it('surfaces the server error detail in the toast description on failure', async () => {
    server.use(
      http.post('/api/leads', () =>
        HttpResponse.json({ detail: "Unknown column 'property_id'" }, { status: 500 })
      )
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateLead(), { wrapper })

    result.current.mutate({
      property_name: 'New Property', city: 'Fort Myers', state: 'FL',
      lead_type: 'HOA', estimated_contract_value: 0, estimated_acreage: 0, status: 'new',
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const toasts = useUIStore.getState().toasts
    const errorToast = toasts.find((t) => t.variant === 'error')
    expect(errorToast?.title).toBe('Failed to add lead')
    expect(errorToast?.description).toBe("Unknown column 'property_id'")
  })

  it('echoes trimmed notes and stores blank notes as null', async () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateLead(), { wrapper })

    result.current.mutate({
      property_name: 'Noted Property',
      city: 'Dallas',
      state: 'TX',
      lead_type: 'commercial',
      estimated_contract_value: 50000,
      estimated_acreage: 5,
      status: 'new',
      notes: '  met at the show  ',
    })
    await waitFor(() => expect(result.current.data?.notes).toBe('met at the show'))

    result.current.mutate({
      property_name: 'Blank Notes',
      city: 'Dallas',
      state: 'TX',
      lead_type: 'commercial',
      estimated_contract_value: 1,
      estimated_acreage: 1,
      status: 'new',
      notes: '   ',
    })
    await waitFor(() => expect(result.current.data?.property_name).toBe('Blank Notes'))
    expect(result.current.data?.notes).toBeNull()
  })

  it('returns 422 with loc body.notes when notes exceed the max length', async () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateLead(), { wrapper })

    result.current.mutate({
      property_name: 'Too Long',
      city: 'Dallas',
      state: 'TX',
      lead_type: 'commercial',
      estimated_contract_value: 1,
      estimated_acreage: 1,
      status: 'new',
      notes: 'x'.repeat(LEAD_NOTES_MAX_LENGTH + 1),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    const err = result.current.error as ApiError
    expect(err.status).toBe(422)
    expect(err.issues).toEqual([
      expect.objectContaining({ loc: ['body', 'notes'] }),
    ])
    const errorToast = useUIStore.getState().toasts.find((t) => t.variant === 'error')
    expect(errorToast?.description).toBe(
      `String should have at most ${LEAD_NOTES_MAX_LENGTH} characters`,
    )
  })
})

describe('useUpdateLead', () => {
  it('fires PATCH /api/leads/:id with the patch body', async () => {
    let capturedBody: unknown
    server.use(
      http.patch('/api/leads/l1', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ...defaultLeadsResponse.data[0], status: 'contacted' })
      })
    )
    server.use(http.get('/api/leads', () => HttpResponse.json(defaultLeadsResponse)))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateLead(), { wrapper })

    result.current.mutate({ id: 'l1', body: { status: 'contacted' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((capturedBody as Record<string, unknown>)?.status).toBe('contacted')
  })

  it('surfaces the server error detail in the toast description on failure', async () => {
    server.use(
      http.patch('/api/leads/l1', () =>
        HttpResponse.json({ detail: 'state exceeds 2 characters' }, { status: 500 })
      )
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateLead(), { wrapper })

    result.current.mutate({ id: 'l1', body: { status: 'contacted' } })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const errorToast = useUIStore.getState().toasts.find((t) => t.variant === 'error')
    expect(errorToast?.description).toBe('state exceeds 2 characters')
  })
})

describe('useDeleteLead', () => {
  it('fires DELETE /api/leads/:id and resolves on 204', async () => {
    let deletedId: string | undefined
    server.use(
      http.delete('/api/leads/:id', ({ params }) => {
        deletedId = params.id as string
        return new HttpResponse(null, { status: 204 })
      })
    )
    server.use(http.get('/api/leads', () => HttpResponse.json(defaultLeadsResponse)))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteLead(), { wrapper })

    result.current.mutate('l1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(deletedId).toBe('l1')
  })

  it('isError becomes true when server returns 500', async () => {
    server.use(
      http.delete('/api/leads/:id', () =>
        HttpResponse.json({ error: 'Server Error' }, { status: 500 })
      )
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteLead(), { wrapper })

    result.current.mutate('l1')

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('surfaces the server error detail in the toast description on failure', async () => {
    server.use(
      http.delete('/api/leads/:id', () =>
        HttpResponse.json({ detail: 'lead is referenced by an estimate' }, { status: 409 })
      )
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteLead(), { wrapper })

    result.current.mutate('l1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    const errorToast = useUIStore.getState().toasts.find((t) => t.variant === 'error')
    expect(errorToast?.description).toBe('lead is referenced by an estimate')
  })
})
