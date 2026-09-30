// ---------------------------------------------------------------------------
// Install engine (quantity-driven kits). Rendered automatically
// when `estimateType === 'install'`; NO mode toggle exists anywhere.
//
// Fixture display math (buildInstallEstimate — see install.test.ts):
//   Mahogany row   TP $30,000.00 · GM 45.00% · sub $16,500.00
//   Irrigation row TP $3,500.00  · GM 44.80%
//   Phase 1 group  TP $33,500.00 · GM 44.98% · hrs 3.52
//   Sod row        TP $19,920.00 · GM 39.23% (component basis, not stale embedded)
//   Parent row     TP $53,420.00 · GM 42.83%
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ApiError } from '@/api/client'
import type { Estimate, InstallEstimate } from '@/types/estimating'
import { buildInstallEstimate, buildMaintenanceEstimate, toCreatePayload } from '@/mocks/estimatingData'
import { estimatingApi, estimatingConfigApi } from '@/api/estimating'
import { UNKNOWN_COST_SAVE_MESSAGE } from '@/lib/estimating/materialSearch'
import { LineItemEditor } from '@/views/inside-sales/components/estimating/LineItemEditor'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'

function renderInstall(estimate: Estimate = buildInstallEstimate()) {
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

function row(label: string): HTMLElement {
  return screen.getByTestId(`install-row-${label}`)
}

afterEach(() => vi.restoreAllMocks())

describe('InstallEditor — engine selection (no mode toggle, ever)', () => {
  it('renders ONLY for install estimates; never for maintenance', () => {
    renderInstall(buildMaintenanceEstimate())
    expect(screen.queryByTestId('install-editor')).not.toBeInTheDocument()
    expect(screen.getByTestId('maintenance-editor')).toBeInTheDocument()
  })

  it('renders the install engine for an install estimate, with no mode switch UI', () => {
    renderInstall()
    expect(screen.getByTestId('install-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('maintenance-editor')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^maintenance$/i })).not.toBeInTheDocument()
  })
})

describe('InstallEditor — nested Parent → Group → Row → Components table', () => {
  it('renders the full column header set', () => {
    renderInstall()
    const header = screen.getByTestId('install-columns')
    for (const col of ['Item', 'Qty', 'Comp', 'Hrs', 'U/P', 'TP', 'Tax', 'Sub cost', 'GM %']) {
      expect(within(header).getByText(col)).toBeInTheDocument()
    }
  })

  it('parent total row aggregates the whole estimate (TP + blended GM)', () => {
    renderInstall()
    const parent = screen.getByTestId('install-parent-row')
    expect(within(parent).getByText('Silverleaf — Phase 2 Installation')).toBeInTheDocument()
    expect(within(parent).getByText('$53,420.00')).toBeInTheDocument()
    expect(within(parent).getByText('42.83%')).toBeInTheDocument()
  })

  it('group rows show hrs, TP kit-price pill, and GM%', () => {
    const est = buildInstallEstimate()
    renderInstall(est)
    const g1 = screen.getByTestId(`install-group-${est.sections[0].id}`)
    expect(within(g1).getByText('Phase 1 — Streetscape')).toBeInTheDocument()
    expect(within(g1).getByText('$33,500.00')).toBeInTheDocument()
    expect(within(g1).getByText('44.98%')).toBeInTheDocument()
    expect(within(g1).getByText('3.52')).toBeInTheDocument()
  })

  it('rows show qty/uom, U/P, TP, sub cost, GM%', () => {
    renderInstall()
    const trees = row("Mahogany 10'-12' — Installed")
    expect(within(trees).getByLabelText(/qty for/i)).toHaveValue(24)
    expect(within(trees).getByText('ea')).toBeInTheDocument()
    expect(within(trees).getByText('$1,250.00')).toBeInTheDocument() // U/P
    expect(within(trees).getByText('$30,000.00')).toBeInTheDocument() // TP
    expect(within(trees).getByText('$16,500.00')).toBeInTheDocument() // sub cost
    expect(within(trees).getByText('45.00%')).toBeInTheDocument()
  })

  it('sub cost feeds from components when present, overriding stale embedded cost', () => {
    renderInstall()
    const sod = row('Bermuda Sod — Installed')
    expect(within(sod).getByText('$12,105.60')).toBeInTheDocument() // 48 × 25,220
    expect(within(sod).getByText('39.23%')).toBeInTheDocument()
  })

  it('component rows expand/collapse via the chevron (view-local state)', async () => {
    const user = userEvent.setup()
    renderInstall()
    expect(screen.queryByText("Mahogany 10'-12' (30g)")).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /toggle components for mahogany/i }))
    expect(screen.getByText("Mahogany 10'-12' (30g)")).toBeInTheDocument()
    expect(screen.getByText('Install crew')).toBeInTheDocument()
    expect(screen.getByText('Backfill + staking kit')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /toggle components for mahogany/i }))
    expect(screen.queryByText("Mahogany 10'-12' (30g)")).not.toBeInTheDocument()
  })
})

