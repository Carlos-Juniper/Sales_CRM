// ---------------------------------------------------------------------------
// Handoff 21 — ITB Tracker Backend & Auto-Generation (frontend fetch layer).
//
// The tracker reads REAL data: GET /api/estimating/itb/projects returns one
// auto-generated ITB project per ACTIVE estimate (status not won/lost), each
// embedding its scope statuses. Creating an estimate from either intake form
// auto-creates the linked project (mirrored by the MSW store). Scope status
// updates persist via PATCH.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useItbProjects } from '@/hooks/useItbProjects'
import { estimatingApi, estimatingItbApi } from '@/api/estimating'
import { buildMaintenanceEstimate, buildInstallEstimate, toCreatePayload } from '@/mocks/estimatingData'
import { ITB_SCOPE_SEED } from '@/lib/estimating/config'

describe('useItbProjects — real ITB data for the tracker', () => {
  it('loads one project per active seeded estimate with flattened statuses', async () => {
    const { result } = renderHook(() => useItbProjects())
    expect(result.current.loaded).toBe(false)
    await waitFor(() => expect(result.current.loaded).toBe(true))

    // Both mockEstimatesV2 seeds are in_progress → both appear.
    expect(result.current.projects.length).toBeGreaterThanOrEqual(2)
    const names = result.current.projects.map((p) => p.name)
    expect(names).toContain('Dobson Ranch HOA — Grounds Maintenance')
    expect(names).toContain('Silverleaf — Phase 2 Installation')

    // Each project links back to its estimate and derives a quarter.
    for (const p of result.current.projects) {
      expect(p.estimateId).toBeTruthy()
      expect(p.quarter).toMatch(/^Q[1-4]$/)
    }

    // Statuses are flattened for the ItbTracker props: one row per
    // project × scope, initialized to the default 'P'.
    const first = result.current.projects[0]
    const firstStatuses = result.current.statuses.filter((s) => s.projectId === first.id)
    expect(firstStatuses).toHaveLength(ITB_SCOPE_SEED.length)
    expect(firstStatuses.every((s) => s.statusCode === 'P')).toBe(true)
  })

  it('creating an estimate from an intake form auto-creates exactly one linked ITB project', async () => {
    const before = await estimatingItbApi.projects()
    const created = await estimatingApi.create(
      toCreatePayload(buildInstallEstimate({ name: 'Auto-Gen Bid', status: 'queued' })),
    )
    const after = await estimatingItbApi.projects()
    const mine = after.filter((p) => p.estimateId === created.id)
    expect(mine).toHaveLength(1)
    expect(after.length).toBe(before.length + 1)
    expect(mine[0].name).toBe('Auto-Gen Bid')
    // scope statuses initialized for every config scope
    expect(mine[0].statuses).toHaveLength(ITB_SCOPE_SEED.length)
  })

  it('excludes won/lost estimates — the tracker shows ACTIVE estimates only', async () => {
    const before = await estimatingItbApi.projects()
    await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate({ name: 'Won Deal', status: 'won' })),
    )
    const after = await estimatingItbApi.projects()
    expect(after.length).toBe(before.length)
    expect(after.map((p) => p.name)).not.toContain('Won Deal')
  })

  it('a PATCHed scope status persists across reload', async () => {
    const projects = await estimatingItbApi.projects()
    const target = projects[0]
    const scopeId = ITB_SCOPE_SEED[0].id

    const updated = await estimatingItbApi.updateScopeStatus(target.id, scopeId, 'X')
    expect(updated).toEqual({ projectId: target.id, scopeId, statusCode: 'X' })

    // "Reload": a fresh GET reflects the persisted status.
    const reloaded = await estimatingItbApi.projects()
    const row = reloaded
      .find((p) => p.id === target.id)!
      .statuses.find((s) => s.scopeId === scopeId)
    expect(row?.statusCode).toBe('X')
  })

  it('refresh() refetches after a mutation', async () => {
    const { result } = renderHook(() => useItbProjects())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const countBefore = result.current.projects.length

    await estimatingApi.create(
      toCreatePayload(buildInstallEstimate({ name: 'Refetched Bid', status: 'queued' })),
    )
    await result.current.refresh()
    await waitFor(() =>
      expect(result.current.projects.length).toBe(countBefore + 1),
    )
  })
})
