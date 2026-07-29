import { describe, it, expect } from 'vitest'
import { waitFor } from '@testing-library/react'
import { estimatingApi, propertiesApi } from '@/api/estimating'
import { buildMaintenanceEstimate, toCreatePayload } from '@/mocks/estimatingData'

/**
 * Exercises the MSW simulation of the backend's async Aspire push: create returns
 * `pending`, then the row flips to `synced` shortly after — the two states the
 * sync-status UI must handle.
 */
describe('async Aspire sync simulation (MSW)', () => {
  it('estimate create returns pending, then flips to synced', async () => {
    const payload = toCreatePayload(buildMaintenanceEstimate({ name: 'Async Sync RT' }))
    const created = await estimatingApi.create(payload)
    expect(created.aspireSyncStatus).toBe('pending')
    expect(created.aspireOpportunityId).toBeNull()

    await waitFor(async () => {
      const got = await estimatingApi.get(created.id)
      expect(got.aspireSyncStatus).toBe('synced')
      expect(got.aspireOpportunityId).not.toBeNull()
    })
  })

  it('property create returns pending, then flips to synced with an Aspire id', async () => {
    const created = await propertiesApi.create({ name: 'Async Prop', branchCity: 'Orlando, FL' })
    expect(created.aspireSyncStatus).toBe('pending')
    expect(created.aspirePropertyId).toBeNull()

    await waitFor(async () => {
      const [row] = await propertiesApi.list('Async Prop')
      expect(row.aspireSyncStatus).toBe('synced')
      expect(row.aspirePropertyId).not.toBeNull()
    })
  })
})