describe('InstallEditor — quantity-driven pricing, live', () => {
  it('TP = QTY × U/P; totals roll up live on qty edit', async () => {
    const user = userEvent.setup()
    renderInstall()
    const trees = row("Mahogany 10'-12' — Installed")
    const qty = within(trees).getByLabelText(/qty for/i)
    await user.clear(qty)
    await user.type(qty, '10')

    expect(within(trees).getByText('$12,500.00')).toBeInTheDocument()
    // GM is qty-invariant here: (1250−687.50)/1250 stays 45.00%
    expect(within(trees).getByText('45.00%')).toBeInTheDocument()
    // group: 12,500 + 3,500 = 16,000 · parent: 16,000 + 19,920 = 35,920
    expect(screen.getByText('$16,000.00')).toBeInTheDocument()
    expect(within(screen.getByTestId('install-parent-row')).getByText('$35,920.00')).toBeInTheDocument()
  })

  it('HOURS NEVER MOVE PRICE — editing hours leaves TP and GM% unchanged', async () => {
    const user = userEvent.setup()
    renderInstall()
    const trees = row("Mahogany 10'-12' — Installed")
    const hrs = within(trees).getByLabelText(/hours for/i)
    await user.clear(hrs)
    await user.type(hrs, '80')

    expect(within(trees).getByText('$30,000.00')).toBeInTheDocument()
    expect(within(trees).getByText('45.00%')).toBeInTheDocument()
    expect(within(screen.getByTestId('install-parent-row')).getByText('$53,420.00')).toBeInTheDocument()
    expect(within(screen.getByTestId('install-parent-row')).getByText('42.83%')).toBeInTheDocument()
  })

  it('component TP = qty × unit cost, live, and re-derives the line GM', async () => {
    const user = userEvent.setup()
    renderInstall()
    await user.click(screen.getByRole('button', { name: /toggle components for mahogany/i }))

    const cost = screen.getByLabelText(/unit cost for backfill \+ staking kit/i)
    await user.clear(cost)
    await user.type(cost, '200')

    // H55 §6: item rows show EXTENDED cost — line qty 24 × (1 × $200.00) —
    // and carry the line GM (items have no sell price of their own).
    const compRow = screen.getByTestId('install-component-Backfill + staking kit')
    expect(within(compRow).getByText('$4,800.00')).toBeInTheDocument()
    expect(within(compRow).getByText('35.44%')).toBeInTheDocument()
    // unit basis 425 + 182 + 200 = 807 → sub 24 × 807 = $19,368 → GM 35.44%
    const trees = row("Mahogany 10'-12' — Installed")
    expect(within(trees).getByText('$19,368.00')).toBeInTheDocument()
    expect(within(trees).getByText('35.44%')).toBeInTheDocument()
  })

  it('blank input coerces to 0', async () => {
    const user = userEvent.setup()
    renderInstall()
    const trees = row("Mahogany 10'-12' — Installed")
    await user.clear(within(trees).getByLabelText(/qty for/i))
    expect(within(trees).getByLabelText(/qty for/i)).toHaveValue(0)
    // TP and sub cost both go to $0.00
    expect(within(trees).getAllByText('$0.00')).toHaveLength(2)
  })
})

