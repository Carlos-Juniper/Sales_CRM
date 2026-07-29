import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { propertiesApi, estimatingApi } from '@/api/estimating'

const API = '/api'

describe('propertiesApi', () => {
  it('lists properties with a search term (local source of truth)', async () => {
    let seenUrl = ''
    server.use(
      http.get(`${API}/properties`, ({ request }) => {
        seenUrl = request.url
        return HttpResponse.json([
          { id: 'prop-1', name: 'Sunny HOA', aspireSyncStatus: 'pending' },
        ])
      }),
    )
    const out = await propertiesApi.list('sun')
    expect(out[0].id).toBe('prop-1')
    expect(seenUrl).toContain('search=sun')
  })

  it('creates a property and returns it with pending sync status', async () => {
    let body: unknown
    server.use(
      http.post(`${API}/properties`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          { id: 'prop-9', name: 'New HOA', aspireSyncStatus: 'pending', aspirePropertyId: null },
          { status: 201 },
        )
      }),
    )
    const created = await propertiesApi.create({ name: 'New HOA', branchCity: 'Orlando, FL' })
    expect(created.id).toBe('prop-9')
    expect(created.aspireSyncStatus).toBe('pending')
    expect(body).toMatchObject({ name: 'New HOA', branchCity: 'Orlando, FL' })
  })

  it('fetches a property’s prior Aspire opportunities (dedup panel)', async () => {
    server.use(
      http.get(`${API}/properties/prop-1/opportunities`, () =>
        HttpResponse.json([{ OpportunityID: 630956, OpportunityNumber: 8 }]),
      ),
    )
    const opps = await propertiesApi.opportunities('prop-1')
    expect(opps).toHaveLength(1)
    expect(opps[0].OpportunityID).toBe(630956)
  })
})

describe('estimatingApi.retryAspireSync', () => {
  it('POSTs the retry endpoint', async () => {
    let called = false
    server.use(
      http.post(`${API}/estimating/estimates/est-1/retry-aspire-sync`, () => {
        called = true
        return HttpResponse.json({ status: 'queued' }, { status: 202 })
      }),
    )
    const res = await estimatingApi.retryAspireSync('est-1')
    expect(called).toBe(true)
    expect(res.status).toBe('queued')
  })
})
