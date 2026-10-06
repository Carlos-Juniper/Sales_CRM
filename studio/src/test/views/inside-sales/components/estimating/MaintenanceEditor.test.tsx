// ---------------------------------------------------------------------------
// Maintenance engine (section-based), rollup contract (Handoff 59 §B4).
//
// The editor now renders each service as a collapsed ServiceRollupRow inside
// its category block. The method rows expose a per-method sqft input and a GM%
// input — NOT the old flat OCC/COMP/P/H/TH columns. These specs assert the
// rollup contract for create / edit / delete / totals; structural, lifecycle,
// section-CRUD, rush and crew-rate-notice specs are unchanged (they never read
// the per-line columns).
//
// Fixture math (buildMaintenanceEstimate, all cents):
//   Common Area (120,000 SF):
//     Mowing        120 × 450 × 42 × 1.10 = 2,494,800
//     Detail/Bed    120 × 320 × 26 × 1.05 = 1,048,320
//     Irrigation    120 × 180 × 12 × 1.00 =   259,200
//     section total                        = 3,802,320  ($38,023.20)
//   Entry & Medians (45,000 SF):
//     Mowing        45 × 450 × 42 × 1.15  =   978,075
//     Seasonal      45 × 2200 × 3 × 1.00  =   297,000
//     section total                        = 1,275,075  ($12,750.75)
//   Contract total                         = 5,077,395  ($50,773.95) → BM tier
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import type { ServiceKit, Estimate, MaintenanceEstimate } from '@/types/estimating'
import { buildInstallEstimate, buildMaintenanceEstimate, mockEstimatesV2, toCreatePayload } from '@/mocks/estimatingData'
import { estimatingApi } from '@/api/estimating'
import { LineItemEditor } from '@/views/inside-sales/components/estimating/LineItemEditor'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'

function renderMaint(estimate: Estimate = buildMaintenanceEstimate()) {
  // Existing specs price an estimate that already has line sells. Give them a
  // resolved crew rate (frozen snapshot) so the editor does not block on the
  // missing-rate gate. Pass crewRateCentsPerHour: null to exercise that gate.
  const priced =
    estimate.crewRateCentsPerHour === undefined
      ? { ...estimate, crewRateCentsPerHour: 18_000 }
      : estimate
  const setOpenEstimate = vi.fn()
  const utils = render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{ activeTab: 'editor', setActiveTab: vi.fn(), openEstimate: priced, setOpenEstimate, openEstimateAt: vi.fn() }}
      >
        <LineItemEditor />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>,
  )
  return { ...utils, setOpenEstimate, estimate }
}

function sectionCard(name: string): HTMLElement {
  const heading = screen.getByDisplayValue(name)
  const card = heading.closest('[data-testid="section-card"]')
  expect(card).not.toBeNull()
  return card as HTMLElement
}

/**
 * Locate a service rollup line by its visible label inside a section card.
 * Lines in the default fixture carry no serviceId, so each is its own singleton
 * rollup group keyed by its row id — we find it by header text, not testid.
 */
function rollupHeaderByLabel(card: HTMLElement, label: string): HTMLElement {
  const headers = within(card).getAllByTestId(/^service-rollup-header-/)
  const match = headers.find((h) => within(h).queryByText(label))
  if (!match) throw new Error(`No service rollup line labeled “${label}”`)
  return match
}

/** The outer service-rollup-{id} wrapper is the header's parent. */
function rollupByLabel(card: HTMLElement, label: string): HTMLElement {
  return rollupHeaderByLabel(card, label).parentElement as HTMLElement
}

/** Expand a rollup line and return its single method row. */
async function expandMethod(
  user: ReturnType<typeof userEvent.setup>,
  card: HTMLElement,
  label: string,
): Promise<HTMLElement> {
  const head = rollupHeaderByLabel(card, label)
  if (head.getAttribute('data-expanded') !== 'true') {
    await user.click(within(head).getByRole('button'))
  }
  const line = head.parentElement as HTMLElement
  return within(line).getByTestId(/^method-row-/)
}

