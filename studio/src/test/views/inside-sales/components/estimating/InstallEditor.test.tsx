// ---------------------------------------------------------------------------
// Handoff 04 — Install engine (quantity-driven kits). Rendered automatically
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
import type { Estimate, InstallEstimate } from '@/types/estimating'
import { buildInstallEstimate, buildMaintenanceEstimate, toCreatePayload } from '@/mocks/estimatingData'
import { estimatingApi } from '@/api/estimating'
import { LineItemEditor } from '@/views/inside-sales/components/estimating/LineItemEditor'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'

function renderInstall(estimate: Estimate = buildInstallEstimate()) {
  const setOpenEstimate = vi.fn()
  const utils = render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{ activeTab: 'editor', setActiveTab: vi.fn(), openEstimate: estimate, setOpenEstimate }}
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

    // component TP: 1 × $200.00 (TP + component sub-cost cells)
    const compRow = screen.getByTestId('install-component-Backfill + staking kit')
    expect(within(compRow).getAllByText('$200.00').length).toBeGreaterThanOrEqual(1)
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

describe('InstallEditor — install routes through the tier ladder (Handoff 19 §4)', () => {
  it('no longer shows the "no approval matrix defined" note — install approvals are config-routed', () => {
    renderInstall()
    expect(screen.queryByTestId('install-approval-note')).not.toBeInTheDocument()
    expect(screen.queryByText(/no approval matrix/i)).not.toBeInTheDocument()
  })
})

describe('InstallEditor — empty / saving / save-error states', () => {
  it('renders "No groups yet" when the estimate has no sections', () => {
    renderInstall(buildInstallEstimate({ sections: [] }))
    expect(screen.getByTestId('install-empty')).toHaveTextContent(/no groups yet/i)
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

// ----- Save persists the full tree, then reloads (Handoff 17) ----------------

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

// ----- RFI status surfaced in the editor (Handoff 24 §3.2) -------------------

describe('InstallEditor — RFI status surfaced (Handoff 24 §3.2)', () => {
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
