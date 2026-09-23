// ---------------------------------------------------------------------------
// ProposalBuilder — Form step tests
//
// Conventions follow ApprovalHandoff.test.tsx: render + createWrapper, mocked
// hooks (vi.mock) and apiClient so the form is tested in isolation without
// needing MSW proposal endpoints wired in handlers.ts.
//
// Test groups:
//  1. Optional sections — default OFF; checking reveals related inputs
//  2. 30-60-90 rows — appear only when startup_plan_30_60_90 is checked
//  3. Org chart — toggle, optional manager IDs produce null not empty string
//  4. Submit — builds correct payload and calls useCreateProposal
//  5. Reopen (proposalId) — hydrates form from useProposal
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import type { Lead } from '@/types'
import type { Estimate } from '@/types/estimating'
import type {
  TeamMember,
  ClientReference,
  PortfolioProperty,
  ProposalRequest,
} from '@/types/proposal'
import { ProposalBuilder } from '@/views/inside-sales/components/estimating/ProposalBuilder'

// ---------------------------------------------------------------------------
// Mock all proposal hooks so tests don't need MSW proposal handlers.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useProposals', () => ({
  PROPOSAL_PACKAGES_KEY: 'proposals',
  useTeamMembers: vi.fn(),
  useClientReferences: vi.fn(),
  usePortfolio: vi.fn(),
  useProposal: vi.fn(),
  useCreateProposal: vi.fn(),
  useUpdateProposal: vi.fn(),
  // Still stubbed because the module is mocked wholesale — the builder itself no
  // longer renders ProposalPreview (that moved to /proposals/:id/preview), so
  // nothing here calls them.
  useProposalConfig: vi.fn(),
  useProposalMediaUrl: vi.fn(),
}))

// Submitting hands off to the full-screen preview route, so navigation is the
// observable outcome. Everything else in react-router-dom stays real — the test
// wrapper's MemoryRouter still has to work.
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// ProposalDocumentsSection (rendered unconditionally by the form) hits
// estimatingApi.listAttachments directly rather than through a mocked hook —
// stub it so it resolves cleanly instead of 404ing against the mock estimate
// id and rendering its own "Failed to load attachments" alert, which would
// otherwise collide with this file's bare getByRole('alert') assertions.
vi.mock('@/api/estimating', async () => {
  const actual = await vi.importActual<typeof import('@/api/estimating')>('@/api/estimating')
  return { ...actual, estimatingApi: { ...actual.estimatingApi, listAttachments: vi.fn().mockResolvedValue([]) } }
})

import {
  useTeamMembers,
  useClientReferences,
  usePortfolio,
  useProposal,
  useCreateProposal,
  useUpdateProposal,
  useProposalConfig,
  useProposalMediaUrl,
} from '@/hooks/useProposals'

const mockUseTeamMembers = useTeamMembers as MockedFunction<typeof useTeamMembers>
const mockUseClientReferences = useClientReferences as MockedFunction<typeof useClientReferences>
const mockUsePortfolio = usePortfolio as MockedFunction<typeof usePortfolio>
const mockUseProposal = useProposal as MockedFunction<typeof useProposal>
const mockUseCreateProposal = useCreateProposal as MockedFunction<typeof useCreateProposal>
const mockUseUpdateProposal = useUpdateProposal as MockedFunction<typeof useUpdateProposal>
const mockUseProposalConfig = useProposalConfig as MockedFunction<typeof useProposalConfig>
const mockUseProposalMediaUrl = useProposalMediaUrl as MockedFunction<typeof useProposalMediaUrl>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockLead: Lead = {
  id: 'lead-001',
  property_name: 'Coral Bay HOA',
  address: '123 Coral Way',
  city: 'Fort Myers',
  state: 'FL',
  zip: '33901',
  lat: 26.6519,
  lng: -81.7718,
  lead_type: 'HOA',
  score: 88,
  score_factors: [],
  estimated_acreage: 45,
  estimated_contract_value: 185000,
  contact_name: 'Jennifer Walsh',
  contact_email: 'jwalsh@coralbay.org',
  contact_linkedin: null,
  current_provider: 'TruGreen',
  source: 'manual',
  source_url: null,
  bid_deadline: null,
  status: 'approved',
  assigned_to: null,
  notes: null,
  handoff_notes: null,
  ai_linkedin_draft: null,
  branch_id: 'b1',
  distance_miles: 5.2,
  aspire_opportunity_id: null,
  division_id: null,
  property_id: 'prop-coral-bay',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-26T10:00:00Z',
}