beforeEach(() => {
  server.use(http.get('/api/estimating/service-kits', () => HttpResponse.json([])))
})

/** A production-rated maintenance kit, as GET /service-kits returns it. */
const RATED_KIT: ServiceKit = {
  id: 'kit-maint-3422',
  description: 'Standard Production Mowing',
  uom: 'Sq. Ft.',
  unitCostCents: 1750,
  unitSellCents: 0,
  targetGm: 0.22,
  kitType: 'maintenance_hours',
  productionRate: 67650,
  aspireBranchId: null,
  active: true,
  serviceType: 'Turf Area',
}

describe('MaintenanceEditor — structure', () => {
  it('renders a null budget as an em dash and a real zero as $0', () => {
    renderMaint(
      buildMaintenanceEstimate({ homesBudget: null, commonAreaBudget: 0 }),
    )
    const budgets = screen.getByTestId('contract-budgets')
    expect(budgets).toHaveTextContent(/Homes budget —/)
    expect(budgets).toHaveTextContent(/Common area budget \$0/)
    expect(budgets).not.toHaveTextContent(/Homes budget \$0/)
  })

  it('renders header with name, draft badge, and lifecycle control', () => {
    renderMaint()
    expect(screen.getByText('Dobson Ranch HOA — Grounds Maintenance')).toBeInTheDocument()
    expect(screen.getByText('Draft — foundation, not final')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bidding' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Won' })).toBeInTheDocument()
  })

  it('groups the estimate by section, one card per section', () => {
    renderMaint()
    expect(screen.getAllByTestId('section-card')).toHaveLength(2)
    expect(screen.getByDisplayValue('Common Area')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Entry & Medians')).toBeInTheDocument()
  })

  it('renders the shared hours-driven column header on each section', () => {
    renderMaint()
    const headerLabels = [
      'Service', 'Occurrences', 'Complexity', 'P/H', 'TH', 'Discipline', 'Billing', 'P/P', 'Line total', '',
    ]
    for (const name of ['Common Area', 'Entry & Medians']) {
      const header = within(sectionCard(name)).getByTestId('maintenance-line-columns')
      expect([...header.children].map((el) => el.textContent)).toEqual(headerLabels)
    }
  })

  it('renders each service as a collapsed rollup line, with its rolled-up $/yr', () => {
    renderMaint()
    const s1 = sectionCard('Common Area')
    const mowing = within(rollupByLabel(s1, 'Mowing')).getByTestId(/^service-rollup-header-/)
    expect(mowing).toHaveAttribute('data-expanded', 'false')
    // rolled-up $/yr = unitSellCents × qty = 450 × 42 = 18,900¢ = $189.00
    expect(mowing).toHaveTextContent('$189.00')
  })

  it('shows section totals, unit reads, and the contract roll-up from calc.ts', () => {
    renderMaint()
    const s1 = sectionCard('Common Area')
    expect(within(s1).getByTestId('section-total')).toHaveTextContent('$38,023.20')
    // unit read: 3,802,320¢ / 120 = $316.86 / 1,000 SF
    expect(within(s1).getByText(/\$316\.86 \/ 1,000 SF/)).toBeInTheDocument()
    const s2 = sectionCard('Entry & Medians')
    expect(within(s2).getByTestId('section-total')).toHaveTextContent('$12,750.75')
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$50,773.95')
  })

  it('roll-up cards: section count, total square footage, approval routing tier', () => {
    renderMaint()
    expect(screen.getByTestId('rollup-sections')).toHaveTextContent('2')
    expect(screen.getByTestId('rollup-sqft')).toHaveTextContent('165,000')
    expect(screen.getByTestId('rollup-approval')).toHaveTextContent('Manager')
  })

  it('shows the ancillary division-of-labor banner (BRD I-6.6)', () => {
    renderMaint()
    expect(screen.getByText(/ancillary/i)).toBeInTheDocument()
    expect(screen.getByText(/branch/i, { selector: '[data-testid="ancillary-banner"] *' })).toBeInTheDocument()
  })

  it('shows yearly occurrence counts, with Not set for null and 0 kept as 0', () => {
    renderMaint(
      buildMaintenanceEstimate({
        mowingOccurrences: 42,
        pruningOccurrences: 0,
        turfFertOccurrences: null,
        shrubFertOccurrences: null,
        ipmOccurrences: 8,
        irrigationOccurrences: null,
      }),
    )
    expect(screen.getByTestId('occurrence-count-mowingOccurrences')).toHaveTextContent('42')
    expect(screen.getByTestId('occurrence-count-pruningOccurrences')).toHaveTextContent('0')
    expect(screen.getByTestId('occurrence-count-turfFertOccurrences')).toHaveTextContent('Not set')
    expect(screen.getByTestId('occurrence-count-shrubFertOccurrences')).toHaveTextContent('Not set')
    expect(screen.getByTestId('occurrence-count-ipmOccurrences')).toHaveTextContent('8')
    expect(screen.getByTestId('occurrence-count-irrigationOccurrences')).toHaveTextContent('Not set')
  })

  it('shows legacy scope text from the intake endpoint when it is present', async () => {
    const estimate = buildMaintenanceEstimate({
      mowingOccurrences: 12,
      pruningOccurrences: null,
      turfFertOccurrences: null,
      shrubFertOccurrences: null,
      ipmOccurrences: null,
      irrigationOccurrences: null,
    })
    server.use(
      http.get('/api/estimating/estimates/:id/intake', () =>
        HttpResponse.json([
          {
            id: 'ins-legacy',
            estimateId: estimate.id,
            estimateType: 'maintenance',
            payload: { scopeOfWork: 'Weekly mow, monthly IPM' },
            submittedBy: 'mock-user',
            createdAt: new Date().toISOString(),
          },
        ]),
      ),
    )
    renderMaint(estimate)
    expect(await screen.findByTestId('legacy-scope-notes')).toHaveTextContent('Weekly mow, monthly IPM')
  })

  it('hides legacy scope notes when the intake has none', async () => {
    const estimate = buildMaintenanceEstimate()
    let sawIntake = false
    server.use(
      http.get('/api/estimating/estimates/:id/intake', () => {
        sawIntake = true
        return HttpResponse.json([
          {
            id: 'ins-empty',
            estimateId: estimate.id,
            estimateType: 'maintenance',
            payload: { scopeOfWork: '   ' },
            submittedBy: 'mock-user',
            createdAt: new Date().toISOString(),
          },
        ])
      }),
    )
    renderMaint(estimate)
    expect(screen.getByTestId('maintenance-occurrence-summary')).toBeInTheDocument()
    await waitFor(() => expect(sawIntake).toBe(true))
    expect(screen.queryByTestId('legacy-scope-notes')).not.toBeInTheDocument()
  })

  it('does not show occurrence counts on an install estimate', () => {
    renderMaint(buildInstallEstimate())
    expect(screen.getByTestId('install-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('maintenance-occurrence-summary')).not.toBeInTheDocument()
  })
})

describe('MaintenanceEditor — live recompute', () => {
  it('acreage pill is sqft/43560 to 1 decimal and updates live', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    expect(within(s1).getByText('≈ 2.8 ac')).toBeInTheDocument()

    const sqft = within(s1).getByLabelText(/region square footage/i)
    await user.clear(sqft)
    await user.type(sqft, '43560')
    expect(within(s1).getByText('≈ 1.0 ac')).toBeInTheDocument()
  })

  it('changing section sqft recomputes section and contract totals live', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    expect(within(s1).getByTestId('section-total')).toHaveTextContent('$38,023.20')

    // Halving the region sqft halves every hours-based line in it.
    const sqft = within(s1).getByLabelText(/region square footage/i)
    await user.clear(sqft)
    await user.type(sqft, '60000')
    // 3,802,320 / 2 = 1,901,160
    expect(within(s1).getByTestId('section-total')).toHaveTextContent('$19,011.60')
    // contract: 1,901,160 + 1,275,075 = 3,176,235
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$31,762.35')
  })
})