describe('InstallEditor — GM color from the single config-driven margin bands', () => {
  it('good margin (≥ goodMin) renders the good band class', () => {
    renderInstall()
    const gm = screen.getByTestId("install-gm-Mahogany 10'-12' — Installed")
    expect(gm.className).toContain('text-[#2E7D52]')
  })

  it('low margin (< okMin) renders the low band class', () => {
    const est = buildInstallEstimate()
    // 5% GM: sell $1.00, component basis $0.95 — below okMin (0.12)
    est.sections[0].services[0].unitSellCents = 100
    est.sections[0].services[0].components = [
      {
        id: 'c-low',
        sectionServiceId: est.sections[0].services[0].id,
        kind: 'material',
        label: 'Costly stock',
        qty: 1,
        unitCostCents: 95,
        hours: null,
        sortOrder: 0,
      },
    ]
    renderInstall(est)
    const gm = screen.getByTestId("install-gm-Mahogany 10'-12' — Installed")
    expect(gm).toHaveTextContent('5.00%')
    expect(gm.className).toContain('text-red-600')
  })
})

describe('InstallEditor — "+ Add labor / cost line" (II-9.7 split)', () => {
  it('adds an editable labor component with blue-cell styling', async () => {
    const user = userEvent.setup()
    renderInstall()
    await user.click(screen.getByRole('button', { name: /toggle components for mahogany/i }))

    const select = screen.getAllByLabelText(/add labor \/ cost line/i)[0]
    await user.selectOptions(select, 'labor')

    const added = screen.getByTestId('install-component-Install labor')
    expect(within(added).getByText('LABOR')).toBeInTheDocument()
    const qtyInput = within(added).getByLabelText(/component qty/i)
    expect(qtyInput.className).toContain('bg-[#eff6ff]')
    expect(qtyInput.className).toContain('border-[#bfdbfe]')
    expect(within(added).getByLabelText(/unit cost/i).className).toContain('bg-[#eff6ff]')
  })

  it('adds a material / cost line', async () => {
    const user = userEvent.setup()
    renderInstall()
    await user.click(screen.getByRole('button', { name: /toggle components for mahogany/i }))
    await user.selectOptions(screen.getAllByLabelText(/add labor \/ cost line/i)[0], 'material')
    const added = screen.getByTestId('install-component-New material line')
    expect(within(added).getByText('MATERIAL')).toBeInTheDocument()
  })
})

describe('InstallEditor — same-production-rate labor grouping (II-9.7)', () => {
  it('merges same-rate labor lines into one labor quantity, keeping materials separate', async () => {
    const user = userEvent.setup()
    const est = buildInstallEstimate()
    const trees = est.sections[0].services[0]
    trees.components.push({
      id: 'c-extra-labor',
      sectionServiceId: trees.id,
      kind: 'labor',
      label: 'Install crew — shrubs',
      qty: 2,
      unitCostCents: 5200, // same production rate as 'Install crew'
      hours: 2,
      sortOrder: 3,
    })
    renderInstall(est)
    await user.click(screen.getByRole('button', { name: /toggle components for mahogany/i }))
    await user.click(screen.getByRole('button', { name: /group same-rate labor/i }))

    expect(screen.getByTestId('install-component-Install crew')).toBeInTheDocument()
    expect(screen.queryByTestId('install-component-Install crew — shrubs')).not.toBeInTheDocument()
    // merged qty 3.5 + 2 = 5.5; materials untouched
    const merged = screen.getByTestId('install-component-Install crew')
    expect(within(merged).getByLabelText(/component qty/i)).toHaveValue(5.5)
    expect(screen.getByTestId("install-component-Mahogany 10'-12' (30g)")).toBeInTheDocument()
    expect(screen.getByTestId('install-component-Backfill + staking kit')).toBeInTheDocument()
  })
})

describe('InstallEditor — add kit line from catalog (II-6.5 / II-9.5)', () => {
  it('appends a catalog kit as a new row with its averaged cost basis', async () => {
    const user = userEvent.setup()
    renderInstall()
    const select = screen.getAllByLabelText(/add line item from catalog/i)[0]
    const firstKit = (within(select).getAllByRole('option')[1] as HTMLOptionElement).value
    await user.selectOptions(select, firstKit)
    expect(screen.getAllByTestId(/^install-row-/).length).toBe(4)
  })
})

