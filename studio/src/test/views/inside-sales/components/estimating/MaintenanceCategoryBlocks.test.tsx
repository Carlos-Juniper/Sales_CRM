// ---------------------------------------------------------------------------
// Handoff 54 §3 — maintenance editor category blocks.
//
// Fixture math (Main Property, 120,000 SF; MOW_KIT 60,000 SF/h):
//   Mowing Service  kit hours 2 h/occ × 40 × 1.00 = 80 h
//                   120 × 450 × 40 × 1.00 = 2,160,000¢ ($21,600.00), P/P $540.00
//   Pruning         3 h × 6 × 1.10 = 19.8 h
//                   120 × 300 × 6 × 1.10 = 237,600¢ ($2,376.00)
//   Fert. Shrub Q1  0 occurrences → Fertilizer starts collapsed
//   Seasonal Color  no catalog service and no kit → "Other services"
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import type { MaintenanceEstimate, SectionService } from '@/types/estimating'
import { buildMaintenanceEstimate, toCreatePayload } from '@/mocks/estimatingData'
import { estimatingApi } from '@/api/estimating'
import { LineItemEditor } from '@/views/inside-sales/components/estimating/LineItemEditor'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'
import {
  MAINTENANCE_CATALOG,
  MOW_KIT,
  MULCH_KIT,
  STANDARD_CATEGORY_NAMES,
} from '@/test/fixtures/maintenanceCatalog'

function line(sectionId: string, over: Partial<SectionService> & Pick<SectionService, 'label'>): SectionService {
  return {
    id: `svc-${over.label}`,
    sectionId,
    serviceKitId: null,
    serviceId: null,
    qty: 0,
    uom: '/yr',
    complexityPct: 0,
    unitSellCents: null,
    embeddedCostCents: null,
    targetGm: null,
    hours: null,
    sortOrder: 0,
    components: [],
    ...over,
  }
}

function buildEstimate(opts: { kitHours?: boolean } = {}): MaintenanceEstimate {
  const base = buildMaintenanceEstimate({ crewRateCentsPerHour: 18_000 })
  const sectionId = base.sections[0].id
  const services = [
    line(sectionId, {
      label: 'Mowing Service',
      serviceId: 'svc-m-mowing',
      serviceKitId: MOW_KIT.id,
      qty: 40,
      unitSellCents: 450,
      hours: opts.kitHours === false ? 2 : null,
    }),
    line(sectionId, { label: 'Pruning', serviceId: 'svc-m-pruning', qty: 6, complexityPct: 0.1, unitSellCents: 300, hours: 3, sortOrder: 1 }),
    line(sectionId, { label: 'Fertilizer Shrub – Q1', serviceId: 'svc-m-fert-shrub-q1', unitSellCents: 100, hours: 1, sortOrder: 2 }),
    line(sectionId, { label: 'Seasonal Color', qty: 3, unitSellCents: 1000, hours: 2, sortOrder: 3 }),
  ]
  const section = { ...base.sections[0], name: 'Main Property', squareFeet: 120_000, services }
  return { ...base, sections: [section] }
}

function renderEditor(estimate: MaintenanceEstimate) {
  return render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{ activeTab: 'editor', setActiveTab: vi.fn(), openEstimate: estimate, setOpenEstimate: vi.fn(), openEstimateAt: vi.fn() }}
      >
        <LineItemEditor />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>,
  )
}

const card = () => screen.getByTestId('section-card')
const block = (name: string) => within(card()).getByTestId(`category-block-${name}`)
const header = (name: string) => within(card()).getByTestId(`category-header-${name}`)
const toggle = (name: string) => within(header(name)).getByRole('button')
const headerHours = (name: string) => within(header(name)).getByTestId('category-total-hours')
const headerPrice = (name: string) => within(header(name)).getByTestId('category-total-price')
const row = (label: string) => within(card()).getByTestId(`service-row-${label}`)
const addSelect = () => within(card()).getByLabelText(/add optional service/i) as HTMLSelectElement

async function renderLoaded(estimate = buildEstimate()) {
  const utils = renderEditor(estimate)
  await screen.findByTestId('category-block-Turf')
  await waitFor(() => expect(headerHours('Turf')).toHaveTextContent('80'))
  return utils
}

