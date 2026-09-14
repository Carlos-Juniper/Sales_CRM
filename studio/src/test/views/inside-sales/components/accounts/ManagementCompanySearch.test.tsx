import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act, fireEvent } from '@testing-library/react'
import { render } from '@/test/utils'
import { ManagementCompanySearch } from '@/views/inside-sales/components/accounts/ManagementCompanySearch'
import type { ManagementCompany } from '@/types/accounts'

// ── Hook mock ──────────────────────────────────────────────────────

const mockUseSearch = vi.fn()

vi.mock('@/hooks/useManagementCompanies', () => ({
  useManagementCompanySearch: (term: string) => mockUseSearch(term),
}))

const sampleCompanies: ManagementCompany[] = [
  {
    id: 'pm1',
    company_name: 'Leland Management',
    website: null,
    phone: null,
    street: null,
    city: null,
    state: null,
    zip: null,
    primary_email: null,
    branch_id: null,
    assigned_to: null,
    status: 'Partner',
    contact_status: 'contacted',
    last_contacted: null,
    contacts: [],
  },
  {
    id: 'pm2',
    company_name: 'Leland & Associates',
    website: null,
    phone: null,
    street: null,
    city: null,
    state: null,
    zip: null,
    primary_email: null,
    branch_id: null,
    assigned_to: null,
    status: 'Partner',
    contact_status: 'contacted',
    last_contacted: null,
    contacts: [],
  },
]

function makeQueryResult(overrides: {
  data?: ManagementCompany[]
  isLoading?: boolean
} = {}) {
  return {
    data: overrides.data ?? [],
    isLoading: overrides.isLoading ?? false,
    isError: false,
    error: null,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockUseSearch.mockReturnValue(makeQueryResult())
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ── Tests ──────────────────────────────────────────────────────────

describe('ManagementCompanySearch', () => {
  it('renders without crashing', () => {
    render(<ManagementCompanySearch value={null} onSelect={vi.fn()} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('calls useManagementCompanySearch with typed term after debounce', () => {
    render(<ManagementCompanySearch value={null} onSelect={vi.fn()} />)

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Leland' } })

    // Before debounce, hook is still called with '' (the initial searchTerm)
    // After 300ms, it should be called with 'Leland'
    act(() => { vi.advanceTimersByTime(300) })

    expect(mockUseSearch).toHaveBeenCalledWith('Leland')
  })

  it('shows results from hook in dropdown after typing', async () => {
    mockUseSearch.mockReturnValue(makeQueryResult({ data: sampleCompanies }))

    render(<ManagementCompanySearch value={null} onSelect={vi.fn()} />)

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Leland' } })

    act(() => { vi.advanceTimersByTime(300) })

    await waitFor(() => {
      expect(screen.getByText('Leland Management')).toBeInTheDocument()
      expect(screen.getByText('Leland & Associates')).toBeInTheDocument()
    })
  })

  it('calls onSelect with management_company_id when a result is clicked', async () => {
    mockUseSearch.mockReturnValue(makeQueryResult({ data: sampleCompanies }))
    const onSelect = vi.fn()

    render(<ManagementCompanySearch value={null} onSelect={onSelect} />)

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Leland' } })
    act(() => { vi.advanceTimersByTime(300) })

    await waitFor(() => expect(screen.getByText('Leland Management')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Leland Management'))

    expect(onSelect).toHaveBeenCalledWith('pm1')
  })

  it('calls onSelect with null when Self-managed is clicked', async () => {
    mockUseSearch.mockReturnValue(makeQueryResult({ data: sampleCompanies }))
    const onSelect = vi.fn()

    render(<ManagementCompanySearch value={null} onSelect={onSelect} />)

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'L' } })
    act(() => { vi.advanceTimersByTime(300) })

    await waitFor(() => expect(screen.getByText(/self-managed/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/self-managed/i))

    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('shows loading spinner while fetching', async () => {
    mockUseSearch.mockReturnValue(makeQueryResult({ isLoading: true }))

    render(<ManagementCompanySearch value={null} onSelect={vi.fn()} />)

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Lel' } })
    act(() => { vi.advanceTimersByTime(300) })

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
  })

  it('shows no-results message when search returns empty and term >= 1 char', async () => {
    // simulate: user typed, debounce fired, hook returned empty array
    mockUseSearch.mockImplementation((term: string) =>
      makeQueryResult({ data: term.length >= 1 ? [] : undefined }),
    )

    render(<ManagementCompanySearch value={null} onSelect={vi.fn()} />)

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'xyz' } })
    act(() => { vi.advanceTimersByTime(300) })

    await waitFor(() => expect(screen.getByText(/no results/i)).toBeInTheDocument())
  })
})
