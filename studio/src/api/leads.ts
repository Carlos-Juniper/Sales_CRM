import { apiClient } from './client'
import type { Lead, AssignCrmPayload } from '@/types'

export interface LeadsResponse {
  data: Lead[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface LeadQueryParams {
  status?: string
  lead_type?: string
  lead_types?: string
  search?: string
  states?: string
  min_score?: number
  /** Canonical properties.id — look up the lead(s) for one property. */
  property_id?: string
  /** Comma-separated `leads.source` values — e.g. GOV_LEAD_SOURCES. */
  sources?: string
  /** Scope to the caller's own leads. The id comes from the JWT server-side. */
  mine?: boolean
  /** Public Leads queue: hide leads once assigned_to is set (never deleted). */
  unassigned_only?: boolean
  page?: number
  page_size?: number
  sort_by?: string
  sort_dir?: 'asc' | 'desc'
}

export interface CreateLeadPayload {
  property_name: string
  city: string
  state: string
  lead_type: Lead['lead_type']
  estimated_contract_value: number
  estimated_acreage: number
  status: Lead['status']
  address?: string
  units?: number
  contact_name?: string
  contact_email?: string
  /** Canonical properties.id — optional create-lead-from-property link. */
  property_id?: string | null
  /** WS1: branch the lead belongs to (from the branch picker in AddLeadModal). */
  branch_id?: string
}

export const leadsApi = {
  list: (params: LeadQueryParams = {}) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => { if (v != null) qs.set(k, String(v)) })
    const query = qs.toString()
    return apiClient.get<LeadsResponse>(`/leads${query ? `?${query}` : ''}`)
  },
  create: (body: CreateLeadPayload) => apiClient.post<Lead>('/leads', body),
  get: (id: string) => apiClient.get<Lead>(`/leads/${id}`),
  patch: (id: string, body: Partial<Lead>) => apiClient.patch<Lead>(`/leads/${id}`, body),
  deleteLead: (id: string): Promise<void> => apiClient.delete(`/leads/${id}`),
  // Assigning to a CRM is a qualification handoff, not an estimating handoff —
  // the lead reaches `estimating` later, when an estimate is actually requested.
  assignToCrm: (payload: AssignCrmPayload) =>
    apiClient.patch<Lead>(`/leads/${payload.lead_id}`, {
      status: 'qualified',
      assigned_to: payload.assigned_to,
      handoff_notes: payload.handoff_notes,
    }),
}

