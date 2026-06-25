import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { apiClient, ApiError } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '../utils'

beforeEach(() => {
  useAuthStore.setState({ user: null, isLoading: false })
  localStorage.clear()
})

describe('apiClient — GET', () => {
  it('returns parsed JSON on success', async () => {
    server.use(
      http.get('/api/test-get', () => HttpResponse.json({ hello: 'world' }))
    )
    const data = await apiClient.get<{ hello: string }>('/test-get')
    expect(data).toEqual({ hello: 'world' })
  })

  it('sends to the correct URL path', async () => {
    let capturedUrl = ''
    server.use(
      http.get('/api/items', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json([])
      })
    )
    await apiClient.get('/items')
    expect(capturedUrl).toContain('/api/items')
  })
})

describe('apiClient — POST', () => {
  it('sends JSON body and returns parsed response', async () => {
    server.use(
      http.post('/api/things', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ received: body }, { status: 201 })
      })
    )
    const result = await apiClient.post<{ received: unknown }>('/things', { name: 'test' })
    expect(result.received).toEqual({ name: 'test' })
  })

  it('sets Content-Type: application/json', async () => {
    let contentType = ''
    server.use(
      http.post('/api/echo', ({ request }) => {
        contentType = request.headers.get('content-type') ?? ''
        return HttpResponse.json({})
      })
    )
    await apiClient.post('/echo', {})
    expect(contentType).toContain('application/json')
  })
})

describe('apiClient — PATCH', () => {
  it('sends partial update body', async () => {
    server.use(
      http.patch('/api/items/1', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>
        return HttpResponse.json({ ...body, id: '1' })
      })
    )
    const result = await apiClient.patch<{ status: string; id: string }>('/items/1', { status: 'done' })
    expect(result.status).toBe('done')
    expect(result.id).toBe('1')
  })
})

describe('apiClient — Authorization header', () => {
  it('never sends Authorization header (cookie-based auth)', async () => {
    let capturedAuth: string | null = 'sentinel'
    server.use(
      http.get('/api/public', ({ request }) => {
        capturedAuth = request.headers.get('Authorization')
        return HttpResponse.json({})
      })
    )

    await apiClient.get('/public')
    expect(capturedAuth).toBeNull()
  })
})

describe('apiClient — ApiError', () => {
  it('throws ApiError on 401 with correct status and message', async () => {
    server.use(
      http.get('/api/unauthorized', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
      )
    )
    const err = await apiClient.get('/unauthorized').catch(e => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('Session expired')
  })

  it('throws ApiError on 404 with correct status', async () => {
    server.use(
      http.get('/api/missing', () =>
        HttpResponse.json({ error: 'Not found' }, { status: 404 })
      )
    )
    const err = await apiClient.get('/missing').catch(e => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
  })

  it('throws ApiError on 500 with status 500', async () => {
    server.use(
      http.get('/api/broken', () =>
        HttpResponse.json({ error: 'Internal Server Error' }, { status: 500 })
      )
    )
    const err = await apiClient.get('/broken').catch(e => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)
  })

  it('falls back to statusText when body has no error field', async () => {
    server.use(
      http.get('/api/weird-error', () =>
        new HttpResponse(null, { status: 422, statusText: 'Unprocessable Entity' })
      )
    )
    const err = await apiClient.get('/weird-error').catch(e => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(422)
  })

  it('ApiError is an instance of Error', async () => {
    server.use(
      http.get('/api/fail', () =>
        HttpResponse.json({ error: 'Fail' }, { status: 400 })
      )
    )
    const err = await apiClient.get('/fail').catch(e => e) as ApiError
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApiError')
  })
})

describe('apiClient — network failure', () => {
  it('propagates error when network request fails', async () => {
    server.use(
      http.get('/api/network-fail', () => HttpResponse.error())
    )
    await expect(apiClient.get('/network-fail')).rejects.toThrow()
  })
})
