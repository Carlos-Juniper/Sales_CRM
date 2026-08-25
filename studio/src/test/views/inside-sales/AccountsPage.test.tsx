import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import AccountsPage from '@/views/inside-sales/AccountsPage'
import type { HOAProperty, ManagementCompany } from '@/types/accounts'

// ── Mock the hook ──────────────────────────────────────────────────

const mockCreateHOAProperty = vi.fn().mockResolvedValue(undefined)
const mockCreateManagementCompany = vi.fn().mockResolvedValue(undefined)
const mockPatchHOAProperty = vi.fn().mockResolvedValue(undefined)
const mockPromoteHOAProperty = vi.fn().mockResolvedValue({ id: 'lead-9' })

// Handoff 23 — property engagement mocks: navigation + canonical property
// upsert + lead lookup used by "Create lead" / "Request estimate".
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))

const mockPropertiesCreate = vi.fn()
vi.mock('@/api/estimating', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/estimating')>()
  return {
    ...actual,
    propertiesApi: { ...actual.propertiesApi, create: (...args: unknown[]) => mockPropertiesCreate(...args) },
  }
})

const mockLeadsList = vi.fn()
vi.mock('@/api/leads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/leads')>()
  return {
    ...actual,
    leadsApi: { ...actual.leadsApi, list: (...args: unknown[]) => mockLeadsList(...args) },
  }
})

// Shared mutation shape returned by useMutation hooks
const makemutation = (fn: ReturnType<typeof vi.fn>) => ({
  mutateAsync: fn,
  mutate: fn,
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  data: undefined,
  reset: vi.fn(),
})

