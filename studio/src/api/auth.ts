import { apiClient } from './client'
import type { AuthUser } from '@/types'

export function login(email: string, password: string) {
  return apiClient.post<AuthUser>('/auth/login', { email, password })
}

export function logout() {
  return apiClient.post<{ ok: boolean }>('/auth/logout', {})
}

export function me() {
  return apiClient.get<AuthUser>('/auth/me')
}

export function entraCallback(idToken: string) {
  return apiClient.post<AuthUser>('/auth/entra-callback', { id_token: idToken })
}