describe('InstallEditor — install routes through the tier ladder (§4)', () => {
  it('no longer shows the "no approval matrix defined" note — install approvals are config-routed', () => {
    renderInstall()
    expect(screen.queryByTestId('install-approval-note')).not.toBeInTheDocument()
    expect(screen.queryByText(/no approval matrix/i)).not.toBeInTheDocument()
  })
})

describe('InstallEditor — empty / saving / save-error states', () => {
  it('renders the empty state for a legacy estimate with no sections — the editor never creates standard sections', async () => {
    const createSection = vi.spyOn(estimatingApi, 'createSection')
    renderInstall(buildInstallEstimate({ sections: [] }))
    const empty = screen.getByTestId('install-empty')
    expect(empty).toHaveTextContent('No standard sections yet.')
    expect(empty).toHaveTextContent(/the service catalog hasn’t been loaded/i)
    // a clear empty state, not a blank editor (no grid rendered)
    expect(screen.queryByTestId('install-columns')).not.toBeInTheDocument()
    // no free-text / category "Add section" picker and no area suffix any more
    expect(screen.queryByLabelText('Add section')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/section area suffix/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Add Optional Services')).toBeInTheDocument()
    expect(createSection).not.toHaveBeenCalled()
  })

  it('shows a save error with retry when the API fails, then saves on retry', async () => {
    const user = userEvent.setup()
    const fixture = buildInstallEstimate() as InstallEstimate
    const spy = vi
      .spyOn(estimatingApi, 'update')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(fixture)
    vi.spyOn(estimatingApi, 'get').mockResolvedValue(fixture)
    renderInstall()

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByTestId('save-error')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.queryByTestId('save-error')).not.toBeInTheDocument())
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('never sends estimateType in the save payload (immutable discriminant)', async () => {
    const user = userEvent.setup()
    const fixture = buildInstallEstimate() as InstallEstimate
    const spy = vi.spyOn(estimatingApi, 'update').mockResolvedValue(fixture)
    vi.spyOn(estimatingApi, 'get').mockResolvedValue(fixture)
    renderInstall()
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls[0][1]).not.toHaveProperty('estimateType')
  })
})

// ----- Handoff 55 §6: three-level roll-ups + collapse -----------------------

