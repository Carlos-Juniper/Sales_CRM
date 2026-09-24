// ---------------------------------------------------------------------------
// devFixtures — DEV-only, fully-populated proposal data for the visual-fidelity
// overlay route (/dev/proposal-fidelity).
//
// Why this exists separately from ProposalPreview.test.tsx's fixtures: importing
// src/test/** into app source is the wrong direction (the test tree is not part
// of the app's build graph), so the shapes are duplicated here instead. Keep the
// two in sync only where it matters — this copy is tuned for *visual* fidelity
// (real names that resolve to bundled headshots, a real portfolio photo, every
// optional section on) rather than for assertion convenience.
//
// Production safety: nothing in the app imports this module except
// views/dev/ProposalFidelityPage, which router.tsx reaches only through a
// dynamic import inside an `import.meta.env.DEV` branch. Vite replaces that with
// a literal `false` at build time, so the branch — and this whole module graph —
// is dead-code-eliminated. The guard in makeDevProposalFixture() is the
// belt-and-braces half of that: if this ever does get reached in a prod bundle,
// it fails loudly instead of quietly shipping fake data. Same precedent as
// mocks/handlers.ts and main.tsx.
// ---------------------------------------------------------------------------

import type { Lead } from '@/types'
import type { Estimate } from '@/types/estimating'
import type {
  BranchCoverageGroup,
  BranchProfile,
  ClientReference,
  InsuranceCert,
  LicenseCertification,
  LicenseCertificationGroups,
  OrgChartInput,
  PortfolioProperty,
  ProposalSigner,
  StartupPlanInput,
  TeamMember,
} from '@/types/proposal'
import type {
  OptionalSection,
  ProposalFormState,
} from '@/views/inside-sales/components/estimating/ProposalBuilder'
import type { ProposalStaticConfig } from '@/hooks/useProposals'

/** Branch the fixture estimate is scoped to — drives the licenses query key. */
export const DEV_ASPIRE_BRANCH_ID = 3696

/**
 * Everything ProposalPreview needs, plus the two query-cache payloads it fetches
 * internally (useProposalConfig / useProposalLicenses). The route seeds those
 * into a nested QueryClient so the component never touches the network.
 */
