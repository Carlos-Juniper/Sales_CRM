import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  useBids,
  useBidByLeadId,
  useCreateBid,
  useUpdateBid,
  useUsers,
  useInsideSalesDashboard,
} from '@/hooks/useBids'
import { useAuthStore } from '@/store/authStore'
import { createWrapper, makeUser } from '../utils'
import type { Bid, User, InsideSalesSummary } from '@/types'

const mockBid: Bid = {
  id: 'b1',
  title: 'City of Tempe Parks',
  agency: 'City of Tempe',
  service_types: ['Mowing'],
  deadline: '2025-06-01T00:00:00Z',
  estimated_value: 420000,
  status: 'pursuing',
  branch_id: 'b1',
  assigned_estimator_id: 'u5',
  lead_id: 'l2',
  submission_notes: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const mockUsers: User[] = [
  { id: 'u1', name: 'Carlos', email: 'carlos@test.com', role: 'inside_sales', branch_id: 'b1', avatar_initials: 'CH' },
  { id: 'u5', name: 'David Lee', email: 'david@test.com', role: 'inside_sales', branch_id: 'b1', avatar_initials: 'DL' },
]

const mockSummary: InsideSalesSummary = {
  new_leads_today: 4,
  leads_contacted_this_week: 12,
  open_bids: 5,
  bids_due_this_week: 2,
  pipeline_value: 1420000,
  overdue_follow_ups: 3,
  won_this_month: 2,
  won_value_this_month: 735000,
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser(), isLoading: false })
})

describe('useBids', () => {
  it('returns bid list from GET /api/bids', async () => {
    server.use(http.get('/api/bids', () => HttpResponse.json([mockBid])))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useBids(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].id).toBe('b1')
  })

  it('isPending is true initially', () => {
    server.use(http.get('/api/bids', () => HttpResponse.json([mockBid])))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useBids(), { wrapper })
    expect(result.current.isPending).toBe(true)
  })

  it('isError is true when server returns 500', async () => {
    server.use(http.get('/api/bids', () => HttpResponse.json({ error: 'fail' }, { status: 500 })))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useBids(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useBidByLeadId', () => {
  it('fetches bids filtered by lead_id and returns first result', async () => {
    server.use(
      http.get('/api/bids', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('lead_id') === 'l2') {
          return HttpResponse.json([mockBid])
        }
        return HttpResponse.json([])
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useBidByLeadId('l2'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('b1')
  })

  it('returns null when no bid found for lead', async () => {
    server.use(http.get('/api/bids', () => HttpResponse.json([])))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useBidByLeadId('l99'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('is disabled when leadId is null', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useBidByLeadId(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCreateBid', () => {
  it('fires POST /api/bids with the payload', async () => {
    let capturedBody: unknown
    server.use(
      http.post('/api/bids', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ...mockBid, id: 'b-new' }, { status: 201 })
      })
    )
    server.use(http.get('/api/bids', () => HttpResponse.json([])))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateBid(), { wrapper })

    result.current.mutate({
      title: 'New Bid',
      agency: 'City Test',
      service_types: ['Mowing'],
      deadline: '2025-12-01T00:00:00Z',
      estimated_value: 100000,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((capturedBody as Record<string, unknown>)?.title).toBe('New Bid')
  })
})

describe('useUpdateBid', () => {
  it('fires PATCH /api/bids/:id with the patch body', async () => {
    let capturedBody: unknown
    server.use(
      http.patch('/api/bids/b1', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ...mockBid, status: 'won' })
      })
    )
    server.use(http.get('/api/bids', () => HttpResponse.json([mockBid])))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateBid(), { wrapper })

    result.current.mutate({ id: 'b1', body: { status: 'won' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((capturedBody as Record<string, unknown>)?.status).toBe('won')
  })
})

describe('useUsers', () => {
  it('returns user list from GET /api/users', async () => {
    server.use(http.get('/api/users', () => HttpResponse.json(mockUsers)))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUsers(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(2)
  })

  it('passes role as query param', async () => {
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/users', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(mockUsers.filter(u => u.role === 'inside_sales'))
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUsers('inside_sales'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('role')).toBe('inside_sales')
  })

  it('passes branch_id as query param', async () => {
    let capturedUrl: URL | undefined
    server.use(
      http.get('/api/users', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(mockUsers)
      })
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUsers(undefined, 'b1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl?.searchParams.get('branch_id')).toBe('b1')
  })
})

describe('useInsideSalesDashboard', () => {
  it('returns KPI summary from GET /api/dashboard/inside-sales', async () => {
    server.use(http.get('/api/dashboard/inside-sales', () => HttpResponse.json(mockSummary)))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useInsideSalesDashboard(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.new_leads_today).toBe(4)
    expect(result.current.data?.pipeline_value).toBe(1420000)
    expect(result.current.data?.open_bids).toBe(5)
  })

  it('isError when server returns 500', async () => {
    server.use(http.get('/api/dashboard/inside-sales', () => HttpResponse.json({ error: 'fail' }, { status: 500 })))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useInsideSalesDashboard(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
