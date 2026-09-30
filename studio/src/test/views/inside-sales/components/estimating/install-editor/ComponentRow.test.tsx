// Item row: unknown cost renders "—" (never $0.00); five distinct cost-kind badges.

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import type { SectionServiceComponent } from '@/types/estimating'
import { DEFAULT_MARGIN_BANDS } from '@/lib/estimating/config'
import { ComponentRow } from '@/views/inside-sales/components/estimating/install-editor/ComponentRow'
import { parseUnitCostInput } from '@/views/inside-sales/components/estimating/install-editor/grid'

function cmp(over: Partial<SectionServiceComponent> = {}): SectionServiceComponent {
  return {
    id: 'cmp-1',
    sectionServiceId: 'svc-1',
    kind: 'material',
    label: 'PVC Pipe',
    qty: 100,
    unitCostCents: null,
    hours: null,
    sortOrder: 0,
    ...over,
  }
}

describe('ComponentRow', () => {
  it('an unknown cost shows "—" in the cost cells and an empty blue cell, never $0.00', () => {
    render(
      <ComponentRow
        component={cmp()}
        rollup={{ costCents: null, priceCents: null, gm: null }}
        bands={DEFAULT_MARGIN_BANDS}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByTestId('install-component-cost-PVC Pipe')).toHaveTextContent('—')
    expect(screen.getByTestId('install-component-gm-PVC Pipe')).toHaveTextContent('—')
    const input = screen.getByLabelText('Unit cost for PVC Pipe') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('—')
    expect(input.className).toContain('bg-[#eff6ff]')
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('typing a cost sets integer cents; clearing it returns to unknown', () => {
    const onChange = vi.fn()
    render(
      <ComponentRow
        component={cmp({ unitCostCents: 250 })}
        rollup={{ costCents: 25_000, priceCents: null, gm: null }}
        bands={DEFAULT_MARGIN_BANDS}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Unit cost for PVC Pipe')
    fireEvent.change(input, { target: { value: '3.1' } })
    expect(onChange).toHaveBeenLastCalledWith({ unitCostCents: 310 })
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ unitCostCents: null })
    expect(parseUnitCostInput('  ')).toBeNull()
    expect(parseUnitCostInput('12.345')).toBe(1235)
  })

  it.each([
    ['labor', 'LABOR'],
    ['material', 'MATERIAL'],
    ['equipment', 'EQUIPMENT'],
    ['subcontractor', 'SUB'],
    ['other', 'OTHER'],
  ] as const)('labels a %s item "%s"', (kind, label) => {
    render(
      <ComponentRow
        component={cmp({ kind, unitCostCents: 100 })}
        rollup={{ costCents: 100, priceCents: null, gm: null }}
        bands={DEFAULT_MARGIN_BANDS}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByTestId('install-component-kind-PVC Pipe')).toHaveTextContent(label)
  })

  it('has a per-item delete with no confirm dialog', async () => {
    const onDelete = vi.fn()
    render(
      <ComponentRow
        component={cmp({ unitCostCents: 100 })}
        rollup={{ costCents: 100, priceCents: null, gm: null }}
        bands={DEFAULT_MARGIN_BANDS}
        onChange={vi.fn()}
        onDelete={onDelete}
      />,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete item PVC Pipe' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
