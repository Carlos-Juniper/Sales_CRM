// ---------------------------------------------------------------------------
// Slice 11a — Branch config forms (crew rate, material factors, production
// rates, branch profile), each bound to the currently-selected branch.
//
// crew-rate:        renders the dollar value from a mocked rate; renders an
//                   explicit "not configured" state when crewRateCentsPerHour
//                   is null; PATCHes cents on save; surfaces a 403 (out-of-scope)
//                   error state and a success state.
// material-factors: renders factor fields, PATCHes changed factors keyed on the
//                   materialKey, and exposes NO unit_cost/unit_sell control.
// production-rates: edits a catalog item's production_rate and PATCHes it.
// branch-profile:   read-only note (no lat/lng write path exists server-side).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import {
  render as rtlRender,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import { makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { BranchSection } from '@/views/settings/branch/BranchSection'
import { CrewRateForm } from '@/views/settings/branch/CrewRateForm'
import { MaterialFactorsForm } from '@/views/settings/branch/MaterialFactorsForm'
import { ProductionRatesForm } from '@/views/settings/branch/ProductionRatesForm'
import { BranchProfileSection } from '@/views/settings/branch/BranchProfileSection'

const BRANCH_ID = 42

// Enriched branch GET payload — the single source for crew rate, material
// factors, and production rates (commits 32c58fe / 2750a9d).
const ENRICHED_BRANCH = {
  aspireBranchId: BRANCH_ID,
  crewRateCentsPerHour: 6500,
  materialFactors: [
    {
      materialKey: 'mulch',
      factors: { sfPerTonAtDepthIn: { '2': 160, '3': 108 }, defaultDepthIn: 2 },
      source: 'override',
    },
    {
      materialKey: 'sod',
      factors: { rollSf: 10 },
      source: 'inherited',
    },
  ],
  productionRates: [
    {
      catalogItemId: 'ci-mow',
      description: 'Weekly Mow',
      productionRate: 12000,
      source: 'inherited',
    },
  ],
}

function mockEnrichedBranch(data = ENRICHED_BRANCH) {
  server.use(
    http.get(`*/api/settings/branch/${BRANCH_ID}`, () =>
      HttpResponse.json(data),
    ),
  )
}

function mockCrewRate(crewRateCentsPerHour: number | null) {
  server.use(
    http.get(`*/api/settings/branch/${BRANCH_ID}`, () =>
      HttpResponse.json({ aspireBranchId: BRANCH_ID, crewRateCentsPerHour }),
    ),
  )
}

function renderComp(ui: React.ReactElement, role = 'manager') {
  useAuthStore.setState({ user: makeUser({ role: role as never }) })
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
  return rtlRender(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ role: 'manager' }) })
})

// ── Crew rate ────────────────────────────────────────────────────────────────

