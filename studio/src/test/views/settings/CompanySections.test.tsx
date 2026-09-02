// ---------------------------------------------------------------------------
// Slice 10a — Company config forms.
//
// Each write form renders current values from the (MSW-mocked) API, submits a
// change, and fires the correct PATCH with the correct payload, surfacing a
// success and an error state. Tiers/bands assert URL + body. A light admin-gate
// test confirms a non-admin never reaches the Company sections (the shell gates
// the group; these forms live behind it).
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
import { CompanySection } from '@/views/settings/company/CompanySection'
import { ApprovalTiersForm } from '@/views/settings/company/ApprovalTiersForm'
import { MarginBandsForm } from '@/views/settings/company/MarginBandsForm'
import { SlaForm } from '@/views/settings/company/SlaForm'
import { DiscrepancyThresholdForm } from '@/views/settings/company/DiscrepancyThresholdForm'
import { IntakeDefaultsForm } from '@/views/settings/company/IntakeDefaultsForm'

const COMPANY = {
  id: 1,
  sla_return_window_days: 14,
  sla_at_risk_threshold_days: 4,
  discrepancy_threshold_pct: 0.1,
  default_target_margin: 0.22,
  default_win_probability: 0.2,
  default_priority: 'medium',
  default_notify_bm_rd_on_return: 1,
}

const TIERS = [
  {
    id: 'tier-bm',
    roleKey: 'manager',
    label: 'Branch Manager',
    minValueCents: 0,
    maxValueCents: 5_000_000,
    order: 1,
    estimateType: 'maintenance',
  },
  {
    id: 'tier-rd',
    roleKey: 'regional_director',
    label: 'Regional Director',
    minValueCents: 5_000_000,
    maxValueCents: null,
    order: 2,
    estimateType: 'maintenance',
  },
]

const BANDS = [{ id: 'mb-default', name: 'default', goodMin: 0.2, okMin: 0.12 }]

function mockCompany(row = COMPANY) {
  server.use(
    http.get('*/api/settings/company', () => HttpResponse.json(row)),
  )
}
function mockTiers(rows = TIERS) {
  server.use(
    http.get('*/api/estimating/config/approval-tiers', () =>
      HttpResponse.json(rows),
    ),
  )
}
function mockBands(rows = BANDS) {
  server.use(
    http.get('*/api/estimating/config/margin-bands', () =>
      HttpResponse.json(rows),
    ),
  )
}

function renderComp(ui: React.ReactElement, role = 'admin') {
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
  useAuthStore.setState({ user: makeUser({ role: 'admin' }) })
  mockCompany()
  mockTiers()
  mockBands()
})

// ── SLA ────────────────────────────────────────────────────────────────────

describe('SlaForm', () => {
  it('renders current SLA values from the API', async () => {
    renderComp(<SlaForm />)
    const win = (await screen.findByLabelText(
      /return window/i,
    )) as HTMLInputElement
    expect(win.value).toBe('14')
    const atRisk = screen.getByLabelText(/at-risk/i) as HTMLInputElement
    expect(atRisk.value).toBe('4')
  })

  it('PATCHes /company with the changed SLA fields and shows success', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/settings/company', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...COMPANY, ...body })
      }),
    )
    renderComp(<SlaForm />)
    const win = (await screen.findByLabelText(
      /return window/i,
    )) as HTMLInputElement
    fireEvent.change(win, { target: { value: '21' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ sla_return_window_days: 21 })
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('shows an error state when the PATCH fails', async () => {
    server.use(
      http.patch('*/api/settings/company', () =>
        HttpResponse.json({ detail: 'nope' }, { status: 403 }),
      ),
    )
    renderComp(<SlaForm />)
    const win = (await screen.findByLabelText(
      /return window/i,
    )) as HTMLInputElement
    fireEvent.change(win, { target: { value: '21' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not/i)
  })
})

// ── Discrepancy threshold ────────────────────────────────────────────────────

describe('DiscrepancyThresholdForm', () => {
  it('renders the threshold as a percent (0.10 → 10)', async () => {
    renderComp(<DiscrepancyThresholdForm />)
    const input = (await screen.findByLabelText(
      /discrepancy threshold/i,
    )) as HTMLInputElement
    expect(input.value).toBe('10')
  })

  it('PATCHes the fraction back (12% → 0.12)', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/settings/company', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...COMPANY, ...body })
      }),
    )
    renderComp(<DiscrepancyThresholdForm />)
    const input = (await screen.findByLabelText(
      /discrepancy threshold/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ discrepancy_threshold_pct: 0.12 })
  })
})

