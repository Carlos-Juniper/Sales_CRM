import { apiClient } from './client'
import type { Lead, OutreachHistory, OutreachSendPayload, HandoffPayload, OutreachContact } from '@/types'

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
  handoff: (payload: HandoffPayload) =>
    apiClient.patch<Lead>(`/leads/${payload.lead_id}`, {
      status: 'handed_off',
      assigned_to: payload.assigned_to,
      handoff_notes: payload.handoff_notes,
      division_id: payload.division_id ?? null,
    }),
}

export const outreachApi = {
  history: (leadId: string) => apiClient.get<OutreachHistory[]>(`/outreach/${leadId}`),
  send: (payload: OutreachSendPayload) => apiClient.post<{ success: boolean; message_id: string }>('/outreach/send', payload),
}

export const contactsApi = {
  list: () => apiClient.get<OutreachContact[]>('/contacts'),
}
