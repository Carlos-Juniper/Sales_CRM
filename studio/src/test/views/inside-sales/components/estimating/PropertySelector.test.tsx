import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from '@/test/utils'
import { server } from '@/mocks/server'
import { PropertySelector } from '@/views/inside-sales/components/estimating/PropertySelector'
import type { Property } from '@/types/estimating'

const API = '/api'

function prop(over: Partial<Property> = {}): Property {
  return {
    id: 'prop-1', name: 'Sunny HOA', address1: '123 Palm St', address2: null,
    city: 'Orlando', state: 'FL', zip: '32807', branchCity: 'Orlando, FL',
    customerType: 'hoa', managementCompanyId: null, aspirePropertyId: 238431,
    aspireSyncStatus: 'synced', createdAt: null, updatedAt: null, ...over,
  }
}

describe('PropertySelector', () => {
  it('searches the local table and lists matches', async () => {
    const user = userEvent.setup()
    server.use(http.get(`${API}/properties`, () => HttpResponse.json([prop()])))
    render(<PropertySelector value={null} onSelect={vi.fn()} />)
    await user.type(screen.getByLabelText(/search properties/i), 'sun')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    expect(await screen.findByText('Sunny HOA')).toBeInTheDocument()
  })

  it('selecting a result reports it to the parent', async () => {
    const user = userEvent.setup()
    server.use(http.get(`${API}/properties`, () => HttpResponse.json([prop()])))
    const onSelect = vi.fn()
    render(<PropertySelector value={null} onSelect={onSelect} />)
    await user.type(screen.getByLabelText(/search properties/i), 'sun')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await user.click(await screen.findByRole('button', { name: /sunny hoa/i }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-1' }))
  })

  it('shows the prior-opportunity history for the selected property (dedup panel)', async () => {
    server.use(
      http.get(`${API}/properties/prop-1/opportunities`, () =>
        HttpResponse.json([{ OpportunityID: 630956, OpportunityNumber: 8, OpportunityName: 'Prior Work' }]),
      ),
    )
    render(<PropertySelector value={prop()} onSelect={vi.fn()} />)
    expect(await screen.findByText(/prior work/i)).toBeInTheDocument()
  })

  it('create-new is only reachable after a search, and creating selects it', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${API}/properties`, () => HttpResponse.json([])),
      http.post(`${API}/properties`, async () =>
        HttpResponse.json(prop({ id: 'prop-new', name: 'Brand New HOA', aspireSyncStatus: 'pending', aspirePropertyId: null }), { status: 201 }),
      ),
    )
    const onSelect = vi.fn()
    render(<PropertySelector value={null} onSelect={onSelect} />)
    // no create affordance before searching
    expect(screen.queryByRole('button', { name: /create new property/i })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/search properties/i), 'brand')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await user.click(await screen.findByRole('button', { name: /create new property/i }))
    await user.type(screen.getByLabelText(/property name/i), 'Brand New HOA')
    await user.selectOptions(screen.getByLabelText(/branch/i), 'Orlando, FL')
    await user.click(screen.getByRole('button', { name: /create property/i }))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-new' })))
  })

  it('surfaces an inline error when create fails and does not select', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${API}/properties`, () => HttpResponse.json([])),
      http.post(`${API}/properties`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    )
    const onSelect = vi.fn()
    render(<PropertySelector value={null} onSelect={onSelect} />)
    await user.type(screen.getByLabelText(/search properties/i), 'x')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await user.click(await screen.findByRole('button', { name: /create new property/i }))
    await user.type(screen.getByLabelText(/property name/i), 'X HOA')
    await user.click(screen.getByRole('button', { name: /create property/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not create/i)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
