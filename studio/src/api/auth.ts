import { apiClient } from './client'
import type { AuthUser } from '@/types'

export function logout() {
  return apiClient.post<{ ok: boolean }>('/auth/logout', {})
}

export function me() {
  return apiClient.get<AuthUser>('/auth/me')
}

export function entraCallback(idToken: string) {
  return apiClient.post<AuthUser>('/auth/entra-callback', { id_token: idToken })
}

export function storeMsGraphToken(payload: {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
}) {
  return apiClient.post<{ ok: boolean }>('/auth/ms-graph-token', payload)
}

export function disconnectMsGraph() {
  return apiClient.delete<{ ok: boolean }>('/auth/ms-graph-token')
}