const sampleHOAProperty: HOAProperty = {
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

const sampleHOAProperty2: HOAProperty = {
  id: 'h2',
  property_name: "Fiddler's Creek",
  association_name: "Fiddler's Creek Foundation",
  address: '3470 Club Center Blvd',
  city: 'Naples',
  state: 'FL',
  zip: '34114',
  county: 'Collier',
  acreage: 990,
  units: 6000,
  status: 'Bidding',
  contact_status: 'contacted',
  branch: 'Naples',
  assigned_to: 'Marisol Vega',
  last_contacted: '2026-06-02',
  management_company_id: 'pm1',
}

const samplePMCompany: ManagementCompany = {
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

vi.mock('@/hooks/useHOAProperties', () => ({
  useHOAProperties: (params?: { search?: string }) => {
    const all = [sampleHOAProperty, sampleHOAProperty2]
    const data = params?.search
      ? all.filter((p) => p.property_name.toLowerCase().includes(params.search!.toLowerCase()))
      : all
    return { data, isLoading: false, isPending: false, isError: false }
  },
  useHOAFilterOptions: () => ({
    data: { branches: ['Naples', 'Fort Myers'], cities: ['Naples'] },
    isLoading: false,
  }),
  useCreateHOAProperty: () => makemutation(mockCreateHOAProperty),
  usePatchHOAProperty: () => makemutation(mockPatchHOAProperty),
  usePromoteHOAProperty: () => makemutation(mockPromoteHOAProperty),
}))

vi.mock('@/hooks/useManagementCompanies', () => ({
  useManagementCompanies: () => ({
    data: [samplePMCompany],
    isLoading: false,
    isPending: false,
    isError: false,
  }),
  useCreateManagementCompany: () => makemutation(mockCreateManagementCompany),
  usePatchManagementCompany: () => makemutation(vi.fn()),
  useAddPMContact: () => makemutation(vi.fn()),
  useUpdatePMContact: () => makemutation(vi.fn()),
  useDeletePMContact: () => makemutation(vi.fn()),
}))

// ── Tests ─────────────────────────────────────────────────────────

const canonicalProperty = {
  id: 'prop-1',
  name: 'Pelican Bay',
  propertyType: 'hoa',
  sourceType: 'hoa',
  sourceId: 'h1',
  address1: '6620 Pelican Bay Blvd',
  address2: null,
  city: 'Naples',
  state: 'FL',
  zip: '34108',
  branchCity: 'Naples',
  customerType: 'hoa',
  managementCompanyId: 'pm1',
  aspirePropertyId: null,
  aspireSyncStatus: 'unsynced',
  createdAt: null,
  updatedAt: null,
}

const sampleLead = {
  id: 'lead-77',
  property_name: 'Pelican Bay',
  status: 'new',
  assigned_to: 'Marisol Vega',
  score: 65,
  property_id: 'prop-1',
}

function emptyLeadsResponse() {
  return { data: [], total: 0, page: 1, page_size: 25, total_pages: 0 }
}

beforeEach(() => {
  mockCreateHOAProperty.mockClear().mockResolvedValue(undefined)
  mockCreateManagementCompany.mockClear().mockResolvedValue(undefined)
  mockPatchHOAProperty.mockClear().mockResolvedValue(undefined)
  mockPromoteHOAProperty.mockClear().mockResolvedValue({ id: 'lead-9' })
  mockNavigate.mockClear()
  mockPropertiesCreate.mockClear().mockResolvedValue(canonicalProperty)
  mockLeadsList.mockClear().mockResolvedValue(emptyLeadsResponse())
})

describe('AccountsPage — default HOA tab', () => {
  it('renders HOA tab as active by default and shows property rows', () => {
    render(<AccountsPage />)
    expect(screen.getByText('Pelican Bay')).toBeInTheDocument()
    expect(screen.getByText("Fiddler's Creek")).toBeInTheDocument()
  })

  it('renders expected HOA table column headers', () => {
    render(<AccountsPage />)
    expect(screen.getByRole('columnheader', { name: /property/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /management company/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument()
  })
})

describe('AccountsPage — tab switching', () => {
  it('switching to PM tab renders accordion cards with company name', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    const pmTab = screen.getByRole('button', { name: /property management/i })
    await user.click(pmTab)

    expect(await screen.findByText('Alliant Property Management')).toBeInTheDocument()
  })

  it('switching back to HOA tab from PM tab shows properties again', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    await user.click(screen.getByRole('button', { name: /property management/i }))
    await screen.findByText('Alliant Property Management')

    await user.click(screen.getByRole('button', { name: /hoa/i }))

    expect(await screen.findByText('Pelican Bay')).toBeInTheDocument()
  })
})

describe('AccountsPage — search filtering', () => {
  it('search input filters visible HOA rows by property name', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    const searchInput = screen.getByPlaceholderText(/search properties/i)
    await user.type(searchInput, 'Pelican')

    expect(screen.getByText('Pelican Bay')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("Fiddler's Creek")).not.toBeInTheDocument()
    })
  })

  it('search input on PM tab filters company cards by company name', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    await user.click(screen.getByRole('button', { name: /property management/i }))
    await screen.findByText('Alliant Property Management')

    const searchInput = screen.getByPlaceholderText(/search companies/i)
    await user.type(searchInput, 'nonexistent')

    await waitFor(() => {
      expect(screen.queryByText('Alliant Property Management')).not.toBeInTheDocument()
    })
  })

  it('empty state renders when no HOA results match search', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    const searchInput = screen.getByPlaceholderText(/search properties/i)
    await user.type(searchInput, 'zzz_no_match')

    await waitFor(() => {
      expect(screen.getByText(/no properties match/i)).toBeInTheDocument()
    })
  })

  it('empty state renders when no PM results match search', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    await user.click(screen.getByRole('button', { name: /property management/i }))
    await screen.findByText('Alliant Property Management')

    const searchInput = screen.getByPlaceholderText(/search companies/i)
    await user.type(searchInput, 'zzz_no_match')

    await waitFor(() => {
      expect(screen.getByText(/no management companies match/i)).toBeInTheDocument()
    })
  })
})

describe('AccountsPage — Add panels', () => {
  it('"Add property" button on HOA tab opens AddHOAPanel', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    const addBtn = screen.getByRole('button', { name: /add property/i })
    await user.click(addBtn)

    expect(await screen.findByText(/add hoa property/i)).toBeInTheDocument()
  })

  it('"Add company" button on PM tab opens AddPMPanel', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    await user.click(screen.getByRole('button', { name: /property management/i }))
    await screen.findByText('Alliant Property Management')

    const addBtn = screen.getByRole('button', { name: /add company/i })
    await user.click(addBtn)

    expect(await screen.findByText(/add management company/i)).toBeInTheDocument()
  })

  it('"Add property" button label changes to "Add company" on PM tab', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    expect(screen.getByRole('button', { name: /add property/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /property management/i }))

    expect(await screen.findByRole('button', { name: /add company/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add property/i })).not.toBeInTheDocument()
  })
})

