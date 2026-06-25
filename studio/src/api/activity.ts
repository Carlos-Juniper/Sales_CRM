import { apiClient } from './client'
import type { ActivityItem } from '@/types'

export async function fetchLeadActivity(leadId: string): Promise<ActivityItem[]> {
  return apiClient.get(`/leads/${leadId}/activity`)
}
