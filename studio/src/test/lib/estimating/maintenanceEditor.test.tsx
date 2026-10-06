// ---------------------------------------------------------------------------
// Handoff 59 Track B4 — maintenance editor hierarchy redesign tests.
//
// Covers:
//   • groupByService: roll up method rows by serviceId
//   • totalYearlyCents rollup math
//   • ServiceRollupRow collapsed/expanded state
//   • squareFeet input with section-sqft placeholder
//   • GM% display and reprice callback
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from '@/test/utils'
import type { SectionService } from '@/types/estimating'
import { groupByService } from '@/lib/estimating/maintenanceEditor'
import { ServiceRollupRow } from '@/views/inside-sales/components/estimating/maintenance-editor/ServiceRollupRow'

// ---------------------------------------------------------------------------
// Helper: build a minimal SectionService for testing
// ---------------------------------------------------------------------------
function makeSvc(
  over: Partial<SectionService> & Pick<SectionService, 'id' | 'label'>,
): SectionService {
  return {
    sectionId: 'sec-1',
    serviceKitId: null,
    serviceId: 'svc-test',
    qty: 26,
    uom: 'SF',
    complexityPct: 0.1,
    unitSellCents: 1000,
    embeddedCostCents: null,
    targetGm: null,
    squareFeet: null,
    laborMarkupPct: 1.0,
    materialMarkupPct: 1.0,
    hours: null,
    sortOrder: 0,
    components: [],
    ...over,
  }
}

// ---------------------------------------------------------------------------
// describe("service rollup grouping")
// ---------------------------------------------------------------------------
describe('service rollup grouping', () => {
  it('groups section_services by service_id into one collapsed line', () => {
    const rows: SectionService[] = [
      makeSvc({ id: 'row-1', label: 'Method A', serviceId: 'maint-svc-100' }),
      makeSvc({ id: 'row-2', label: 'Method B', serviceId: 'maint-svc-100' }),
      makeSvc({ id: 'row-3', label: 'Method C', serviceId: 'maint-svc-100' }),
    ]
    const groups = groupByService(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].serviceId).toBe('maint-svc-100')
    expect(groups[0].methods).toHaveLength(3)
  })

  it('rollup totalYearlyCents sums all method rows', () => {
    // 3 rows each with unitSellCents=1000, qty=26 → 3 × 1000 × 26 = 78000
    const rows: SectionService[] = [
      makeSvc({ id: 'row-1', label: 'Method A', serviceId: 'maint-svc-100', unitSellCents: 1000, qty: 26 }),
      makeSvc({ id: 'row-2', label: 'Method B', serviceId: 'maint-svc-100', unitSellCents: 1000, qty: 26 }),
      makeSvc({ id: 'row-3', label: 'Method C', serviceId: 'maint-svc-100', unitSellCents: 1000, qty: 26 }),
    ]
    const groups = groupByService(rows)
    expect(groups[0].totalYearlyCents).toBe(78000)
  })

  it('produces one group per unique service_id', () => {
    const rows: SectionService[] = [
      makeSvc({ id: 'r1', label: 'M1', serviceId: 'svc-a', unitSellCents: 500, qty: 10 }),
      makeSvc({ id: 'r2', label: 'M2', serviceId: 'svc-b', unitSellCents: 200, qty: 5 }),
      makeSvc({ id: 'r3', label: 'M3', serviceId: 'svc-a', unitSellCents: 300, qty: 10 }),
    ]
    const groups = groupByService(rows)
    expect(groups).toHaveLength(2)
    const groupA = groups.find((g) => g.serviceId === 'svc-a')!
    expect(groupA.totalYearlyCents).toBe(500 * 10 + 300 * 10) // 8000
    const groupB = groups.find((g) => g.serviceId === 'svc-b')!
    expect(groupB.totalYearlyCents).toBe(200 * 5) // 1000
  })

  it('handles rows with null unitSellCents as 0', () => {
    const rows: SectionService[] = [
      makeSvc({ id: 'r1', label: 'M1', serviceId: 'svc-x', unitSellCents: null, qty: 10 }),
      makeSvc({ id: 'r2', label: 'M2', serviceId: 'svc-x', unitSellCents: 500, qty: 4 }),
    ]
    const groups = groupByService(rows)
    expect(groups[0].totalYearlyCents).toBe(2000)
  })
})

