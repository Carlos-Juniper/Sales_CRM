// ---------------------------------------------------------------------------
// ProposalPreview — component tests (Slice 8)
//
// Conventions mirror ProposalBuilder.test.tsx:
//   - vi.mock('@/hooks/useProposals') — tests don't need real API calls
//   - render() from @/test/utils
//   - data-testid assertions for page presence/absence
//
// Test groups:
//  1. Required pages — all 12 base pages always present in fixed §2 order
//  2. Org chart — included=false → page absent; null manager nodes → nodes absent
//  3. Optional pages — absent by default; present when section key is in formState
//  4. Static content — known blurb titles render from constants (not hardcoded)
//  5. Proximity footer — nearbyBranches renders; deduplication is tested in proximity.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '@/test/utils'
import { ProposalPreview } from '@/views/inside-sales/components/estimating/ProposalPreview'
import type { Lead } from '@/types'
import type { Estimate } from '@/types/estimating'
import type {
  TeamMember,
  ClientReference,
  PortfolioProperty,
  BranchCoverageGroup,
  LicenseCertification,
  BranchProfile,
  OrgChartInput,
  OrgChartCrewCounts,
  StartupPlanInput,
} from '@/types/proposal'
import type { ProposalFormState } from '@/views/inside-sales/components/estimating/ProposalBuilder'

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useProposals', () => ({
  useProposalConfig: vi.fn(),
  useProposalLicenses: vi.fn(),
  useProposalMediaUrl: vi.fn(),
  useRenderProposal: vi.fn(),
  // other hooks not consumed by ProposalPreview
  useTeamMembers: vi.fn(),
  useClientReferences: vi.fn(),
  usePortfolio: vi.fn(),
  useProposal: vi.fn(),
  useCreateProposal: vi.fn(),
  useUpdateProposal: vi.fn(),
  useProposalRenders: vi.fn(),
}))

import { useProposalConfig, useProposalLicenses, useProposalMediaUrl, useRenderProposal } from '@/hooks/useProposals'

const mockUseProposalConfig = useProposalConfig as MockedFunction<typeof useProposalConfig>
const mockUseProposalLicenses = useProposalLicenses as MockedFunction<typeof useProposalLicenses>
const mockUseProposalMediaUrl = useProposalMediaUrl as MockedFunction<typeof useProposalMediaUrl>
const mockUseRenderProposal = useRenderProposal as MockedFunction<typeof useRenderProposal>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockBranch1: BranchProfile = {
  aspireBranchId: 1403,
  branchName: 'Fort Myers Install',
  city: 'Fort Myers',
  regionId: 'west-coast',
  address: '5880 Staley Road, Fort Myers, FL 33905',
  lat: 26.6519,
  lng: -81.7718,
}

const mockBranch2: BranchProfile = {
  aspireBranchId: 2001,
  branchName: 'Naples',
  city: 'Naples',
  regionId: 'west-coast',
  address: '1234 Naples Way, Naples, FL 34103',
  lat: 26.1424,
  lng: -81.7948,
}

const mockBranchCoverage: BranchCoverageGroup[] = [
  { state: 'FL', stateName: 'Florida', branches: ['Fort Myers', 'Naples', 'Venice'] },
  { state: 'TX', stateName: 'Texas', branches: ['Houston'] },
]

function makeLicense(over: Partial<LicenseCertification> = {}): LicenseCertification {
  return {
    id: 'lc-000',
    kind: 'license',
    name: 'Sample Credential',
    issuingBody: 'Florida Dept. of Agriculture',
    identifier: 'JB1234',
    holderName: 'Jane Bell',
    aspireBranchId: null,
    issuedDate: '2025-01-15',
    expiryDate: '2027-01-14',
    objectKey: null,
    isExpired: false,
    active: true,
    ...over,
  }
}

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

const mockProductionManager: TeamMember = {
  id: 'tm-pm-001',
  name: 'Dave Brown',
  title: 'production_manager',
  teamType: 'branch',
  aspireBranchId: 3696,
  userId: null,
  location: 'Fort Myers, FL',
  bio: '',
  headshotObjectKey: null,
  active: true,
  sortOrder: 4,
}

