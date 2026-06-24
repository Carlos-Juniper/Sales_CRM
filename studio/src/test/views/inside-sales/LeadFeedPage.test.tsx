import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import LeadFeedPage from '@/views/inside-sales/LeadFeedPage'
import { useAuthStore } from '@/store/authStore'
import { useLeadsStore } from '@/store/leadsStore'
import { useUIStore } from '@/store/uiStore'
import { makeUser } from '@/test/utils'
import type { Lead } from '@/types'

// Mock the PipelinePage module to avoid DnD Kit in tests
vi.mock('@/views/inside-sales/components/AddLeadModal', () => ({
  AddLeadModal: ({
    open,
    onClose,
  }: {
    open: boolean
    defaultStatus: string
    onClose: () => void
  }) =>
    open ? (
      <div role="dialog" data-testid="add-lead-modal">
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null,
}))

function makeLead(id: string, overrides: Partial<Lead> = {}): Lead {
  return {
    id,
    property_name: `Property ${id}`,
    address: '1 Main St',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85001',
    lat: 33.44,
    lng: -112.07,
    lead_type: 'HOA',
    score: 80,
    score_factors: [],
    estimated_acreage: 10,
    estimated_contract_value: 50000,
    contact_name: null,
    contact_email: null,
    contact_linkedin: null,
    current_provider: null,
    source: 'manual',
    source_url: null,
    bid_deadline: null,
    status: 'new',
    assigned_to: null,
    notes: null,
    handoff_notes: null,
    ai_email_draft: null,
    ai_linkedin_draft: null,
    branch_id: 'b1',
    distance_miles: 5,
    aspire_opportunity_id: null,
    division_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const tenLeads = Array.from({ length: 10 }, (_, i) => makeLead(`l${i + 1}`))
const thirtyLeads = Array.from({ length: 30 }, (_, i) => makeLead(`l${i + 1}`))

const defaultFilters = {
  search: '',
  leadTypes: [],
  minScore: 0,
  states: [],
  assignedOnly: false,
  unassignedOnly: false,
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser() })
  useLeadsStore.setState({ filters: defaultFilters, sortBy: 'score', sortDir: 'desc', page: 1 })
  useUIStore.setState({ selectedLeadId: null })
})

describe('LeadFeedPage — loading state', () => {
  it('renders 6 skeleton cards while request is in-flight', async () => {
    server.use(
      http.get('/api/leads', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: [], total: 0, page: 1, page_size: 25 })
      }),
    )
    render(<LeadFeedPage />)
    await waitFor(() => {
      expect(screen.getAllByTestId('lead-card-skeleton')).toHaveLength(6)
    })
  })

  it('skeleton cards disappear once data arrives', async () => {
    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({ data: tenLeads, total: 10, page: 1, page_size: 25 }),
      ),
    )
    render(<LeadFeedPage />)
    await waitFor(() => {
      expect(screen.queryByTestId('lead-card-skeleton')).not.toBeInTheDocument()
    })
  })
})

describe('LeadFeedPage — data display', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({ data: tenLeads, total: 10, page: 1, page_size: 25 }),
      ),
    )
  })

  it('renders lead cards for each returned lead', async () => {
    render(<LeadFeedPage />)
    await waitFor(() => {
      expect(screen.getByText('Property l1')).toBeInTheDocument()
    })
    for (let i = 1; i <= 10; i++) {
      expect(screen.getByText(`Property l${i}`)).toBeInTheDocument()
    }
  })

  it('shows total count in subtitle', async () => {
    render(<LeadFeedPage />)
    await waitFor(() => {
      expect(screen.getByText(/10 total leads/i)).toBeInTheDocument()
    })
  })

  it('shows score as active sort button by default', async () => {
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    const scoreBtn = screen.getByRole('button', { name: /score/i })
    expect(scoreBtn.className).toContain('bg-[#2E7D52]')
  })
})

describe('LeadFeedPage — pagination', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/leads', ({ request }) => {
        const url = new URL(request.url)
        const page = parseInt(url.searchParams.get('page') ?? '1')
        const pageSize = 25
        const paged = thirtyLeads.slice((page - 1) * pageSize, page * pageSize)
        return HttpResponse.json({ data: paged, total: 30, page, page_size: pageSize })
      }),
    )
  })

  it('shows pagination controls when total > 25', async () => {
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText(/Page 1 of 2/i))
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
  })

  it('Previous button is disabled on page 1', async () => {
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByRole('button', { name: /previous/i }))
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  })

  it('clicking Next advances to page 2', async () => {
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => screen.getByText(/Page 2 of 2/i))
  })

  it('Next button is disabled on last page', async () => {
    useLeadsStore.setState({ page: 2 })
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })
})

