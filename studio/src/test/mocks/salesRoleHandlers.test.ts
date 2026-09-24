import { describe, it, expect, afterEach } from 'vitest'
import { apiClient, ApiError } from '@/api/client'
import { mockAuthSession, resetMockAuthSession } from '@/mocks/handlers'
import type { User } from '@/types'

afterEach(() => {
  resetMockAuthSession()
})

describe('MSW sales-role contract', () => {
  it('auth/me returns allowed_intake_types', async () => {
    const me = await apiClient.get<{ allowed_intake_types: string[] }>('/auth/me')
    expect(me.allowed_intake_types).toEqual(['maintenance', 'install'])
  })

  it('returns 403 when the session posts a disallowed estimateType', async () => {
    mockAuthSession.allowed_intake_types = ['maintenance']
    try {
      await apiClient.post('/estimating/estimates', { estimateType: 'install' })
      throw new Error('expected 403')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(403)
      expect((err as ApiError).message).toMatch(/maintenance intakes/i)
    }
    try {
      await apiClient.post('/estimating/intake/drafts', {
        estimateType: 'install',
        payload: { note: 'resume' },
      })
      throw new Error('expected 403')
    } catch (err) {
      expect((err as ApiError).status).toBe(403)
    }
  })

  it('?role=sales includes maintenance_sales and install_sales', async () => {
    const users = await apiClient.get<User[]>('/users?role=sales')
    const roles = users.map((u) => u.role)
    expect(roles).toContain('maintenance_sales')
    expect(roles).toContain('install_sales')
    expect(users.some((u) => u.name === 'Avery Brooks')).toBe(true)
    expect(users.some((u) => u.name === 'Parker Singh')).toBe(true)
  })
})