describe('InstallEditor — item → service → section roll-ups (H55 §6)', () => {
  it('item rows show extended cost, apportioned price and GM%', async () => {
    const user = userEvent.setup()
    renderInstall()
    await user.click(screen.getByRole('button', { name: /toggle components for mahogany/i }))
    // Mahogany 30g: 24 × 42,500 = $10,200 cost; share of $30,000 TP at the
    // line GM (45%) = 10,200 / 0.55 = $18,545.45
    const tree = "Mahogany 10'-12' (30g)"
    expect(screen.getByTestId(`install-component-cost-${tree}`)).toHaveTextContent('$10,200.00')
    expect(screen.getByTestId(`install-component-price-${tree}`)).toHaveTextContent('$18,545.45')
    expect(screen.getByTestId(`install-component-gm-${tree}`)).toHaveTextContent('45.00%')
  })

  it('section rows show cost, price and GM%', () => {
    const est = buildInstallEstimate()
    renderInstall(est)
    const sid = est.sections[0].id
    expect(screen.getByTestId(`install-group-cost-${sid}`)).toHaveTextContent('$18,432.00')
    expect(screen.getByTestId(`install-group-gm-${sid}`)).toHaveTextContent('44.98%')
    expect(screen.getByTestId('install-parent-cost')).toHaveTextContent('$30,537.60')
  })

  it('editing an ITEM quantity moves the service, section and estimate totals', async () => {
    const user = userEvent.setup()
    const est = buildInstallEstimate()
    renderInstall(est)
    await user.click(screen.getByRole('button', { name: /toggle components for mahogany/i }))
    const qty = screen.getByLabelText('Component qty for Install crew')
    await user.clear(qty)
    await user.type(qty, '4.5')
    // unit basis 42,500 + 4.5×5,200 + 8,050 = 73,950 → sub 24 × 73,950 = $17,748
    expect(screen.getByTestId("install-cost-Mahogany 10'-12' — Installed")).toHaveTextContent('$17,748.00')
    // section: 17,748 + 1,932 = $19,680 · estimate: + 12,105.60 = $31,785.60
    expect(screen.getByTestId(`install-group-cost-${est.sections[0].id}`)).toHaveTextContent('$19,680.00')
    expect(screen.getByTestId('install-parent-cost')).toHaveTextContent('$31,785.60')
    // GM (30,000 − 17,748) / 30,000 = 40.84%
    expect(screen.getByTestId("install-gm-Mahogany 10'-12' — Installed")).toHaveTextContent('40.84%')
  })

  it('renders "—", never 0, for an unresolvable cost / GM', async () => {
    const user = userEvent.setup()
    const est = buildInstallEstimate()
    // No components and no embedded cost → cost cannot be resolved.
    est.sections[1].services[0].components = []
    est.sections[1].services[0].embeddedCostCents = null
    renderInstall(est)
    expect(screen.getByTestId('install-cost-Bermuda Sod — Installed')).toHaveTextContent('—')
    expect(screen.getByTestId('install-gm-Bermuda Sod — Installed')).toHaveTextContent('—')
    expect(screen.getByTestId(`install-group-gm-${est.sections[1].id}`)).toHaveTextContent('—')
    expect(screen.getByTestId('install-parent-gm')).toHaveTextContent('—')
    // A zero-price line has no GM either.
    const trees = row("Mahogany 10'-12' — Installed")
    await user.clear(within(trees).getByLabelText(/qty for/i))
    expect(screen.getByTestId("install-gm-Mahogany 10'-12' — Installed")).toHaveTextContent('—')
  })

  it('section and parent rows collapse and expand (view-local)', async () => {
    const user = userEvent.setup()
    const est = buildInstallEstimate()
    renderInstall(est)
    const sectionToggle = screen.getByRole('button', { name: `Toggle section ${est.sections[0].name}` })
    expect(sectionToggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(sectionToggle)
    expect(screen.queryByTestId("install-row-Mahogany 10'-12' — Installed")).not.toBeInTheDocument()
    expect(screen.getByTestId('install-row-Bermuda Sod — Installed')).toBeInTheDocument()
    await user.click(sectionToggle)
    expect(screen.getByTestId("install-row-Mahogany 10'-12' — Installed")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle all groups' }))
    expect(screen.queryAllByTestId(/^install-group-sec/)).toHaveLength(0)
    // totals remain on the parent row while collapsed
    expect(within(screen.getByTestId('install-parent-row')).getByText('$53,420.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle all groups' }))
    expect(screen.getByTestId(`install-group-${est.sections[0].id}`)).toBeInTheDocument()
  })
})

// ----- Handoff 55 §3 (revised): Add Optional Services ----------------------------

const OPTIONAL_CATALOG = [
  {
    id: 'cat-install-optional',
    code: 'OPTIONAL',
    name: 'Optional Services',
    estimateType: 'install',
    sortOrder: 5,
    isOptional: true,
    aspireServiceGroupName: null,
    itemClassCodes: null,
    active: true,
    services: [
      {
        id: 'svc-opt-lighting',
        serviceCategoryId: 'cat-install-optional',
        name: 'IN: Optional Lighting',
        displayName: 'Optional Lighting',
        sortOrder: 0,
        defaultOccurrences: null,
        aspireServiceId: null,
        active: true,
        defaultItems: [],
      },
    ],
  },
]

async function readyOptionalPicker(): Promise<HTMLSelectElement> {
  const select = screen.getByLabelText('Add Optional Services') as HTMLSelectElement
  await waitFor(() => expect(select).not.toBeDisabled())
  return select
}

describe('InstallEditor — Add Optional Services (H55 §3, revised)', () => {
  it('shows an empty state while the Optional Services category has no services', async () => {
    renderInstall()
    const select = screen.getByLabelText('Add Optional Services') as HTMLSelectElement
    expect(await within(select).findByText('No optional services in the catalog yet')).toBeInTheDocument()
    expect(select).toBeDisabled()
  })

  it('lists only Optional Services services and adds one into ONE Optional Services section', async () => {
    server.use(http.get('*/estimating/service-catalog', () => HttpResponse.json(OPTIONAL_CATALOG)))
    const user = userEvent.setup()
    renderInstall()
    const select = await readyOptionalPicker()
    expect(Array.from(select.options).filter((o) => o.value).map((o) => o.textContent)).toEqual([
      'Optional Lighting',
    ])
    await user.selectOptions(select, 'svc-opt-lighting')
    expect(await screen.findByText('Optional Services')).toBeInTheDocument()
    expect(screen.getByTestId('install-row-Optional Lighting')).toBeInTheDocument()
    // a second pick lands in the same section — never a duplicate section
    await user.selectOptions(await readyOptionalPicker(), 'svc-opt-lighting')
    expect(screen.getAllByText('Optional Services')).toHaveLength(1)
    expect(screen.getAllByTestId('install-row-Optional Lighting')).toHaveLength(2)
  })

  it('saves the optional section with its category link, and surfaces a backend 422 as the save error', async () => {
    server.use(http.get('*/estimating/service-catalog', () => HttpResponse.json(OPTIONAL_CATALOG)))
    const user = userEvent.setup()
    const created = (await estimatingApi.create(toCreatePayload(buildInstallEstimate()))) as InstallEstimate
    const createSection = vi
      .spyOn(estimatingApi, 'createSection')
      .mockRejectedValueOnce(new ApiError(422, 'Only Optional Services sections can be added'))
    renderInstall(created)
    await user.selectOptions(await readyOptionalPicker(), 'svc-opt-lighting')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByTestId('save-error')).toHaveTextContent(
      'Only Optional Services sections can be added',
    )
    expect(createSection.mock.calls[0][1]).toMatchObject({
      name: 'Optional Services',
      serviceCategoryId: 'cat-install-optional',
      services: [expect.objectContaining({ serviceId: 'svc-opt-lighting', serviceKitId: null })],
    })
  })

  it('an existing section still renders and saves unchanged', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildInstallEstimate()),
    )) as InstallEstimate
    const updateSection = vi.spyOn(estimatingApi, 'updateSection')
    renderInstall(created)
    expect(screen.getByText(created.sections[0].name)).toBeInTheDocument()
    const svc = created.sections[0].services[0]
    const qtyInput = screen.getByLabelText(`Qty for ${svc.label}`)
    await user.clear(qtyInput)
    await user.type(qtyInput, '25')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()
    expect(updateSection).not.toHaveBeenCalled()
    const fetched = await estimatingApi.get(created.id)
    expect(fetched.sections[0].name).toBe(created.sections[0].name)
    expect(fetched.sections[0].services[0].qty).toBe(25)
  })
})

