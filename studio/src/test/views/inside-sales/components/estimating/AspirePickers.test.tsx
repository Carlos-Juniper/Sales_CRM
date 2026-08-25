import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import {
  BranchPicker,
  ServiceLineSelect,
  LostReasonSelect,
} from '@/views/inside-sales/components/estimating/AspirePickers'

describe('BranchPicker', () => {
  it('lists city-level branches and reports the selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BranchPicker value="" onChange={onChange} label="Branch" />)
    await user.selectOptions(screen.getByLabelText('Branch'), 'Orlando, FL')
    expect(onChange).toHaveBeenCalledWith('Orlando, FL')
  })
})

describe('ServiceLineSelect', () => {
  it('sends the exact backend key (double-space Hardscape) as the value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ServiceLineSelect value="Maintenance: Contract" onChange={onChange} label="Service line" />)
    await user.selectOptions(screen.getByLabelText('Service line'), 'Install:  Hardscape')
    expect(onChange).toHaveBeenCalledWith('Install:  Hardscape')
  })
})

describe('LostReasonSelect', () => {
  it('offers only the active reasons and reports a numeric id', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LostReasonSelect value={null} onChange={onChange} label="Lost reason" />)
    // deprecated reasons must not appear
    expect(screen.queryByRole('option', { name: /timing/i })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Lost reason'), 'Price')
    expect(onChange).toHaveBeenCalledWith(13)
  })
})