const mockExecutive: TeamMember = {
  id: 'tm-exec-001',
  name: 'Eve CEO',
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

function makeDefaultCrewCounts(): OrgChartCrewCounts {
  return {
    mow: { foremen: 2, members: 6 },
    prune: { foremen: 1, members: 3 },
    fertIpm: { members: 2 },
    irrigation: { members: 1 },
  }
}

function makeOrgChart(overrides?: Partial<OrgChartInput>): OrgChartInput {
  return {
    included: true,
    accountManagerIds: ['tm-am-001'],
    agronomyManagerId: 'tm-agro-001',
    irrigationManagerId: 'tm-irr-001',
    productionManagerId: 'tm-pm-001',
    crewCounts: makeDefaultCrewCounts(),
    ...overrides,
  }
}

function makeStartupPlan(overrides?: Partial<StartupPlanInput>): StartupPlanInput {
  return {
    included: false,
    day60: [],
    day90: [],
    day120Plus: [],
    ongoing: [],
    ...overrides,
  }
}

function makeFormState(overrides?: Partial<ProposalFormState>): ProposalFormState {
  return {
    sections: [],
    orgChart: makeOrgChart({ included: false }),
    startupPlan: makeStartupPlan(),
    teamMemberIds: [],
    executiveTeamMemberIds: [],
    clientReferenceIds: [],
    portfolioPropertyIds: [],
    signerUserId: 'user-001',
    ...overrides,
  }
}

const ALL_MEMBERS = [
  mockAccountManager,
  mockAgronomyManager,
  mockIrrigationManager,
  mockProductionManager,
  mockExecutive,
]

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const mockMutate = vi.fn()

function setupDefaultMocks() {
  mockUseProposalConfig.mockReturnValue({
    branches: [mockBranch1, mockBranch2],
    branchCoverage: mockBranchCoverage,
    insurance: {
      id: 'ins-001',
      objectKey: 'proposal/insurance/cert-2026.pdf',
      expiryDate: '2027-03-31',
      label: 'General Liability',
      uploadedAt: '2026-01-01T00:00:00Z',
    },
    loaded: true,
  })
  // Empty is the live state: every credential on file is currently expired, and
  // the backend filters those out. Tests that need rows override this.
  mockUseProposalLicenses.mockReturnValue({
    data: { licenses: [], certifications: [] },
  } as ReturnType<typeof useProposalLicenses>)
  mockUseProposalMediaUrl.mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof useProposalMediaUrl>)
  mockUseRenderProposal.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
  } as ReturnType<typeof useRenderProposal>)
}

function renderPreview(
  formStateOverrides?: Partial<ProposalFormState>,
  propsOverrides?: {
    teamMembers?: TeamMember[]
    executiveTeamMembers?: TeamMember[]
    clientReferences?: ClientReference[]
    portfolioProperties?: PortfolioProperty[]
    proposalId?: string | null
  },
) {
  const formState = makeFormState(formStateOverrides)
  // Use 'prop-001' as the default only when proposalId was NOT explicitly provided.
  const proposalId = propsOverrides && 'proposalId' in propsOverrides
    ? propsOverrides.proposalId
    : 'prop-001'
  // The portfolio page is omitted when no picked property has a photo, so the
  // default must carry one for the required-page assertions.
  const portfolioProperties = propsOverrides?.portfolioProperties ?? [mockPortfolioProperty]
  return render(
    <ProposalPreview
      formState={formState}
      lead={mockLead}
      estimate={mockEstimate}
      onBack={vi.fn()}
      proposalId={proposalId}
      allTeamMembers={ALL_MEMBERS}
      teamMembers={propsOverrides?.teamMembers ?? []}
      executiveTeamMembers={propsOverrides?.executiveTeamMembers ?? []}
      clientReferences={propsOverrides?.clientReferences ?? []}
      portfolioProperties={portfolioProperties}
    />,
  )
}

beforeEach(() => {
  mockMutate.mockReset()
  useAuthStore.setState({
    user: makeUser({ id: 'user-001', name: 'Test Rep', role: 'inside_sales' }),
  })
  setupDefaultMocks()
})

// ---------------------------------------------------------------------------
// 1. Required pages — all 12 base pages always present in fixed §2 order
// ---------------------------------------------------------------------------

