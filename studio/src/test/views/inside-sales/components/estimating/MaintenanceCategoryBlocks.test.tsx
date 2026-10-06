// ---------------------------------------------------------------------------
// Handoff 59 §B4 — maintenance editor category blocks, rollup contract.
//
// The category accordion (Turf, Bed Maint, …) is unchanged. What changed is
// the SECOND level: inside an expanded category, each service renders as a
// collapsed ServiceRollupRow (service-rollup-{serviceId}) that expands to its
// method rows (method-row-{id}) carrying a sqft input and a GM% input.
//
// These specs assert the rollup contract, not the old flat per-line columns.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import type { MaintenanceEstimate, SectionService } from '@/types/estimating'
import { buildMaintenanceEstimate } from '@/mocks/estimatingData'
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
    squareFeet: null,
    laborMarkupPct: undefined,
    materialMarkupPct: undefined,
    hours: null,
    sortOrder: 0,
    components: [],
    ...over,
  }
}

function buildEstimate(): MaintenanceEstimate {
  const base = buildMaintenanceEstimate({ crewRateCentsPerHour: 18_000 })
  const sectionId = base.sections[0].id
  const services = [
    line(sectionId, {
      label: 'Mowing Service',
      serviceId: 'svc-m-mowing',
      serviceKitId: MOW_KIT.id,
      qty: 40,
      unitSellCents: 450,
      hours: 2,
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
const rollup = (serviceId: string) => within(card()).getByTestId(`service-rollup-${serviceId}`)
const rollupHeader = (serviceId: string) =>
  within(card()).getByTestId(`service-rollup-header-${serviceId}`)
const addSelect = () => within(card()).getByLabelText(/add optional service/i) as HTMLSelectElement

async function renderLoaded(estimate = buildEstimate()) {
  const utils = renderEditor(estimate)
  await screen.findByTestId('category-block-Turf')
  await waitFor(() => expect(rollupHeader('svc-m-mowing')).toBeInTheDocument())
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
    // Seasonal Color has no catalog service/kit → lands in "Other services",
    // keyed in the rollup by its own row id.
    expect(
      within(block('Other services')).getByTestId('service-rollup-svc-Seasonal Color'),
    ).toBeInTheDocument()
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
    // Fertilizer is collapsed → its rollup line is not mounted.
    expect(within(card()).queryByTestId('service-rollup-svc-m-fert-shrub-q1')).not.toBeInTheDocument()

    await user.click(toggle('Fertilizer'))
    expect(toggle('Fertilizer')).toHaveAttribute('aria-expanded', 'true')
    expect(rollup('svc-m-fert-shrub-q1')).toBeInTheDocument()

    await user.click(toggle('Turf'))
    expect(within(card()).queryByTestId('service-rollup-svc-m-mowing')).not.toBeInTheDocument()
  })
})

describe('service rollup lines', () => {
  it('each service renders one collapsed rollup line inside its category', async () => {
    await renderLoaded()
    const mowing = rollupHeader('svc-m-mowing')
    expect(mowing).toHaveAttribute('data-expanded', 'false')
    expect(mowing).toHaveTextContent('Mowing Service')
    // Rolled-up $/yr = unitSellCents × qty = 450 × 40 = 18,000¢ = $180.00
    expect(mowing).toHaveTextContent('$180.00')
    // collapsed → the method row is not mounted yet
    expect(within(card()).queryByTestId('method-row-svc-Mowing Service')).not.toBeInTheDocument()
  })

  it('expanding a rollup reveals its method rows with sqft + GM inputs', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(rollupHeader('svc-m-mowing')).getByRole('button'))
    expect(rollupHeader('svc-m-mowing')).toHaveAttribute('data-expanded', 'true')

    const methodRow = within(card()).getByTestId('method-row-svc-Mowing Service')
    expect(within(methodRow).getByTestId('sqft-input-svc-Mowing Service')).toBeInTheDocument()
    expect(within(methodRow).getByTestId('gm-input-svc-Mowing Service')).toBeInTheDocument()
  })

  it('sqft input is blank with the section sqft as placeholder when not overridden', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(rollupHeader('svc-m-mowing')).getByRole('button'))
    const sqft = within(card()).getByTestId('sqft-input-svc-Mowing Service') as HTMLInputElement
    expect(sqft.value).toBe('')
    expect(sqft.placeholder).toBe('120,000')
  })
})

describe('optional services instant-add', () => {
  it('lists only optional-category services', async () => {
    await renderLoaded()
    const options = within(addSelect()).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['+ Add optional service…', 'Mulch', 'Annuals'])
  })

  it('adds the picked service as one new rollup line and expands Optional Services', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.selectOptions(addSelect(), 'svc-m-mulch')

    expect(addSelect().value).toBe('')
    expect(toggle('Optional Services')).toHaveAttribute('aria-expanded', 'true')
    expect(within(block('Optional Services')).getByTestId('service-rollup-svc-m-mulch')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Mulch added')
  })

  it('shows an unavailable state when the catalog cannot load', async () => {
    server.use(http.get('/api/estimating/service-catalog', () => HttpResponse.json({}, { status: 500 })))
    renderEditor(buildEstimate())
    await waitFor(() => expect(addSelect()).toHaveTextContent('Service catalog unavailable'))
    expect(addSelect()).toBeDisabled()
  })
})

describe('per-line delete', () => {
  it('removes the whole rollup line from the draft without a confirm dialog', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    // expand the Pruning rollup so its method row (with the delete button) shows
    await user.click(within(rollupHeader('svc-m-pruning')).getByRole('button'))
    await user.click(
      within(within(card()).getByTestId('method-row-svc-Pruning')).getByRole('button', {
        name: /remove method/i,
      }),
    )
    expect(within(card()).queryByTestId('service-rollup-svc-m-pruning')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/removed/i)
  })
})
