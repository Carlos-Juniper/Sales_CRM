// ---------------------------------------------------------------------------
// BillingTypeSelect — per-line override of the contract's recurring/one-time
// split (migration 046).
//
// All maintenance work bundles into the contract and is broken into the
// Landscape Maintenance Agreement's 12-month payment schedule, so the control
// is not there to rescue unresolved lines (contract.ts treats anything not
// explicitly one-time as recurring). It exists to mark the exception: work
// billed once, when performed.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { BillingTypeSelect } from '@/views/inside-sales/components/estimating/BillingTypeSelect'

function renderSelect(props: Partial<React.ComponentProps<typeof BillingTypeSelect>> = {}) {
  const onChange = vi.fn()
  render(
    <BillingTypeSelect
      label="Mowing & Edging"
      value={null}
      onChange={onChange}
      {...props}
    />,
  )
  return { onChange, select: screen.getByLabelText('Billing type for Mowing & Edging') }
}

describe('BillingTypeSelect', () => {
  it('offers Auto plus both billing categories', () => {
    const { select } = renderSelect()
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['Auto', 'Recurring', 'One-time'])
  })

  it('reflects the persisted override', () => {
    const { select } = renderSelect({ value: 'one_time' })
    expect((select as HTMLSelectElement).value).toBe('one_time')
  })

  it('emits the chosen billing type', async () => {
    const { onChange, select } = renderSelect()
    await userEvent.selectOptions(select, 'recurring')
    expect(onChange).toHaveBeenCalledWith('recurring')
  })

  it('emits null when cleared back to Auto, so it re-derives from the catalog', async () => {
    const { onChange, select } = renderSelect({ value: 'one_time' })
    await userEvent.selectOptions(select, '')
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('emits one_time to mark the exception to the 12-month bundle', async () => {
    const { onChange, select } = renderSelect()
    await userEvent.selectOptions(select, 'one_time')
    expect(onChange).toHaveBeenCalledWith('one_time')
  })

  it('explains both sides of the split, since Auto is not self-evident', () => {
    const { select } = renderSelect()
    expect(select.title).toContain('12-month payment schedule')
    expect(select.title).toContain('when the work is performed')
  })
})
