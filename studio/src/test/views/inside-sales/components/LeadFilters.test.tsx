import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { LeadFilters } from '@/views/inside-sales/components/LeadFilters'
import { useLeadsStore } from '@/store/leadsStore'

const defaultFilters = {
  search: '',
  leadTypes: [],
  minScore: 0,
  states: [],
  assignedOnly: false,
  unassignedOnly: false,
}

beforeEach(() => {
  useLeadsStore.setState({ filters: defaultFilters, page: 1 })
})

describe('LeadFilters', () => {
  it('renders search input', () => {
    render(<LeadFilters />)
    expect(screen.getByPlaceholderText(/search properties/i)).toBeInTheDocument()
  })

  it('renders all five lead type buttons', () => {
    render(<LeadFilters />)
    expect(screen.getByRole('button', { name: 'HOA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commercial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deathcare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resorts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Healthcare' })).toBeInTheDocument()
  })

  it('renders all state buttons: FL, TX, PA, NC, SC', () => {
    render(<LeadFilters />)
    for (const state of ['FL', 'TX', 'PA', 'NC', 'SC']) {
      expect(screen.getByRole('button', { name: state })).toBeInTheDocument()
    }
  })

  it('typing in search input calls setFilter("search", value)', async () => {
    const user = userEvent.setup()
    render(<LeadFilters />)
    await user.type(screen.getByPlaceholderText(/search properties/i), 'Phoenix')
    expect(useLeadsStore.getState().filters.search).toBe('Phoenix')
  })

  it('checking HOA adds it to leadTypes', async () => {
    const user = userEvent.setup()
    render(<LeadFilters />)
    await user.click(screen.getByRole('button', { name: 'HOA' }))
    expect(useLeadsStore.getState().filters.leadTypes).toContain('HOA')
  })

  it('unchecking HOA removes it from leadTypes', async () => {
    useLeadsStore.setState({ filters: { ...defaultFilters, leadTypes: ['HOA'] } })
    const user = userEvent.setup()
    render(<LeadFilters />)
    await user.click(screen.getByRole('button', { name: 'HOA' }))
    expect(useLeadsStore.getState().filters.leadTypes).not.toContain('HOA')
  })

  it('checking multiple type buttons accumulates them', async () => {
    const user = userEvent.setup()
    render(<LeadFilters />)
    await user.click(screen.getByRole('button', { name: 'HOA' }))
    await user.click(screen.getByRole('button', { name: 'Commercial' }))
    const { leadTypes } = useLeadsStore.getState().filters
    expect(leadTypes).toContain('HOA')
    expect(leadTypes).toContain('commercial')
  })

  it('clicking a state button adds it to states', async () => {
    const user = userEvent.setup()
    render(<LeadFilters />)
    await user.click(screen.getByRole('button', { name: 'FL' }))
    expect(useLeadsStore.getState().filters.states).toContain('FL')
  })

  it('clicking "Clear filters" calls resetFilters', async () => {
    useLeadsStore.setState({ filters: { ...defaultFilters, leadTypes: ['HOA'], states: ['AZ'] } })
    const user = userEvent.setup()
    render(<LeadFilters />)
    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    const { filters } = useLeadsStore.getState()
    expect(filters.leadTypes).toHaveLength(0)
    expect(filters.states).toHaveLength(0)
    expect(filters.search).toBe('')
  })

  it('Clear filters button only appears when filters are active', () => {
    render(<LeadFilters />)
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
  })

  it('Clear filters button appears when leadTypes filter is set', () => {
    useLeadsStore.setState({ filters: { ...defaultFilters, leadTypes: ['HOA'] } })
    render(<LeadFilters />)
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument()
  })

  it('clicking Healthcare adds it to leadTypes', async () => {
    const user = userEvent.setup()
    render(<LeadFilters />)
    await user.click(screen.getByRole('button', { name: 'Healthcare' }))
    expect(useLeadsStore.getState().filters.leadTypes).toContain('healthcare')
  })

  it('active Deathcare chip uses slate styling, not purple', () => {
    useLeadsStore.setState({ filters: { ...defaultFilters, leadTypes: ['deathcare'] } })
    render(<LeadFilters />)
    const btn = screen.getByRole('button', { name: 'Deathcare' })
    expect(btn.className).toContain('border-slate-300')
    expect(btn.className).not.toContain('border-purple')
  })
})