describe('CrewRateForm', () => {
  it('renders the crew rate in dollars from cents-per-hour', async () => {
    mockCrewRate(6500) // $65.00/hr
    renderComp(<CrewRateForm aspireBranchId={BRANCH_ID} />)
    const input = (await screen.findByLabelText(
      /crew rate/i,
    )) as HTMLInputElement
    expect(input.value).toBe('65')
  })

  it('renders an explicit "not configured" state when the rate is null', async () => {
    mockCrewRate(null)
    renderComp(<CrewRateForm aspireBranchId={BRANCH_ID} />)
    expect(
      await screen.findByTestId('crew-rate-unconfigured'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('crew-rate-unconfigured')).toHaveTextContent(
      /not configured/i,
    )
    // Even unconfigured, the admin/BM can set it — an input must be present.
    expect(screen.getByLabelText(/crew rate/i)).toBeInTheDocument()
  })

  it('PATCHes the rate in CENTS on save and shows success', async () => {
    mockCrewRate(6500)
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch(`*/api/settings/branch/${BRANCH_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          aspireBranchId: BRANCH_ID,
          crewRateCentsPerHour: 7000,
        })
      }),
    )
    renderComp(<CrewRateForm aspireBranchId={BRANCH_ID} />)
    const input = (await screen.findByLabelText(
      /crew rate/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ crew_rate_cents_per_hour: 7000 })
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('surfaces a 403 (out-of-scope branch) as an error state', async () => {
    mockCrewRate(6500)
    server.use(
      http.patch(`*/api/settings/branch/${BRANCH_ID}`, () =>
        HttpResponse.json({ detail: 'forbidden' }, { status: 403 }),
      ),
    )
    renderComp(<CrewRateForm aspireBranchId={BRANCH_ID} />)
    const input = (await screen.findByLabelText(
      /crew rate/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not/i)
  })

  it('shows an error state when the branch read itself 403s', async () => {
    server.use(
      http.get(`*/api/settings/branch/${BRANCH_ID}`, () =>
        HttpResponse.json({ detail: 'forbidden' }, { status: 403 }),
      ),
    )
    renderComp(<CrewRateForm aspireBranchId={BRANCH_ID} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
  })
})

// ── Material factors ──────────────────────────────────────────────────────────

describe('MaterialFactorsForm', () => {
  it('renders factor fields and NO unit_cost/unit_sell control', async () => {
    // MaterialFactorsForm reads from the enriched branch GET (commits
    // 32c58fe / 2750a9d) — no separate material-calcs endpoint call.
    mockEnrichedBranch()
    renderComp(<MaterialFactorsForm aspireBranchId={BRANCH_ID} />)
    // A scalar factor field is editable (sod rollSf = 10).
    const rollSf = (await screen.findByLabelText(
      /sod.*rollSf|rollSf.*sod/i,
    )) as HTMLInputElement
    expect(rollSf.value).toBe('10')
    // Cost/sell must never be exposed on this form.
    expect(screen.queryByLabelText(/unit cost/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/unit sell/i)).not.toBeInTheDocument()
  })

  it('PATCHes only the changed factor, keyed on materialKey', async () => {
    mockEnrichedBranch()
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch(`*/api/settings/branch/${BRANCH_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          aspireBranchId: BRANCH_ID,
          crewRateCentsPerHour: null,
        })
      }),
    )
    renderComp(<MaterialFactorsForm aspireBranchId={BRANCH_ID} />)
    const rollSf = (await screen.findByLabelText(
      /sod.*rollSf|rollSf.*sod/i,
    )) as HTMLInputElement
    fireEvent.change(rollSf, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ material_factors: { sod: { rollSf: 12 } } })
  })
})

// ── Production rates ──────────────────────────────────────────────────────────

describe('ProductionRatesForm', () => {
  it('renders a production-rate field per maintenance kit', async () => {
    // ProductionRatesForm now reads from the enriched branch GET (commits
    // 32c58fe / 2750a9d) — no separate catalog-items endpoint call.
    mockEnrichedBranch()
    renderComp(<ProductionRatesForm aspireBranchId={BRANCH_ID} />)
    const rate = (await screen.findByLabelText(
      /weekly mow/i,
    )) as HTMLInputElement
    expect(rate.value).toBe('12000')
  })

  it('PATCHes the changed production_rate keyed on catalog item id', async () => {
    mockEnrichedBranch()
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch(`*/api/settings/branch/${BRANCH_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          aspireBranchId: BRANCH_ID,
          crewRateCentsPerHour: null,
        })
      }),
    )
    renderComp(<ProductionRatesForm aspireBranchId={BRANCH_ID} />)
    const rate = (await screen.findByLabelText(
      /weekly mow/i,
    )) as HTMLInputElement
    fireEvent.change(rate, { target: { value: '13000' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ production_rates: { 'ci-mow': 13000 } })
  })
})

// ── Source badges: inherited vs override ─────────────────────────────────────

// These tests use the enriched branch GET which now returns materialFactors and
// productionRates directly (each row carries a `source` field). The forms must
// show the appropriate badge per row without hardcoding the source value.
// ENRICHED_BRANCH and mockEnrichedBranch are defined near the top of the file
// and shared across all describe blocks that need the enriched payload.

describe('MaterialFactorsForm — source badges', () => {
  it('shows an "override" badge for a material factor with source=override', async () => {
    mockEnrichedBranch()
    renderComp(<MaterialFactorsForm aspireBranchId={BRANCH_ID} />)
    // Mulch has source: 'override' — find its badge.
    const badge = await screen.findByTestId('source-badge-mulch')
    expect(badge).toHaveTextContent(/branch override/i)
  })

  it('shows an "inherited" badge for a material factor with source=inherited', async () => {
    mockEnrichedBranch()
    renderComp(<MaterialFactorsForm aspireBranchId={BRANCH_ID} />)
    const badge = await screen.findByTestId('source-badge-sod')
    expect(badge).toHaveTextContent(/inherited/i)
  })

  it('still PATCHes correctly when editing an inherited factor (creates override)', async () => {
    mockEnrichedBranch()
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch(`*/api/settings/branch/${BRANCH_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ aspireBranchId: BRANCH_ID, crewRateCentsPerHour: null })
      }),
    )
    renderComp(<MaterialFactorsForm aspireBranchId={BRANCH_ID} />)
    const rollSf = (await screen.findByLabelText(/sod.*rollSf|rollSf.*sod/i)) as HTMLInputElement
    fireEvent.change(rollSf, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ material_factors: { sod: { rollSf: 12 } } })
  })
})

