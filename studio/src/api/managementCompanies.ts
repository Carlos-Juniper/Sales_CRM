import { apiClient } from './client'
import type { ManagementCompany, PMContact } from '@/types/accounts'

export interface MgmtListResponse {
  data: ManagementCompany[]
  total: number
  page: number
  page_size: number
}

export interface PMContactPayload {
  name: string
  title?: string | null
  email?: string | null
  phone?: string | null
}

export interface CreateManagementCompanyPayload {
  company_name: string
  website?: string | null
  phone?: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  primary_email?: string | null
  branch_id?: string | null
  contacts?: PMContactPayload[]
}

export interface PatchManagementCompanyPayload {
  company_name?: string
  website?: string | null
  phone?: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  primary_email?: string | null
  branch_id?: string | null
  assigned_to?: string | null
  status?: ManagementCompany['status']
  last_contacted?: string | null
  contact_status?: ManagementCompany['contact_status']
}

export interface PMContactBody {
  name: string
  title?: string | null
  email?: string | null
  phone?: string | null
}

export interface PatchPMContactBody {
  name?: string
  title?: string | null
  email?: string | null
  phone?: string | null
}

// PMContact is imported so TypeScript resolves it — used indirectly via ManagementCompany['contacts']
export type { PMContact }

export const managementCompaniesApi = {
  list: (params?: { search?: string; branch_id?: string; status?: string; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => { if (v != null) qs.set(k, String(v)) })
    }
    const query = qs.toString()
    return apiClient.get<MgmtListResponse>(`/management-companies${query ? `?${query}` : ''}`)
  },

  create: (body: CreateManagementCompanyPayload) =>
    apiClient.post<ManagementCompany>('/management-companies', body),

  patch: (id: string, body: PatchManagementCompanyPayload) =>
    apiClient.patch<ManagementCompany>(`/management-companies/${id}`, body),

  addContact: (companyId: string, body: PMContactBody) =>
    apiClient.post<ManagementCompany>(`/management-companies/${companyId}/contacts`, body),

  updateContact: (companyId: string, contactId: string, body: PatchPMContactBody) =>
    apiClient.patch<ManagementCompany>(`/management-companies/${companyId}/contacts/${contactId}`, body),

  deleteContact: (companyId: string, contactId: string) =>
    apiClient.delete<ManagementCompany>(`/management-companies/${companyId}/contacts/${contactId}`),
}
