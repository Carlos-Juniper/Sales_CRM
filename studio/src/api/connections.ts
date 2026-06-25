import { apiClient } from './client'
import type { ConnectionsStatus } from '@/types'

export async function fetchConnections(): Promise<ConnectionsStatus> {
  return apiClient.get('/settings/connections')
}