// ---------------------------------------------------------------------------
// describe("collapsed by default")
// ---------------------------------------------------------------------------
describe('collapsed by default', () => {
  const sectionSquareFeet = 50_000

  function renderRollupRow(methods: SectionService[], expanded = false) {
    const group = groupByService(methods)[0]
    return render(
      <ServiceRollupRow
        group={{ ...group, isExpanded: expanded }}
        sectionSquareFeet={sectionSquareFeet}
        onToggle={vi.fn()}
        onUpdate={vi.fn()}
        onGmChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
  }

  it('service line renders as collapsed by default', () => {
    const methods = [makeSvc({ id: 'r1', label: 'Mow Standard 48"', serviceId: 'svc-mow' })]
    renderRollupRow(methods)
    const header = screen.getByTestId('service-rollup-header-svc-mow')
    expect(header).toHaveAttribute('data-expanded', 'false')
  })

  it('expand button shows method rows', () => {
    const methods = [
      makeSvc({ id: 'r1', label: 'Mow Standard 48"', serviceId: 'svc-mow' }),
      makeSvc({ id: 'r2', label: 'Mow Push Mow', serviceId: 'svc-mow' }),
    ]
    renderRollupRow(methods, true)
    // When expanded, method rows are visible
    expect(screen.getByTestId('method-row-r1')).toBeInTheDocument()
    expect(screen.getByTestId('method-row-r2')).toBeInTheDocument()
  })

  it('method rows are hidden when collapsed', () => {
    const methods = [makeSvc({ id: 'r1', label: 'Mow Standard 48"', serviceId: 'svc-mow' })]
    renderRollupRow(methods, false)
    expect(screen.queryByTestId('method-row-r1')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// describe("typeable square feet")
// ---------------------------------------------------------------------------
describe('typeable square feet', () => {
  const sectionSquareFeet = 50_000

  function renderWithSqft(squareFeet: number | null) {
    const method = makeSvc({ id: 'r1', label: 'Mow Standard 48"', serviceId: 'svc-mow', squareFeet })
    const group = groupByService([method])[0]
    const onUpdate = vi.fn()
    render(
      <ServiceRollupRow
        group={{ ...group, isExpanded: true }}
        sectionSquareFeet={sectionSquareFeet}
        onToggle={vi.fn()}
        onUpdate={onUpdate}
        onGmChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    return { onUpdate }
  }

  it('null squareFeet shows placeholder from section', () => {
    renderWithSqft(null)
    const input = screen.getByTestId('sqft-input-r1') as HTMLInputElement
    // null means inherit from section; placeholder shows section's sqft
    expect(input.placeholder).toBe('50,000')
    expect(input.value).toBe('')
  })

  it('typed sqft triggers onUpdate with squareFeet as number', () => {
    const { onUpdate } = renderWithSqft(null)
    const input = screen.getByTestId('sqft-input-r1') as HTMLInputElement
    fireEvent.change(input, { target: { value: '25000' } })
    expect(onUpdate).toHaveBeenCalledWith('r1', { squareFeet: 25000 })
  })

  it('non-null squareFeet shows as the controlled input value', () => {
    renderWithSqft(30_000)
    const input = screen.getByTestId('sqft-input-r1') as HTMLInputElement
    expect(input.value).toBe('30000')
  })
})

// ---------------------------------------------------------------------------
// describe("GM% field")
// ---------------------------------------------------------------------------
describe('GM% field', () => {
  const sectionSquareFeet = 50_000

  function renderWithGm(opts: {
    laborMarkupPct: number
    materialMarkupPct: number
    unitCostCents: number
    unitSellCents: number
    targetGm: number | null
  }) {
    const method = makeSvc({
      id: 'r1',
      label: 'Mow Standard 48"',
      serviceId: 'svc-mow',
      laborMarkupPct: opts.laborMarkupPct,
      materialMarkupPct: opts.materialMarkupPct,
      unitSellCents: opts.unitSellCents,
      targetGm: opts.targetGm,
    })
    const group = groupByService([method])[0]
    const onGmChange = vi.fn()
    render(
      <ServiceRollupRow
        group={{ ...group, isExpanded: true }}
        sectionSquareFeet={sectionSquareFeet}
        onToggle={vi.fn()}
        onUpdate={vi.fn()}
        onGmChange={onGmChange}
        onRemove={vi.fn()}
      />,
    )
    return { onGmChange }
  }

  it('displays derived GM from sell/cost when targetGm is null', () => {
    // unitCostCents=3000, unitSellCents=6000 → GM = (6000-3000)/6000 = 50%
    // We pass laborMarkupPct to derive cost context, unitSellCents for sell
    // The component should display "50%" derived from the sell/cost ratio
    renderWithGm({
      laborMarkupPct: 1.0,
      materialMarkupPct: 1.0,
      unitCostCents: 3000,
      unitSellCents: 6000,
      targetGm: null,
    })
    // targetGm=null → display derived GM from the sell/cost formula
    const gmField = screen.getByTestId('gm-field-r1')
    // GM = (sell - cost) / sell = (6000 - 3000) / 6000 = 50%
    expect(gmField).toHaveTextContent('50%')
  })

  it('displays stored targetGm when set', () => {
    renderWithGm({
      laborMarkupPct: 1.0,
      materialMarkupPct: 1.0,
      unitCostCents: 3000,
      unitSellCents: 6000,
      targetGm: 0.3,
    })
    const gmField = screen.getByTestId('gm-field-r1')
    expect(gmField).toHaveTextContent('30%')
  })

  it('typing GM% triggers onGmChange with decimal', () => {
    const { onGmChange } = renderWithGm({
      laborMarkupPct: 1.0,
      materialMarkupPct: 1.0,
      unitCostCents: 3000,
      unitSellCents: 6000,
      targetGm: null,
    })
    const input = screen.getByTestId('gm-input-r1') as HTMLInputElement
    fireEvent.change(input, { target: { value: '30' } })
    expect(onGmChange).toHaveBeenCalledWith('r1', 0.3)
  })
})
