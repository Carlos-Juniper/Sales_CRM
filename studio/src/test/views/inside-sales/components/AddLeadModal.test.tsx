import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { AddLeadModal } from '@/views/inside-sales/components/AddLeadModal'

// ── Hook mock ─────────────────────────────────────────────────────

const mockCreateLead = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useLeads', () => ({
  useCreateLead: () => ({
    mutateAsync: mockCreateLead,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  }),
}))

beforeEach(() => {
  mockCreateLead.mockClear().mockResolvedValue(undefined)
})

// ── Helpers ───────────────────────────────────────────────────────

function renderModal(onClose = vi.fn()) {
  render(
    <AddLeadModal open={true} defaultStatus="new" onClose={onClose} />,
  )
  return { onClose }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('AddLeadModal — lead type buttons', () => {
  it('renders HOA, commercial, and RFP type buttons', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'HOA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'commercial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RFP' })).toBeInTheDocument()
  })

  it('renders exactly three lead type buttons (no duplicate commercial)', () => {
    renderModal()
    const commercialButtons = screen.getAllByRole('button', { name: 'commercial' })
    expect(commercialButtons).toHaveLength(1)
  })

  it('selecting RFP includes it in the submit payload', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByPlaceholderText(/silverleaf hoa/i), 'Test Property')
    await user.type(screen.getByPlaceholderText(/phoenix/i), 'Tucson')
    await user.click(screen.getByRole('button', { name: 'RFP' }))
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.lead_type).toBe('RFP')
  })
})

describe('AddLeadModal — address field', () => {
  it('renders an address input', () => {
    renderModal()
    expect(screen.getByPlaceholderText(/123 main st/i)).toBeInTheDocument()
  })

  it('address value is included in the submit payload when filled', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByPlaceholderText(/silverleaf hoa/i), 'Test Property')
    await user.type(screen.getByPlaceholderText(/phoenix/i), 'Tucson')
    await user.type(screen.getByPlaceholderText(/123 main st/i), '456 Oak Ave')
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.address).toBe('456 Oak Ave')
  })

  it('address is omitted from payload when left blank', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByPlaceholderText(/silverleaf hoa/i), 'Test Property')
    await user.type(screen.getByPlaceholderText(/phoenix/i), 'Tucson')
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.address).toBeUndefined()
  })
})

describe('AddLeadModal — units field', () => {
  it('renders a units input', () => {
    renderModal()
    expect(screen.getByPlaceholderText(/^240$/i)).toBeInTheDocument()
  })

  it('units value is included in the submit payload when filled', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByPlaceholderText(/silverleaf hoa/i), 'Test Property')
    await user.type(screen.getByPlaceholderText(/phoenix/i), 'Tucson')
    await user.type(screen.getByPlaceholderText(/^240$/i), '320')
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.units).toBe(320)
  })

  it('units is omitted from payload when left blank', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByPlaceholderText(/silverleaf hoa/i), 'Test Property')
    await user.type(screen.getByPlaceholderText(/phoenix/i), 'Tucson')
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.units).toBeUndefined()
  })
})

describe('AddLeadModal — cancel', () => {
  it('"Cancel" button calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