describe('AccountsPage — filter badge and clear', () => {
  it('filter badge shows count when a filter is active', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    // Open the Status filter dropdown and select one option
    const statusFilter = screen.getByRole('button', { name: /status/i })
    await user.click(statusFilter)

    const activeOption = await screen.findByRole('button', { name: /active/i })
    await user.click(activeOption)

    // Badge count of 1 should appear on the Status filter button
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('"Clear all" button removes all active filters', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)

    const statusFilter = screen.getByRole('button', { name: /status/i })
    await user.click(statusFilter)
    const activeOption = await screen.findByRole('button', { name: /active/i })
    await user.click(activeOption)

    // Close dropdown by clicking elsewhere
    await user.keyboard('{Escape}')

    const clearAll = await screen.findByRole('button', { name: /clear all/i })
    await user.click(clearAll)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
    })
  })
})

// ── Handoff 23 — Property engagement: Create lead & Request estimate ─────────

async function openDetailPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Pelican Bay'))
  return screen.findByRole('button', { name: /request estimate/i })
}

describe('AccountsPage — Create lead from a property (Handoff 23)', () => {
  it('"Create lead" promotes the HOA (find-or-create property + lead) and routes to leads', async () => {
    const user = userEvent.setup()
    render(<AccountsPage />)
    await openDetailPanel(user)

    await user.click(screen.getByRole('button', { name: /create lead/i }))

    await waitFor(() => expect(mockPromoteHOAProperty).toHaveBeenCalledWith('h1'))
    expect(mockNavigate).toHaveBeenCalledWith('/inside-sales/leads')
  })
})

describe('AccountsPage — Request estimate gating (Handoff 23 §1a)', () => {
  it('blocks "Request estimate" when the property has no lead and prompts create-lead-first', async () => {
    const user = userEvent.setup()
    mockLeadsList.mockResolvedValue(emptyLeadsResponse())
    render(<AccountsPage />)
    await openDetailPanel(user)

    await user.click(screen.getByRole('button', { name: /request estimate/i }))

    // Lead lookup is keyed by the canonical property id
    await waitFor(() =>
      expect(mockLeadsList).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'prop-1' })),
    )
    // Gate prompt appears; no navigation to estimating
    expect(await screen.findByText(/create a lead first/i)).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalledWith('/inside-sales/estimating', expect.anything())
  })

  it('the gate prompt offers "Create lead" which promotes and routes to leads', async () => {
    const user = userEvent.setup()
    mockLeadsList.mockResolvedValue(emptyLeadsResponse())
    render(<AccountsPage />)
    await openDetailPanel(user)

    await user.click(screen.getByRole('button', { name: /request estimate/i }))
    await screen.findByText(/create a lead first/i)

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /create lead/i }))

    await waitFor(() => expect(mockPromoteHOAProperty).toHaveBeenCalledWith('h1'))
    expect(mockNavigate).toHaveBeenCalledWith('/inside-sales/leads')
  })

  it('once a lead exists, "Request estimate" navigates to estimating with the property AND real lead context', async () => {
    const user = userEvent.setup()
    mockLeadsList.mockResolvedValue({
      data: [sampleLead], total: 1, page: 1, page_size: 25, total_pages: 1,
    })
    render(<AccountsPage />)
    await openDetailPanel(user)

    await user.click(screen.getByRole('button', { name: /request estimate/i }))

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/inside-sales/estimating', {
        state: {
          requestEstimateProperty: expect.objectContaining({ id: 'prop-1' }),
          requestEstimateLead: expect.objectContaining({ id: 'lead-77' }),
        },
      }),
    )
    // Property was upserted (idempotent on sourceType/sourceId), never re-created blindly
    expect(mockPropertiesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'hoa', sourceId: 'h1', propertyType: 'hoa' }),
    )
  })
})