describe('MaintenanceEditor — rollup edit (sqft + GM)', () => {
  it('typing a per-method sqft override updates the controlled input', async () => {
    const user = userEvent.setup()
    renderMaint()
    const method = await expandMethod(user, sectionCard('Common Area'), 'Mowing')
    const sqft = within(method).getByTestId(/^sqft-input-/) as HTMLInputElement
    // not overridden → blank with the section sqft as placeholder
    expect(sqft.value).toBe('')
    expect(sqft.placeholder).toBe('120,000')

    await user.type(sqft, '60000')
    expect(sqft.value).toBe('60000')
  })

  it('typing a GM% updates the method row GM input', async () => {
    const user = userEvent.setup()
    renderMaint()
    const method = await expandMethod(user, sectionCard('Common Area'), 'Mowing')
    const gm = within(method).getByTestId(/^gm-input-/) as HTMLInputElement
    await user.clear(gm)
    await user.type(gm, '30')
    expect(gm.value).toBe('30')
  })
})

describe('MaintenanceEditor — lifecycle & ownership (BRD §8.1)', () => {
  it('starts in Bidding with the estimating-ownership banner', () => {
    renderMaint()
    expect(screen.getByRole('button', { name: 'Bidding' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ownership-banner')).toHaveTextContent(
      /addendums route to both CRM and Estimating/i,
    )
    expect(screen.getByTestId('ownership-banner')).toHaveTextContent(/Estimating owns Aspire/i)
  })

  it('clicking Won persists the flip server-side, swaps the banner, and records the edge in the status-transition audit', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate()),
    )) as MaintenanceEstimate
    const { setOpenEstimate } = renderMaint(created)
    await user.click(screen.getByRole('button', { name: 'Won' }))

    await waitFor(() =>
      expect(screen.getByTestId('ownership-banner')).toHaveTextContent(
        /Aspire ownership transferred to CRM/i,
      ),
    )
    expect(screen.getByRole('button', { name: 'Won' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ownership-banner')).toHaveTextContent(/quantities-assist/i)

    expect(setOpenEstimate).toHaveBeenCalled()
    const updated = setOpenEstimate.mock.calls.at(-1)![0] as MaintenanceEstimate
    expect(updated.lifecycle).toBe('won')
    expect(updated.aspireOwner).toBe('crm')

    const fetched = await estimatingApi.get(created.id)
    expect(fetched.lifecycle).toBe('won')
    expect(fetched.aspireOwner).toBe('crm')
    const audit = await estimatingApi.listStatusTransitions(created.id)
    expect(audit.some((t) => t.from === 'lifecycle:bidding' && t.to === 'lifecycle:won')).toBe(true)
  })

  it('clicking the already-active lifecycle is a no-op (no audit spam)', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate()),
    )) as MaintenanceEstimate
    renderMaint(created)
    await user.click(screen.getByRole('button', { name: 'Bidding' }))
    expect(await estimatingApi.listStatusTransitions(created.id)).toHaveLength(0)
  })
})