// ----- Save persists the full tree, then reloads ----------------------------

describe('InstallEditor — Save persists line-item and component edits', () => {
  it('blue-cell component edits survive a reload after Save', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildInstallEstimate()),
    )) as InstallEstimate
    renderInstall(created)

    const svc = created.sections[0].services.find((sv) => sv.components.length > 0)!
    const comp = svc.components[0]
    await user.click(screen.getByRole('button', { name: `Toggle components for ${svc.label}` }))
    const qtyInput = screen.getByLabelText(`Component qty for ${comp.label}`)
    await user.clear(qtyInput)
    await user.type(qtyInput, '99')

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    const fetched = await estimatingApi.get(created.id)
    const freshComp = fetched.sections[0].services
      .find((sv) => sv.id === svc.id)!
      .components.find((c) => c.id === comp.id)!
    expect(freshComp.qty).toBe(99)
  })

  it('service qty edits + an added kit cost line survive a reload after Save', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildInstallEstimate()),
    )) as InstallEstimate
    renderInstall(created)

    const svc = created.sections[0].services[0]
    const qtyInput = screen.getByLabelText(`Qty for ${svc.label}`)
    await user.clear(qtyInput)
    await user.type(qtyInput, '30')

    // add a labor component line to the same service
    await user.click(screen.getByRole('button', { name: `Toggle components for ${svc.label}` }))
    await user.selectOptions(
      screen.getByLabelText(`Add labor / cost line for ${svc.label}`),
      'labor',
    )

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    const fetched = await estimatingApi.get(created.id)
    const freshSvc = fetched.sections[0].services.find((sv) => sv.id === svc.id)!
    expect(freshSvc.qty).toBe(30)
    expect(freshSvc.components.length).toBe(svc.components.length + 1)
  })
})