describe('ProposalPreview — required pages', () => {
  it('renders the proposal preview wrapper', () => {
    renderPreview()
    expect(screen.getByTestId('proposal-preview')).toBeInTheDocument()
  })

  it('renders page 1: intro letter', () => {
    renderPreview()
    expect(screen.getByTestId('page-intro-letter')).toBeInTheDocument()
  })

  it('renders page 2: rooted in florida', () => {
    renderPreview()
    expect(screen.getByTestId('page-rooted-in-florida')).toBeInTheDocument()
  })

  it('renders page 3: local landscape experts', () => {
    renderPreview()
    expect(screen.getByTestId('page-local-landscape-experts')).toBeInTheDocument()
  })

  it('renders all 11 service pages', () => {
    renderPreview()
    const serviceKeys = [
      'services_design', 'services_maintenance', 'services_installation',
      'services_turf', 'services_irrigation', 'services_arboriculture',
      'services_storm_response', 'services_enhancements', 'services_aquatics',
      'services_safety_training', 'services_juniper_cares',
    ]
    for (const key of serviceKeys) {
      expect(screen.getByTestId(`page-service-${key}`)).toBeInTheDocument()
    }
  })

  it('renders page 16: startup communication', () => {
    renderPreview()
    expect(screen.getByTestId('page-startup-communication')).toBeInTheDocument()
  })

  it('renders page 17: customer care', () => {
    renderPreview()
    expect(screen.getByTestId('page-customer-care')).toBeInTheDocument()
  })

  it('renders page 18: meet our team', () => {
    renderPreview()
    expect(screen.getByTestId('page-meet-our-team')).toBeInTheDocument()
  })

  it('renders page 19: client references', () => {
    renderPreview()
    expect(screen.getByTestId('page-client-references')).toBeInTheDocument()
  })

  it('renders page 20: insurance', () => {
    renderPreview()
    expect(screen.getByTestId('page-insurance')).toBeInTheDocument()
  })

  it('renders page 21: licenses and certifications', () => {
    renderPreview()
    expect(screen.getByTestId('page-licenses-certifications')).toBeInTheDocument()
  })

  it('renders page 22: portfolio', () => {
    renderPreview()
    expect(screen.getByTestId('page-portfolio')).toBeInTheDocument()
  })

  it('renders page 23: thank you', () => {
    renderPreview()
    expect(screen.getByTestId('page-thank-you')).toBeInTheDocument()
  })

  it('all 13 required pages are present with no optional sections', () => {
    renderPreview({ sections: [] })
    // Required pages
    expect(screen.getByTestId('page-intro-letter')).toBeInTheDocument()
    expect(screen.getByTestId('page-rooted-in-florida')).toBeInTheDocument()
    expect(screen.getByTestId('page-local-landscape-experts')).toBeInTheDocument()
    expect(screen.getByTestId('page-startup-communication')).toBeInTheDocument()
    expect(screen.getByTestId('page-customer-care')).toBeInTheDocument()
    expect(screen.getByTestId('page-meet-our-team')).toBeInTheDocument()
    expect(screen.getByTestId('page-client-references')).toBeInTheDocument()
    expect(screen.getByTestId('page-insurance')).toBeInTheDocument()
    expect(screen.getByTestId('page-licenses-certifications')).toBeInTheDocument()
    expect(screen.getByTestId('page-portfolio')).toBeInTheDocument()
    expect(screen.getByTestId('page-thank-you')).toBeInTheDocument()
    // Optional pages should NOT be present
    expect(screen.queryByTestId('page-startup-plan')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-juniper-sync')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-juniper-mapping-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-meet-our-team-executive')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 2. Org chart — conditional rendering
// ---------------------------------------------------------------------------

describe('ProposalPreview — org chart conditional rendering', () => {
  it('org chart page is absent when orgChart.included is false', () => {
    renderPreview({ orgChart: makeOrgChart({ included: false }) })
    expect(screen.queryByTestId('page-org-chart')).not.toBeInTheDocument()
  })

  it('org chart page renders when orgChart.included is true', () => {
    renderPreview({ orgChart: makeOrgChart({ included: true }) })
    expect(screen.getByTestId('page-org-chart')).toBeInTheDocument()
  })

  it('agronomy manager node is absent when agronomyManagerId is null', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        agronomyManagerId: null,
        irrigationManagerId: 'tm-irr-001',
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    // Should NOT contain "Agronomy Manager" label
    expect(within(orgChartPage).queryByText(/agronomy manager/i)).not.toBeInTheDocument()
    // Irrigation Manager IS present
    expect(within(orgChartPage).getByText(/irrigation manager/i)).toBeInTheDocument()
  })

  it('irrigation manager node is absent when irrigationManagerId is null', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        agronomyManagerId: 'tm-agro-001',
        irrigationManagerId: null,
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    expect(within(orgChartPage).getByText(/agronomy manager/i)).toBeInTheDocument()
    expect(within(orgChartPage).queryByText(/irrigation manager/i)).not.toBeInTheDocument()
  })

  it('neither agronomy nor irrigation manager renders when both are null', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        agronomyManagerId: null,
        irrigationManagerId: null,
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    expect(within(orgChartPage).queryByText(/agronomy manager/i)).not.toBeInTheDocument()
    expect(within(orgChartPage).queryByText(/irrigation manager/i)).not.toBeInTheDocument()
  })

  it('production manager node renders when productionManagerId is set', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        productionManagerId: 'tm-pm-001',
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    expect(within(orgChartPage).getByText(/production manager/i)).toBeInTheDocument()
    // Dave Brown is the mock production manager
    expect(within(orgChartPage).getByText('Dave Brown')).toBeInTheDocument()
  })

  it('production manager node absent when productionManagerId is null', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        productionManagerId: null,
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    expect(within(orgChartPage).queryByText(/production manager/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 3. Optional pages — absent by default, present when section key is set
// ---------------------------------------------------------------------------

describe('ProposalPreview — optional pages', () => {
  it('startup plan page absent when startup_plan_30_60_90 not in sections', () => {
    renderPreview({ sections: [] })
    expect(screen.queryByTestId('page-startup-plan')).not.toBeInTheDocument()
  })

  it('startup plan page present when startup_plan_30_60_90 is in sections', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({
        included: true,
        day60: ['Audit schedule'],
        day90: ['Review fertilization'],
      }),
    })
    expect(screen.getByTestId('page-startup-plan')).toBeInTheDocument()
  })

  it('juniper sync page absent when juniper_sync not in sections', () => {
    renderPreview({ sections: [] })
    expect(screen.queryByTestId('page-juniper-sync')).not.toBeInTheDocument()
  })

  it('juniper sync page present when juniper_sync is in sections', () => {
    renderPreview({ sections: ['juniper_sync'] })
    expect(screen.getByTestId('page-juniper-sync')).toBeInTheDocument()
  })

  it('juniper mapping pages absent when juniper_mapping not in sections', () => {
    renderPreview({ sections: [] })
    expect(screen.queryByTestId('page-juniper-mapping-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-juniper-mapping-2')).not.toBeInTheDocument()
  })

  it('both juniper mapping pages present when juniper_mapping is in sections', () => {
    renderPreview({ sections: ['juniper_mapping'] })
    expect(screen.getByTestId('page-juniper-mapping-1')).toBeInTheDocument()
    expect(screen.getByTestId('page-juniper-mapping-2')).toBeInTheDocument()
  })

  it('executive team page absent when meet_our_team_executive not in sections', () => {
    renderPreview({ sections: [] })
    expect(screen.queryByTestId('page-meet-our-team-executive')).not.toBeInTheDocument()
  })

  it('executive team page present when meet_our_team_executive is in sections', () => {
    renderPreview(
      { sections: ['meet_our_team_executive'] },
      { executiveTeamMembers: [mockExecutive] },
    )
    expect(screen.getByTestId('page-meet-our-team-executive')).toBeInTheDocument()
  })

  it('all four optional pages render simultaneously when all sections are set', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90', 'juniper_sync', 'juniper_mapping', 'meet_our_team_executive'],
      startupPlan: makeStartupPlan({ included: true }),
    })
    expect(screen.getByTestId('page-startup-plan')).toBeInTheDocument()
    expect(screen.getByTestId('page-juniper-sync')).toBeInTheDocument()
    expect(screen.getByTestId('page-juniper-mapping-1')).toBeInTheDocument()
    expect(screen.getByTestId('page-meet-our-team-executive')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 4. Static content — renders from constants, not hardcoded strings
// ---------------------------------------------------------------------------

describe('ProposalPreview — static content from constants', () => {
  it('Rooted in Florida heading renders from ROOTED_IN_FLORIDA_CONTENT', () => {
    renderPreview()
    const page = screen.getByTestId('page-rooted-in-florida')
    expect(within(page).getByText('Rooted in Florida')).toBeInTheDocument()
    // About Us subheading
    expect(within(page).getByText('About Us')).toBeInTheDocument()
  })

  it('Customer Care heading renders from CUSTOMER_CARE_CONTENT', () => {
    renderPreview()
    const page = screen.getByTestId('page-customer-care')
    expect(within(page).getByText('Customer Care')).toBeInTheDocument()
  })

  it('Startup Communication heading renders from STARTUP_COMMUNICATION_CONTENT', () => {
    renderPreview()
    const page = screen.getByTestId('page-startup-communication')
    expect(within(page).getByText('Start Up Communication')).toBeInTheDocument()
  })

  it('services_design page renders "Design" from SERVICES_CONTENT', () => {
    renderPreview()
    const page = screen.getByTestId('page-service-services_design')
    expect(within(page).getByText('Design')).toBeInTheDocument()
  })

  it('services_arboriculture page renders "Arboriculture" from SERVICES_CONTENT', () => {
    renderPreview()
    const page = screen.getByTestId('page-service-services_arboriculture')
    expect(within(page).getByText('Arboriculture')).toBeInTheDocument()
  })

  it('Juniper Sync heading renders from JUNIPER_SYNC_CONTENT when section is included', () => {
    renderPreview({ sections: ['juniper_sync'] })
    const page = screen.getByTestId('page-juniper-sync')
    expect(within(page).getByText('Juniper Sync')).toBeInTheDocument()
  })

  it('startup plan page renders Day Zero and Day 30 from STARTUP_PLAN_SEED', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({ included: true }),
    })
    const page = screen.getByTestId('page-startup-plan')
    expect(within(page).getByText(/day zero/i)).toBeInTheDocument()
    expect(within(page).getByText(/day 30/i)).toBeInTheDocument()
  })

  it('startup plan page renders free-text day60 entries from startupPlan', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({
        included: true,
        day60: ['Audit current schedule', 'Review pesticide program'],
      }),
    })
    const page = screen.getByTestId('page-startup-plan')
    expect(within(page).getByText('Audit current schedule')).toBeInTheDocument()
    expect(within(page).getByText('Review pesticide program')).toBeInTheDocument()
  })

  it('insurance page renders INSURANCE_PAGE_COPY heading', () => {
    renderPreview()
    const page = screen.getByTestId('page-insurance')
    expect(within(page).getByText('Insurance')).toBeInTheDocument()
  })

  it('insurance page shows cert expiry when cert is provided by useProposalConfig', () => {
    renderPreview()
    const page = screen.getByTestId('page-insurance')
    // Cert expiry date — text contains '2027' regardless of locale format
    expect(within(page).getByText(/2027/)).toBeInTheDocument()
  })

  it('licenses page renders the prose empty state, not a table, when nothing is current', () => {
    renderPreview()
    const page = screen.getByTestId('page-licenses-certifications')
    expect(within(page).queryByTestId('licenses-table')).not.toBeInTheDocument()
    expect(within(page).getByText(/available on request/i)).toBeInTheDocument()
  })

  it('licenses page renders a table once current credentials exist', () => {
    mockUseProposalLicenses.mockReturnValue({
      data: {
        licenses: [makeLicense({ id: 'lc-1', name: 'Certified Pest Control Operator' })],
        certifications: [
          makeLicense({ id: 'lc-2', kind: 'certification', name: 'ISA Certified Arborist' }),
        ],
      },
    } as ReturnType<typeof useProposalLicenses>)
    renderPreview()
    const page = screen.getByTestId('page-licenses-certifications')
    expect(within(page).getByTestId('licenses-table')).toBeInTheDocument()
    expect(within(page).getByText(/Certified Pest Control Operator/)).toBeInTheDocument()
    expect(within(page).getByText(/ISA Certified Arborist/)).toBeInTheDocument()
    expect(within(page).queryByText(/available on request/i)).not.toBeInTheDocument()
  })

  it('the empty licenses page never hints that something is missing', () => {
    // Expired rows are filtered server-side and simply absent. A client must not
    // be able to tell the difference between "none current" and "none on file".
    renderPreview()
    const page = screen.getByTestId('page-licenses-certifications')
    expect(within(page).queryByText(/expired/i)).not.toBeInTheDocument()
    expect(within(page).queryByText(/pending/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 5. Proximity footer — nearby branches shown on Local Landscape Experts page
// ---------------------------------------------------------------------------

describe('ProposalPreview — proximity footer', () => {
  it('renders the nearby-branches container on the local-landscape-experts page', () => {
    renderPreview()
    const page = screen.getByTestId('page-local-landscape-experts')
    // The mock provides two branches — both should appear
    expect(within(page).getByTestId('nearby-branches')).toBeInTheDocument()
  })

  it('shows Fort Myers branch name in the proximity footer', () => {
    renderPreview()
    const page = screen.getByTestId('page-local-landscape-experts')
    expect(within(page).getByText('Fort Myers Install')).toBeInTheDocument()
  })

  it('renders no nearby-branches container when no branches are configured', () => {
    mockUseProposalConfig.mockReturnValue({
      branches: [],
      branchCoverage: mockBranchCoverage,
      insurance: null,
      loaded: true,
    })
    renderPreview()
    const page = screen.getByTestId('page-local-landscape-experts')
    expect(within(page).queryByTestId('nearby-branches')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 6. Variable data — team members / refs / portfolio render from props
// ---------------------------------------------------------------------------

describe('ProposalPreview — variable data', () => {
  it('Meet Our Team renders the passed team member name', () => {
    renderPreview({}, { teamMembers: [mockAccountManager] })
    const page = screen.getByTestId('page-meet-our-team')
    expect(within(page).getByText('Alice Johnson')).toBeInTheDocument()
  })

  it('Client References renders the passed reference property name', () => {
    renderPreview({}, { clientReferences: [mockClientRef] })
    const page = screen.getByTestId('page-client-references')
    expect(within(page).getByText('Coral Bay HOA')).toBeInTheDocument()
  })

  it('Portfolio renders the passed property name', () => {
    renderPreview({}, { portfolioProperties: [mockPortfolioProperty] })
    const page = screen.getByTestId('page-portfolio')
    expect(within(page).getByText(/Pointe Jupiter Yacht Club/)).toBeInTheDocument()
  })

  it('Meet Our Team — Executive renders the executive member name', () => {
    renderPreview(
      { sections: ['meet_our_team_executive'] },
      { executiveTeamMembers: [mockExecutive] },
    )
    const page = screen.getByTestId('page-meet-our-team-executive')
    expect(within(page).getByText('Eve CEO')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 7. Generate PDF button (Slice 8)
// ---------------------------------------------------------------------------

describe('ProposalPreview — Generate PDF button', () => {
  it('renders the Generate PDF button', () => {
    renderPreview()
    expect(screen.getByTestId('generate-pdf-btn')).toBeInTheDocument()
  })

  it('Generate PDF button text is "Generate PDF" by default', () => {
    renderPreview()
    expect(screen.getByTestId('generate-pdf-btn')).toHaveTextContent('Generate PDF')
  })

  it('clicking Generate PDF calls mutate with the proposalId', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderPreview({}, { proposalId: 'prop-test-123' })
    const btn = screen.getByTestId('generate-pdf-btn')
    await user.click(btn)
    expect(mockMutate).toHaveBeenCalledWith('prop-test-123', expect.any(Object))
  })

  it('Generate PDF button is disabled and shows loading when isPending', () => {
    mockUseRenderProposal.mockReturnValue({
      mutate: mockMutate,
      isPending: true,
      isSuccess: false,
      isError: false,
      data: undefined,
    } as ReturnType<typeof useRenderProposal>)
    renderPreview()
    const btn = screen.getByTestId('generate-pdf-btn')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Generating…')
  })

  it('Generate PDF button is disabled when proposalId is null', () => {
    renderPreview({}, { proposalId: null })
    expect(screen.getByTestId('generate-pdf-btn')).toBeDisabled()
  })

  it('Print button is also rendered as a fallback', () => {
    renderPreview()
    // The Print button is not the Generate PDF button
    const buttons = screen.getAllByRole('button')
    const printBtn = buttons.find((b) => b.textContent?.includes('Print') && !b.textContent?.includes('Generate'))
    expect(printBtn).toBeDefined()
  })
})