describe('MaintenanceEditor — Reset / Save', () => {
  it('Reset restores sections to saved state and margin to the 0.22 target', async () => {
    const user = userEvent.setup()
    renderMaint(buildMaintenanceEstimate({ targetMargin: 0.3 }))
    const s1 = sectionCard('Common Area')

    // dirty the draft via the region sqft, then Reset restores it
    const sqft = within(s1).getByLabelText(/region square footage/i)
    await user.clear(sqft)
    await user.type(sqft, '60000')
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$31,762.35')

    await user.click(screen.getByRole('button', { name: /reset/i }))
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$50,773.95')
    expect(screen.getByText(/margin 22%/i)).toBeInTheDocument()
  })

  it('Save persists via the API and toasts success', async () => {
    const user = userEvent.setup()
    const seeded = mockEstimatesV2[0]
    renderMaint(seeded)
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('Save persists an added section (tree diff) and reloads server state', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/estimating/service-kits', () => HttpResponse.json([RATED_KIT])),
    )
    const created = (await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate()),
    )) as MaintenanceEstimate
    renderMaint(created)
    await screen.findByDisplayValue('Common Area')

    await user.click(screen.getByRole('button', { name: /add section/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    const fetched = await estimatingApi.get(created.id)
    expect(fetched.sections).toHaveLength(created.sections.length + 1)
    const added = fetched.sections.at(-1)!
    expect(added.name).toBe('New region')
    expect(screen.getByDisplayValue('New region')).toBeInTheDocument()
  })

  it('Save persists a per-method sqft edit and a section removal — changed/gone after reload', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate()),
    )) as MaintenanceEstimate
    renderMaint(created)

    // estimator sets a per-method sqft override on an existing line
    const s1 = sectionCard('Common Area')
    const method = await expandMethod(user, s1, 'Mowing')
    const sqft = within(method).getByTestId(/^sqft-input-/)
    await user.type(sqft, '60000')

    // …and removes a whole section (confirm dialog)
    const s2 = sectionCard('Entry & Medians')
    await user.click(within(s2).getByRole('button', { name: /remove section entry & medians/i }))
    await user.click(screen.getByRole('button', { name: 'Remove section' }))

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    const fetched = await estimatingApi.get(created.id)
    expect(fetched.sections).toHaveLength(1)
    expect(fetched.sections[0].name).toBe('Common Area')
    const mow = fetched.sections[0].services.find((sv) => sv.label === 'Mowing')!
    expect(mow.squareFeet).toBe(60000)
  })

  it('Save persists a rollup line deletion — gone after reload', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate()),
    )) as MaintenanceEstimate
    const deleteSpy = vi.spyOn(estimatingApi, 'deleteService')
    renderMaint(created)
    await screen.findByDisplayValue('Common Area')

    const s1 = sectionCard('Common Area')
    const method = await expandMethod(user, s1, 'Detail / Bed Maintenance')
    await user.click(within(method).getByRole('button', { name: /remove method/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    expect(deleteSpy).toHaveBeenCalledTimes(1)
    const fetched = await estimatingApi.get(created.id)
    const labels = fetched.sections[0].services.map((s) => s.label)
    expect(labels).not.toContain('Detail / Bed Maintenance')
    expect(labels).toContain('Mowing')
    deleteSpy.mockRestore()
  })

  it('a failed save shows the save-error state with retry', async () => {
    const user = userEvent.setup()
    renderMaint(buildMaintenanceEstimate())
    await user.click(screen.getByRole('button', { name: /save/i }))
    const err = await screen.findByTestId('save-error')
    expect(err).toHaveTextContent(/couldn.t be saved|failed/i)
    expect(within(err).getByRole('button', { name: /retry/i })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled(),
    )
  })
})