const mockEstimate: Estimate = {
  id: 'est-001',
  name: 'Coral Bay HOA',
  estimateType: 'maintenance',
  status: 'approved',
  leadId: 'lead-001',
  branch: 'Fort Myers, FL',
  contractValueCents: 18500000,
  acreage: 45,
  sections: [],
  notes: null,
  crmRep: null,
  assignedLsEstimator: null,
  assignedIrrEstimator: null,
  aspireNumber: null,
  aspireOpportunityId: null,
  aspireSyncStatus: 'synced',
  aspireOwner: 'crm',
  lifecycle: 'won',
  siteWalkDate: null,
  dueBackDate: null,
  clientName: 'Coral Bay HOA',
  approvalSettings: null,
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-26T10:00:00Z',
}

const mockAccountManager: TeamMember = {
  id: 'tm-am-001',
  name: 'Alice Johnson',
  title: 'account_manager',
  teamType: 'branch',
  aspireBranchId: 3696,
  userId: 'u1',
  location: 'Fort Myers, FL',
  bio: 'Account manager bio.',
  headshotObjectKey: null,
  active: true,
  sortOrder: 1,
}

const mockAgronomyManager: TeamMember = {
  id: 'tm-agro-001',
  name: 'Bob Green',
  title: 'agronomy_manager',
  teamType: 'branch',
  aspireBranchId: 3696,
  userId: null,
  location: 'Fort Myers, FL',
  bio: '',
  headshotObjectKey: null,
  active: true,
  sortOrder: 2,
}

const mockIrrigationManager: TeamMember = {
  id: 'tm-irr-001',
  name: 'Carol Blue',
  title: 'irrigation_manager',
  teamType: 'branch',
  aspireBranchId: 3696,
  userId: null,
  location: 'Fort Myers, FL',
  bio: '',
  headshotObjectKey: null,
  active: true,
  sortOrder: 3,
}

const mockExecutiveMember: TeamMember = {
  id: 'tm-exec-001',
  name: 'Dave CEO',
  title: 'executive',
  teamType: 'executive',
  aspireBranchId: null,
  userId: 'u-exec',
  location: 'Naples, FL',
  bio: 'CEO bio.',
  headshotObjectKey: null,
  active: true,
  sortOrder: 1,
}

const mockClientRef: ClientReference = {
  id: 'cr-001',
  aspireBranchId: null,
  propertyName: 'Coral Bay HOA',
  servicesProvided: 'Landscape Maintenance',
  contactName: 'Bob Smith',
  contactTitle: 'Property Manager',
  phone: '239-555-0100',
  email: 'bob@coralbay.com',
  address: '123 Coral Way, Fort Myers, FL 33901',
  clientSinceYear: 2018,
  active: true,
}

const mockPortfolioProperty: PortfolioProperty = {
  id: 'pp-001',
  name: 'Pointe Jupiter Yacht Club',
  cityState: 'Jupiter, FL',
  regionId: 'east-coast',
  photoObjectKeys: ['portfolio/pjyc-1.jpg'],
  sortOrder: 1,
}