describe('ProductionRatesForm — source badges', () => {
  it('shows an "inherited" badge for a production rate with source=inherited', async () => {
    mockEnrichedBranch()
    renderComp(<ProductionRatesForm aspireBranchId={BRANCH_ID} />)
    const badge = await screen.findByTestId('source-badge-ci-mow')
    expect(badge).toHaveTextContent(/inherited/i)
  })

  it('still PATCHes correctly from the enriched branch response', async () => {
    mockEnrichedBranch()
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch(`*/api/settings/branch/${BRANCH_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ aspireBranchId: BRANCH_ID, crewRateCentsPerHour: null })
      }),
    )
    renderComp(<ProductionRatesForm aspireBranchId={BRANCH_ID} />)
    const rate = (await screen.findByLabelText(/weekly mow/i)) as HTMLInputElement
    fireEvent.change(rate, { target: { value: '13000' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ production_rates: { 'ci-mow': 13000 } })
  })
})

// ── Slice 15b: BranchSection dispatches branch-credentials to CredentialsSection

describe('BranchSection branch-credentials slug', () => {
  it('renders the CredentialsSection for branch-credentials (not blank)', async () => {
    // branch-credentials now renders CredentialsSection (Slice 15b).
    // Stub the three queries CredentialsSection fires so it does not hang.
    server.use(
      http.get('*/api/settings/licenses', () => HttpResponse.json([])),
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )
    renderComp(
      <BranchSection
        slug="branch-credentials"
        aspireBranchId={42}
        sectionLabel="Credentials (branch)"
      />,
    )
    // The CredentialsSection uses the 'credentials' slug for its testid.
    expect(
      await screen.findByTestId('settings-section-credentials'),
    ).toBeInTheDocument()
  })

  it('renders a "select a branch" prompt when no aspireBranchId is available', () => {
    renderComp(
      <BranchSection
        slug="branch-credentials"
        aspireBranchId={undefined}
        sectionLabel="Credentials (branch)"
      />,
    )
    expect(
      screen.getByTestId('settings-section-branch-credentials'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('settings-section-branch-credentials').textContent,
    ).toMatch(/select a branch/i)
  })
})

// ── Branch profile (read-only) ────────────────────────────────────────────────

describe('BranchProfileSection', () => {
  it('renders read-only with a no-write-path note (no lat/lng backend)', async () => {
    renderComp(<BranchProfileSection aspireBranchId={BRANCH_ID} />)
    expect(
      await screen.findByTestId('settings-section-branch-profile'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('settings-section-branch-profile'),
    ).toHaveTextContent(/read-only|not.*editable|no.*write/i)
    // No editable inputs / save button on a read-only section.
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
  })
})