describe('MaintenanceEditor — section CRUD', () => {
  it('Duplicate deep-clones the section, inserting "(copy)" after the source', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    await user.click(within(s1).getByRole('button', { name: /duplicate/i }))

    const cards = screen.getAllByTestId('section-card')
    expect(cards).toHaveLength(3)
    expect(within(cards[1]).getByDisplayValue('Common Area (copy)')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/duplicated/i)
    // contract total doubles s1: 5,077,395 + 3,802,320 = 8,879,715
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$88,797.15')
  })

  it('Add section appends a default region seeded from the catalog', async () => {
    const user = userEvent.setup()
    renderMaint()
    await user.click(screen.getByRole('button', { name: /add section/i }))
    expect(screen.getAllByTestId('section-card')).toHaveLength(3)
    expect(screen.getByDisplayValue('New region')).toBeInTheDocument()
  })

  it('Remove asks for confirmation before deleting; cancel keeps the section', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s2 = sectionCard('Entry & Medians')
    await user.click(within(s2).getByRole('button', { name: /^remove section/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/remove section/i)
    expect(dialog).toHaveTextContent('Entry & Medians')

    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    expect(screen.getAllByTestId('section-card')).toHaveLength(2)
  })

  it('confirming Remove deletes the section and recomputes the contract total', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s2 = sectionCard('Entry & Medians')
    await user.click(within(s2).getByRole('button', { name: /^remove section/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /remove section/i }))

    expect(screen.getAllByTestId('section-card')).toHaveLength(1)
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$38,023.20')
  })

  it('renders the empty state when the estimate has no sections', () => {
    renderMaint(buildMaintenanceEstimate({ sections: [] }))
    expect(screen.getByText(/no sections yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add section/i })).toBeInTheDocument()
  })

  it('renaming a section is inline', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    const name = within(s1).getByLabelText(/section name/i)
    await user.clear(name)
    await user.type(name, 'North Campus')
    expect(screen.getByDisplayValue('North Campus')).toBeInTheDocument()
  })
})

