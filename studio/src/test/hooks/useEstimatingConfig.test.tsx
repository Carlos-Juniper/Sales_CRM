// ---------------------------------------------------------------------------
// Handoff 16 — Config-Table Read APIs (frontend fetch layer).
//
// The five config sets come from the API; the config.ts literals are used
// ONLY as an offline fallback (fetch failed / in flight). The DB (mocked via
// MSW here) is the source of truth: a new/edited row flows to the UI with no
// frontend code edit.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor, screen } from '@testing-library/react'
import { useState } from 'react'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import {
  useEstimatingConfig,
  resetEstimatingConfigCache,
} from '@/hooks/useEstimatingConfig'
import {
  APPROVAL_TIER_SEED,
  DEFAULT_MARGIN_BANDS,
  ITB_SCOPE_SEED,
  MATERIAL_FORMULA_ROWS,
} from '@/lib/estimating/config'
import type { ApprovalTier, Estimate } from '@/types/estimating'
import { buildMaintenanceEstimate } from '@/mocks/estimatingData'
import { ApprovalHandoff } from '@/views/inside-sales/components/estimating/ApprovalHandoff'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'

beforeEach(() => {
  resetEstimatingConfigCache()
  useAuthStore.setState({ user: makeUser({ name: 'Rita Delgado', role: 'inside_sales' }) })
})

describe('useEstimatingConfig — fetch with literal fallback', () => {
  it('starts from the typed fallback literals while the fetch is in flight', () => {
    const { result } = renderHook(() => useEstimatingConfig())
    expect(result.current.loaded).toBe(false)
    expect(result.current.approvalTiers).toEqual(APPROVAL_TIER_SEED)
    expect(result.current.marginBands).toEqual(DEFAULT_MARGIN_BANDS)
    expect(result.current.materialCalcs).toEqual(MATERIAL_FORMULA_ROWS)
    expect(result.current.itbScopes).toEqual(ITB_SCOPE_SEED)
    expect(result.current.catalogItems).toEqual([])
  })

  it('loads all five config sets from the API', async () => {
    const { result } = renderHook(() => useEstimatingConfig())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.approvalTiers.length).toBeGreaterThan(0)
    expect(result.current.itbScopes.length).toBeGreaterThan(0)
    expect(result.current.materialCalcs.length).toBeGreaterThan(0)
    expect(result.current.marginBands.goodMin).toBeGreaterThan(result.current.marginBands.okMin)
  })

  it('a NEW approval_tiers row in the DB reaches the hook with no code edit (Handoff 00 §6)', async () => {
    const installTier: ApprovalTier = {
      id: 'tier-inst-custom',
      roleKey: 'manager',
      label: 'Install Manager Override',
      minValueCents: 0,
      maxValueCents: null,
      order: 1,
      estimateType: 'install',
    }
    server.use(
      http.get('/api/estimating/config/approval-tiers', () =>
        HttpResponse.json([...APPROVAL_TIER_SEED, installTier]),
      ),
    )
    const { result } = renderHook(() => useEstimatingConfig())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.approvalTiers).toContainEqual(installTier)
  })

  it('an edited margin_bands row flows through (canonical {goodMin, okMin})', async () => {
    server.use(
      http.get('/api/estimating/config/margin-bands', () =>
        HttpResponse.json([{ id: 'mb-default', name: 'default', goodMin: 0.34, okMin: 0.28 }]),
      ),
    )
    const { result } = renderHook(() => useEstimatingConfig())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.marginBands).toEqual({ goodMin: 0.34, okMin: 0.28 })
  })

  it('falls back to the config.ts literals when the API is unreachable', async () => {
    const fail = () => new HttpResponse(null, { status: 500 })
    server.use(
      http.get('/api/estimating/config/approval-tiers', fail),
      http.get('/api/estimating/config/margin-bands', fail),
      http.get('/api/estimating/config/material-calcs', fail),
      http.get('/api/estimating/config/itb-scopes', fail),
      http.get('/api/estimating/catalog-items', fail),
    )
    const { result } = renderHook(() => useEstimatingConfig())
    // Give the (failing) fetch a tick to settle, then confirm fallback holds.
    await waitFor(() => expect(result.current.approvalTiers).toEqual(APPROVAL_TIER_SEED))
    expect(result.current.marginBands).toEqual(DEFAULT_MARGIN_BANDS)
    expect(result.current.materialCalcs).toEqual(MATERIAL_FORMULA_ROWS)
    expect(result.current.itbScopes).toEqual(ITB_SCOPE_SEED)
    expect(result.current.catalogItems).toEqual([])
  })

  it('caches per session — a second hook mount does not refetch', async () => {
    let hits = 0
    server.use(
      http.get('/api/estimating/config/approval-tiers', () => {
        hits += 1
        return HttpResponse.json(APPROVAL_TIER_SEED)
      }),
    )
    const first = renderHook(() => useEstimatingConfig())
    await waitFor(() => expect(first.result.current.loaded).toBe(true))
    first.unmount()
    const second = renderHook(() => useEstimatingConfig())
    expect(second.result.current.loaded).toBe(true)
    expect(hits).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// UI-level config-drivenness: a fetched tier row drives approval routing.
// ---------------------------------------------------------------------------

function Harness({ estimate }: { estimate: Estimate | null }) {
  const [openEstimate, setOpenEstimate] = useState<Estimate | null>(estimate)
  return (
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{ activeTab: 'approval', setActiveTab: () => {}, openEstimate, setOpenEstimate }}
      >
        {/* No tiers prop: the component must fetch the ladder itself. */}
        <ApprovalHandoff />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>
  )
}

describe('ApprovalHandoff — API-fetched ladder drives routing (no code edit)', () => {
  it('routes by the DB ladder returned from the API, not the literals', async () => {
    // "DB edit": the API now returns a ladder where BM covers everything
    // under $2M — the seed literals would route $150K to Regional Director.
    server.use(
      http.get('/api/estimating/config/approval-tiers', () =>
        HttpResponse.json([
          { id: 't1', roleKey: 'manager', label: 'Branch Manager', minValueCents: 0, maxValueCents: 200_000_000, order: 1, estimateType: 'maintenance' },
          { id: 't2', roleKey: 'ceo', label: 'Chief Operating Officer', minValueCents: 200_000_000, maxValueCents: null, order: 2, estimateType: 'maintenance' },
        ]),
      ),
    )
    const est = buildMaintenanceEstimate({ contractValueCents: 15_000_000 })
    render(<Harness estimate={est} />)

    await waitFor(() =>
      expect(screen.getByTestId('required-tier')).toHaveTextContent('Branch Manager'),
    )
    expect(screen.getByText('Chief Operating Officer')).toBeInTheDocument()
    // The seed's mid-band tiers are gone — proof the fetched rows won.
    expect(screen.queryByText('Regional Director')).not.toBeInTheDocument()
  })
})