// ----- RFI status surfaced in the editor (§3.2) ------------------------------

describe('InstallEditor — RFI status surfaced (§3.2)', () => {
  it('shows the tracked RFI status in the header when present', () => {
    renderInstall(
      buildInstallEstimate({ rfiStatus: 'Awaiting GC response on storm drain details' }),
    )
    expect(screen.getByTestId('install-rfi-status')).toHaveTextContent(
      /awaiting gc response/i,
    )
  })

  it('renders no RFI chip when rfiStatus is empty', () => {
    renderInstall(buildInstallEstimate())
    expect(screen.queryByTestId('install-rfi-status')).not.toBeInTheDocument()
  })
})

describe('InstallEditor — rush badge', () => {
  it('shows Rush on the estimate detail only when isRush is true', () => {
    renderInstall(buildInstallEstimate({ name: 'Rush Install', isRush: true }))
    expect(screen.getByTestId('install-editor')).toBeInTheDocument()
    expect(screen.getByTestId('rush-badge')).toHaveTextContent('Rush')
  })

  it('hides Rush when isRush is false, including a past-due estimate', () => {
    renderInstall(
      buildInstallEstimate({
        name: 'Plain Install',
        dueBackDate: '2020-01-01',
        isRush: false,
      }),
    )
    expect(screen.queryByTestId('rush-badge')).not.toBeInTheDocument()
  })
})

// ----- Handoff 55 §4: add a service, get its default items -----------------------

describe('InstallEditor — Add service (H55 §4)', () => {
  function irrigationEstimate(): InstallEstimate {
    const est = buildInstallEstimate()
    est.sections[0].serviceCategoryId = 'cat-install-irrigation'
    return est
  }

  async function addIrrigationInstall(sectionId: string, sectionName: string) {
    const user = userEvent.setup()
    const select = screen.getByLabelText(`Add service to ${sectionName}`) as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, 'svc-cat-irrigation-install')
    return { user, group: screen.getByTestId(`install-group-${sectionId}`) }
  }

  it('one pick inserts the service with its default items; an unpriced item shows "—"', async () => {
    const est = irrigationEstimate()
    renderInstall(est)
    await addIrrigationInstall(est.sections[0].id, est.sections[0].name)
    const line = await screen.findByTestId('install-row-Irrigation Install')
    // unknown item cost → the line cost is "—", never $0.00
    expect(within(line).getByTestId('install-cost-Irrigation Install')).toHaveTextContent('—')
    await userEvent.setup().click(within(line).getByRole('button', { name: /toggle components/i }))
    expect(screen.getByTestId('install-component-cost-Irrigation install labor')).toHaveTextContent('$360.00')
    expect(screen.getByTestId('install-component-cost-1" CL200 PVC Pipe')).toHaveTextContent('—')
    expect((screen.getByLabelText('Unit cost for 1" CL200 PVC Pipe') as HTMLInputElement).value).toBe('')
  })

  it('Save issues one createService with the snapshotted items, and deleting the line removes it', async () => {
    const created = (await estimatingApi.create(toCreatePayload(irrigationEstimate()))) as InstallEstimate
    const createService = vi.spyOn(estimatingApi, 'createService')
    const createComponent = vi.spyOn(estimatingApi, 'createComponent')
    const deleteService = vi.spyOn(estimatingApi, 'deleteService')
    renderInstall(created)
    const { user } = await addIrrigationInstall(created.sections[0].id, created.sections[0].name)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    expect(createService).toHaveBeenCalledTimes(1)
    expect(createComponent).not.toHaveBeenCalled()
    const body = createService.mock.calls[0][2]
    expect(body).toMatchObject({ serviceId: 'svc-cat-irrigation-install', serviceKitId: null })
    expect(body.components?.map((c) => c.unitCostCents)).toEqual([4500, null])

    let fetched = await estimatingApi.get(created.id)
    const saved = fetched.sections[0].services.find((s) => s.serviceId === 'svc-cat-irrigation-install')!
    expect(saved.components).toHaveLength(2)

    await user.click(await screen.findByRole('button', { name: 'Delete line Irrigation Install' }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(deleteService).toHaveBeenCalledTimes(1))
    await waitFor(async () => {
      fetched = await estimatingApi.get(created.id)
      expect(fetched.sections[0].services.some((s) => s.id === saved.id)).toBe(false)
    })
  })
})

