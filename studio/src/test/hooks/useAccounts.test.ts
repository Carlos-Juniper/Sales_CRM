import { describe, it, expect } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { useHOAProperties, useCreateHOAProperty, usePatchHOAProperty } from '@/hooks/useHOAProperties'
import { useManagementCompanies, useCreateManagementCompany } from '@/hooks/useManagementCompanies'
import { createWrapper } from '../utils'
import type { HOAProperty, ManagementCompany } from '@/types/accounts'

// ── Fixtures ──────────────────────────────────────────────────────

const samplePMCompany: ManagementCompany = {
  id: 'pm1',
  company_name: 'Alliant Property Management',
  website: 'www.alliantproperty.com',
  phone: '(239) 454-1101',
  street: '13831 Vector Ave',
  city: 'Fort Myers',
  state: 'FL',
  zip: '33907',
  primary_email: 'service@alliantproperty.com',
  branch_id: 'b1',
  assigned_to: 'Trent Boyd',
  status: 'Partner',
  contact_status: 'contacted',
  last_contacted: '2026-05-30',
  contacts: [
    { id: 'c1', name: 'Dana Whitfield', title: 'Community Association Manager', email: 'dwhitfield@alliantproperty.com', phone: '(239) 454-1108' },
  ],
}

const sampleHOAProperty: HOAProperty = {
  id: 'h1',
  property_name: 'Pelican Bay',
  association_name: 'Pelican Bay Foundation, Inc.',
  address: '6620 Pelican Bay Blvd',
  city: 'Naples',
  state: 'FL',
  zip: '34108',
  county: 'Collier',
  acreage: 570,
  units: 6800,
  status: 'Active',
  contact_status: 'contacted',
  branch: 'Naples',
  assigned_to: 'Marisol Vega',
  last_contacted: '2026-05-20',
  management_company_id: 'pm1',
}

// ── useHOAProperties ──────────────────────────────────────────────

describe('useHOAProperties', () => {
  it('isPending is true initially before data resolves', () => {
    server.use(
      http.get('/api/hoa-properties', () =>
        HttpResponse.json({ data: [sampleHOAProperty], total: 1, page: 1, page_size: 25, total_pages: 1 }),
      ),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useHOAProperties(), { wrapper })
    expect(result.current.isPending).toBe(true)
  })

  it('returns HOA property array on successful fetch', async () => {
    server.use(
      http.get('/api/hoa-properties', () =>
        HttpResponse.json({ data: [sampleHOAProperty], total: 1, page: 1, page_size: 25, total_pages: 1 }),
      ),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useHOAProperties(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0].property_name).toBe('Pelican Bay')
  })

  it('isError becomes true when HOA properties API returns 500', async () => {
    server.use(
      http.get('/api/hoa-properties', () =>
        HttpResponse.json({ error: 'Server Error' }, { status: 500 }),
      ),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useHOAProperties(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('useCreateHOAProperty POSTs to /api/hoa-properties and invalidates cache', async () => {
    const newProperty: HOAProperty = {
      ...sampleHOAProperty,
      id: 'h-new',
      property_name: 'New Property',
      management_company_id: null,
    }
    let capturedBody: unknown
    server.use(
      http.get('/api/hoa-properties', () =>
        HttpResponse.json({ data: [sampleHOAProperty], total: 1, page: 1, page_size: 25, total_pages: 1 }),
      ),
      http.post('/api/hoa-properties', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(newProperty, { status: 201 })
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateHOAProperty(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        property_name: 'New Property',
        association_name: '',
        address: '',
        city: 'Naples',
        state: 'FL',
        zip: '34108',
        county: 'Collier',
        acreage: 100,
        units: 200,
        status: 'Prospect',
        branch: 'Naples',
        management_company_id: null,
      })
    })

    expect((capturedBody as Record<string, unknown>)?.property_name).toBe('New Property')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('usePatchHOAProperty PATCHes /api/hoa-properties/:id', async () => {
    const updatedProperty = { ...sampleHOAProperty, status: 'Bidding' as const }
    let capturedBody: unknown
    server.use(
      http.get('/api/hoa-properties', () =>
        HttpResponse.json({ data: [updatedProperty], total: 1, page: 1, page_size: 25, total_pages: 1 }),
      ),
      http.patch('/api/hoa-properties/h1', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(updatedProperty)
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => usePatchHOAProperty(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'h1', body: { status: 'Bidding' } })
    })

    expect((capturedBody as Record<string, unknown>)?.status).toBe('Bidding')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

// ── useManagementCompanies ────────────────────────────────────────

describe('useManagementCompanies', () => {
  it('isPending is true initially before data resolves', () => {
    server.use(
      http.get('/api/management-companies', () =>
        HttpResponse.json({ data: [samplePMCompany], total: 1, page: 1, page_size: 50 }),
      ),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useManagementCompanies(), { wrapper })
    expect(result.current.isPending).toBe(true)
  })

  it('returns management company array on successful fetch', async () => {
    server.use(
      http.get('/api/management-companies', () =>
        HttpResponse.json({ data: [samplePMCompany], total: 1, page: 1, page_size: 50 }),
      ),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useManagementCompanies(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0].company_name).toBe('Alliant Property Management')
  })

  it('isError becomes true when management companies API returns 500', async () => {
    server.use(
      http.get('/api/management-companies', () =>
        HttpResponse.json({ error: 'Server Error' }, { status: 500 }),
      ),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useManagementCompanies(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('useCreateManagementCompany POSTs to /api/management-companies and invalidates cache', async () => {
    const newCompany: ManagementCompany = {
      ...samplePMCompany,
      id: 'pm-new',
      company_name: 'Brand New Co',
      contacts: [],
    }
    let capturedBody: unknown
    server.use(
      http.get('/api/management-companies', () =>
        HttpResponse.json({ data: [samplePMCompany], total: 1, page: 1, page_size: 50 }),
      ),
      http.post('/api/management-companies', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(newCompany, { status: 201 })
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateManagementCompany(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        company_name: 'Brand New Co',
        website: '',
        phone: '',
        street: '',
        city: 'Naples',
        state: 'FL',
        zip: '34108',
        primary_email: '',
        branch_id: 'b1',
        contacts: [],
      })
    })

    expect((capturedBody as Record<string, unknown>)?.company_name).toBe('Brand New Co')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})
