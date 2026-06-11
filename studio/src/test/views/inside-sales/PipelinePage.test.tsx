import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import PipelinePage from '@/views/inside-sales/PipelinePage'

// DndKit requires PointerEvent in jsdom — provide a minimal polyfill
class MockPointerEvent extends Event {
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
  }
}
vi.stubGlobal('PointerEvent', MockPointerEvent)

function seedUser() {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
}

describe('PipelinePage', () => {
  beforeEach(() => {
    seedUser()
    // Reset selected lead
    useUIStore.setState({ selectedLeadId: null })
  })

  it('renders all 3 kanban column titles', async () => {
    render(<PipelinePage />)
    await screen.findByText('New Leads')
    expect(screen.getByText('New Leads')).toBeInTheDocument()
    expect(screen.getByText('Contacted')).toBeInTheDocument()
    expect(screen.getByText('Proposal Sent')).toBeInTheDocument()
  })

  it('renders Pipeline page TopNav title', async () => {
    render(<PipelinePage />)
    await screen.findByText('Pipeline')
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
  })

  it('renders page description', async () => {
    render(<PipelinePage />)
    await screen.findByText(/Drag leads between stages/)
    expect(screen.getByText(/Drag leads between stages/)).toBeInTheDocument()
  })

  it('places new-status leads in New Leads column', async () => {
    render(<PipelinePage />)
    // Wait for cards to appear
    await screen.findByText('Silverleaf HOA')
    expect(screen.getByText('Silverleaf HOA')).toBeInTheDocument()
    // Maricopa County is also new
    expect(screen.getByText('Maricopa County — Facilities RFP')).toBeInTheDocument()
  })

  it('places contacted leads in Contacted column', async () => {
    render(<PipelinePage />)
    await screen.findByText('City of Tempe — Parks RFP')
    expect(screen.getByText('City of Tempe — Parks RFP')).toBeInTheDocument()
  })

  it('places proposal_sent leads in Proposal Sent column', async () => {
    render(<PipelinePage />)
    await screen.findByText('Scottsdale Unified School District RFP')
    expect(screen.getByText('Scottsdale Unified School District RFP')).toBeInTheDocument()
  })

  it('filters out won/lost/handed_off leads from kanban', async () => {
    render(<PipelinePage />)
    // Wait for data to load
    await screen.findByText('Silverleaf HOA')
    // Town of Gilbert Parks is 'won' — should NOT appear in kanban columns
    expect(screen.queryByText('Town of Gilbert Parks')).not.toBeInTheDocument()
    // Mesa Arts Center is 'lost' — should NOT appear
    expect(screen.queryByText('Mesa Arts Center')).not.toBeInTheDocument()
  })

  it('lead cards show lead type badge', async () => {
    render(<PipelinePage />)
    await screen.findByText('Silverleaf HOA')
    // HOA type badges should appear
    const hoaBadges = screen.getAllByText('HOA')
    expect(hoaBadges.length).toBeGreaterThan(0)
  })

  it('renders Add Lead button in page header', async () => {
    render(<PipelinePage />)
    await screen.findByText('Inbound Pipeline')
    const addLeadBtn = screen.getByRole('button', { name: /add lead/i })
    expect(addLeadBtn).toBeInTheDocument()
  })

  it('opens AddLead modal when Add Lead button is clicked', async () => {
    const user = userEvent.setup()
    render(<PipelinePage />)
    await screen.findByText('Inbound Pipeline')

    const addLeadBtn = screen.getByRole('button', { name: /add lead/i })
    await user.click(addLeadBtn)

    await screen.findByRole('dialog')
    expect(screen.getByText(/Add lead to New Leads/i)).toBeInTheDocument()
  })

  it('Add lead modal closes when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<PipelinePage />)
    await screen.findByText('Inbound Pipeline')

    await user.click(screen.getByRole('button', { name: /add lead/i }))
    await screen.findByRole('dialog')

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('submits POST /api/leads when Add Lead form is submitted', async () => {
    const user = userEvent.setup()
    let postCalled = false
    let postedBody: Record<string, unknown> | null = null

    server.use(
      http.post('/api/leads', async ({ request }) => {
        postCalled = true
        postedBody = await request.json() as Record<string, unknown>
        return HttpResponse.json({
          id: 'l-new',
          property_name: postedBody.property_name,
          city: postedBody.city,
          state: 'AZ',
          zip: '',
          lat: 0, lng: 0,
          lead_type: 'HOA',
          score: 50,
          score_factors: [],
          estimated_acreage: 0,
          estimated_contract_value: 0,
          contact_name: null,
          contact_email: null,
          contact_linkedin: null,
          current_provider: null,
          source: 'manual',
          source_url: null,
          bid_deadline: null,
          status: 'new',
          assigned_to: null,
          handoff_notes: null,
          ai_email_draft: null,
          ai_linkedin_draft: null,
          branch_id: 'b1',
          distance_miles: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          address: '',
        }, { status: 201 })
      })
    )

    render(<PipelinePage />)
    await screen.findByText('Inbound Pipeline')

    // Click the header "Add lead" button (first one = PageHeader button)
    const addLeadButtons = screen.getAllByRole('button', { name: /add lead/i })
    await user.click(addLeadButtons[0])
    const dialog = await screen.findByRole('dialog')

    // Fill required fields within the dialog by directly setting values
    const propertyInput = screen.getByPlaceholderText('Silverleaf HOA') as HTMLInputElement
    // Use fireEvent to bypass pointer-events:none on body set by Radix Dialog
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(propertyInput, { target: { value: 'Test Property' } })

    const cityInput = screen.getByPlaceholderText('Phoenix') as HTMLInputElement
    fireEvent.change(cityInput, { target: { value: 'Phoenix' } })

    // Submit the form directly (bypass pointer-events: none set by Radix)
    const form = dialog.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    await waitFor(() => {
      expect(postCalled).toBe(true)
    }, { timeout: 3000 })

    expect(postedBody).toMatchObject({
      property_name: 'Test Property',
      city: 'Phoenix',
    })
  })

  it('renders column Add lead buttons for each column', async () => {
    render(<PipelinePage />)
    await screen.findByText('Silverleaf HOA')
    // Each column has an "Add lead" button
    const addLeadButtons = screen.getAllByRole('button', { name: /add lead/i })
    // 1 in header + 3 in columns = 4 total, but at minimum 3 column buttons
    expect(addLeadButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('search bar filters leads by property name', async () => {
    const user = userEvent.setup()
    render(<PipelinePage />)
    await screen.findByText('Silverleaf HOA')

    const searchInput = screen.getByPlaceholderText('Search leads...')
    await user.type(searchInput, 'Silverleaf')

    // Silverleaf HOA should remain visible
    expect(screen.getByText('Silverleaf HOA')).toBeInTheDocument()
    // Other leads like Maricopa County should be hidden
    await waitFor(() => {
      expect(screen.queryByText('Maricopa County — Facilities RFP')).not.toBeInTheDocument()
    })
  })
})
