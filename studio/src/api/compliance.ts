import { apiClient } from './client'
import type { ContactConsent } from '@/types'

export async function fetchContactConsent(contactId: string): Promise<ContactConsent> {
  return apiClient.get(`/contacts/${contactId}/consent`)
}

export async function patchContactConsent(contactId: string, updates: Partial<ContactConsent>): Promise<ContactConsent> {
  return apiClient.patch(`/contacts/${contactId}/consent`, updates)
}

export async function checkCompliance(channel: string, to: string): Promise<{ allowed: boolean; reason?: string }> {
  return apiClient.get(`/compliance/check?channel=${channel}&to=${encodeURIComponent(to)}`)
}