const mockSavedProposal: ProposalRequest = {
  id: 'prop-existing',
  leadId: 'lead-001',
  estimateId: 'est-001',
  createdBy: 'user-001',
  sections: ['startup_plan_30_60_90', 'juniper_sync'],
  orgChart: {
    included: true,
    accountManagerIds: ['tm-am-001'],
    agronomyManagerName: null,
    irrigationManagerName: null,
    productionManagerName: null,
    crewCounts: {
      mow: { foremen: 1, members: 4 },
      prune: { foremen: 0, members: 0 },
      fertIpm: { members: 2 },
      irrigation: { members: 1 },
    },
  },
  startupPlan: {
    included: true,
    planMaxDays: 90,
    day60: ['Establish mowing schedule'],
    day90: ['Review fertilization program'],
    day120Plus: [],
    ongoing: [],
  },
  teamMemberIds: ['tm-am-001'],
  executiveTeamMemberIds: ['tm-exec-001'],
  clientReferenceIds: ['cr-001'],
  portfolioPropertyIds: ['pp-001'],
  signerUserId: 'user-001',
  createdAt: '2026-08-26T10:00:00Z',
  updatedAt: '2026-08-26T10:00:00Z',
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/** Returns a mutation mock with a controllable mutateAsync. */
function makeMutation(overrides?: Partial<ReturnType<typeof useCreateProposal>>) {
  const mutateAsync = vi.fn().mockResolvedValue({ ...mockSavedProposal, id: 'prop-new' })
  return {
    mutateAsync,
    isPending: false,
    isError: false,
    isSuccess: false,
    ...overrides,
  } as unknown as ReturnType<typeof useCreateProposal>
}

function setupDefaultMocks() {
  mockUseTeamMembers.mockImplementation((params) => {
    // Return executive members when teamType is 'executive'; branch members otherwise.
    const data =
      params?.teamType === 'executive'
        ? [mockExecutiveMember]
        : [mockAccountManager, mockAgronomyManager, mockIrrigationManager]
    return { data, isLoading: false, isError: false } as ReturnType<typeof useTeamMembers>
  })
  mockUseClientReferences.mockReturnValue({
    data: [mockClientRef],
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useClientReferences>)
  mockUsePortfolio.mockReturnValue({
    data: [mockPortfolioProperty],
    isLoading: false,
    isError: false,
  } as ReturnType<typeof usePortfolio>)
  mockUseProposal.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useProposal>)
  mockUseCreateProposal.mockReturnValue(makeMutation())
  mockUseUpdateProposal.mockReturnValue(makeMutation() as unknown as ReturnType<typeof useUpdateProposal>)
  // Stubs for ProposalPreview (rendered in the preview step)
  mockUseProposalConfig.mockReturnValue({
    branches: [],
    insurance: null,
    loaded: true,
  })
  mockUseProposalMediaUrl.mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof useProposalMediaUrl>)
}

beforeEach(() => {
  useAuthStore.setState({
    user: makeUser({ id: 'user-001', name: 'Test Rep', role: 'inside_sales' }),
  })
  mockNavigate.mockClear()
  setupDefaultMocks()
})

// ---------------------------------------------------------------------------
// 1. Optional sections — default OFF
// ---------------------------------------------------------------------------

