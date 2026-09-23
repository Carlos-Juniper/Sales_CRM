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

/**
 * Redeem the Entra authorization code on the backend and open the session.
 *
 * Supersedes the browser-side token exchange plus the follow-up
 * storeMsGraphToken call: the backend now does both in one round trip, and its
 * redemption is what makes the stored Graph refresh token refreshable at all.
 */
export function entraComplete(payload: {
  code: string
  code_verifier: string
  redirect_uri: string
}) {
  return apiClient.post<AuthUser>('/auth/entra-complete', payload)
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
