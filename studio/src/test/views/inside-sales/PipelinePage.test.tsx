import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import PipelinePage from '@/views/inside-sales/PipelinePage'
import type { Property } from '@/types/estimating'

// DndKit requires PointerEvent in jsdom — provide a minimal polyfill
class MockPointerEvent extends Event {
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
  }
}
vi.stubGlobal('PointerEvent', MockPointerEvent)

// WS1: AddLeadModal now uses PropertySelector + useBranchList. Mock both so
// the PipelinePage integration tests don't need a real search backend.
const _mockProperty: Property = {
  id: 'prop-pipeline-test',
  name: 'Test Property',
  address1: null, address2: null,
  city: 'Phoenix', state: 'AZ', zip: null,
  branchCity: null, customerType: null,
  managementCompanyId: null, aspirePropertyId: null,
  aspireSyncStatus: 'pending', createdAt: null, updatedAt: null,
}
vi.mock('@/views/inside-sales/components/estimating/PropertySelector', () => ({
  PropertySelector: ({ value, onSelect }: { value: Property | null; onSelect: (p: Property | null) => void }) => (
    <div>
      {value ? (
        <span data-testid="pipeline-property-selected">{value.name}</span>
      ) : (
        <button type="button" data-testid="pipeline-select-property" onClick={() => onSelect(_mockProperty)}>
          Select property
        </button>
      )}
    </div>
  ),
}))
vi.mock('@/hooks/useBranchList', () => ({
  useBranchList: () => ({
    data: [{ aspireBranchId: 1, branchName: 'Phoenix', city: 'Phoenix' }],
    isLoading: false,
    isError: false,
  }),
}))

function seedUser() {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
}

describe('PipelinePage', () => {
  beforeEach(() => {
    seedUser()
    // Reset selected lead
    useUIStore.setState({ selectedLeadId: null })
  })

  it('renders all 4 kanban stage titles', async () => {
    render(<PipelinePage />)
    await screen.findByText('Qualifying')
    expect(screen.getByText('Qualifying')).toBeInTheDocument()
    expect(screen.getByText('Estimating')).toBeInTheDocument()
    expect(screen.getByText('OP Review')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('renders Pipeline page TopNav title', async () => {
    render(<PipelinePage />)
    await screen.findByText('Pipeline')
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
  })

  it('renders page description', async () => {
    render(<PipelinePage />)
    await screen.findByText(/Leads move between stages automatically/)
    expect(screen.getByText(/Leads move between stages automatically/)).toBeInTheDocument()
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

  it('hides proposal_sent leads from the kanban (terminal/hidden status)', async () => {
    render(<PipelinePage />)
    await screen.findByText('Silverleaf HOA')
    expect(
      screen.queryByText('Scottsdale Unified School District RFP'),
    ).not.toBeInTheDocument()
  })

  it('filters out won/lost leads from kanban', async () => {
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
    expect(screen.getByText(/Add lead to Qualifying/i)).toBeInTheDocument()
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

    // WS1: property_name/city inputs are replaced by PropertySelector + branch picker.
    // Click the mock "Select property" button, then pick a branch.
    const { fireEvent } = await import('@testing-library/react')
    const selectPropBtn = screen.getByTestId('pipeline-select-property')
    fireEvent.click(selectPropBtn)

    const branchSelect = screen.getByRole('combobox', { name: /branch/i }) as HTMLSelectElement
    fireEvent.change(branchSelect, { target: { value: '1' } })

    // Submit the form directly (bypass pointer-events: none set by Radix)
    const form = dialog.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    await waitFor(() => {
      expect(postCalled).toBe(true)
    }, { timeout: 3000 })

    expect(postedBody).toMatchObject({
      property_id: 'prop-pipeline-test',
      property_name: 'Test Property',
    })
  })

  it('renders a column Add lead button ONLY on Qualifying (auto-driven stages have none)', async () => {
    render(<PipelinePage />)
    await screen.findByText('Silverleaf HOA')
    // 1 in the page header + 1 on the Qualifying column — the other stages are
    // reached only via the estimate write-back, never by direct creation.
    const addLeadButtons = screen.getAllByRole('button', { name: /add lead/i })
    expect(addLeadButtons).toHaveLength(2)
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
