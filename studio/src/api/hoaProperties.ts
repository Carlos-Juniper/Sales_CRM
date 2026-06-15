import { apiClient } from './client'
import type { HOAProperty } from '@/types/accounts'

export interface HOAListResponse {
  data: HOAProperty[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface CreateHOAPropertyPayload {
  property_name: string
  association_name?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  county?: string
  acreage?: number
  units?: number | null
  status?: HOAProperty['status']
  branch?: string | null
  management_company_id?: string | null
}

export interface PatchHOAPropertyPayload {
  status?: HOAProperty['status']
  management_company_id?: string | null
  assigned_to?: string | null
  last_contacted?: string | null
  contact_status?: HOAProperty['contact_status']
}

export const hoaPropertiesApi = {
  list: (params?: {
    state?: string
    status?: string       // comma-separated for multi-select
    branch_id?: string    // comma-separated
    city?: string         // comma-separated
    search?: string
    page?: number
    page_size?: number
  }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => { if (v != null) qs.set(k, String(v)) })
    }
    const query = qs.toString()
    return apiClient.get<HOAListResponse>(`/hoa-properties${query ? `?${query}` : ''}`)
  },

  filterOptions: () =>
    apiClient.get<{ cities: string[]; branches: string[] }>('/hoa-properties/filter-options'),

  create: (body: CreateHOAPropertyPayload) =>
    apiClient.post<HOAProperty>('/hoa-properties', body),

  patch: (id: string, body: PatchHOAPropertyPayload) =>
    apiClient.patch<HOAProperty>(`/hoa-properties/${id}`, body),

  promote: (id: string) =>
    apiClient.post<import('@/types/index').Lead>(`/hoa-properties/${id}/promote`, {}),
}
