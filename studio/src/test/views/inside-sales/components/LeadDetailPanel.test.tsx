import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import { LeadDetailPanel } from '@/views/inside-sales/components/LeadDetailPanel'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '@/test/utils'
import type { Lead } from '@/types'

const onClose = vi.fn()

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'l1',
    property_name: 'Silverleaf HOA',
    address: '1234 Desert Ridge Blvd',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85050',
    lat: 33.69,
    lng: -111.97,
    lead_type: 'HOA',
    score: 88,
    score_factors: [],
    estimated_acreage: 45,
    estimated_contract_value: 185000,
    contact_name: 'Jennifer Walsh',
    contact_email: 'jwalsh@silverleafhoa.org',
    contact_linkedin: null,
    current_provider: 'TruGreen',
    source: 'hoa_usa',
    source_url: null,
    bid_deadline: null,
    status: 'new',
    assigned_to: null,
    notes: null,
    handoff_notes: null,
    ai_linkedin_draft: 'Hi Jennifer, LinkedIn message here.',
    branch_id: 'b1',
    distance_miles: 8.4,
    aspire_opportunity_id: null,
    division_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function setupHandlers(lead: Lead) {
  server.use(
    http.get('/api/leads/l1', () => HttpResponse.json(lead)),
    http.get('/api/bids', () => HttpResponse.json([])),
    http.patch('/api/leads/l1', async ({ request }) => {
      const body = (await request.json()) as Partial<Lead>
      return HttpResponse.json({ ...lead, ...body })
    }),
    http.delete('/api/leads/l1', () => new HttpResponse(null, { status: 204 })),
    http.get('/api/users', () =>
      HttpResponse.json([
        { id: 'u2', name: 'Maria Garcia', email: 'maria.garcia@juniperlandscaping.com', role: 'outside_sales', branch_id: 'b1', avatar_initials: 'MG' },
      ]),
    ),
  )
}

beforeEach(() => {
  onClose.mockClear()
  useAuthStore.setState({ user: makeUser() })
})

