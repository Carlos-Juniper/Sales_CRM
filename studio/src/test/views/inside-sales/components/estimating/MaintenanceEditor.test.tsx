// ---------------------------------------------------------------------------
// Maintenance engine (hours-driven, section-based).
// Fixture math (buildMaintenanceEstimate, all cents, via maintServiceLine):
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
import type { CatalogItem, Estimate, MaintenanceEstimate } from '@/types/estimating'
import { buildInstallEstimate, buildMaintenanceEstimate, mockEstimatesV2, toCreatePayload } from '@/mocks/estimatingData'
import { estimatingApi } from '@/api/estimating'
import { LineItemEditor } from '@/views/inside-sales/components/estimating/LineItemEditor'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'

function renderMaint(estimate: Estimate = buildMaintenanceEstimate()) {
  const setOpenEstimate = vi.fn()
  const utils = render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{ activeTab: 'editor', setActiveTab: vi.fn(), openEstimate: estimate, setOpenEstimate, openEstimateAt: vi.fn() }}
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

beforeEach(() => {
  // Each render() call gets its own fresh QueryClient (test/utils.tsx), so
  // there's no cross-test config cache to reset.
  // These specs exercise the OFFLINE-FALLBACK catalog (the
  // maintenance.ts literal). The API-driven catalog + save-guard specs at the
  // bottom override this handler per test.
  server.use(http.get('/api/estimating/catalog-items', () => HttpResponse.json([])))
})

/** A production-rated maintenance kit, as GET /catalog-items returns it. */
const RATED_KIT: CatalogItem = {
  id: 'kit-maint-3422',
  description: 'Standard Production Mowing',
  uom: 'Sq. Ft.',
  unitCostCents: 1750,
  unitSellCents: 0,
  targetGm: 0.22,
  kitType: 'maintenance_hours',
  productionRate: 67650,
  branch: 'All Branches',
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

  it('shows section totals, unit reads, and the contract roll-up from calc.ts', () => {
    renderMaint()
    const s1 = sectionCard('Common Area')
    expect(within(s1).getByText('$38,023.20')).toBeInTheDocument()
    // unit read: 3,802,320¢ / 120 = $316.86 / 1,000 SF
    expect(within(s1).getByText(/\$316\.86 \/ 1,000 SF/)).toBeInTheDocument()
    const s2 = sectionCard('Entry & Medians')
    expect(within(s2).getByText('$12,750.75')).toBeInTheDocument()
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$50,773.95')
  })

  it('roll-up cards: section count, total square footage, approval routing tier', () => {
    renderMaint()
    expect(screen.getByTestId('rollup-sections')).toHaveTextContent('2')
    expect(screen.getByTestId('rollup-sqft')).toHaveTextContent('165,000')
    // $50,773.95 < $100K ⇒ Manager tier (config-driven tier table)
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

describe('MaintenanceEditor — live recompute (hours-driven)', () => {
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

  it('editing occurrences recomputes line, section, and contract totals live', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    const mowRow = within(s1).getByTestId('service-row-Mowing')
    expect(within(mowRow).getByText('$24,948.00')).toBeInTheDocument()

    const qty = within(mowRow).getByLabelText(/occurrences/i)
    await user.clear(qty)
    await user.type(qty, '21')
    // 120 × 450 × 21 × 1.1 = 1,247,400
    expect(within(mowRow).getByText('$12,474.00')).toBeInTheDocument()
    // section: 3,802,320 − 1,247,400 = 2,554,920
    expect(within(s1).getByText('$25,549.20')).toBeInTheDocument()
    // contract: 2,554,920 + 1,275,075 = 3,829,995
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$38,299.95')
  })

  it('blank input coerces to 0', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    const mowRow = within(s1).getByTestId('service-row-Mowing')
    await user.clear(within(mowRow).getByLabelText(/occurrences/i))
    expect(within(mowRow).getByText('$0.00')).toBeInTheDocument()
    // contract drops to Entry & Medians + remaining Common Area lines
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$25,825.95')
  })
})

describe('MaintenanceEditor — complexity (I-9.7)', () => {
  it('flags rows whose complexity deviates from the company default (10%)', () => {
    renderMaint()
    const s1 = sectionCard('Common Area')
    // Mowing is at the 10% default — not flagged
    expect(
      within(within(s1).getByTestId('service-row-Mowing')).queryByTestId('complexity-override-flag'),
    ).not.toBeInTheDocument()
    // Detail (5%) and Irrigation (0%) deviate — flagged
    expect(
      within(within(s1).getByTestId('service-row-Detail / Bed Maintenance')).getByTestId('complexity-override-flag'),
    ).toBeInTheDocument()
  })

  it('changing complexity recomputes the line total AND its $/SF read, and flags the override', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    const irrRow = within(s1).getByTestId('service-row-Irrigation Inspection')
    // 259,200¢ / 120,000 SF = $0.0216/SF
    expect(within(irrRow).getByText('$0.0216 /SF')).toBeInTheDocument()
    expect(within(irrRow).queryByTestId('complexity-override-flag')).toBeInTheDocument() // 0% ≠ 10% default

    const cx = within(irrRow).getByLabelText(/complexity/i)
    await user.selectOptions(cx, '0.2')
    // 259,200 × 1.2 = 311,040 → $3,110.40 · $0.0259/SF
    expect(within(irrRow).getByText('$3,110.40')).toBeInTheDocument()
    expect(within(irrRow).getByText('$0.0259 /SF')).toBeInTheDocument()
    expect(within(irrRow).getByTestId('complexity-override-flag')).toBeInTheDocument()
  })

  it('setting complexity back to the company default clears the flag', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    const irrRow = within(s1).getByTestId('service-row-Irrigation Inspection')
    await user.selectOptions(within(irrRow).getByLabelText(/complexity/i), '0.1')
    expect(within(irrRow).queryByTestId('complexity-override-flag')).not.toBeInTheDocument()
  })
})