beforeEach(() => {
  server.use(
    http.get('/api/estimating/service-kits', () => HttpResponse.json([MOW_KIT, MULCH_KIT])),
    http.get('/api/estimating/service-catalog', () => HttpResponse.json(MAINTENANCE_CATALOG)),
  )
})

describe('category blocks', () => {
  it('renders the 5 standard categories, then Optional Services, then Other services', async () => {
    await renderLoaded()
    const names = within(card())
      .getAllByTestId(/^category-block-/)
      .map((el) => el.getAttribute('data-testid')!.replace('category-block-', ''))
    expect(names).toEqual([...STANDARD_CATEGORY_NAMES, 'Optional Services', 'Other services'])
    expect(within(block('Other services')).getByTestId('service-row-Seasonal Color')).toBeInTheDocument()
  })

  it('renders every standard block even for an empty section', async () => {
    const est = buildEstimate()
    est.sections[0].services = []
    renderEditor(est)
    await screen.findByTestId('category-block-Turf')
    for (const name of [...STANDARD_CATEGORY_NAMES, 'Optional Services']) {
      expect(block(name)).toBeInTheDocument()
    }
    expect(within(card()).queryByTestId('category-block-Other services')).not.toBeInTheDocument()
  })

  it('starts categories with occurrences expanded and the rest collapsed', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    expect(toggle('Turf')).toHaveAttribute('aria-expanded', 'true')
    expect(toggle('Bed Maint')).toHaveAttribute('aria-expanded', 'true')
    for (const name of ['Irrigation', 'Fertilizer', 'Pest Control', 'Optional Services']) {
      expect(toggle(name)).toHaveAttribute('aria-expanded', 'false')
    }
    expect(within(card()).queryByTestId('service-row-Fertilizer Shrub – Q1')).not.toBeInTheDocument()

    await user.click(toggle('Fertilizer'))
    expect(toggle('Fertilizer')).toHaveAttribute('aria-expanded', 'true')
    expect(row('Fertilizer Shrub – Q1')).toBeInTheDocument()

    await user.click(toggle('Turf'))
    expect(within(card()).queryByTestId('service-row-Mowing Service')).not.toBeInTheDocument()
  })

  it('expands Optional Services when a saved optional line has occurrences', async () => {
    const est = buildEstimate()
    const sectionId = est.sections[0].id
    est.sections[0].services.push(
      line(sectionId, { label: 'Mulch', serviceId: 'svc-m-mulch', qty: 2, unitSellCents: 500, hours: 1, sortOrder: 4 }),
    )
    await renderLoaded(est)
    expect(toggle('Optional Services')).toHaveAttribute('aria-expanded', 'true')
    expect(within(block('Optional Services')).getByTestId('service-row-Mulch')).toBeInTheDocument()
  })

  it('does not collapse a block when its occurrences are edited to 0', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.clear(within(row('Pruning')).getByLabelText(/occurrences/i))
    expect(toggle('Bed Maint')).toHaveAttribute('aria-expanded', 'true')
    expect(row('Pruning')).toBeInTheDocument()
  })
})

describe('hours and price columns', () => {
  it('shows P/H, TH, P/P and TP per line, with hours from the kit', async () => {
    await renderLoaded()
    const mow = row('Mowing Service')
    expect(within(mow).getByTestId('line-per-hours')).toHaveTextContent('2')
    expect(within(mow).getByTestId('line-total-hours')).toHaveTextContent('80')
    expect(within(mow).getByTestId('line-per-price')).toHaveTextContent('$540.00')
    expect(within(mow).getByText('$21,600.00')).toBeInTheDocument()
  })

  it('sums hours and price in the category header', async () => {
    await renderLoaded()
    expect(headerHours('Bed Maint')).toHaveTextContent('19.8')
    expect(headerPrice('Bed Maint')).toHaveTextContent('$2,376.00')
    expect(headerPrice('Turf')).toHaveTextContent('$21,600.00')
    expect(headerHours('Irrigation')).toHaveTextContent('0')
    expect(headerPrice('Irrigation')).toHaveTextContent('$0.00')
  })

  it('updates the header live as occurrences and complexity change', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const qty = within(row('Pruning')).getByLabelText(/occurrences/i)
    await user.clear(qty)
    await user.type(qty, '12')
    // 3 × 12 × 1.10 = 39.6 h · 120 × 300 × 12 × 1.10 = 475,200¢
    expect(headerHours('Bed Maint')).toHaveTextContent('39.6')
    expect(headerPrice('Bed Maint')).toHaveTextContent('$4,752.00')

    await user.selectOptions(within(row('Pruning')).getByLabelText(/complexity/i), '0.2')
    // 3 × 12 × 1.20 = 43.2 h · 120 × 300 × 12 × 1.20 = 518,400¢
    expect(headerHours('Bed Maint')).toHaveTextContent('43.2')
    expect(headerPrice('Bed Maint')).toHaveTextContent('$5,184.00')
  })

  it('renders unresolvable hours as —, never 0, and the save guard still blocks', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    // Annuals links no kit: no production rate and no hours.
    await user.selectOptions(addSelect(), 'svc-m-annuals')
    expect(within(row('Annuals')).getByTestId('line-total-hours')).toHaveTextContent('—')
    expect(within(row('Annuals')).getByTestId('line-per-hours')).toHaveTextContent('—')
    expect(headerHours('Optional Services')).toHaveTextContent('—')

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    const err = await screen.findByTestId('save-error')
    expect(err).toHaveTextContent(/production rate/i)
    expect(err).toHaveTextContent('Annuals')
  })
})

