// ---------------------------------------------------------------------------
// Crew-rate resolution + no-fallback contract (Slice 11b, §2.3 / §2.6).
//
// The loaded crew rate feeds maintenance margin DIRECTLY. The rules under test:
//   • A failed config fetch yields NO crew rate (null), never the old 18_000
//     demo literal — that literal is not a margin source anymore.
//   • Resolution order: frozen snapshot → live branch rate → null.
//   • A frozen snapshot WINS: changing the live branch rate must not move a
//     frozen estimate's resolved rate (snapshot stability, §2.6).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { server } from '@/mocks/server'
import { createWrapper, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { FALLBACK_ESTIMATING_CONFIG } from '@/hooks/useEstimatingConfig'
import { useResolvedCrewRate } from '@/hooks/useResolvedCrewRate'
import { buildMaintenanceEstimate } from '@/mocks/estimatingData'

const API = '/api'
const BRANCH_ID = 3696

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ name: 'Rita Delgado', role: 'inside_sales' }) })
})

function mockBranchRate(crewRateCentsPerHour: number | null) {
  server.use(
    http.get(`${API}/settings/branch/${BRANCH_ID}`, () =>
      HttpResponse.json({ aspireBranchId: BRANCH_ID, crewRateCentsPerHour }),
    ),
  )
}

describe('crew-rate no-fallback contract', () => {
  it('the estimating config fallback carries NO crew rate (never the 18_000 literal)', () => {
    // A failed config fetch degrades to this object. It must not smuggle a crew
    // rate: the margin panel resolves the rate itself and refuses when absent.
    expect('crewRateCentsPerHour' in FALLBACK_ESTIMATING_CONFIG).toBe(false)
    expect(JSON.stringify(FALLBACK_ESTIMATING_CONFIG)).not.toContain('18000')
  })

  it('the 18_000 literal is not a margin default — margins.ts does not export it', async () => {
    const margins = await import('@/lib/estimating/margins')
    expect('MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR' in margins).toBe(false)
  })
})

describe('useResolvedCrewRate — snapshot → live → null', () => {
  it('null when there is no snapshot and no branch id (no invented default)', () => {
    const est = buildMaintenanceEstimate() // aspireBranchId null, no snapshot
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useResolvedCrewRate(est), { wrapper })
    expect(result.current.crewRateCents).toBeNull()
    expect(result.current.source).toBe('none')
  })

  it('uses the live branch rate when there is no snapshot', async () => {
    mockBranchRate(19_500)
    const est = { ...buildMaintenanceEstimate(), aspireBranchId: BRANCH_ID }
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useResolvedCrewRate(est), { wrapper })
    await waitFor(() => expect(result.current.crewRateCents).toBe(19_500))
    expect(result.current.source).toBe('live')
  })

  it('null when the branch has no configured rate (live read returns null)', async () => {
    mockBranchRate(null)
    const est = { ...buildMaintenanceEstimate(), aspireBranchId: BRANCH_ID }
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useResolvedCrewRate(est), { wrapper })
    // Give the (successful, null) read a tick, then confirm it stays null.
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.crewRateCents).toBeNull()
    expect(result.current.source).toBe('none')
  })

  it('the frozen snapshot WINS over a different live branch rate (§2.6 stability)', async () => {
    mockBranchRate(25_000) // live rate moved AFTER submission
    const frozen = {
      ...buildMaintenanceEstimate(),
      aspireBranchId: BRANCH_ID,
      status: 'review' as const,
      crewRateCentsPerHour: 18_000, // frozen at submission
    }
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useResolvedCrewRate(frozen), { wrapper })
    // The resolved rate is the snapshot immediately and stays there — the live
    // read is not even enabled, so it can never override the frozen number.
    expect(result.current.crewRateCents).toBe(18_000)
    expect(result.current.source).toBe('snapshot')
    await waitFor(() => expect(result.current.crewRateCents).toBe(18_000))
    expect(result.current.source).toBe('snapshot')
  })
})