describe('ProposalBuilder — optional sections', () => {
  it('all six optional sections default OFF', () => {
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    const optionalSections = screen.getByTestId('optional-sections')
    const checkboxes = within(optionalSections).getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(6)
    for (const cb of checkboxes) {
      expect(cb).not.toBeChecked()
    }
  })

  it('checking Juniper Sync shows it as selected but does not reveal startup-plan inputs', async () => {
    const user = userEvent.setup()
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('section-checkbox-juniper_sync'))
    expect(screen.getByTestId('section-checkbox-juniper_sync')).toBeChecked()
    expect(screen.queryByTestId('startup-plan-section')).not.toBeInTheDocument()
  })

  it('checking "Meet Our Team — Executive" reveals the executive team picker', async () => {
    const user = userEvent.setup()
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    expect(screen.queryByTestId('executive-team-section')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('section-checkbox-meet_our_team_executive'))
    expect(screen.getByTestId('executive-team-section')).toBeInTheDocument()
  })

  it('unchecking a section hides its related inputs', async () => {
    const user = userEvent.setup()
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('section-checkbox-startup_plan_30_60_90'))
    expect(screen.getByTestId('startup-plan-section')).toBeInTheDocument()

    await user.click(screen.getByTestId('section-checkbox-startup_plan_30_60_90'))
    expect(screen.queryByTestId('startup-plan-section')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 2. 30-60-90 rows — appear only when startup_plan_30_60_90 is checked
// ---------------------------------------------------------------------------

describe('ProposalBuilder — 30-60-90 day inputs', () => {
  it('startup-plan section is hidden when startup_plan_30_60_90 is not checked', () => {
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)
    expect(screen.queryByTestId('startup-plan-section')).not.toBeInTheDocument()
  })

  it('startup-plan section appears when startup_plan_30_60_90 is checked', async () => {
    const user = userEvent.setup()
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('section-checkbox-startup_plan_30_60_90'))
    expect(screen.getByTestId('startup-plan-section')).toBeInTheDocument()
    // The plan length defaults to 30 days, so only Ongoing is editable until a longer plan is chosen.
    expect(screen.getByTestId('startup-ongoing')).toBeInTheDocument()
    expect(screen.queryByTestId('startup-day60')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('startup-max-days-120'))
    expect(screen.getByTestId('startup-day60')).toBeInTheDocument()
    expect(screen.getByTestId('startup-day90')).toBeInTheDocument()
    expect(screen.getByTestId('startup-day120plus')).toBeInTheDocument()
  })

  it('can add Day 60 bullet points', async () => {
    const user = userEvent.setup()
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('section-checkbox-startup_plan_30_60_90'))
    await user.click(screen.getByTestId('startup-max-days-60'))
    const addBtn = within(screen.getByTestId('startup-day60')).getByRole('button', {
      name: /add bullet/i,
    })
    await user.click(addBtn)
    const inputs = within(screen.getByTestId('startup-day60')).getAllByRole('textbox')
    expect(inputs).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 3. Org chart — toggle; optional manager IDs produce null not empty string
// ---------------------------------------------------------------------------

describe('ProposalBuilder — org chart', () => {
  it('org chart inputs are hidden when the toggle is off (default)', () => {
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)
    expect(screen.getByTestId('org-chart-toggle')).not.toBeChecked()
    expect(screen.queryByTestId('org-chart-inputs')).not.toBeInTheDocument()
  })

  it('org chart inputs appear when the toggle is turned on', async () => {
    const user = userEvent.setup()
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('org-chart-toggle'))
    expect(screen.getByTestId('org-chart-inputs')).toBeInTheDocument()
    // Account manager list, optional free-text roles, crew counts
    expect(screen.getByTestId('account-manager-list')).toBeInTheDocument()
    expect(screen.getByTestId('agronomy-manager-input')).toBeInTheDocument()
    expect(screen.getByTestId('irrigation-manager-input')).toBeInTheDocument()
    expect(screen.getByTestId('crew-mow-foremen')).toBeInTheDocument()
  })

  it('omitting Agronomy Manager leaves agronomyManagerName as null (not empty string)', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ ...mockSavedProposal })
    mockUseCreateProposal.mockReturnValue(makeMutation({ mutateAsync }))

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    // Enable org chart but do NOT type an agronomy manager name
    await user.click(screen.getByTestId('org-chart-toggle'))
    // Pick one account manager so the form is populated
    await user.click(screen.getByTestId('am-checkbox-tm-am-001'))

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())

    const payload = mutateAsync.mock.calls[0][0]
    // null, not '' or undefined
    expect(payload.orgChart.agronomyManagerName).toBeNull()
    expect(payload.orgChart.irrigationManagerName).toBeNull()
    expect(payload.orgChart.productionManagerName).toBeNull()
  })

  it('omitting Irrigation Manager leaves irrigationManagerName as null (drives Slice 8 node omission)', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ ...mockSavedProposal })
    mockUseCreateProposal.mockReturnValue(makeMutation({ mutateAsync }))

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('org-chart-toggle'))
    // Leave irrigation manager name blank

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())

    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.orgChart.irrigationManagerName).toBeNull()
  })

  it('typing an agronomy manager name sets a non-null value', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ ...mockSavedProposal })
    mockUseCreateProposal.mockReturnValue(makeMutation({ mutateAsync }))

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('org-chart-toggle'))
    // Type an agronomy manager name into the free-text field
    const agroInput = screen.getByTestId('agronomy-manager-input')
    await user.type(agroInput, 'Bob Green')

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())

    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.orgChart.agronomyManagerName).toBe('Bob Green')
  })

  it('crew count inputs accept numeric values', async () => {
    const user = userEvent.setup()
    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('org-chart-toggle'))
    const foremenInput = screen.getByTestId('crew-mow-foremen')
    await user.clear(foremenInput)
    await user.type(foremenInput, '2')
    expect(foremenInput).toHaveValue(2)
  })
})