// ----- Handoff 55 §5: add materials within a service -------------------------

describe('InstallEditor — Add item: material search (H55 §5)', () => {
  async function pickMaterial(lineLabel: string, term: string, option: RegExp) {
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: `Toggle components for ${lineLabel}` })
    if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle)
    await user.type(screen.getByRole('combobox', { name: `Add item to ${lineLabel}` }), term)
    await user.click(await screen.findByRole('option', { name: option }))
    return user
  }

  it('a pick adds a material item with label, uom and snapshotted cost', async () => {
    renderInstall()
    await pickMaterial("Mahogany 10'-12' — Installed", 'spray', /Spray Head/)
    const item = screen.getByTestId('install-component-4" Pop-up Spray Head')
    expect(within(item).getByText('MATERIAL')).toBeInTheDocument()
    expect(within(item).getByText('EA')).toBeInTheDocument()
    expect((within(item).getByLabelText(/unit cost/i) as HTMLInputElement).value).toBe('3.89')
  })

  it('a material with no current price shows "—" (unknown), never $0.00', async () => {
    renderInstall()
    await pickMaterial("Mahogany 10'-12' — Installed", 'valve', /Irrigation Valve/)
    expect(screen.getByTestId('install-component-cost-1" Irrigation Valve')).toHaveTextContent('—')
    expect((screen.getByLabelText('Unit cost for 1" Irrigation Valve') as HTMLInputElement).value).toBe('')
  })

  it("prefilters by the line's catalog-service category codes", async () => {
    const spy = vi.spyOn(estimatingConfigApi, 'searchMaterials')
    const est = buildInstallEstimate() as InstallEstimate
    est.sections[0].serviceCategoryId = 'cat-install-landscape'
    est.sections[0].services[0].serviceId = 'svc-cat-irrigation-install'
    renderInstall(est)
    await waitFor(() => expect(screen.getByLabelText(`Add service to ${est.sections[0].name}`)).not.toBeDisabled())
    await pickMaterial(est.sections[0].services[0].label, 'pvc', /1" CL200 PVC Pipe/)
    expect(spy.mock.calls[0][0].itemClassCodes).toEqual([601, 602, 605, 606])
  })

  it('Save sends inventoryId + uom for the pick and a null inventoryId for a plain labor row', async () => {
    const created = (await estimatingApi.create(toCreatePayload(buildInstallEstimate()))) as InstallEstimate
    const createComponent = vi.spyOn(estimatingApi, 'createComponent')
    renderInstall(created)
    const svc = created.sections[0].services[0]
    const user = await pickMaterial(svc.label, 'spray', /Spray Head/)
    await user.selectOptions(screen.getByLabelText(`Add labor / cost line for ${svc.label}`), 'labor')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    const bodies = createComponent.mock.calls.map((c) => c[3])
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'material', inventoryId: 'IRR-SPR-4IN', uom: 'EA', unitCostCents: 389 }),
        expect.objectContaining({ kind: 'labor', inventoryId: null }),
      ]),
    )
  })

  it('a 422 for a material with no current price shows the unknown-cost message', async () => {
    vi.spyOn(estimatingApi, 'createComponent').mockRejectedValueOnce(
      new ApiError(422, 'Material IRR-VLV-1IN has no current price'),
    )
    const created = (await estimatingApi.create(toCreatePayload(buildInstallEstimate()))) as InstallEstimate
    renderInstall(created)
    const user = await pickMaterial(created.sections[0].services[0].label, 'valve', /Irrigation Valve/)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByTestId('save-error')).toHaveTextContent(UNKNOWN_COST_SAVE_MESSAGE)
  })
})