export interface DevProposalFixture {
  formState: ProposalFormState
  lead: Lead
  estimate: Estimate
  allTeamMembers: TeamMember[]
  teamMembers: TeamMember[]
  executiveTeamMembers: TeamMember[]
  clientReferences: ClientReference[]
  portfolioProperties: PortfolioProperty[]
  signer: ProposalSigner
  /** Seeds [PROPOSAL_CONFIG_KEY]. */
  config: ProposalStaticConfig
  /** Seeds ['proposals','config','licenses', DEV_ASPIRE_BRANCH_ID]. */
  licenses: LicenseCertificationGroups
  /** Seeds ['proposals','config','insurance', DEV_ASPIRE_BRANCH_ID]. */
  insurance: InsuranceCert | null
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const BRANCHES: BranchProfile[] = [
  {
    aspireBranchId: 3696,
    branchName: 'Fort Myers',
    city: 'Fort Myers',
    regionId: 'west-coast',
    address: '5880 Staley Road, Fort Myers, FL 33905',
    lat: 26.6519,
    lng: -81.7718,
  },
  {
    aspireBranchId: 2001,
    branchName: 'Naples',
    city: 'Naples',
    regionId: 'west-coast',
    address: '3785 Enterprise Avenue, Naples, FL 34104',
    lat: 26.1424,
    lng: -81.7948,
  },
  {
    aspireBranchId: 2002,
    branchName: 'Venice',
    city: 'Venice',
    regionId: 'central',
    address: '1100 Pinebrook Road, Venice, FL 34285',
    lat: 27.0998,
    lng: -82.4543,
  },
]

const BRANCH_COVERAGE: BranchCoverageGroup[] = [
  {
    state: 'FL',
    stateName: 'Florida',
    regions: [
      {
        regionId: 'west-coast',
        regionName: 'West Coast',
        branches: ['Bonita Springs', 'Fort Myers', 'Naples', 'Sarasota'],
      },
      {
        regionId: 'central',
        regionName: 'Central',
        branches: ['Ocala', 'Orlando', 'Tampa', 'Venice'],
      },
      {
        regionId: 'east-coast',
        regionName: 'East Coast',
        branches: ['Jupiter', 'Vero Beach', 'West Palm Beach'],
      },
    ],
  },
  {
    state: 'TX',
    stateName: 'Texas',
    regions: [{ regionId: '', regionName: '', branches: ['Houston'] }],
  },
]

/**
 * Names are deliberately ones photos.ts has bundled headshots for — the whole
 * point of this route is comparing real pixels, and an initials placeholder
 * where the reference has a portrait makes the team page useless to diff.
 */
function makeTeamMember(over: Partial<TeamMember> & Pick<TeamMember, 'id' | 'name' | 'title'>): TeamMember {
  return {
    teamType: 'branch',
    aspireBranchId: DEV_ASPIRE_BRANCH_ID,
    userId: null,
    location: 'Fort Myers, FL',
    bio: '',
    // null, not an object key: a key would send useProposalMediaUrl to the
    // network. null falls through to the bundled portrait, which is canonical.
    headshotObjectKey: null,
    active: true,
    sortOrder: 1,
    ...over,
  }
}

const ACCOUNT_MANAGER = makeTeamMember({
  id: 'tm-am-001',
  name: 'Brandon Duke',
  title: 'account_manager',
  userId: 'user-dev-001',
  bio: 'Brandon has managed large-scale HOA and commercial portfolios across Southwest Florida for over a decade.',
  sortOrder: 1,
})

const AGRONOMY_MANAGER = makeTeamMember({
  id: 'tm-agro-001',
  name: 'Dan DeMont',
  title: 'agronomy_manager',
  bio: 'Dan leads turf health, fertilization and integrated pest management programs.',
  sortOrder: 2,
})

const IRRIGATION_MANAGER = makeTeamMember({
  id: 'tm-irr-001',
  name: 'Jake Rubin',
  title: 'irrigation_manager',
  bio: 'Jake oversees irrigation auditing, repair scheduling and water-use reporting.',
  sortOrder: 3,
})

const PRODUCTION_MANAGER = makeTeamMember({
  id: 'tm-pm-001',
  name: 'Kyle McNamara',
  title: 'production_manager',
  bio: 'Kyle runs day-to-day crew operations and quality control on site.',
  sortOrder: 4,
})

const EXECUTIVE = makeTeamMember({
  id: 'tm-exec-001',
  name: 'Michelle Cady',
  title: 'executive',
  teamType: 'executive',
  aspireBranchId: null,
  userId: 'user-dev-exec',
  location: 'Naples, FL',
  bio: 'Michelle leads the executive team and is accountable for client outcomes company-wide.',
  sortOrder: 1,
})

const ALL_TEAM_MEMBERS: TeamMember[] = [
  ACCOUNT_MANAGER,
  AGRONOMY_MANAGER,
  IRRIGATION_MANAGER,
  PRODUCTION_MANAGER,
  EXECUTIVE,
]

function makeLicense(
  over: Partial<LicenseCertification> & Pick<LicenseCertification, 'id' | 'name'>,
): LicenseCertification {
  return {
    kind: 'license',
    issuingBody: 'Florida Department of Agriculture and Consumer Services',
    identifier: 'JB1234',
    holderName: 'Brandon Duke',
    aspireBranchId: null,
    issuedDate: '2025-01-15',
    expiryDate: '2027-01-14',
    // null so no signed-URL fetch fires; the page renders the table, not scans.
    objectKey: null,
    isExpired: false,
    active: true,
    ...over,
  }
}

const LICENSES: LicenseCertificationGroups = {
  licenses: [
    makeLicense({
      id: 'lc-001',
      name: 'Commercial Fertilizer Applicator',
      identifier: 'CFA-118204',
      holderName: 'Dan DeMont',
    }),
    makeLicense({
      id: 'lc-002',
      name: 'Limited Commercial Landscape Maintenance',
      identifier: 'LCLM-90441',
      holderName: 'Kyle McNamara',
    }),
  ],
  certifications: [
    makeLicense({
      id: 'lc-003',
      kind: 'certification',
      name: 'ISA Certified Arborist',
      issuingBody: 'International Society of Arboriculture',
      identifier: 'FL-6612A',
      holderName: 'Jake Rubin',
    }),
    makeLicense({
      id: 'lc-004',
      kind: 'certification',
      name: 'FNGLA Certified Landscape Technician',
      issuingBody: 'Florida Nursery, Growers and Landscape Association',
      identifier: 'FCLT-3390',
      holderName: 'Brandon Duke',
    }),
  ],
}

const CLIENT_REFERENCES: ClientReference[] = [
  {
    id: 'cr-001',
    aspireBranchId: null,
    propertyName: 'Pelican Landing Community Association',
    servicesProvided: 'Landscape Maintenance, Irrigation, Arboriculture',
    contactName: 'Robert Sherman',
    contactTitle: 'Property Manager',
    phone: '(239) 555-0142',
    email: 'rsherman@pelicanlanding.example',
    address: '24401 Walden Center Drive, Bonita Springs, FL 34134',
    clientSinceYear: 2016,
    active: true,
  },
  {
    id: 'cr-002',
    aspireBranchId: null,
    propertyName: 'Fiddler’s Creek',
    servicesProvided: 'Landscape Maintenance, Enhancements',
    contactName: 'Diane Whitfield',
    contactTitle: 'Community Association Manager',
    phone: '(239) 555-0188',
    email: 'dwhitfield@fiddlerscreek.example',
    address: '8152 Fiddler’s Creek Parkway, Naples, FL 34114',
    clientSinceYear: 2019,
    active: true,
  },
  {
    id: 'cr-003',
    aspireBranchId: null,
    propertyName: 'Heritage Isles Golf & Country Club',
    servicesProvided: 'Landscape Maintenance, Aquatics, Turf',
    contactName: 'Marcus Reed',
    contactTitle: 'General Manager',
    phone: '(813) 555-0119',
    email: 'mreed@heritageisles.example',
    address: '10630 Plantation Bay Drive, Tampa, FL 33647',
    clientSinceYear: 2014,
    active: true,
  },
]

/**
 * photoObjectKeys are bundled paths, not GCS keys: PortfolioPhoto renders
 * `/${objectKey}` directly, so these resolve against studio/public.
 */
const PORTFOLIO_PROPERTIES: PortfolioProperty[] = [
  {
    id: 'pp-001',
    name: 'Alys Beach',
    cityState: 'Alys Beach, FL',
    regionId: 'panhandle',
    photoObjectKeys: ['proposal/portfolio/alys-beach.jpg'],
    sortOrder: 1,
  },
  {
    id: 'pp-002',
    name: 'Heritage Isles',
    cityState: 'Tampa, FL',
    regionId: 'central',
    photoObjectKeys: ['proposal/portfolio/heritage-isles.jpg'],
    sortOrder: 2,
  },
]

const LEAD: Lead = {
  id: 'lead-dev-001',
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
  contact_email: 'jwalsh@coralbay.example',
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

const ESTIMATE: Estimate = {
  id: 'est-dev-001',
  name: 'Coral Bay HOA',
  estimateType: 'maintenance',
  customerType: 'hoa',
  status: 'approved',
  leadId: 'lead-dev-001',
  clientName: 'Coral Bay HOA',
  propertyId: null,
  // aspireBranchId is the identity ProposalPreview scopes licenses by.
  aspireBranchId: DEV_ASPIRE_BRANCH_ID,
  branchCity: 'Fort Myers, FL',
  acreage: 45,
  mowingOccurrences: null,
  pruningOccurrences: null,
  turfFertOccurrences: null,
  shrubFertOccurrences: null,
  ipmOccurrences: null,
  irrigationOccurrences: null,
  contractValueCents: 18_500_000,
  targetMargin: 0.22,
  lifecycle: 'won',
  aspireOwner: 'crm',
  priority: 'medium',
  winProbability: 0.6,
  siteWalkDate: '2026-08-05',
  dueBackDate: '2026-08-20',
  anticipatedCloseDate: '2026-09-15',
  serviceStartDate: '2026-10-01',
  assignedLsEstimator: null,
  assignedIrrEstimator: null,
  crmRep: 'user-dev-001',
  aspireNumber: null,
  aspireOpportunityId: null,
  aspireSyncStatus: 'synced',
  sections: [],
  notes: null,
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-26T10:00:00Z',
}

const ORG_CHART: OrgChartInput = {
  included: true,
  accountManagerIds: [ACCOUNT_MANAGER.id],
  agronomyManagerName: AGRONOMY_MANAGER.name,
  irrigationManagerName: IRRIGATION_MANAGER.name,
  productionManagerName: PRODUCTION_MANAGER.name,
  crewCounts: {
    mow: { foremen: 2, members: 6 },
    prune: { foremen: 1, members: 3 },
    fertIpm: { members: 2 },
    irrigation: { members: 1 },
  },
}

// planMaxDays: 60 deliberately exercises all four states at once: Day 60 is
// rep-entered and prints it; Day 90 is empty AND excluded by plan length, so
// its box prints with no bullets; Day 120+ has rep-entered text that plan
// length excludes anyway — its box must also print empty, not the rep copy;
// Ongoing is empty but always prints, so it falls through to the seed. All
// six boxes must still render at the same fixed size regardless of which of
// them are empty — that is the thing to eyeball on /dev/proposal-fidelity.
const STARTUP_PLAN: StartupPlanInput = {
  included: true,
  planMaxDays: 60,
  day60: [
    'Full site walk with the board',
    'Irrigation zone audit',
    'Controller programming log',
  ],
  day90: [],
  day120Plus: [
    'Entry feature enhancement plan',
    'Amenity center enhancement plan',
    'Quarterly board reporting cadence',
  ],
  ongoing: [],
}

/** Every togglable section, so the route exercises all ~25 pages. */
const ALL_OPTIONAL_SECTIONS: OptionalSection[] = [
  'table_of_contents',
  'startup_plan_30_60_90',
  'juniper_sync',
  'juniper_mapping',
  'meet_our_team_executive',
  'irrigation_reporting_sample',
]

const SIGNER: ProposalSigner = {
  name: 'Brandon Duke',
  title: 'Business Developer',
  phone: '(239) 555-0130',
  email: 'brandon.duke@juniperlandscaping.example',
  branchAddress: '5880 Staley Road, Fort Myers, FL 33905',
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the fully-populated DEV fixture. Fresh objects each call so the dev page
 * can mutate without leaking state across HMR reloads.
 */
export function makeDevProposalFixture(): DevProposalFixture {
  if (!import.meta.env.DEV) {
    throw new Error(
      'makeDevProposalFixture() is DEV-only and must never be reached in a production build',
    )
  }

  const formState: ProposalFormState = {
    sections: [...ALL_OPTIONAL_SECTIONS],
    orgChart: { ...ORG_CHART, crewCounts: { ...ORG_CHART.crewCounts } },
    startupPlan: { ...STARTUP_PLAN },
    teamMemberIds: [
      ACCOUNT_MANAGER.id,
      AGRONOMY_MANAGER.id,
      IRRIGATION_MANAGER.id,
      PRODUCTION_MANAGER.id,
    ],
    executiveTeamMemberIds: [EXECUTIVE.id],
    clientReferenceIds: CLIENT_REFERENCES.map((r) => r.id),
    portfolioPropertyIds: PORTFOLIO_PROPERTIES.map((p) => p.id),
    signerUserId: 'user-dev-001',
  }

  return {
    formState,
    lead: { ...LEAD },
    estimate: { ...ESTIMATE },
    allTeamMembers: [...ALL_TEAM_MEMBERS],
    teamMembers: [
      ACCOUNT_MANAGER,
      AGRONOMY_MANAGER,
      IRRIGATION_MANAGER,
      PRODUCTION_MANAGER,
    ],
    executiveTeamMembers: [EXECUTIVE],
    clientReferences: [...CLIENT_REFERENCES],
    portfolioProperties: [...PORTFOLIO_PROPERTIES],
    signer: { ...SIGNER },
    config: {
      branches: [...BRANCHES],
      branchCoverage: [...BRANCH_COVERAGE],
      loaded: true,
    },
    insurance: {
      id: 'ins-dev-001',
      // Empty key keeps useProposalMediaUrl disabled (enabled: !!objectKey), so
      // the insurance page renders INSURANCE_PAGE_COPY.unavailable and fires no
      // request. The live key is a PNG scan (credentials/licenses/*.png), never
      // the source PDF — see insurance-page.tsx for why.
      objectKey: '',
      expiryDate: '2027-03-31',
      label: 'General Liability',
      uploadedAt: '2026-01-01T00:00:00Z',
    },
    licenses: {
      licenses: [...LICENSES.licenses],
      certifications: [...LICENSES.certifications],
    },
  }
}