// ── Intake defaults ──────────────────────────────────────────────────────────

describe('IntakeDefaultsForm', () => {
  it('renders margin/win-prob as percents and priority/notify controls', async () => {
    renderComp(<IntakeDefaultsForm />)
    const margin = (await screen.findByLabelText(
      /target margin/i,
    )) as HTMLInputElement
    expect(margin.value).toBe('22')
    expect((screen.getByLabelText(/win probability/i) as HTMLInputElement).value).toBe(
      '20',
    )
    expect((screen.getByLabelText(/priority/i) as HTMLSelectElement).value).toBe(
      'medium',
    )
    expect(
      (screen.getByLabelText(/notify bm/i) as HTMLInputElement).checked,
    ).toBe(true)
  })

  it('PATCHes changed intake defaults (fractions + bool)', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/settings/company', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...COMPANY, ...body })
      }),
    )
    renderComp(<IntakeDefaultsForm />)
    const margin = (await screen.findByLabelText(
      /target margin/i,
    )) as HTMLInputElement
    fireEvent.change(margin, { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText(/notify bm/i))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({
      default_target_margin: 0.3,
      default_notify_bm_rd_on_return: false,
    })
  })
})

// ── Approval tiers ───────────────────────────────────────────────────────────

describe('ApprovalTiersForm', () => {
  it('renders tier ceilings in dollars', async () => {
    renderComp(<ApprovalTiersForm />)
    expect(await screen.findByText('Branch Manager')).toBeInTheDocument()
    const ceiling = screen.getByLabelText(
      /branch manager ceiling/i,
    ) as HTMLInputElement
    // 5_000_000 cents → 50000 dollars.
    expect(ceiling.value).toBe('50000')
  })

  it('PATCHes /company/approval-tiers/{id} with cents in the body', async () => {
    let url = ''
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch(
        '*/api/settings/company/approval-tiers/:id',
        async ({ request }) => {
          url = request.url
          body = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({ id: 'tier-bm' })
        },
      ),
    )
    renderComp(<ApprovalTiersForm />)
    const ceiling = (await screen.findByLabelText(
      /branch manager ceiling/i,
    )) as HTMLInputElement
    fireEvent.change(ceiling, { target: { value: '75000' } })
    fireEvent.click(
      screen.getByRole('button', { name: /save branch manager/i }),
    )
    await waitFor(() => expect(body).not.toBeNull())
    expect(url).toContain('/settings/company/approval-tiers/tier-bm')
    // 75000 dollars → 7_500_000 cents.
    expect(body).toEqual({ max_value_cents: 7_500_000 })
  })
})

// ── Margin bands ─────────────────────────────────────────────────────────────

describe('MarginBandsForm', () => {
  it('renders good/ok thresholds as percents', async () => {
    renderComp(<MarginBandsForm />)
    const good = (await screen.findByLabelText(/good/i)) as HTMLInputElement
    expect(good.value).toBe('20')
    expect((screen.getByLabelText(/ok/i) as HTMLInputElement).value).toBe('12')
  })

  it('PATCHes /company/margin-bands/{id} with fractions', async () => {
    let url = ''
    let body: Record<string, unknown> | null = null
    server.use(
      http.patch(
        '*/api/settings/company/margin-bands/:id',
        async ({ request }) => {
          url = request.url
          body = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({ id: 'mb-default' })
        },
      ),
    )
    renderComp(<MarginBandsForm />)
    const good = (await screen.findByLabelText(/good/i)) as HTMLInputElement
    fireEvent.change(good, { target: { value: '34' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(url).toContain('/settings/company/margin-bands/mb-default')
    expect(body).toEqual({ good_min: 0.34 })
  })
})

// ── Admin gate ───────────────────────────────────────────────────────────────

describe('CompanySection admin gate', () => {
  it('renders the real form for an admin', async () => {
    renderComp(<CompanySection slug="sla" label="SLA" />, 'admin')
    expect(
      await screen.findByTestId('settings-section-sla'),
    ).toBeInTheDocument()
    expect(await screen.findByLabelText(/return window/i)).toBeInTheDocument()
  })

  it('refuses to render company config for a non-admin', () => {
    renderComp(<CompanySection slug="sla" label="SLA" />, 'manager')
    expect(screen.getByTestId('settings-section-sla')).toHaveTextContent(
      /admin/i,
    )
    expect(screen.queryByLabelText(/return window/i)).not.toBeInTheDocument()
  })
})