describe('MaintenanceEditor — rush badge', () => {
  it('shows Rush on the estimate detail only when isRush is true', () => {
    renderMaint(buildMaintenanceEstimate({ name: 'Rush Detail', isRush: true }))
    expect(screen.getByTestId('maintenance-editor')).toBeInTheDocument()
    expect(screen.getByTestId('rush-badge')).toHaveTextContent('Rush')
  })

  it('hides Rush when isRush is false, including a past-due estimate', () => {
    renderMaint(
      buildMaintenanceEstimate({
        name: 'Plain Detail',
        dueBackDate: '2020-01-01',
        isRush: false,
      }),
    )
    expect(screen.queryByTestId('rush-badge')).not.toBeInTheDocument()
  })
})

describe('MaintenanceEditor — crew rate notices', () => {
  it('uses a frozen snapshot and labels it as frozen at submission', () => {
    renderMaint(
      buildMaintenanceEstimate({
        crewRateCentsPerHour: 19_500,
        branchCity: 'Fort Myers, FL',
      }),
    )
    const rate = screen.getByTestId('crew-rate-provenance')
    expect(rate).toHaveTextContent('Priced at $195.00/hr loaded crew rate')
    expect(rate).toHaveTextContent('Fort Myers, FL')
    expect(rate).toHaveTextContent('(frozen at submission)')
    expect(rate).toHaveAttribute('data-source', 'snapshot')
  })

  it('prompts for Settings → Branch → Crew rate without blocking the whole save', async () => {
    server.use(
      http.get('/api/settings/branch/2224', () =>
        HttpResponse.json({ aspireBranchId: 2224, crewRateCentsPerHour: null }),
      ),
    )
    renderMaint(
      buildMaintenanceEstimate({
        crewRateCentsPerHour: null,
        aspireBranchId: 2224,
        branchCity: '*** PICK A BRANCH ***',
      }),
    )
    const notice = await screen.findByTestId('margin-no-crew-rate')
    expect(notice).toHaveTextContent('No crew rate configured for *** PICK A BRANCH ***')
    expect(screen.getByTestId('crew-rate-settings-link')).toHaveAttribute(
      'href',
      '/settings/branch/2224/crew-rate',
    )
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
    expect(screen.queryByTestId('crew-rate-provenance')).not.toBeInTheDocument()
  })

  it('shows the shared no-crew-rate notice without a settings link when the estimate has no branch', () => {
    renderMaint(
      buildMaintenanceEstimate({ crewRateCentsPerHour: null, aspireBranchId: null }),
    )
    expect(screen.getByTestId('margin-no-crew-rate')).toHaveTextContent(
      'No crew rate configured for Phoenix-Desert',
    )
    expect(screen.queryByTestId('crew-rate-settings-link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })
})

describe('MaintenanceEditor — production-rate save guard', () => {
  it('blocks Save with a clear message when a line resolves no production rate', async () => {
    const user = userEvent.setup()
    const est = buildMaintenanceEstimate()
    // strip the resolution paths from one line: no hours, no kit
    est.sections[0].services[0] = {
      ...est.sections[0].services[0],
      hours: null,
      serviceKitId: null,
    }
    renderMaint(est)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const err = await screen.findByTestId('save-error')
    expect(err).toHaveTextContent(/production rate/i)
    expect(err).toHaveTextContent('Mowing')
    // the save never reached the API — no success toast
    expect(screen.queryByText(/estimate saved/i)).not.toBeInTheDocument()
  })
})
