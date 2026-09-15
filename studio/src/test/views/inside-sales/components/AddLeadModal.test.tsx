import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { AddLeadModal } from '@/views/inside-sales/components/AddLeadModal'
import type { Property } from '@/types/estimating'

// ── Hook mocks ────────────────────────────────────────────────────

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

const mockBranches = [
  { aspireBranchId: 1, branchName: 'Fort Myers', city: 'Fort Myers' },
  { aspireBranchId: 2, branchName: 'Tampa North', city: 'Tampa North' },
]

vi.mock('@/hooks/useBranchList', () => ({
  useBranchList: () => ({
    data: mockBranches,
    isLoading: false,
    isError: false,
  }),
}))

// PropertySelector mock: renders a simple button to simulate property selection.
// Tests that need a selected property click this button; tests that don't leave
// it unclicked to exercise the "no property" validation path.
const mockProperty: Property = {
  id: 'prop-test-1',
  name: 'Coral Bay HOA',
  address1: '123 Coral Way',
  address2: null,
  city: 'Fort Myers',
  state: 'FL',
  zip: null,
  branchCity: null,
  customerType: null,
  managementCompanyId: null,
  aspirePropertyId: null,
  aspireSyncStatus: 'pending',
  createdAt: null,
  updatedAt: null,
}

vi.mock('@/views/inside-sales/components/estimating/PropertySelector', () => ({
  PropertySelector: ({ value, onSelect }: { value: Property | null; onSelect: (p: Property | null) => void }) => (
    <div>
      {value ? (
        <span data-testid="property-selected">{value.name}</span>
      ) : (
        <button
          type="button"
          data-testid="mock-select-property"
          onClick={() => onSelect(mockProperty)}
        >
          Select property
        </button>
      )}
    </div>
  ),
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
  it('renders HOA, commercial, deathcare, and resort type buttons', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'HOA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'commercial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'deathcare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resort' })).toBeInTheDocument()
  })

  it('renders exactly four lead type buttons (no duplicate commercial)', () => {
    renderModal()
    const commercialButtons = screen.getAllByRole('button', { name: 'commercial' })
    expect(commercialButtons).toHaveLength(1)
  })

  it('selecting deathcare includes it in the submit payload', async () => {
    const user = userEvent.setup()
    renderModal()

    // Select property and branch to enable submission
    await user.click(screen.getByTestId('mock-select-property'))
    await user.selectOptions(screen.getByRole('combobox', { name: /branch/i }), '1')
    await user.click(screen.getByRole('button', { name: 'deathcare' }))
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.lead_type).toBe('deathcare')
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

    await user.click(screen.getByTestId('mock-select-property'))
    await user.selectOptions(screen.getByRole('combobox', { name: /branch/i }), '1')
    await user.type(screen.getByPlaceholderText(/^240$/i), '320')
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.units).toBe(320)
  })

  it('units is omitted from payload when left blank', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByTestId('mock-select-property'))
    await user.selectOptions(screen.getByRole('combobox', { name: /branch/i }), '1')
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.units).toBeUndefined()
  })
})

describe('AddLeadModal — accessibility (Handoff 49 §6.2)', () => {
  it('renders a DialogDescription so DialogContent is described', () => {
    const { container } = render(
      <AddLeadModal open={true} defaultStatus="new" onClose={vi.fn()} />,
    )
    // Radix wires aria-describedby to the description element's id.
    const content = container.ownerDocument.querySelector('[role="dialog"]')
    expect(content?.getAttribute('aria-describedby')).toBeTruthy()
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

// ── WS1: branch picker + property selector tests ──────────────────

describe('AddLeadModal — WS1 branch picker', () => {
  it('branch dropdown renders with options from useBranchList', () => {
    renderModal()
    const select = screen.getByRole('combobox', { name: /branch/i })
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Fort Myers')).toBeInTheDocument()
    expect(screen.getByText('Tampa North')).toBeInTheDocument()
  })

  it('has a default empty "Select branch" option', () => {
    renderModal()
    const select = screen.getByRole('combobox', { name: /branch/i }) as HTMLSelectElement
    expect(select.value).toBe('')
  })
})

describe('AddLeadModal — WS1 property required', () => {
  it('submit without selecting a property keeps button enabled but mutateAsync is not called when no property', async () => {
    const user = userEvent.setup()
    renderModal()
    // Select a branch but do NOT select a property
    const select = screen.getByRole('combobox', { name: /branch/i })
    await user.selectOptions(select, '1')

    await user.click(screen.getByRole('button', { name: /add lead/i }))
    // Should not have submitted without a property
    expect(mockCreateLead).not.toHaveBeenCalled()
  })

  it('shows a property-required validation message when submitting without a property', async () => {
    const user = userEvent.setup()
    renderModal()
    const select = screen.getByRole('combobox', { name: /branch/i })
    await user.selectOptions(select, '1')

    await user.click(screen.getByRole('button', { name: /add lead/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('AddLeadModal — WS1 submit sends branch_id', () => {
  it('selecting a branch + property and submitting calls createLead with branch_id and property_id', async () => {
    const user = userEvent.setup()
    renderModal()

    // Select property via mock button
    await user.click(screen.getByTestId('mock-select-property'))
    // Select branch
    const select = screen.getByRole('combobox', { name: /branch/i })
    await user.selectOptions(select, '1')

    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.property_id).toBe('prop-test-1')
    expect(payload.branch_id).toBe('1')
  })
})