describe('LeadDetailPanel — panel lifecycle', () => {
  it('renders nothing when leadId is null', () => {
    const { container } = render(<LeadDetailPanel leadId={null} onClose={onClose} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders panel when leadId is set', async () => {
    setupHandlers(makeLead())
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('close button (×) calls onClose', async () => {
    setupHandlers(makeLead())
    const user = userEvent.setup()
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pressing Escape calls onClose', async () => {
    setupHandlers(makeLead())
    const user = userEvent.setup()
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('LeadDetailPanel — content', () => {
  beforeEach(() => {
    setupHandlers(makeLead())
  })

  it('renders lead property name', async () => {
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    expect(await screen.findByText('Silverleaf HOA')).toBeInTheDocument()
  })

  it('renders address', async () => {
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(screen.getByText(/1234 Desert Ridge Blvd/)).toBeInTheDocument()
  })

  it('renders numeric score', async () => {
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(screen.getByText('88')).toBeInTheDocument()
  })

  it('renders lead type badge', async () => {
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    // HOA appears in header badge + overview tab — both are fine
    expect(screen.getAllByText('HOA').length).toBeGreaterThanOrEqual(1)
  })

  it('renders estimated contract value as currency', async () => {
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(screen.getAllByText('$185K').length).toBeGreaterThanOrEqual(1)
  })

  it('renders source field', async () => {
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    // source text "hoa usa" appears in header span + overview tab
    expect(screen.getAllByText(/hoa usa/i).length).toBeGreaterThanOrEqual(1)
  })

  it('renders contact info when contact_name is set', async () => {
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Jennifer Walsh')
    expect(screen.getByText('Jennifer Walsh')).toBeInTheDocument()
  })

  it('hides contact section when contact_name is null', async () => {
    setupHandlers(makeLead({ contact_name: null, contact_email: null }))
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(screen.queryByText('Jennifer Walsh')).not.toBeInTheDocument()
    expect(screen.getByText(/No contact identified yet/i)).toBeInTheDocument()
  })

  it('shows bid deadline chip when bid_deadline is set', async () => {
    const deadline = new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString()
    setupHandlers(makeLead({ bid_deadline: deadline }))
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(screen.getByText(/Bid Due/i)).toBeInTheDocument()
  })
})

describe('LeadDetailPanel — stage progression', () => {
  it('current status "new" is highlighted in the stage stepper', async () => {
    setupHandlers(makeLead({ status: 'new' }))
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    const newBtn = screen.getByRole('button', { name: 'New' })
    expect(newBtn.className).toContain('bg-[#1f2937]')
  })

  it('clicking Contacted stage button fires PATCH with status=contacted', async () => {
    setupHandlers(makeLead({ status: 'new' }))
    const user = userEvent.setup()
    let patchBody: Partial<Lead> | null = null
    server.use(
      http.patch('/api/leads/l1', async ({ request }) => {
        patchBody = (await request.json()) as Partial<Lead>
        return HttpResponse.json({ ...makeLead(), ...patchBody })
      }),
    )
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    await user.click(screen.getByRole('button', { name: 'Contacted' }))
    await waitFor(() => expect(patchBody?.status).toBe('contacted'))
  })
})

describe('LeadDetailPanel — assign to CRM', () => {
  it('Assign to CRM button is visible on an unassigned lead', async () => {
    setupHandlers(makeLead({ status: 'new' }))
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(
      screen.getByRole('button', { name: /assign to crm/i }),
    ).toBeInTheDocument()
  })

  it('an already-assigned lead shows a disabled Assigned button', async () => {
    setupHandlers(makeLead({ status: 'qualified', assigned_to: 'u-42' }))
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(screen.getByRole('button', { name: /assigned/i })).toBeDisabled()
  })

  it('clicking Assign to CRM opens AssignCrmModal', async () => {
    setupHandlers(makeLead({ status: 'new' }))
    const user = userEvent.setup()
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    await user.click(screen.getByRole('button', { name: /assign to crm/i }))
    expect(await screen.findByRole('dialog', { name: /assign to crm/i })).toBeInTheDocument()
  })

  it('AssignCrmModal Cancel closes without firing PATCH', async () => {
    setupHandlers(makeLead({ status: 'new' }))
    let patched = false
    server.use(
      http.patch('/api/leads/l1', async () => {
        patched = true
        return HttpResponse.json(makeLead())
      }),
    )
    const user = userEvent.setup()
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    await user.click(screen.getByRole('button', { name: /assign to crm/i }))
    const modal = await screen.findByRole('dialog', { name: /assign to crm/i })
    await user.click(within(modal).getByRole('button', { name: /cancel/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /assign to crm/i })).not.toBeInTheDocument()
    })
    expect(patched).toBe(false)
  })
})

describe('LeadDetailPanel — delete', () => {
  it('Delete button is visible in the action bar', async () => {
    setupHandlers(makeLead())
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(screen.getByRole('button', { name: /delete lead/i })).toBeInTheDocument()
  })

  it('clicking Delete opens confirmation dialog', async () => {
    setupHandlers(makeLead())
    const user = userEvent.setup()
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    await user.click(screen.getByRole('button', { name: /delete lead/i }))
    expect(await screen.findByText(/remove this lead/i)).toBeInTheDocument()
  })

  it('Cancel in confirmation dialog closes without firing DELETE', async () => {
    setupHandlers(makeLead())
    let deleted = false
    server.use(
      http.delete('/api/leads/l1', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    await user.click(screen.getByRole('button', { name: /delete lead/i }))
    await screen.findByText(/remove this lead/i)
    const cancelBtns = screen.getAllByRole('button', { name: /cancel/i })
    await user.click(cancelBtns[cancelBtns.length - 1])
    await waitFor(() => expect(screen.queryByText(/remove this lead/i)).not.toBeInTheDocument())
    expect(deleted).toBe(false)
  })

  it('confirming delete fires DELETE /api/leads/:id and calls onClose', async () => {
    setupHandlers(makeLead())
    let deleted = false
    server.use(
      http.delete('/api/leads/l1', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    server.use(http.get('/api/leads', () => HttpResponse.json({ data: [], total: 0, page: 1, page_size: 25, total_pages: 0 })))
    const user = userEvent.setup()
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    await user.click(screen.getByRole('button', { name: /delete lead/i }))
    await screen.findByText(/remove this lead/i)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete$/i })
    await user.click(deleteBtns[deleteBtns.length - 1])
    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('LeadDetailPanel — In Aspire badge', () => {
  it('does not show In Aspire badge when aspire_opportunity_id is null', async () => {
    setupHandlers(makeLead({ aspire_opportunity_id: null }))
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(screen.queryByText('In Aspire')).not.toBeInTheDocument()
  })

  it('shows In Aspire badge when aspire_opportunity_id is set', async () => {
    setupHandlers(makeLead({ aspire_opportunity_id: 'opp_abc123' }))
    render(<LeadDetailPanel leadId="l1" onClose={onClose} />)
    await screen.findByText('Silverleaf HOA')
    expect(await screen.findByText('In Aspire')).toBeInTheDocument()
  })
})
