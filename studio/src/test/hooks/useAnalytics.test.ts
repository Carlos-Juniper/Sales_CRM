import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { useRevenueAnalytics } from '@/hooks/useAnalytics'
import { useAuthStore } from '@/store/authStore'
import { createWrapper, makeUser } from '../utils'
import type { MonthlyRevenue } from '@/types'

const mockRevenue: MonthlyRevenue[] = [
  { month: 'Jan', won: 650000, forecast: 0, pipeline: 1100000 },
  { month: 'Feb', won: 735000, forecast: 0, pipeline: 1420000 },
  { month: 'Mar', won: 0, forecast: 680000, pipeline: 1620000 },
]

beforeEach(() => {
  useAuthStore.setState({ user: makeUser(), isLoading: false })
})

describe('useRevenueAnalytics', () => {
  it('returns MonthlyRevenue array from GET /api/analytics/revenue', async () => {
    server.use(http.get('/api/analytics/revenue', () => HttpResponse.json(mockRevenue)))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRevenueAnalytics(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(3)
    expect(result.current.data?.[0].month).toBe('Jan')
    expect(result.current.data?.[1].won).toBe(735000)
  })

  it('isPending is true initially', () => {
    server.use(http.get('/api/analytics/revenue', () => HttpResponse.json(mockRevenue)))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRevenueAnalytics(), { wrapper })
    expect(result.current.isPending).toBe(true)
  })

  it('isError becomes true when server returns 500', async () => {
    server.use(
      http.get('/api/analytics/revenue', () =>
        HttpResponse.json({ error: 'Server Error' }, { status: 500 })
      )
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRevenueAnalytics(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('returns an empty array when server returns []', async () => {
    server.use(http.get('/api/analytics/revenue', () => HttpResponse.json([])))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRevenueAnalytics(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })

  it('data includes all expected MonthlyRevenue fields', async () => {
    server.use(http.get('/api/analytics/revenue', () => HttpResponse.json(mockRevenue)))
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRevenueAnalytics(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const first = result.current.data?.[0]
    expect(first).toHaveProperty('month')
    expect(first).toHaveProperty('won')
    expect(first).toHaveProperty('forecast')
    expect(first).toHaveProperty('pipeline')
  })
})
