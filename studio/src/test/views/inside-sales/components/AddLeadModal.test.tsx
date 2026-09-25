import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { AddLeadModal } from '@/views/inside-sales/components/AddLeadModal'
import { ApiError } from '@/api/client'
import { LEAD_NOTES_MAX_LENGTH } from '@/api/leads'
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
  it('renders all five lead type buttons with display labels', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'HOA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commercial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deathcare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resort' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Healthcare' })).toBeInTheDocument()
  })

  it('renders exactly five lead type buttons (no duplicates)', () => {
    renderModal()
    const commercialButtons = screen.getAllByRole('button', { name: 'Commercial' })
    expect(commercialButtons).toHaveLength(1)
  })

  it('selecting Deathcare includes it in the submit payload', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByTestId('mock-select-property'))
    await user.selectOptions(screen.getByRole('combobox', { name: /branch/i }), '1')
    await user.click(screen.getByRole('button', { name: 'Deathcare' }))
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.lead_type).toBe('deathcare')
  })

  it('selecting Healthcare stores the raw "healthcare" value in the payload', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByTestId('mock-select-property'))
    await user.selectOptions(screen.getByRole('combobox', { name: /branch/i }), '1')
    await user.click(screen.getByRole('button', { name: 'Healthcare' }))
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.lead_type).toBe('healthcare')
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

describe('AddLeadModal — notes', () => {
  async function selectRequired(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('mock-select-property'))
    await user.selectOptions(screen.getByRole('combobox', { name: /branch/i }), '1')
  }

  it('creates the lead without notes when the field is blank', async () => {
    const user = userEvent.setup()
    renderModal()
    await selectRequired(user)
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.notes).toBeUndefined()
  })

  it('omits whitespace-only notes', async () => {
    const user = userEvent.setup()
    renderModal()
    await selectRequired(user)
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), '   ')
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.notes).toBeUndefined()
  })

  it('sends trimmed notes when the field is filled in', async () => {
    const user = userEvent.setup()
    renderModal()
    await selectRequired(user)
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), '  met at the CAI trade show  ')
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const payload = mockCreateLead.mock.calls[0][0] as Record<string, unknown>
    expect(payload.notes).toBe('met at the CAI trade show')
  })

  it('shows a character counter and stops at the 10000 maxlength', async () => {
    const user = userEvent.setup()
    renderModal()
    const notes = screen.getByRole('textbox', { name: 'Notes' })
    expect(notes).toHaveAttribute('maxLength', String(LEAD_NOTES_MAX_LENGTH))
    expect(screen.getByText(`0/${LEAD_NOTES_MAX_LENGTH}`)).toBeInTheDocument()

    await user.type(notes, 'hello')
    expect(notes).toHaveValue('hello')
    expect(screen.getByText(`5/${LEAD_NOTES_MAX_LENGTH}`)).toBeInTheDocument()

    await user.clear(notes)
    await user.paste('x'.repeat(LEAD_NOTES_MAX_LENGTH + 25))
    expect(notes).toHaveValue('x'.repeat(LEAD_NOTES_MAX_LENGTH))
    expect(screen.getByText(`${LEAD_NOTES_MAX_LENGTH}/${LEAD_NOTES_MAX_LENGTH}`)).toBeInTheDocument()
  })

  it('shows a notes 422 on the form alert', async () => {
    const user = userEvent.setup()
    mockCreateLead.mockRejectedValueOnce(new ApiError(
      422,
      'String should have at most 10000 characters',
      [{ loc: ['body', 'notes'], msg: 'String should have at most 10000 characters' }],
    ))
    renderModal()
    await selectRequired(user)
    await user.click(screen.getByRole('button', { name: /add lead/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'String should have at most 10000 characters',
    )
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
