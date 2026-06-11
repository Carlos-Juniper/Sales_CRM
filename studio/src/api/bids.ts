import { apiClient } from './client'
import type { Bid, BidStatus, InsideSalesSummary, User } from '@/types'

export interface CreateBidPayload {
  title: string
  agency: string
  service_types: string[]
  deadline: string
  estimated_value: number
  lead_id?: string | null
  branch_id?: string
}

export const bidsApi = {
  list: (status?: BidStatus, leadId?: string) => {
    const qs = new URLSearchParams()
    if (status) qs.set('status', status)
    if (leadId) qs.set('lead_id', leadId)
    const q = qs.toString()
    return apiClient.get<Bid[]>(`/bids${q ? `?${q}` : ''}`)
  },
  create: (body: CreateBidPayload) => apiClient.post<Bid>('/bids', body),
  patch: (id: string, body: Partial<Bid>) => apiClient.patch<Bid>(`/bids/${id}`, body),
}

export const usersApi = {
  list: (role?: string, branchId?: string) => {
    const qs = new URLSearchParams()
    if (role) qs.set('role', role)
    if (branchId) qs.set('branch_id', branchId)
    const q = qs.toString()
    return apiClient.get<User[]>(`/users${q ? `?${q}` : ''}`)
  },
}

export const dashboardApi = {
  insideSales: () => apiClient.get<InsideSalesSummary>('/dashboard/inside-sales'),
}
