import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { HOADetailPanel } from '@/views/inside-sales/components/accounts/HOADetailPanel'
import type { HOAProperty, ManagementCompany } from '@/types/accounts'

// ── Hook mock ─────────────────────────────────────────────────────

const mockPatchHOAProperty = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useHOAProperties', () => ({
  usePatchHOAProperty: () => ({
    mutateAsync: mockPatchHOAProperty,
    mutate: mockPatchHOAProperty,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  }),
}))

beforeEach(() => {
  mockPatchHOAProperty.mockClear().mockResolvedValue(undefined)
})

// ── Fixtures ──────────────────────────────────────────────────────

const sampleProperty: HOAProperty = {
  id: 'h1',
  property_name: 'Pelican Bay',
  association_name: 'Pelican Bay Foundation, Inc.',
  address: '6620 Pelican Bay Blvd',
  city: 'Naples',
  state: 'FL',
  zip: '34108',
  county: 'Collier',
  acreage: 570,
  units: 6800,
  status: 'Active',
  contact_status: 'contacted',
  branch: 'Naples',
  assigned_to: 'Marisol Vega',
  last_contacted: '2026-05-20',
  management_company_id: 'pm1',
}

const sampleCompany: ManagementCompany = {
  id: 'pm1',
  company_name: 'Alliant Property Management',
  website: 'www.alliantproperty.com',
  phone: '(239) 454-1101',
  street: '13831 Vector Ave',
  city: 'Fort Myers',
  state: 'FL',
  zip: '33907',
  primary_email: 'service@alliantproperty.com',
  branch_id: 'b1',
  assigned_to: 'Trent Boyd',
  status: 'Partner',
  contact_status: 'contacted',
  last_contacted: '2026-05-30',
  contacts: [
    { id: 'c1', name: 'Dana Whitfield', title: 'Community Association Manager', email: 'dwhitfield@alliantproperty.com', phone: '(239) 454-1108' },
  ],
}

function renderPanel({
  property = sampleProperty,
  company = sampleCompany as ManagementCompany | null,
  managementCompanies = [sampleCompany],
  onClose = vi.fn(),
  onCreateBid = vi.fn(),
  onCreateLead = vi.fn(),
  onRequestEstimate = vi.fn(),
} = {}) {
  render(
    <HOADetailPanel
      property={property}
      company={company}
      managementCompanies={managementCompanies}
      isOpen={true}
      onClose={onClose}
      onCreateBid={onCreateBid}
      onCreateLead={onCreateLead}
      onRequestEstimate={onRequestEstimate}
    />,
  )
  return { onClose, onCreateBid, onCreateLead, onRequestEstimate }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('HOADetailPanel — property details', () => {
  it('renders the property name as the panel title', () => {
    renderPanel()
    expect(screen.getByText('Pelican Bay')).toBeInTheDocument()
  })

  it('renders the management company name in the "Managed by" section', () => {
    renderPanel()
    expect(screen.getByText('Alliant Property Management')).toBeInTheDocument()
  })

  it('renders "Self-managed" message when company is null', () => {
    renderPanel({ company: null })
    expect(screen.getByText(/self-managed/i)).toBeInTheDocument()
  })

  it('renders acreage, units, and county in the metrics section', () => {
    renderPanel()
    expect(screen.getByText('570 ac')).toBeInTheDocument()
    expect(screen.getByText('6,800')).toBeInTheDocument()
    expect(screen.getByText('Collier')).toBeInTheDocument()
  })
})

describe('HOADetailPanel — property engagement actions (Handoff 15)', () => {
  it('renders "Create lead" and "Request estimate" actions in the footer', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /create lead/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request estimate/i })).toBeInTheDocument()
  })

  it('clicking "Create lead" reports the HOA property to the parent', async () => {
    const user = userEvent.setup()
    const { onCreateLead } = renderPanel()
    await user.click(screen.getByRole('button', { name: /create lead/i }))
    expect(onCreateLead).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))
  })

  it('clicking "Request estimate" reports the HOA property to the parent', async () => {
    const user = userEvent.setup()
    const { onRequestEstimate } = renderPanel()
    await user.click(screen.getByRole('button', { name: /request estimate/i }))
    expect(onRequestEstimate).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))
  })
})

describe('HOADetailPanel — edit button', () => {
  it('renders an "Edit property" button in the panel header', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /edit property/i })).toBeInTheDocument()
  })

  it('clicking "Edit property" opens the AddHOAPanel in edit mode', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /edit property/i }))

    expect(await screen.findByText(/edit hoa property/i)).toBeInTheDocument()
  })

  it('the edit panel is pre-filled with the current property name', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /edit property/i }))

    await screen.findByText(/edit hoa property/i)
    const nameInput = screen.getByTestId('property-name-input') as HTMLInputElement
    expect(nameInput.value).toBe('Pelican Bay')
  })

  it('the edit panel is pre-filled with the current address', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /edit property/i }))

    await screen.findByText(/edit hoa property/i)
    const addressInput = screen.getByPlaceholderText(/6620 pelican bay blvd/i) as HTMLInputElement
    expect(addressInput.value).toBe('6620 Pelican Bay Blvd')
  })

  it('shows "Save changes" submit button inside the opened edit panel', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /edit property/i }))

    expect(await screen.findByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('submitting the edit panel calls patchHOAProperty with the correct id and payload', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /edit property/i }))
    await screen.findByText(/edit hoa property/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockPatchHOAProperty).toHaveBeenCalledTimes(1))
    const callArgs = mockPatchHOAProperty.mock.calls[0][0] as { id: string; body: Record<string, unknown> }
    expect(callArgs.id).toBe('h1')
    expect(callArgs.body.property_name).toBe('Pelican Bay')
  })

  it('the edit panel closes after a successful save', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /edit property/i }))
    await screen.findByText(/edit hoa property/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(screen.queryByText(/edit hoa property/i)).not.toBeInTheDocument()
    })
  })
})