describe('MaintenanceEditor — granularity + add line item (I-9.7)', () => {
  it('mowing rows expose a kit granularity dropdown with mower sizes', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    const mowRow = within(s1).getByTestId('service-row-Mowing')
    const size = within(mowRow).getByLabelText(/mower size/i)
    expect(within(size).getByRole('option', { name: '36"' })).toBeInTheDocument()
    expect(within(size).getByRole('option', { name: '72"' })).toBeInTheDocument()
    await user.selectOptions(size, '72"')
    expect((size as HTMLSelectElement).value).toBe('72"')
  })

  it('"Add line item" adds a catalog service not in the original spec', async () => {
    const user = userEvent.setup()
    renderMaint()
    const s1 = sectionCard('Common Area')
    expect(within(s1).queryByTestId('service-row-Fertilizer & pest')).not.toBeInTheDocument()

    await user.selectOptions(within(s1).getByLabelText(/add line item/i), 'fert')
    await user.click(within(s1).getByRole('button', { name: /add line item/i }))

    const fertRow = within(s1).getByTestId('service-row-Fertilizer & pest')
    expect(fertRow).toBeInTheDocument()
    // seeded at catalog defaults: 120 × 135 × 6 × 1.1 = 106,920 → $1,069.20
    expect(within(fertRow).getByText('$1,069.20')).toBeInTheDocument()
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
    await user.click(within(s2).getByRole('button', { name: /remove/i }))

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
    await user.click(within(s2).getByRole('button', { name: /remove/i }))
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
    // server-seeded so the persistence round-trip is real (MSW store)
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

    // the shell estimate was updated from the server response
    expect(setOpenEstimate).toHaveBeenCalled()
    const updated = setOpenEstimate.mock.calls.at(-1)![0] as MaintenanceEstimate
    expect(updated.lifecycle).toBe('won')
    expect(updated.aspireOwner).toBe('crm')

    // the flip SURVIVES A RELOAD — the server row changed…
    const fetched = await estimatingApi.get(created.id)
    expect(fetched.lifecycle).toBe('won')
    expect(fetched.aspireOwner).toBe('crm')
    // …and the WON edge landed in estimate_status_transitions
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
    const mowRow = within(s1).getByTestId('service-row-Mowing')
    await user.clear(within(mowRow).getByLabelText(/occurrences/i))
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$25,825.95')

    await user.click(screen.getByRole('button', { name: /reset/i }))
    expect(screen.getByTestId('contract-total')).toHaveTextContent('$50,773.95')
    expect(screen.getByText(/margin 22%/i)).toBeInTheDocument()
  })

  it('Save persists via the API and toasts success', async () => {
    const user = userEvent.setup()
    // must be a server-seeded estimate for the MSW PATCH route to find it
    const seeded = mockEstimatesV2[0]
    renderMaint(seeded)
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('Save persists an added section (tree diff) and reloads server state', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate()),
    )) as MaintenanceEstimate
    renderMaint(created)

    await user.click(screen.getByRole('button', { name: /add section/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    // reload from the server: the section (and its seeded services) persisted
    const fetched = await estimatingApi.get(created.id)
    expect(fetched.sections).toHaveLength(created.sections.length + 1)
    const added = fetched.sections.at(-1)!
    expect(added.name).toBe('New region')
    expect(added.services.length).toBeGreaterThan(0)
    // the editor now shows the server-reloaded tree
    expect(screen.getByDisplayValue('New region')).toBeInTheDocument()
  })

  it('Save persists qty edits and section removal — gone/changed after reload', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildMaintenanceEstimate()),
    )) as MaintenanceEstimate
    renderMaint(created)

    // estimator edits occurrences on an existing line item
    const s1 = sectionCard('Common Area')
    const mowRow = within(s1).getByTestId('service-row-Mowing')
    const qty = within(mowRow).getByLabelText(/occurrences/i)
    await user.clear(qty)
    await user.type(qty, '21')

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
    expect(mow.qty).toBe(21)
    // server-reloaded contract value reflects the persisted tree
    expect(fetched.contractValueCents).toBeGreaterThan(0)
  })

  it('a failed save shows the save-error state with retry', async () => {
    const user = userEvent.setup()
    // a fresh estimate is unknown to the MSW store → PATCH 404s
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

// ---------------------------------------------------------------------------
// Kits come from GET /catalog-items; every maintenance line must
// resolve a production rate (or explicit hours) before Save.
// ---------------------------------------------------------------------------

describe('MaintenanceEditor — kit catalog + production-rate save guard', () => {
  it('feeds the add-line dropdown from GET /catalog-items, not the literal', async () => {
    server.use(
      http.get('/api/estimating/catalog-items', () => HttpResponse.json([RATED_KIT])),
    )
    renderMaint()
    const s1 = sectionCard('Common Area')
    const select = within(s1).getByLabelText(/add line item/i)
    await waitFor(() =>
      expect(
        within(select).getByRole('option', { name: 'Standard Production Mowing' }),
      ).toBeInTheDocument(),
    )
    // the literal-only demo rows are gone once the API catalog loads
    expect(
      within(select).queryByRole('option', { name: 'Fertilizer & pest' }),
    ).not.toBeInTheDocument()
  })

  it('falls back to the literal catalog when the API returns no kits (offline)', () => {
    renderMaint()
    const s1 = sectionCard('Common Area')
    const select = within(s1).getByLabelText(/add line item/i)
    expect(
      within(select).getByRole('option', { name: 'Fertilizer & pest' }),
    ).toBeInTheDocument()
  })

  it('blocks Save with a clear message when a line resolves no production rate', async () => {
    const user = userEvent.setup()
    const est = buildMaintenanceEstimate()
    // strip the resolution paths from one line: no hours, no kit
    est.sections[0].services[0] = {
      ...est.sections[0].services[0],
      hours: null,
      catalogItemId: null,
    }
    renderMaint(est)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const err = await screen.findByTestId('save-error')
    expect(err).toHaveTextContent(/production rate/i)
    expect(err).toHaveTextContent('Mowing')
    // the save never reached the API — no success toast
    expect(screen.queryByText(/estimate saved/i)).not.toBeInTheDocument()
  })

  it('a line pointing at an UNRATED kit is blocked once the catalog is loaded', async () => {
    const unrated: CatalogItem = {
      ...RATED_KIT,
      id: 'kit-maint-3435',
      description: 'Prune Easy',
      productionRate: null,
    }
    server.use(
      http.get('/api/estimating/catalog-items', () =>
        HttpResponse.json([RATED_KIT, unrated]),
      ),
    )
    const user = userEvent.setup()
    const est = buildMaintenanceEstimate()
    est.sections[0].services[0] = {
      ...est.sections[0].services[0],
      hours: null,
      catalogItemId: unrated.id,
    }
    renderMaint(est)
    // wait for the catalog fetch so the client guard can resolve the kit
    const s1 = sectionCard('Common Area')
    await waitFor(() =>
      expect(
        within(s1).getByRole('option', { name: 'Standard Production Mowing' }),
      ).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    const err = await screen.findByTestId('save-error')
    expect(err).toHaveTextContent(/production rate/i)
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