// ---------------------------------------------------------------------------
// 4. Submit — builds correct payload and calls useCreateProposal
// ---------------------------------------------------------------------------

describe('ProposalBuilder — submit builds payload', () => {
  it('calls useCreateProposal with the correct ProposalRequest payload', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ ...mockSavedProposal, id: 'prop-new' })
    mockUseCreateProposal.mockReturnValue(makeMutation({ mutateAsync }))

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    // Select a client reference and portfolio item
    await user.click(within(screen.getByTestId('client-reference-picker')).getByRole('checkbox'))
    await user.click(within(screen.getByTestId('portfolio-picker')).getByRole('checkbox'))

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))

    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.leadId).toBe('lead-001')
    expect(payload.estimateId).toBe('est-001')
    expect(payload.signerUserId).toBe('user-001')
    expect(payload.clientReferenceIds).toContain('cr-001')
    expect(payload.portfolioPropertyIds).toContain('pp-001')
    // No optional sections checked → sections array is empty
    expect(payload.sections).toEqual([])
    // Org chart included is false by default
    expect(payload.orgChart.included).toBe(false)
    // startupPlan.included is derived from sections array
    expect(payload.startupPlan.included).toBe(false)
  })

  it('includes checked optional sections in the payload sections array', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ ...mockSavedProposal })
    mockUseCreateProposal.mockReturnValue(makeMutation({ mutateAsync }))

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('section-checkbox-juniper_sync'))
    await user.click(screen.getByTestId('section-checkbox-juniper_mapping'))

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())

    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.sections).toContain('juniper_sync')
    expect(payload.sections).toContain('juniper_mapping')
    expect(payload.sections).not.toContain('startup_plan_30_60_90')
  })

  it('sets startupPlan.included true when startup_plan_30_60_90 is checked', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ ...mockSavedProposal })
    mockUseCreateProposal.mockReturnValue(makeMutation({ mutateAsync }))

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('section-checkbox-startup_plan_30_60_90'))
    await user.click(screen.getByTestId('startup-max-days-60'))
    // Add a Day 60 bullet
    const addBtn = within(screen.getByTestId('startup-day60')).getByRole('button', { name: /add bullet/i })
    await user.click(addBtn)
    const input = within(screen.getByTestId('startup-day60')).getByRole('textbox')
    await user.type(input, 'Audit current schedule')

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())

    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.startupPlan.included).toBe(true)
    expect(payload.startupPlan.day60).toEqual(['Audit current schedule'])
  })

  it('navigates to the full-screen preview route after a successful submit', async () => {
    const user = userEvent.setup()
    mockUseCreateProposal.mockReturnValue(
      makeMutation({ mutateAsync: vi.fn().mockResolvedValue({ ...mockSavedProposal }) }),
    )

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('submit-proposal'))
    // The preview is no longer a second step inside this panel: a .print-page is
    // a fixed 8.5in and the builder renders in a 672px drawer, which clipped the
    // right quarter of every page. Submitting hands off to /proposals/:id/preview.
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/proposals/${mockSavedProposal.id}/preview`),
    )
  })

  it('does not navigate when the create mutation returns no id', async () => {
    const user = userEvent.setup()
    mockUseCreateProposal.mockReturnValue(
      makeMutation({ mutateAsync: vi.fn().mockResolvedValue({}) }),
    )

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows an error message when the mutation rejects', async () => {
    const user = userEvent.setup()
    mockUseCreateProposal.mockReturnValue(
      makeMutation({ mutateAsync: vi.fn().mockRejectedValue(new Error('Network error')) }),
    )

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} />)

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to save proposal/i),
    )
    // Still on the form step — no preview placeholder
    expect(screen.queryByTestId('preview-placeholder')).not.toBeInTheDocument()
  })

  it('calls useUpdateProposal when proposalId is provided and proposal is loaded', async () => {
    const user = userEvent.setup()
    const updateMutateAsync = vi.fn().mockResolvedValue({ ...mockSavedProposal })
    mockUseProposal.mockReturnValue({
      data: mockSavedProposal,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProposal>)
    mockUseUpdateProposal.mockReturnValue(
      makeMutation({ mutateAsync: updateMutateAsync }) as unknown as ReturnType<typeof useUpdateProposal>,
    )

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} proposalId="prop-existing" />)

    // Form should show "Save changes" when editing
    expect(screen.getByTestId('submit-proposal')).toHaveTextContent(/save changes/i)

    await user.click(screen.getByTestId('submit-proposal'))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))

    const call = updateMutateAsync.mock.calls[0][0]
    expect(call.id).toBe('prop-existing')
  })
})

// ---------------------------------------------------------------------------
// 5. Reopen — hydrates form from useProposal
// ---------------------------------------------------------------------------

describe('ProposalBuilder — reopen from proposalId', () => {
  it('hydrates optional sections from the saved proposal', async () => {
    mockUseProposal.mockReturnValue({
      data: mockSavedProposal,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProposal>)

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} proposalId="prop-existing" />)

    await waitFor(() => {
      expect(screen.getByTestId('section-checkbox-startup_plan_30_60_90')).toBeChecked()
      expect(screen.getByTestId('section-checkbox-juniper_sync')).toBeChecked()
    })
    // Optional sections not in saved proposal remain unchecked
    expect(screen.getByTestId('section-checkbox-juniper_mapping')).not.toBeChecked()
    expect(screen.getByTestId('section-checkbox-meet_our_team_executive')).not.toBeChecked()
  })

  it('hydrates org chart included from the saved proposal', async () => {
    mockUseProposal.mockReturnValue({
      data: mockSavedProposal,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProposal>)

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} proposalId="prop-existing" />)

    await waitFor(() => {
      expect(screen.getByTestId('org-chart-toggle')).toBeChecked()
    })
    // Org chart inputs should be visible because included: true
    expect(screen.getByTestId('org-chart-inputs')).toBeInTheDocument()
  })

  it('hydrates startup-plan free-text rows (day60, day90) from the saved proposal', async () => {
    mockUseProposal.mockReturnValue({
      data: mockSavedProposal,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProposal>)

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} proposalId="prop-existing" />)

    await waitFor(() => {
      // startup_plan_30_60_90 is checked → section renders
      expect(screen.getByTestId('startup-plan-section')).toBeInTheDocument()
    })

    // The saved proposal has day60: ['Establish mowing schedule']
    const day60Input = within(screen.getByTestId('startup-day60')).getByRole('textbox')
    expect(day60Input).toHaveValue('Establish mowing schedule')
  })

  it('shows loading spinner while fetching the saved proposal', () => {
    mockUseProposal.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useProposal>)

    render(<ProposalBuilder lead={mockLead} estimate={mockEstimate} proposalId="prop-existing" />)

    // Loading state — form is not yet rendered
    expect(screen.queryByTestId('submit-proposal')).not.toBeInTheDocument()
  })

  it('blocks generate when the lead has no property attached', async () => {
    const mutateAsync = vi.fn()
    mockUseCreateProposal.mockReturnValue(makeMutation({ mutateAsync }))
    render(
      <ProposalBuilder
        lead={{ ...mockLead, property_id: null }}
        estimate={mockEstimate}
      />,
    )

    expect(screen.getByTestId('property-required')).toBeInTheDocument()
    expect(screen.getByTestId('submit-proposal')).toBeDisabled()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('asks for a lead before showing the generator when opened from Proposals', () => {
    render(<ProposalBuilder lead={null} pickLead showHeader={false} />)
    expect(screen.getByLabelText('Search leads')).toBeInTheDocument()
    expect(screen.getByTestId('proposal-lead-prompt')).toBeInTheDocument()
    expect(screen.queryByTestId('submit-proposal')).not.toBeInTheDocument()
  })
})