describe('optional services instant-add', () => {
  it('lists only optional-category services', async () => {
    await renderLoaded()
    const options = within(addSelect()).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['+ Add optional service…', 'Mulch', 'Annuals'])
  })

  it('adds the picked service in one gesture, resets the select and hides it', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    expect(within(card()).queryByRole('button', { name: /^add/i })).not.toBeInTheDocument()

    await user.selectOptions(addSelect(), 'svc-m-mulch')

    expect(addSelect().value).toBe('')
    expect(within(addSelect()).queryByRole('option', { name: 'Mulch' })).not.toBeInTheDocument()
    expect(toggle('Optional Services')).toHaveAttribute('aria-expanded', 'true')
    const mulch = within(block('Optional Services')).getByTestId('service-row-Mulch')
    // default 2 occurrences, company complexity 10%, catalog sell 500¢/1,000 SF:
    // 120 × 500 × 2 × 1.10 = 132,000¢
    expect(within(mulch).getByLabelText(/occurrences/i)).toHaveValue(2)
    expect(within(mulch).getByText('$1,320.00')).toBeInTheDocument()
    expect(headerPrice('Optional Services')).toHaveTextContent('$1,320.00')
    expect(screen.getByRole('status')).toHaveTextContent('Mulch added')
  })

  it('adds one service at a time, never the whole optional category', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.selectOptions(addSelect(), 'svc-m-mulch')
    expect(within(block('Optional Services')).getAllByTestId(/^service-row-/)).toHaveLength(1)
  })

  it('shows an unavailable state when the catalog cannot load', async () => {
    server.use(http.get('/api/estimating/service-catalog', () => HttpResponse.json({}, { status: 500 })))
    renderEditor(buildEstimate())
    await waitFor(() => expect(addSelect()).toHaveTextContent('Service catalog unavailable'))
    expect(addSelect()).toBeDisabled()
  })
})

describe('per-line delete', () => {
  it('removes the row from the draft without a confirm dialog', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(row('Pruning')).getByRole('button', { name: 'Remove Pruning' }))
    expect(within(card()).queryByTestId('service-row-Pruning')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(headerPrice('Bed Maint')).toHaveTextContent('$0.00')
  })

  it('Save issues exactly one deleteService and the line is gone after reload', async () => {
    const user = userEvent.setup()
    const created = (await estimatingApi.create(
      toCreatePayload(buildEstimate({ kitHours: false })),
    )) as MaintenanceEstimate
    const deleteSpy = vi.spyOn(estimatingApi, 'deleteService')
    renderEditor(created)
    await screen.findByTestId('category-block-Turf')

    await user.click(within(row('Pruning')).getByRole('button', { name: 'Remove Pruning' }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/estimate saved/i)).toBeInTheDocument()

    expect(deleteSpy).toHaveBeenCalledTimes(1)
    const fetched = await estimatingApi.get(created.id)
    const labels = fetched.sections[0].services.map((s) => s.label)
    expect(labels).not.toContain('Pruning')
    expect(labels).toContain('Mowing Service')
    deleteSpy.mockRestore()
  })
})