describe('LeadFeedPage — sorting', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({ data: tenLeads, total: 10, page: 1, page_size: 25 }),
      ),
    )
  })

  it('clicking Value sets sortBy to estimated_contract_value', async () => {
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    await user.click(screen.getByRole('button', { name: /value/i }))
    expect(useLeadsStore.getState().sortBy).toBe('estimated_contract_value')
  })

  it('clicking Date Added sets sortBy to created_at', async () => {
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    await user.click(screen.getByRole('button', { name: /date added/i }))
    expect(useLeadsStore.getState().sortBy).toBe('created_at')
  })

  it('clicking Deadline sets sortBy to bid_deadline', async () => {
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    await user.click(screen.getByRole('button', { name: /deadline/i }))
    expect(useLeadsStore.getState().sortBy).toBe('bid_deadline')
  })

  it('clicking active sort button toggles sortDir desc→asc', async () => {
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    expect(useLeadsStore.getState().sortDir).toBe('desc')
    await user.click(screen.getByRole('button', { name: /score/i }))
    expect(useLeadsStore.getState().sortDir).toBe('asc')
  })

  it('active sort button has distinct visual class', async () => {
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    const scoreBtn = screen.getByRole('button', { name: /score/i })
    const valueBtn = screen.getByRole('button', { name: /value/i })
    expect(scoreBtn.className).toContain('bg-[#2E7D52]')
    expect(valueBtn.className).not.toContain('bg-[#2E7D52]')
  })
})

describe('LeadFeedPage — selection', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({ data: tenLeads, total: 10, page: 1, page_size: 25 }),
      ),
    )
    // Handle lead detail + outreach calls from LeadDetailPanel
    server.use(
      http.get('/api/leads/:id', ({ params }) => {
        const lead = tenLeads.find((l) => l.id === params.id)
        if (!lead) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
        return HttpResponse.json(lead)
      }),
      http.get('/api/outreach/:leadId', () => HttpResponse.json([])),
      http.get('/api/bids', () => HttpResponse.json([])),
      http.get('/api/dashboard/inside-sales', () =>
        HttpResponse.json({
          new_leads_today: 0,
          leads_contacted_this_week: 0,
          open_bids: 0,
          bids_due_this_week: 0,
          pipeline_value: 0,
          overdue_follow_ups: 0,
          won_this_month: 0,
          won_value_this_month: 0,
        }),
      ),
    )
  })

  it('clicking a lead card sets selectedLeadId in uiStore', async () => {
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    await user.click(screen.getByText('Property l1'))
    expect(useUIStore.getState().selectedLeadId).toBe('l1')
  })
})

describe('LeadFeedPage — error state', () => {
  it('shows EmptyState with Retry button on 500 error', async () => {
    server.use(
      http.get('/api/leads', () => HttpResponse.json({ error: 'Server Error' }, { status: 500 })),
    )
    render(<LeadFeedPage />)
    expect(await screen.findByText(/failed to load leads/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('clicking Retry fires a new GET /api/leads request', async () => {
    let callCount = 0
    server.use(
      http.get('/api/leads', () => {
        callCount++
        if (callCount === 1)
          return HttpResponse.json({ error: 'Server Error' }, { status: 500 })
        return HttpResponse.json({ data: tenLeads, total: 10, page: 1, page_size: 25 })
      }),
    )
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await screen.findByText(/failed to load leads/i)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2))
  })
})

describe('LeadFeedPage — empty state', () => {
  it('shows "No leads match" message when API returns empty data', async () => {
    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, page_size: 25 }),
      ),
    )
    render(<LeadFeedPage />)
    expect(await screen.findByText(/no leads match your filters/i)).toBeInTheDocument()
    expect(screen.queryByTestId('lead-card-skeleton')).not.toBeInTheDocument()
  })
})

describe('LeadFeedPage — Add Lead', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({ data: tenLeads, total: 10, page: 1, page_size: 25 }),
      ),
    )
  })

  it('clicking Add Lead button opens the AddLeadModal', async () => {
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    await user.click(screen.getByRole('button', { name: /add lead/i }))
    expect(screen.getByTestId('add-lead-modal')).toBeInTheDocument()
  })
})

describe('LeadFeedPage — Refresh', () => {
  it('clicking refresh button fires GET /api/leads again', async () => {
    let callCount = 0
    server.use(
      http.get('/api/leads', () => {
        callCount++
        return HttpResponse.json({ data: tenLeads, total: 10, page: 1, page_size: 25 })
      }),
    )
    const user = userEvent.setup()
    render(<LeadFeedPage />)
    await waitFor(() => screen.getByText('Property l1'))
    const initialCount = callCount
    await user.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(callCount).toBeGreaterThan(initialCount))
  })
})
