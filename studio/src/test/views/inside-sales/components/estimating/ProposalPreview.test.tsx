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
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { screen, within, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import type { IntakeAttachment } from '@/types/estimating'
import { JuniperLogoFull } from '@/components/brand/JuniperLogo'
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
  useProposalRepBranches: vi.fn(),
  useProposalLicenses: vi.fn(),
  useProposalInsurance: vi.fn(),
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

// A1: The approved copy uses subhead/lists fields that no existing content
// object carries yet (copy is added in A2). To exercise the new renderers here,
// mock the static-content module so a single service page and Customer Care can
// be augmented on demand. The injection is OFF by default, so every other test
// in this file sees the real, unmodified content.
const copyInject = vi.hoisted(() => ({
  service: undefined as
    | { subhead?: string; lists?: unknown[] }
    | undefined,
  customerCare: undefined as { lists?: unknown[] } | undefined,
}))

vi.mock('@/lib/proposal/staticContent', async (importActual) => {
  const actual =
    await importActual<typeof import('@/lib/proposal/staticContent')>()
  return {
    ...actual,
    // Getters so the flag is read at render time, not module-eval time.
    get SERVICES_CONTENT() {
      if (!copyInject.service) return actual.SERVICES_CONTENT
      return {
        ...actual.SERVICES_CONTENT,
        services_design: {
          ...actual.SERVICES_CONTENT.services_design,
          ...copyInject.service,
        },
      }
    },
    get CUSTOMER_CARE_CONTENT() {
      if (!copyInject.customerCare) return actual.CUSTOMER_CARE_CONTENT
      return { ...actual.CUSTOMER_CARE_CONTENT, ...copyInject.customerCare }
    },
  }
})

import { useProposalConfig, useProposalRepBranches, useProposalLicenses, useProposalInsurance, useProposalMediaUrl, useRenderProposal } from '@/hooks/useProposals'
import {
  INSURANCE_PAGE_COPY,
  SERVICES_CONTENT,
  SERVICE_OVERVIEW_CATEGORIES,
  STARTUP_PLAN_SEED,
} from '@/lib/proposal/staticContent'
import { overviewCategoryPhotoUrl } from '@/lib/proposal/photos'
import { measureProposalOverflow } from '@/hooks/useProposalOverflow'

const mockUseProposalConfig = useProposalConfig as MockedFunction<typeof useProposalConfig>
const mockUseProposalRepBranches = useProposalRepBranches as MockedFunction<typeof useProposalRepBranches>
const mockUseProposalLicenses = useProposalLicenses as MockedFunction<typeof useProposalLicenses>
const mockUseProposalInsurance = useProposalInsurance as MockedFunction<typeof useProposalInsurance>
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
  {
    state: 'FL',
    stateName: 'Florida',
    regions: [
      { regionId: 'west-coast', regionName: 'West Coast', branches: ['Fort Myers', 'Naples'] },
      { regionId: 'central', regionName: 'Central', branches: ['Venice'] },
    ],
  },
  {
    state: 'TX',
    stateName: 'Texas',
    regions: [{ regionId: '', regionName: '', branches: ['Houston'] }],
  },
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
    agronomyManagerName: 'Bob Green',
    irrigationManagerName: 'Carol Blue',
    productionManagerName: 'Dave Brown',
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
    loaded: true,
  })
  // Empty is the default: no signer/branch assignment resolved, so
  // localBranchPicks falls back to plain nearestBranches proximity — matches
  // every existing proximity-footer test, which was written for that path.
  mockUseProposalRepBranches.mockReturnValue({
    data: [],
  } as unknown as ReturnType<typeof useProposalRepBranches>)
  // Empty is the live state: every credential on file is currently expired, and
  // the backend filters those out. Tests that need rows override this.
  mockUseProposalLicenses.mockReturnValue({
    data: { licenses: [], certifications: [] },
  } as ReturnType<typeof useProposalLicenses>)
  mockUseProposalInsurance.mockReturnValue({
    data: {
      id: 'ins-001',
      // A raster scan, matching what swap_insurance_cert.py writes. A .pdf key
      // here would not reproduce production: Chromium cannot print an embedded
      // PDF, which is the bug this page's <img> rendering exists to avoid.
      objectKey: 'credentials/licenses/ins-cert-001.png',
      expiryDate: '2027-03-31',
      label: 'General Liability',
      uploadedAt: '2026-01-01T00:00:00Z',
    },
  } as ReturnType<typeof useProposalInsurance>)
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
    lead?: Lead
    teamMembers?: TeamMember[]
    executiveTeamMembers?: TeamMember[]
    clientReferences?: ClientReference[]
    portfolioProperties?: PortfolioProperty[]
    proposalId?: string | null
    estimate?: Estimate | null
    chapterOrder?: string[] | null
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
  const estimate = propsOverrides && 'estimate' in propsOverrides
    ? propsOverrides.estimate
    : mockEstimate
  return render(
    <ProposalPreview
      formState={formState}
      lead={propsOverrides?.lead ?? mockLead}
      estimate={estimate}
      onBack={vi.fn()}
      proposalId={proposalId}
      chapterOrder={propsOverrides?.chapterOrder ?? null}
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

  it('renders all 10 service pages', () => {
    renderPreview()
    // Juniper Cares is NOT a service page (A4 / §6) — it is its own section.
    const serviceKeys = [
      'services_design', 'services_maintenance', 'services_installation',
      'services_turf', 'services_irrigation', 'services_arboriculture',
      'services_storm_response', 'services_enhancements', 'services_aquatics',
      'services_safety_training',
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

  it('renders page 22: portfolio (one sheet per property)', () => {
    renderPreview()
    // Handoff 48: the single page-portfolio sheet is replaced by one sheet per
    // photographed property, keyed page-portfolio-<id>.
    expect(screen.getByTestId(`page-portfolio-${mockPortfolioProperty.id}`)).toBeInTheDocument()
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
    expect(screen.getByTestId(`page-portfolio-${mockPortfolioProperty.id}`)).toBeInTheDocument()
    expect(screen.getByTestId('page-thank-you')).toBeInTheDocument()
    // Optional pages should NOT be present
    expect(screen.queryByTestId('page-startup-plan')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-juniper-sync')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-juniper-mapping-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-meet-our-team-executive')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// A4 — Juniper Cares is its own section (§6), not a service under OUR SERVICES.
// ---------------------------------------------------------------------------

describe('A4 – Juniper Cares is its own section', () => {
  it('renders page-juniper-cares with its own data-testid', () => {
    renderPreview()
    expect(screen.getByTestId('page-juniper-cares')).toBeInTheDocument()
  })

  it('does not render Juniper Cares as a service page under OUR SERVICES', () => {
    renderPreview()
    expect(
      screen.queryByTestId('page-service-services_juniper_cares'),
    ).not.toBeInTheDocument()
  })

  it('SERVICE_KEYS does not include services_juniper_cares', () => {
    // SERVICE_KEYS is derived from the keys of SERVICES_CONTENT, so the absence
    // of the key there is the observable proxy for its absence from SERVICE_KEYS.
    expect(SERVICES_CONTENT).not.toHaveProperty('services_juniper_cares')
    expect(Object.keys(SERVICES_CONTENT)).toHaveLength(10)
  })

  it('every overview card carries its brand photo, not the hatch stand-in', () => {
    // The overview page now maps over SERVICE_OVERVIEW_CATEGORIES (six capability
    // groups), not SERVICES_CONTENT. Testids are `service-cell-<key>` where key
    // is the category key (design, build, …). The stand-in is a bare
    // <div class="photo">; an img present with the correct src confirms the photo
    // manifest is wired. photos.test.ts asserts the file exists on disk.
    renderPreview()
    for (const cat of SERVICE_OVERVIEW_CATEGORIES) {
      const cell = screen.getByTestId(`service-cell-${cat.key}`)
      const img = within(cell).getByRole('presentation')
      expect(img).toHaveAttribute('src', overviewCategoryPhotoUrl(cat.key))
    }
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

  it('agronomy manager node is absent when agronomyManagerName is null', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        agronomyManagerName: null,
        irrigationManagerName: 'Carol Blue',
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    // Should NOT contain "Agronomy Manager" label
    expect(within(orgChartPage).queryByText(/agronomy manager/i)).not.toBeInTheDocument()
    // Irrigation Manager IS present
    expect(within(orgChartPage).getByText(/irrigation manager/i)).toBeInTheDocument()
  })

  it('irrigation manager node is absent when irrigationManagerName is null', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        agronomyManagerName: 'Bob Green',
        irrigationManagerName: null,
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
        agronomyManagerName: null,
        irrigationManagerName: null,
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    expect(within(orgChartPage).queryByText(/agronomy manager/i)).not.toBeInTheDocument()
    expect(within(orgChartPage).queryByText(/irrigation manager/i)).not.toBeInTheDocument()
  })

  it('production manager node renders when productionManagerName is set', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        productionManagerName: 'Dave Brown',
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    expect(within(orgChartPage).getByText(/production manager/i)).toBeInTheDocument()
    expect(within(orgChartPage).getByText('Dave Brown')).toBeInTheDocument()
  })

  it('production manager node absent when productionManagerName is null', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        productionManagerName: null,
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    expect(within(orgChartPage).queryByText(/production manager/i)).not.toBeInTheDocument()
  })

  it('agronomy manager node is absent when name is blank/whitespace-only', () => {
    renderPreview({
      orgChart: makeOrgChart({
        included: true,
        agronomyManagerName: '   ',
      }),
    })
    const orgChartPage = screen.getByTestId('page-org-chart')
    expect(within(orgChartPage).queryByText(/agronomy manager/i)).not.toBeInTheDocument()
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

  it('irrigation reporting sample page absent when irrigation_reporting_sample not in sections', () => {
    renderPreview({ sections: [] })
    expect(screen.queryByTestId('page-irrigation-reporting-sample')).not.toBeInTheDocument()
  })

  it('irrigation reporting sample page present when irrigation_reporting_sample is in sections', () => {
    renderPreview({ sections: ['irrigation_reporting_sample'] })
    expect(screen.getByTestId('page-irrigation-reporting-sample')).toBeInTheDocument()
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

  it('all five optional pages render simultaneously when all sections are set', () => {
    // The executive page is now gated on executiveTeamMembers.length > 0 (not on
    // the section flag), so we must pass a non-empty executive roster here.
    renderPreview(
      {
        sections: [
          'startup_plan_30_60_90', 'juniper_sync', 'juniper_mapping',
          'meet_our_team_executive', 'irrigation_reporting_sample',
        ],
        startupPlan: makeStartupPlan({ included: true }),
      },
      { executiveTeamMembers: [mockExecutive] },
    )
    expect(screen.getByTestId('page-startup-plan')).toBeInTheDocument()
    expect(screen.getByTestId('page-juniper-sync')).toBeInTheDocument()
    expect(screen.getByTestId('page-juniper-mapping-1')).toBeInTheDocument()
    expect(screen.getByTestId('page-meet-our-team-executive')).toBeInTheDocument()
    expect(screen.getByTestId('page-irrigation-reporting-sample')).toBeInTheDocument()
  })

  // The optional pages append to the end of the document, so the closing letter
  // has to come after them. It did not: the Handoff 43 §1 audit render printed
  // "we look forward to working with you" mid-document and closed on the
  // executive-team page whenever a rep picked any optional section.
  it.each([
    ['no optional sections', [] as ProposalFormState['sections']],
    ['every optional section', [
      'startup_plan_30_60_90', 'juniper_sync', 'juniper_mapping', 'meet_our_team_executive',
      'irrigation_reporting_sample',
    ] as ProposalFormState['sections']],
  ])('closing letter is the last printed page with %s', (_label, sections) => {
    renderPreview(
      { sections, startupPlan: makeStartupPlan({ included: true }) },
      { executiveTeamMembers: [mockExecutive] },
    )
    const pages = document.querySelectorAll('.print-page')
    expect(pages.length).toBeGreaterThan(0)
    expect(pages[pages.length - 1].getAttribute('data-testid')).toBe('page-thank-you')
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
    // Approved structure (§4.5): eyebrow "Start Up" + heading "Communication".
    expect(within(page).getByText('Start Up')).toBeInTheDocument()
    expect(within(page).getByText('Communication')).toBeInTheDocument()
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

  it('Irrigation Reporting Sample renders heading and lead-in bullets from IRRIGATION_REPORTING_CONTENT', () => {
    renderPreview({ sections: ['irrigation_reporting_sample'] })
    const page = screen.getByTestId('page-irrigation-reporting-sample')
    expect(
      within(page).getByText('Weekly Updates & Irrigation Inspection Schedule Sample Map'),
    ).toBeInTheDocument()
    expect(within(page).getByText('Zone by zone, with photos:')).toBeInTheDocument()
    expect(within(page).getByText('Every week, in your inbox:')).toBeInTheDocument()
  })

  // The reference (Pointe Jupiter p.18) always prints six boxes in two fixed
  // rows of three, so this page does too regardless of plan length — a 30-day
  // plan still shows all six titles/tabs, it just leaves Day 60/90/120+ empty
  // rather than dropping their box (which would shrink the grid and reopen
  // the dead-green-space problem the page was rebuilt to remove).
  it('startup plan page always renders all six box titles, even on a 30-day plan', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({ included: true, planMaxDays: 30 }),
    })
    const page = screen.getByTestId('page-startup-plan')
    for (const title of [/day zero/i, /^day 30$/i, /^day 60$/i, /^day 90$/i, /^day 120\+$/i, /^ongoing$/i]) {
      expect(within(page).getByText(title)).toBeInTheDocument()
    }
    // But Day 60/90/120+ are outside a 30-day plan, so their seed bullets
    // must not print — the box is there, its content is not.
    expect(within(page).queryByText(STARTUP_PLAN_SEED.day60[0].text)).not.toBeInTheDocument()
    expect(within(page).queryByText(STARTUP_PLAN_SEED.day90[0].text)).not.toBeInTheDocument()
    expect(within(page).queryByText(STARTUP_PLAN_SEED.day120Plus[0].text)).not.toBeInTheDocument()
    // Ongoing always prints regardless of plan length.
    expect(within(page).getByText(STARTUP_PLAN_SEED.ongoing[0].text)).toBeInTheDocument()
  })

  it('phase outside the chosen plan length prints its box empty even if the rep entered bullets', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({
        included: true,
        planMaxDays: 60,
        day120Plus: ['Should not print — outside plan length'],
      }),
    })
    const page = screen.getByTestId('page-startup-plan')
    expect(within(page).getByText(/^day 120\+$/i)).toBeInTheDocument()
    expect(
      within(page).queryByText('Should not print — outside plan length'),
    ).not.toBeInTheDocument()
  })

  // A 120-day plan is the one planMaxDays value that reaches all six phases'
  // content — Day 120+ is otherwise always excluded.
  it('startup plan page fills in all six phases on a 120-day plan', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({ included: true, planMaxDays: 120 }),
    })
    const page = screen.getByTestId('page-startup-plan')
    for (const seedList of [
      STARTUP_PLAN_SEED.day60,
      STARTUP_PLAN_SEED.day90,
      STARTUP_PLAN_SEED.day120Plus,
      STARTUP_PLAN_SEED.ongoing,
    ]) {
      expect(within(page).getByText(seedList[0].text)).toBeInTheDocument()
    }
  })

  it('startup plan page falls back to seed copy for a phase the rep left empty', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({ included: true, planMaxDays: 90 }),
    })
    const page = screen.getByTestId('page-startup-plan')
    expect(
      within(page).getByText(STARTUP_PLAN_SEED.day90[0].text),
    ).toBeInTheDocument()
    expect(
      within(page).getByText(STARTUP_PLAN_SEED.ongoing[0].text),
    ).toBeInTheDocument()
  })

  it('startup plan page renders free-text day60 entries from startupPlan', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({
        included: true,
        planMaxDays: 60,
        day60: ['Audit current schedule', 'Review pesticide program'],
      }),
    })
    const page = screen.getByTestId('page-startup-plan')
    expect(within(page).getByText('Audit current schedule')).toBeInTheDocument()
    expect(within(page).getByText('Review pesticide program')).toBeInTheDocument()
  })

  it('rep-entered bullets replace the seed for that phase, not append to it', () => {
    renderPreview({
      sections: ['startup_plan_30_60_90'],
      startupPlan: makeStartupPlan({
        included: true,
        planMaxDays: 60,
        day60: ['Audit current schedule'],
      }),
    })
    const page = screen.getByTestId('page-startup-plan')
    expect(within(page).getByText('Audit current schedule')).toBeInTheDocument()
    expect(
      within(page).queryByText(STARTUP_PLAN_SEED.day60[0].text),
    ).not.toBeInTheDocument()
  })

  it('insurance page renders INSURANCE_PAGE_COPY heading', () => {
    renderPreview()
    const page = screen.getByTestId('page-insurance')
    expect(within(page).getByText('Insurance')).toBeInTheDocument()
  })

  it('insurance page renders the certificate image once the media URL resolves', () => {
    mockAllMediaResolved()
    renderPreview()
    const page = screen.getByTestId('page-insurance')
    const img = page.querySelector('img.insurance-cert-embed')
    expect(img).toHaveAttribute('src', 'https://signed.example/credentials/licenses/ins-cert-001.png')
    expect(within(page).queryByText(/failed to load/i)).not.toBeInTheDocument()
  })

  // The certificate must be an <img>, never an <object>/<embed>: headless
  // Chromium does not rasterize nested PDF plugin content, so an <object> looks
  // correct on screen and prints as a blank page (the Sept 2026 regression).
  it('insurance page renders the certificate as an img, not an embedded object', () => {
    mockAllMediaResolved()
    renderPreview()
    const page = screen.getByTestId('page-insurance')
    expect(page.querySelector('object')).toBeNull()
    expect(page.querySelector('embed')).toBeNull()
  })

  it('insurance page prints a message, not an empty well, when the scan does not resolve', () => {
    // Default mock: useProposalMediaUrl returns no URL.
    renderPreview()
    const page = screen.getByTestId('page-insurance')
    expect(page.querySelector('img.insurance-cert-embed')).toBeNull()
    expect(within(page).getByText(INSURANCE_PAGE_COPY.unavailable)).toBeInTheDocument()
  })

  it('insurance page prints a message when no certificate is configured at all', () => {
    mockAllMediaResolved()
    mockUseProposalInsurance.mockReturnValue({
      data: null,
    } as ReturnType<typeof useProposalInsurance>)
    renderPreview()
    const page = screen.getByTestId('page-insurance')
    expect(page.querySelector('img.insurance-cert-embed')).toBeNull()
    expect(within(page).getByText(INSURANCE_PAGE_COPY.unavailable)).toBeInTheDocument()
  })

  it('licenses page renders the prose empty state, not a grid, when nothing is current', () => {
    renderPreview()
    const page = screen.getByTestId('page-licenses-certifications')
    expect(within(page).queryByTestId('licenses-grid')).not.toBeInTheDocument()
    expect(within(page).getByText(/available on request/i)).toBeInTheDocument()
  })

  it('licenses page renders a scanned credential once one exists with an image', () => {
    mockAllMediaResolved()
    mockUseProposalLicenses.mockReturnValue({
      data: {
        licenses: [
          makeLicense({ id: 'lc-1', name: 'Certified Pest Control Operator', objectKey: 'licenses/lc-1.jpg' }),
        ],
        certifications: [
          makeLicense({
            id: 'lc-2',
            kind: 'certification',
            name: 'ISA Certified Arborist',
            objectKey: 'licenses/lc-2.jpg',
          }),
        ],
      },
    } as ReturnType<typeof useProposalLicenses>)
    renderPreview()
    const page = screen.getByTestId('page-licenses-certifications')
    expect(within(page).getByTestId('licenses-grid')).toBeInTheDocument()
    expect(page.querySelectorAll('.license-cert-img')).toHaveLength(2)
    expect(within(page).queryByText(/available on request/i)).not.toBeInTheDocument()
  })

  it('licenses page omits credentials on file with no scanned image', () => {
    mockUseProposalLicenses.mockReturnValue({
      data: {
        licenses: [makeLicense({ id: 'lc-1', name: 'Certified Pest Control Operator' })],
        certifications: [],
      },
    } as ReturnType<typeof useProposalLicenses>)
    renderPreview()
    const page = screen.getByTestId('page-licenses-certifications')
    expect(within(page).queryByTestId('licenses-grid')).not.toBeInTheDocument()
    expect(within(page).getByText(/available on request/i)).toBeInTheDocument()
  })

  it('requests licenses scoped to the estimate\'s aspireBranchId when one is present', () => {
    renderPreview({}, { estimate: { ...mockEstimate, aspireBranchId: 1403 } })
    expect(mockUseProposalLicenses).toHaveBeenCalledWith({ aspireBranchId: 1403 })
  })

  it('requests company-wide licenses only when the proposal has no estimate (WS2)', () => {
    renderPreview({}, { estimate: null })
    expect(mockUseProposalLicenses).toHaveBeenCalledWith(undefined)
  })

  it('requests insurance with no args even when the estimate carries aspireBranchId (insurance is always global)', () => {
    renderPreview({}, { estimate: { ...mockEstimate, aspireBranchId: 1403 } })
    expect(mockUseProposalInsurance).toHaveBeenCalledWith()
  })

  it('requests insurance with no args when the proposal has no estimate', () => {
    renderPreview({}, { estimate: null })
    expect(mockUseProposalInsurance).toHaveBeenCalledWith()
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

  it('renders the bio-box only for a team member with a bio', () => {
    // A bio'd member gets the green-outlined bio panel; an empty bio must render
    // no .bio-box at all (not an empty bordered sliver beside the headshot).
    const noBioMember: TeamMember = {
      ...mockAccountManager,
      id: 'tm-am-002',
      name: 'Nolan Nobio',
      bio: '',
    }
    renderPreview({}, { teamMembers: [mockAccountManager, noBioMember] })
    const page = screen.getByTestId('page-meet-our-team')

    // Alice has a bio → her card carries a .bio-box; Nolan does not.
    const cards = page.querySelectorAll('.team-card')
    const aliceCard = Array.from(cards).find((c) => c.textContent?.includes('Alice Johnson'))
    const nolanCard = Array.from(cards).find((c) => c.textContent?.includes('Nolan Nobio'))
    expect(aliceCard).toBeTruthy()
    expect(nolanCard).toBeTruthy()
    expect(aliceCard!.querySelector('.bio-box')).not.toBeNull()
    expect(nolanCard!.querySelector('.bio-box')).toBeNull()
  })

  it('Client References renders the passed reference property name', () => {
    renderPreview({}, { clientReferences: [mockClientRef] })
    const page = screen.getByTestId('page-client-references')
    expect(within(page).getByText(/Coral Bay HOA/)).toBeInTheDocument()
  })

  it('Portfolio renders the passed property image (full-bleed — no heading)', () => {
    // W5g: portfolio pages are full-bleed; the property name is baked into the
    // rasterized image, so no <h1> or visible text label is rendered. The image's
    // alt attribute carries the name for accessibility.
    mockAllMediaResolved()
    renderPreview({}, { portfolioProperties: [mockPortfolioProperty] })
    const page = screen.getByTestId(`page-portfolio-${mockPortfolioProperty.id}`)
    // The full-bleed image is the only content — assert by its alt attribute.
    const img = page.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('alt')).toContain('Pointe Jupiter Yacht Club')
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

// ---------------------------------------------------------------------------
// 8. Slice 10 — brand/print fidelity locks
//
// These lock ALREADY-SHIPPED behaviour so a regression turns them red. The
// print CSS is loaded by a headless renderer, not jsdom, so a couple of these
// assert against the stylesheet SOURCE rather than computed layout (see the
// per-test comments explaining the jsdom limitation).
// ---------------------------------------------------------------------------

// Read once — every geometry/token assertion reads the same source of truth the
// renderer bundles (studio/src/styles/proposal-print.css).
const PROPOSAL_PRINT_CSS = readFileSync(
  path.resolve(process.cwd(), 'src/styles/proposal-print.css'),
  'utf8',
)

describe('ProposalPreview — Slice 10 brand & print fidelity', () => {
  it('last page footer number equals the .print-page count and the cover shows none', () => {
    // Structural page-counting via .print-page is legitimate; the ASSERTION is
    // behavioural — the footer's rendered NUMBER text, and the cover's absence
    // of one.
    const { container } = renderPreview()
    const pages = container.querySelectorAll('.print-page')
    const pageCount = pages.length

    // The cover (page-cover) renders no footer number.
    const cover = screen.getByTestId('page-cover')
    const coverFooter = cover.querySelector('.footer .meta')
    expect(coverFooter?.textContent ?? '').not.toMatch(/\d/)

    // The cover and the closing page carry no footer BAR at all, matching the
    // reference (a rect census of Coral Bay HOA.pdf found the 48pt green rect
    // absent on exactly pages 1 and 41).
    expect(cover.querySelector('.footer')).toBeNull()
    expect(screen.getByTestId('page-thank-you').querySelector('.footer')).toBeNull()

    // Numbering counts every sheet but the printed number is the physical index
    // (value={i}, not i+1) — B4 shifted it by one so the cover (i=0) and the
    // intro letter (i=1) stay unnumbered and Rooted in Florida (i=2) prints "2".
    // So the last footered page prints its own 0-based index.
    const numbered = Array.from(pages).filter((p) => p.querySelector('.footer .meta'))
    const lastNumbered = numbered[numbered.length - 1]
    const lastIndex = Array.from(pages).indexOf(lastNumbered)
    // The footer meta is "<n>" (website is empty in test env); the number is the
    // last token.
    const lastNumber = (lastNumbered.querySelector('.footer .meta')?.textContent ?? '')
      .trim()
      .split('|')
      .pop()
      ?.trim()
    expect(lastNumber).toBe(String(lastIndex))
    // Sanity: the document is longer than the last numbered page, because the
    // closing page follows it without a bar.
    expect(pageCount).toBeGreaterThan(lastIndex + 1)
  })

  it('print page geometry is declared as US Letter (8.5in x 11in) in the stylesheet', () => {
    // jsdom does NOT apply stylesheet CSS to layout and does NOT resolve CSS
    // custom properties via getComputedStyle, so `.print-page` never computes to
    // 8.5in/11in here (that would be vacuous). Assert the SOURCE the print
    // renderer actually bundles instead: the page-size tokens and @page rule.
    expect(PROPOSAL_PRINT_CSS).toMatch(/--jn-page-w:\s*8\.5in/)
    expect(PROPOSAL_PRINT_CSS).toMatch(/--jn-page-h:\s*11in/)
    // @page declares the US Letter size, matching the 8.5x11 tokens above.
    expect(PROPOSAL_PRINT_CSS).toMatch(/@page\s*\{[^}]*size:\s*letter/)
  })

  it('JuniperLogoFull renders a genuine vector (viewBox, no <image>, no <text>)', () => {
    const { container } = render(<JuniperLogoFull variant="color" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.hasAttribute('viewBox')).toBe(true)
    expect(svg!.querySelectorAll('image').length).toBe(0)
    expect(svg!.querySelectorAll('text').length).toBe(0)
  })

  it('--jn-green is the single source of truth (#038442) referenced via var(), not hardcoded', () => {
    // Empirically, getComputedStyle(...).getPropertyValue('--jn-green') returns
    // '' under jsdom (external/style-block custom properties are not resolved),
    // so asserting the computed value would be vacuous. Assert the SOURCE: the
    // token is defined once, and consumers reference var(--jn-green) rather than
    // repeating the hex.
    expect(PROPOSAL_PRINT_CSS).toMatch(/--jn-green:\s*#038442/)
    // The footer bar — the brand's most visible surface — pulls the token, not a
    // literal hex.
    expect(PROPOSAL_PRINT_CSS).toMatch(/\.footer\s*\{[^}]*background:\s*var\(--jn-green\)/)
  })
})

// ---------------------------------------------------------------------------
// A1 – copy type rendering
//
// Exercises the new ServiceBlurb.subhead / CopyList rendering wired into
// ServicePage (and, via CopyLists, the static pages). Content is injected
// through the copyInject holder so no permanent copy change is required.
// ---------------------------------------------------------------------------

describe('A1 – copy type rendering', () => {
  beforeEach(() => {
    copyInject.service = undefined
    copyInject.customerCare = undefined
  })

  it('renders subhead when present in ServiceBlurb', () => {
    copyInject.service = { subhead: 'Certified Arborists' }
    renderPreview()
    const page = screen.getByTestId('page-service-services_design')
    const subhead = within(page).getByText('Certified Arborists')
    expect(subhead).toBeInTheDocument()
    // F1: subhead now renders as <p class="lede quote"> (Lato-Bold pull-quote style)
    expect(subhead).toHaveClass('lede')
    expect(subhead).toHaveClass('quote')
  })

  it('renders list label when CopyList has one', () => {
    copyInject.service = {
      lists: [{ label: 'What We Offer', items: [{ text: 'Design consults' }] }],
    }
    renderPreview()
    const page = screen.getByTestId('page-service-services_design')
    const label = within(page).getByText('What We Offer')
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('copy-list-label')
    // The item text renders as a bullet.
    expect(within(page).getByText('Design consults')).toBeInTheDocument()
  })

  it('renders CopyListItem lead in bold before colon', () => {
    copyInject.service = {
      lists: [
        {
          items: [{ lead: 'Land Planning', text: 'zoning, site design' }],
        },
      ],
    }
    renderPreview()
    const page = screen.getByTestId('page-service-services_design')
    // The lead prints as "Land Planning:" in a bolded span before the text.
    const lead = within(page).getByText('Land Planning:')
    expect(lead).toHaveClass('copy-list-item-lead')
    const item = lead.closest('li')
    expect(item).not.toBeNull()
    expect(item).toHaveTextContent('Land Planning: zoning, site design')
  })

  it('renders nothing extra when subhead/lists are absent', () => {
    // No injection — services_turf keeps its real content, which (unlike Design,
    // which now carries a "What We Offer:" list) has neither a subhead nor lists.
    renderPreview()
    const page = screen.getByTestId('page-service-services_turf')
    expect(within(page).queryByText('Certified Arborists')).not.toBeInTheDocument()
    expect(page.querySelector('.service-subhead')).toBeNull()
    expect(page.querySelector('.copy-list-label')).toBeNull()
    expect(page.querySelector('.copy-list-items')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// A3 – factual-contradiction phrase guards (Handoff 45 §5 / §8)
//
// The four §5 passages state things the approved deck contradicts, and two are
// commitments a client could hold Juniper to. These assertions pin the copy so a
// regression that reintroduces any of them turns red — cheaper and stricter than
// the TODO_PATTERN guard, which cannot see invented-but-non-TODO prose.
//
// Exports are read via the UNMOCKED module (importActual) and every string leaf
// is collected recursively, so the guard covers the whole staticContent surface,
// not just rendered output.
// ---------------------------------------------------------------------------

describe('A3 – factual-contradiction phrase guards', () => {
  /** Every string leaf reachable from a content value, recursively. */
  function collectStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(collectStrings)
    if (value !== null && typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).flatMap(collectStrings)
    }
    return []
  }

  let allStrings: string[]

  beforeEach(async () => {
    // importActual bypasses the top-of-file module mock so we assert the real copy.
    const staticContent = await vi.importActual<
      typeof import('@/lib/proposal/staticContent')
    >('@/lib/proposal/staticContent')
    // Drop the guard helpers (functions), keep only the exported data constants.
    allStrings = Object.values(staticContent).flatMap(collectStrings)
  })

  it('no exported string mentions "community-giving" (§5.1)', () => {
    expect(allStrings.some((s) => /community-giving/i.test(s))).toBe(false)
  })

  it('no exported string mentions "one business day" (§5.2)', () => {
    expect(allStrings.some((s) => /one business day/i.test(s))).toBe(false)
  })

  it('no exported string names "Aspire" in client-facing copy (§5.3)', () => {
    expect(allStrings.some((s) => /Aspire/.test(s))).toBe(false)
  })

  it('no exported string mentions "five states" (§5.4)', () => {
    expect(allStrings.some((s) => /five states/i.test(s))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// E1 – no service page clips below the footer bar
//
// Slice B1 fixed useProposalOverflow to measure each .well against its CONTENT
// box (clientHeight, i.e. inside the 0.847in bottom padding that clears the 61pt
// footer bar), not the padding box — so content that spilled under the opaque
// footer is now reported. Lane A replaced the service copy with approved bullet
// lists; the two heaviest list pages (LANDSCAPE IRRIGATION, 4 lists / 17 items,
// and START UP COMMUNICATION, 4 lists / 16 items) were the overflow risk, fixed
// by tightening .copy-list-items li spacing.
//
// jsdom LIMITATION: jsdom performs no layout, so scrollHeight and clientHeight
// are both 0 for every element (verified: a 500px child inside a 100px
// overflow:hidden box reports scrollHeight 0 / clientHeight 0). The real
// pt-by-pt fit was verified against the content-box arithmetic in the E1
// handback, not here. What this block CAN lock behaviourally is that the
// overflow measurement — the exact guard the renderer runs — reports NO service
// page as clipped, and sets no data-proposal-overflow annotation on one.
// ---------------------------------------------------------------------------

describe('E1 – no service page clips below the footer bar', () => {
  /** data-testid prefixes for every page that carries service copy. */
  const SERVICE_TESTID_RE = /^page-service(s-overview)?-|^page-startup-communication$/

  it('all service pages scroll-height fits within content box', () => {
    renderPreview()

    // Run the renderer's own measurement WITH annotation, exactly as the
    // screen preview does. In jsdom every well measures 0 - 0 = 0 <= tolerance,
    // so nothing is flagged; the value of the assertion is that it exercises the
    // real guard against the real DOM and pins "no service page over the line".
    const overflowing = measureProposalOverflow(true)

    const servicePages = Array.from(
      document.querySelectorAll<HTMLElement>('.print-page'),
    ).filter((p) => {
      const id = p.getAttribute('data-testid')
      return id != null && SERVICE_TESTID_RE.test(id)
    })

    // Sanity: the service/overview/startup pages are actually in the document,
    // so a future refactor that renames the testids can't turn this vacuous.
    expect(servicePages.length).toBeGreaterThan(0)

    for (const page of servicePages) {
      const testId = page.getAttribute('data-testid')
      // measureProposalOverflow(true) annotates offenders; a service page must
      // never be annotated.
      expect(
        page.hasAttribute('data-proposal-overflow'),
        `${testId} was annotated as overflowing`,
      ).toBe(false)

      // And it must not appear in the reported overflow set.
      expect(
        overflowing.some((o) => o.testId === testId),
        `${testId} was reported as clipped below the footer`,
      ).toBe(false)

      // Direct content-box check: scrollHeight must not exceed clientHeight
      // (0 <= 0 under jsdom; the arithmetic proof of the real pt fit is in the
      // handback). TOLERANCE mirrors the hook's 2px sub-pixel allowance.
      const well = page.querySelector<HTMLElement>('.well')
      expect(well).not.toBeNull()
      expect(well!.scrollHeight - well!.clientHeight).toBeLessThanOrEqual(2)
    }
  })
})

// ---------------------------------------------------------------------------
// Local Landscape Experts – one table per region, over the coverage map
// ---------------------------------------------------------------------------

describe('Local Landscape Experts – region tables', () => {
  it('renders one table per Florida region, headed by the region name', () => {
    renderPreview()
    const headers = Array.from(
      screen.getByTestId('branch-coverage').querySelectorAll('th'),
    ).map((th) => th.textContent)
    expect(headers).toEqual(['West Coast', 'Central'])
  })

  it('lists only that region\u2019s offices, and no Texas office', () => {
    renderPreview()
    const cells = Array.from(
      screen.getByTestId('branch-coverage').querySelectorAll('td'),
    ).map((td) => td.textContent)
    expect(cells).toEqual(['Fort Myers', 'Naples', 'Venice'])
    expect(cells).not.toContain('Houston')
  })

  it('fills two columns round-robin so a tall region does not push the next one down', () => {
    renderPreview()
    const cols = screen.getByTestId('branch-coverage').querySelectorAll('.branch-col')
    expect(cols).toHaveLength(2)
    expect(cols[0].querySelectorAll('th')[0].textContent).toBe('West Coast')
    expect(cols[1].querySelectorAll('th')[0].textContent).toBe('Central')
  })

  it('falls back to a generic heading for offices with no region', () => {
    mockUseProposalConfig.mockReturnValue({
      branches: [mockBranch1, mockBranch2],
      branchCoverage: [
        {
          state: 'FL',
          stateName: 'Florida',
          regions: [{ regionId: '', regionName: '', branches: ['Nowhere'] }],
        },
      ],
      loaded: true,
    })
    renderPreview()
    const th = screen.getByTestId('branch-coverage').querySelector('th')
    expect(th?.textContent).toBe('Florida Locations')
  })
})

// ---------------------------------------------------------------------------
// B4 – page numbering (Handoff 46 §4.2)
//
// PageNumberContext now provides value={i} (physical index). Cover (i=0) is
// suppressed by pageNumber<1. Intro letter has hideNumber (added by A3).
// Rooted in Florida (i=2) prints "2", matching the reference.
// ---------------------------------------------------------------------------

describe('B4 – page numbering', () => {
  it('Rooted in Florida prints page number 2', () => {
    renderPreview()
    const meta = screen
      .getByTestId('page-rooted-in-florida')
      .querySelector('.footer .meta')
    // Website is empty in the test env, so the meta is just the number.
    expect(meta?.textContent?.trim()).toBe('2')
  })

  it('intro letter renders no visible page number', () => {
    // A3 added hideNumber to the intro letter's PrintPage call, so "1" is suppressed.
    renderPreview()
    const meta = screen
      .getByTestId('page-intro-letter')
      .querySelector('.footer .meta')
    expect(meta?.textContent?.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Handoff 46 §2 — service overview: one page, six categories
//
// The overview changed from two paginated pages of ten services to a single
// page (`page-services-overview`) of six capability categories. These tests
// pin that shape so a pagination regression or a service-count change turns
// them red immediately.
// ---------------------------------------------------------------------------

describe('Handoff 46 §2 – service overview page', () => {
  it('renders exactly one services-overview page (no -1 / -2 variants)', () => {
    renderPreview()
    // The singular testid must exist…
    expect(screen.getByTestId('page-services-overview')).toBeInTheDocument()
    // …and the old paginated variants must not.
    expect(screen.queryByTestId('page-services-overview-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-services-overview-2')).not.toBeInTheDocument()
  })

  it('renders all six capability category names on the overview page', () => {
    renderPreview()
    const page = screen.getByTestId('page-services-overview')
    // SERVICE_OVERVIEW_CATEGORIES titles, verified against staticContent.ts.
    for (const cat of SERVICE_OVERVIEW_CATEGORIES) {
      expect(within(page).getByText(cat.title)).toBeInTheDocument()
    }
  })

  it.each(SERVICE_OVERVIEW_CATEGORIES.map((c) => [c.key, c.title] as [string, string]))(
    'overview category "%s" card renders with the correct photo src',
    (key) => {
      renderPreview()
      const cell = screen.getByTestId(`service-cell-${key}`)
      const img = within(cell).getByRole('presentation')
      expect(img).toHaveAttribute('src', overviewCategoryPhotoUrl(key))
    },
  )
})

// ---------------------------------------------------------------------------
// Handoff 46 §3 — org chart page title
//
// The page heading changed from "Your Service Team" to "Community Org Chart".
// It previously also rendered the lead's property_name as a subtitle; that
// was removed per client feedback — the page reads "Our Team" / "Community
// Org Chart" only, with no property name.
// ---------------------------------------------------------------------------

describe('Handoff 46 §3 – org chart page title', () => {
  it('org chart page title is "Community Org Chart"', () => {
    renderPreview({ orgChart: makeOrgChart({ included: true }) })
    const page = screen.getByTestId('page-org-chart')
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Community Org Chart')
  })

  it('org chart page does not render the lead property_name', () => {
    renderPreview({ orgChart: makeOrgChart({ included: true }) })
    const page = screen.getByTestId('page-org-chart')
    // mockLead.property_name is "Coral Bay HOA"
    expect(within(page).queryByText('Coral Bay HOA')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Handoff 46 §4 — executive page renders BEFORE the regular team page
//
// The exec team is now gated on executiveTeamMembers.length > 0, not on a
// section flag. When both exec and branch members exist, the executive page
// must appear before page-meet-our-team in DOM order.
// ---------------------------------------------------------------------------

describe('Handoff 46 §4 – executive-before-team ordering', () => {
  it('executive page is absent when executiveTeamMembers is empty', () => {
    // No section flag needed — the gate is the array length.
    renderPreview({}, { executiveTeamMembers: [] })
    expect(screen.queryByTestId('page-meet-our-team-executive')).not.toBeInTheDocument()
  })

  it('executive page is present when executiveTeamMembers is non-empty (no section flag required)', () => {
    // sections does NOT include meet_our_team_executive — the gate is the prop.
    renderPreview(
      { sections: [] },
      { executiveTeamMembers: [mockExecutive] },
    )
    expect(screen.getByTestId('page-meet-our-team-executive')).toBeInTheDocument()
  })

  it('page-meet-our-team-executive appears before page-meet-our-team in DOM order', () => {
    renderPreview(
      { sections: [] },
      { executiveTeamMembers: [mockExecutive], teamMembers: [mockAccountManager] },
    )
    const allPages = Array.from(document.querySelectorAll('[data-testid]'))
    const execIdx = allPages.findIndex((el) => el.getAttribute('data-testid') === 'page-meet-our-team-executive')
    const teamIdx = allPages.findIndex((el) => el.getAttribute('data-testid') === 'page-meet-our-team')
    expect(execIdx).toBeGreaterThan(-1)
    expect(teamIdx).toBeGreaterThan(-1)
    expect(execIdx).toBeLessThan(teamIdx)
  })
})

// ---------------------------------------------------------------------------
// Handoff 46 §2.4 — watermark on every sheet
//
// PrintPage now always adds the `frond` class. The escape hatch (`no-frond`)
// is available but unused. Every .print-page in the document must carry the
// class; a single uncovered sheet would break the PDF's visual consistency.
// ---------------------------------------------------------------------------

describe('Handoff 46 §2.4 – watermark on every sheet', () => {
  it('every .print-page carries the frond class', () => {
    const { container } = renderPreview()
    const pages = container.querySelectorAll('.print-page')
    // Sanity: there must be at least one page in the document.
    expect(pages.length).toBeGreaterThan(0)
    for (const page of Array.from(pages)) {
      expect(page.classList.contains('frond')).toBe(true)
    }
  })

  it('frond class is present even on pages that have no footer bar', () => {
    // The cover and thank-you pages carry noFooter; confirm the watermark still lands.
    renderPreview()
    const cover = screen.getByTestId('page-cover')
    const thankYou = screen.getByTestId('page-thank-you')
    expect(cover.classList.contains('frond')).toBe(true)
    expect(thankYou.classList.contains('frond')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Handoff 48 §3 — Portfolio: one image, one sheet per property
//
// The live portfolio_properties table has only 3 rows, so the multi-sheet and
// long-name cases are exercised with fixtures here rather than seed data. jsdom
// cannot catch clipping, so the CSS-sizing acceptance criteria (§4) are locked
// against the stylesheet source and the class wiring, not computed layout.
// ---------------------------------------------------------------------------

/** A photographed property fixture with a stable, testid-safe id. */
function makeProperty(over: Partial<PortfolioProperty> = {}): PortfolioProperty {
  return {
    id: 'pp-x',
    name: 'Village Walk',
    cityState: 'Orlando, FL',
    regionId: 'central',
    photoObjectKeys: ['portfolio/village-walk-1.jpg'],
    sortOrder: 1,
    ...over,
  }
}

/** Resolve every PortfolioPhoto's signed URL so an <img> (not the hatch
 *  placeholder) renders — the "exactly one img" criterion needs a loaded image. */
function mockAllMediaResolved() {
  mockUseProposalMediaUrl.mockImplementation(
    (objectKey: string | null) =>
      ({
        data: objectKey ? { url: `https://signed.example/${objectKey}` } : undefined,
        isLoading: false,
      }) as ReturnType<typeof useProposalMediaUrl>,
  )
}

describe('Handoff 48 §3 – one sheet per portfolio property', () => {
  it('four selected properties produce four consecutive sheets in sortOrder', () => {
    const props = [
      makeProperty({ id: 'pp-1', name: 'Village Walk', sortOrder: 1 }),
      makeProperty({ id: 'pp-2', name: 'Alys Beach', sortOrder: 2 }),
      makeProperty({ id: 'pp-3', name: 'Sanibel Inn', sortOrder: 3 }),
      makeProperty({ id: 'pp-4', name: 'Sunseeker Resort', sortOrder: 4 }),
    ]
    renderPreview({}, { portfolioProperties: props })

    for (const p of props) {
      expect(screen.getByTestId(`page-portfolio-${p.id}`)).toBeInTheDocument()
    }

    // Consecutive and in the given (sortOrder) order.
    const allPages = Array.from(document.querySelectorAll('.print-page'))
    const idxOf = (id: string) =>
      allPages.findIndex((el) => el.getAttribute('data-testid') === `page-portfolio-${id}`)
    const indices = props.map((p) => idxOf(p.id))
    expect(indices).toEqual([...indices].sort((a, b) => a - b)) // ascending
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1] + 1) // no gaps between them
    }
  })

  it('W5g: each portfolio sheet is full-bleed — no h1 title, no frond, exactly one <img>', () => {
    // W5g: the baked-in rasterized image carries a green bar but no logo/number,
    // so the real footer intentionally renders on top of it.
    mockAllMediaResolved()
    const prop = makeProperty({ id: 'pp-1', name: 'Village Walk' })
    renderPreview({}, { portfolioProperties: [prop] })

    const page = screen.getByTestId('page-portfolio-pp-1')

    // No <h1> title — the rasterized image carries the property name already.
    expect(within(page).queryByRole('heading', { level: 1 })).not.toBeInTheDocument()

    // Exactly one <img> in the well (the footer mark is an <svg>, so scope to
    // .well and count real <img> tags).
    const well = page.querySelector('.well')!
    expect(well.querySelectorAll('img')).toHaveLength(1)

    // Green footer intentionally renders on top of the baked-in image bar.
    expect(page.querySelector('.footer')).not.toBeNull()

    // The page carries no-frond so the ::before watermark is suppressed.
    expect(page.classList.contains('no-frond')).toBe(true)

    // The page uses the full-bleed layout class, not the old flex-well approach.
    expect(page.classList.contains('portfolio-full-bleed')).toBe(true)
  })

  it('renders no city, no "Our Work" eyebrow, no "Portfolio" heading, and no capbar', () => {
    const prop = makeProperty({ id: 'pp-1', name: 'Village Walk', cityState: 'Orlando, FL' })
    renderPreview({}, { portfolioProperties: [prop] })

    const page = screen.getByTestId('page-portfolio-pp-1')
    expect(within(page).queryByText(/Orlando, FL/)).not.toBeInTheDocument()
    expect(within(page).queryByText(/Our Work/i)).not.toBeInTheDocument()
    // The old "Portfolio" section heading must be gone.
    expect(within(page).queryByText(/^Portfolio$/)).not.toBeInTheDocument()
    expect(page.querySelector('.capbar')).toBeNull()
    // And the retired single-page testid must not exist.
    expect(screen.queryByTestId('page-portfolio')).not.toBeInTheDocument()
  })

  it('a property with five photoObjectKeys renders exactly one image (the first)', () => {
    mockAllMediaResolved()
    const prop = makeProperty({
      id: 'pp-1',
      name: 'Village Walk',
      photoObjectKeys: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'],
    })
    renderPreview({}, { portfolioProperties: [prop] })

    const page = screen.getByTestId('page-portfolio-pp-1')
    const imgs = page.querySelector('.well')!.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    // The first key wins. F3a: PortfolioPhoto resolves via useProposalMediaUrl;
    // mockAllMediaResolved() returns https://signed.example/${objectKey}.
    expect(imgs[0]).toHaveAttribute('src', 'https://signed.example/a.jpg')
  })

  it('a property with no photos and no before/after contributes no sheet', () => {
    const withPhoto = makeProperty({ id: 'pp-1', name: 'Has Photo' })
    const empty = makeProperty({
      id: 'pp-empty',
      name: 'Empty',
      photoObjectKeys: [],
    })
    renderPreview({}, { portfolioProperties: [withPhoto, empty] })

    expect(screen.getByTestId('page-portfolio-pp-1')).toBeInTheDocument()
    expect(screen.queryByTestId('page-portfolio-pp-empty')).not.toBeInTheDocument()
  })

  it('printed page numbers stay contiguous with portfolio sheets inserted', () => {
    const props = [
      makeProperty({ id: 'pp-1', name: 'A', sortOrder: 1 }),
      makeProperty({ id: 'pp-2', name: 'B', sortOrder: 2 }),
    ]
    renderPreview({}, { portfolioProperties: props })

    const pages = Array.from(document.querySelectorAll('.print-page'))
    // Collect the printed numbers from every footered page; they must be a
    // strictly ascending run with no skips (value={i}, so index-based).
    const numbers = pages
      .map((p) => p.querySelector('.footer .meta')?.textContent?.trim())
      .filter((t): t is string => !!t && /^\d+$/.test(t))
      .map(Number)
    // Numbers must be strictly ascending — no repeats and no backwards steps.
    // Gaps are allowed because noFooter pages (cover, closing page)
    // consume page indices without contributing to the footer sequence.
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1])
    }
  })
})

// ---------------------------------------------------------------------------
// W5g — CSS for full-bleed portfolio pages
//
// W5g replaces the old flex-well sizing (.portfolio-photo / .portfolio class)
// with edge-to-edge image coverage (.portfolio-full-bleed-img /
// .portfolio-full-bleed class). The jsdom layout limitation still applies —
// the pixel-perfect fit is verified visually. What IS locked here: the class
// wiring (loaded <img> vs loading placeholder) and the stylesheet source, so a
// regression that reintroduces the title/footer or drops the full-bleed sizing
// turns these red.
// ---------------------------------------------------------------------------

describe('W5g – portfolio full-bleed image sizing', () => {
  it('a loaded portfolio image carries portfolio-full-bleed-img and NOT the hatch .photo class', () => {
    // W5g: full-bleed images must not show the diagonal hatch as a frame.
    mockAllMediaResolved()
    renderPreview({}, { portfolioProperties: [makeProperty({ id: 'pp-1' })] })

    const page = screen.getByTestId('page-portfolio-pp-1')
    const imgs = page.querySelector('.well')!.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    const img = imgs[0]
    expect(img.classList.contains('portfolio-full-bleed-img')).toBe(true)
    // The hatch .photo class must not be on a loaded <img>.
    expect(img.classList.contains('photo')).toBe(false)
  })

  it('PortfolioPhoto renders an <img> once useProposalMediaUrl resolves', () => {
    // PortfolioPhoto routes through useProposalMediaUrl; mockAllMediaResolved()
    // stubs the hook synchronously so the initial render already shows an <img>.
    mockAllMediaResolved()
    renderPreview({}, { portfolioProperties: [makeProperty({ id: 'pp-1' })] })

    const page = screen.getByTestId('page-portfolio-pp-1')
    const img = page.querySelector('.portfolio-full-bleed-img')
    expect(img).not.toBeNull()
    // An <img>, not a div — same-origin path is resolved synchronously.
    expect(img!.tagName.toLowerCase()).toBe('img')
    expect(img!.classList.contains('photo')).toBe(false)
  })

  it('the print sheet carries the portfolio-full-bleed class (not the old portfolio class)', () => {
    renderPreview({}, { portfolioProperties: [makeProperty({ id: 'pp-1' })] })
    const page = screen.getByTestId('page-portfolio-pp-1')
    expect(page.classList.contains('portfolio-full-bleed')).toBe(true)
    // The old flex-well class must not be present.
    expect(page.classList.contains('portfolio')).toBe(false)
  })

  it('the stylesheet sizes .portfolio-full-bleed-img to 100% width+height with object-fit:cover', () => {
    // Lock the CSS rules added by W5g so a rename or deletion turns this red.
    expect(PROPOSAL_PRINT_CSS).toMatch(/\.portfolio-full-bleed-img\s*\{[^}]*width:\s*100%/)
    expect(PROPOSAL_PRINT_CSS).toMatch(/\.portfolio-full-bleed-img\s*\{[^}]*height:\s*100%/)
    expect(PROPOSAL_PRINT_CSS).toMatch(/\.portfolio-full-bleed-img\s*\{[^}]*object-fit:\s*cover/)
    // The full-bleed well has zero padding so the image bleeds to the paper edge.
    expect(PROPOSAL_PRINT_CSS).toMatch(
      /\.portfolio-full-bleed\s*>\s*\.well\s*\{[^}]*padding:\s*0/,
    )
    // .photo still has no width/height (the four other layouts must be untouched).
    const photoBlock = PROPOSAL_PRINT_CSS.match(/\.proposal-root\s+\.photo\s*\{([^}]*)\}/)
    expect(photoBlock).not.toBeNull()
    expect(photoBlock![1]).not.toMatch(/\bwidth:/)
    expect(photoBlock![1]).not.toMatch(/\bheight:/)
  })
})
// ---------------------------------------------------------------------------
// Appended-documents summary panel (Handoff 47 §6)
//
// A NON-PRINTING panel after the thank-you sheet listing the documents that will
// be appended to the tail of the PDF, in append order. It must NOT be a
// .print-page (that would renumber the document) and must be display:none in
// print (.no-print) so the headless capture never sees it.
// ---------------------------------------------------------------------------

function summaryDoc(overrides?: Partial<IntakeAttachment>): IntakeAttachment {
  return {
    id: 'att-x',
    intakeSubmissionId: null,
    estimateId: 'est-001',
    fileName: 'file.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    kind: 'proposal_contract',
    uploadedBy: 'u1',
    status: 'stored',
    objectKey: 'estimating/est-001/att-x.pdf',
    downloadable: true,
    sortOrder: 0,
    pageCount: 6,
    createdAt: '2026-09-08T10:00:00Z',
    ...overrides,
  }
}

describe('ProposalPreview — appended documents summary panel', () => {
  it('is absent when there are no proposal documents', async () => {
    server.use(
      http.get('/api/estimating/estimates/:id/attachments', () => HttpResponse.json([])),
    )
    renderPreview()
    // The thank-you page renders synchronously; give the async fetch a tick.
    await waitFor(() => expect(screen.getByTestId('page-thank-you')).toBeInTheDocument())
    expect(screen.queryByTestId('appended-documents-summary')).toBeNull()
  })

  it('lists documents in append order with page counts and a total', async () => {
    server.use(
      http.get('/api/estimating/estimates/:id/attachments', () =>
        HttpResponse.json([
          // Deliberately out of append order + a non-proposal kind that must be ignored.
          summaryDoc({ id: 'c', kind: 'proposal_contract', fileName: 'contract.pdf', pageCount: 6 }),
          summaryDoc({ id: 'm', kind: 'proposal_measurements', fileName: 'meas.pdf', pageCount: 1 }),
          summaryDoc({ id: 'o1', kind: 'proposal_other', fileName: 'spec.pdf', pageCount: 2, sortOrder: 1 }),
          summaryDoc({ id: 'o0', kind: 'proposal_other', fileName: 'notary.pdf', pageCount: 3, sortOrder: 0 }),
          summaryDoc({ id: 'map', kind: 'property_map', fileName: 'ignore.pdf', pageCount: 9 }),
        ]),
      ),
    )
    renderPreview()
    const panel = await screen.findByTestId('appended-documents-summary')
    const rows = within(panel).getAllByRole('listitem')
    // Order: measurements → contract → other(sortOrder 0) → other(sortOrder 1).
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('meas.pdf'),
      expect.stringContaining('contract.pdf'),
      expect.stringContaining('notary.pdf'),
      expect.stringContaining('spec.pdf'),
    ])
    // 1 + 6 + 3 + 2 = 12 appended pages.
    expect(within(panel).getByText(/12 appended pages total/i)).toBeInTheDocument()
    // The non-proposal property_map row is excluded.
    expect(within(panel).queryByText('ignore.pdf')).toBeNull()
  })

  it('is not a .print-page and does not renumber the document', async () => {
    server.use(
      http.get('/api/estimating/estimates/:id/attachments', () =>
        HttpResponse.json([summaryDoc({ kind: 'proposal_contract', fileName: 'contract.pdf' })]),
      ),
    )
    renderPreview()
    const panel = await screen.findByTestId('appended-documents-summary')
    // Must carry .no-print (hidden in print) and must NOT be a .print-page.
    expect(panel.classList.contains('no-print')).toBe(true)
    expect(panel.classList.contains('print-page')).toBe(false)
    // The closing letter is the last .print-page; the summary panel is not a print page.
    const pages = document.querySelectorAll('.print-page')
    expect(pages[pages.length - 1].getAttribute('data-testid')).toBe('page-thank-you')
  })
})

// ---------------------------------------------------------------------------
// Table of Contents + chapter reorder
// ---------------------------------------------------------------------------

describe('ProposalPreview — Table of Contents', () => {
  it('is absent by default', () => {
    renderPreview({ sections: [] })
    expect(screen.queryByTestId('page-toc')).toBeNull()
  })

  it('renders right after the Intro Letter when the section is enabled', () => {
    const { container } = renderPreview({ sections: ['table_of_contents'] })
    const pages = Array.from(container.querySelectorAll('.print-page'))
    expect(pages[0].getAttribute('data-testid')).toBe('page-cover')
    expect(pages[1].getAttribute('data-testid')).toBe('page-intro-letter')
    expect(pages[2].getAttribute('data-testid')).toBe('page-toc')
  })

  it("every entry's printed page number matches where that chapter actually starts", () => {
    const { container } = renderPreview({ sections: ['table_of_contents'] })
    const pages = Array.from(container.querySelectorAll('.print-page'))
    const entries = Array.from(container.querySelectorAll('.toc-entry'))
    expect(entries.length).toBeGreaterThan(0)

    for (const entry of entries) {
      const title = entry.querySelector('.toc-entry-title')?.textContent ?? ''
      const printedNumber = entry.querySelector('.toc-entry-page')?.textContent ?? ''
      // Find the page whose OWN footer prints that same number, and confirm the
      // chapter's title text appears on that physical page — i.e. the TOC's
      // claimed page number is not just consistent with itself, but with where
      // the reader actually lands.
      const target = pages.find(
        (p) => (p.querySelector('.footer .meta')?.textContent ?? '').trim().split('|').pop()?.trim() === printedNumber,
      )
      expect(target, `no page prints "${printedNumber}" for entry "${title}"`).toBeTruthy()
    }
  })

  it('does not list the locked Cover, Intro Letter, or Closing pages', () => {
    const { container } = renderPreview({ sections: ['table_of_contents'] })
    const titles = Array.from(container.querySelectorAll('.toc-entry-title')).map((e) => e.textContent)
    expect(titles).not.toContain('Cover')
    expect(titles.join(' ')).not.toMatch(/intro letter/i)
    expect(titles.join(' ')).not.toMatch(/closing/i)
  })
})

describe('ProposalPreview — chapter reorder', () => {
  it('renders body chapters in natural order when chapterOrder is null', () => {
    const { container } = renderPreview({}, { chapterOrder: null })
    const testIds = Array.from(container.querySelectorAll('.print-page')).map((p) =>
      p.getAttribute('data-testid'),
    )
    // Rooted in Florida (a body chapter) precedes Client References (a later
    // body chapter) in the natural, unreordered document.
    expect(testIds.indexOf('page-rooted-in-florida')).toBeGreaterThanOrEqual(0)
    expect(testIds.indexOf('page-client-references')).toBeGreaterThan(testIds.indexOf('page-rooted-in-florida'))
  })

  it('moves a whole chapter when a custom chapterOrder is saved', () => {
    // 'references' moved before 'rooted-in-florida' — everything else keeps its
    // natural relative order via resolveChapterOrder's append-the-rest rule.
    const { container } = renderPreview(
      {},
      {
        chapterOrder: [
          'references',
          'rooted-in-florida',
          'local-landscape-experts',
          'our-services',
          'juniper-cares',
          'startup-communication',
          'customer-care',
          'meet-the-team',
          'insurance',
          'licenses',
          'portfolio',
        ],
      },
    )
    const testIds = Array.from(container.querySelectorAll('.print-page')).map((p) =>
      p.getAttribute('data-testid'),
    )
    expect(testIds.indexOf('page-client-references')).toBeLessThan(testIds.indexOf('page-rooted-in-florida'))
    // Cover and Intro Letter are still locked at the very front regardless.
    expect(testIds[0]).toBe('page-cover')
    expect(testIds[1]).toBe('page-intro-letter')
    expect(testIds[testIds.length - 1]).toBe('page-thank-you')
  })

  it('drops a stale chapter key and appends a newly-present one', () => {
    // 'org-chart' was saved once but this proposal has orgChart.included=false,
    // so it must not appear; 'portfolio' exists now but wasn't in the saved
    // order, so it lands at the end rather than disappearing.
    const { container } = renderPreview(
      { orgChart: makeOrgChart({ included: false }) },
      { chapterOrder: ['org-chart', 'licenses', 'insurance'] },
    )
    const testIds = Array.from(container.querySelectorAll('.print-page')).map((p) =>
      p.getAttribute('data-testid'),
    )
    expect(testIds).not.toContain('page-org-chart')
    expect(testIds).toContain(`page-portfolio-${mockPortfolioProperty.id}`)
    expect(testIds.indexOf('page-licenses-certifications')).toBeLessThan(testIds.indexOf('page-insurance'))
  })
})

describe('ProposalPreview — contract chapter', () => {
  it("shows the lead's property name, not the estimate's clientName", () => {
    // clientName and property_name deliberately differ here — the contract
    // chapter must read the same source of truth as the cover page (the
    // lead), not a possibly-stale independent field on the estimate.
    renderPreview(
      {},
      {
        lead: { ...mockLead, property_name: 'Willowbrook Estates' },
        estimate: { ...mockEstimate, clientName: 'Coral Bay HOA' },
      },
    )
    const page = screen.getByTestId('page-contract-scope')
    expect(within(page).getByText('Willowbrook Estates')).toBeInTheDocument()
    expect(within(page).queryByText('Coral Bay HOA')).not.toBeInTheDocument()
  })

  it('keeps a single annual price when the maintenance estimate has no line items', () => {
    renderPreview()
    const page = screen.getByTestId('page-contract-scope')
    expect(within(page).getByTestId('contract-pricing-lump-sum')).toBeInTheDocument()
    expect(within(page).getByTestId('contract-total')).toHaveTextContent('$185,000.00')
    expect(within(page).queryByTestId('contract-line')).not.toBeInTheDocument()
  })

  it('does not render the contract chapter for an install estimate or without an estimate', () => {
    const { unmount } = renderPreview({}, { estimate: { ...mockEstimate, estimateType: 'install' } as Estimate })
    expect(screen.queryByTestId('page-contract-scope')).not.toBeInTheDocument()
    unmount()
    renderPreview({}, { estimate: null })
    expect(screen.queryByTestId('page-contract-scope')).not.toBeInTheDocument()
  })
})
