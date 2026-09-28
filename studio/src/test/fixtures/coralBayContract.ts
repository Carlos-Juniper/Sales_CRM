// ---------------------------------------------------------------------------
// Seeded Coral Bay maintenance estimate, shared by contract tests.
//
// Sections, quantities, rates, and square footage match
// scripts/seed_contract_estimate.py. contractValueCents is the stored
// $48,000 figure and is not a line price.
//
// Mulch Application and Annual Flower Installation are flat items in that
// seed ($4,200 and $8,600). Their extended prices are not part of this
// fixture: area-pricing those lines is a separate change.
// ---------------------------------------------------------------------------

import type { Estimate, SectionService } from '@/types/estimating'

const ESTIMATE_ID = 'est-coral-bay'

export const CORAL_BAY_CONTRACT_VALUE_CENTS = 4_800_000

/** Area-priced recurring lines. Not the flat mulch and flower rows. */
export const CORAL_BAY_RECURRING_LINES = [
  { label: 'Mowing & Edging', extPriceCents: 1_436_400 },
  { label: 'Landscape Bed Maintenance', extPriceCents: 820_800 },
  { label: 'Fertilization', extPriceCents: 410_400 },
  { label: 'Weed Control', extPriceCents: 410_400 },
  { label: 'Tree Canopy Trimming', extPriceCents: 342_000 },
  { label: 'Shrub & Hedge Trimming', extPriceCents: 239_400 },
  { label: 'Irrigation System Maint.', extPriceCents: 342_000 },
] as const

export const CORAL_BAY_ANNUAL_MAINTENANCE_CENTS = CORAL_BAY_RECURRING_LINES.reduce(
  (sum, line) => sum + line.extPriceCents,
  0,
)

export const CORAL_BAY_OPTIONAL_LABELS = [
  'Mulch Application',
  'Annual Flower Installation',
] as const

function service(
  sectionId: string,
  row: Pick<SectionService, 'id' | 'label' | 'qty' | 'unitSellCents' | 'sortOrder'> & {
    billingType?: SectionService['billingType']
  },
): SectionService {
  return {
    sectionId,
    catalogItemId: null,
    uom: '/yr',
    complexityPct: 0,
    embeddedCostCents: null,
    targetGm: null,
    hours: null,
    billingType: 'recurring',
    components: [],
    ...row,
  }
}

/** The seeded Coral Bay contract estimate. */
export function coralBayContractEstimate(): Estimate {
  const mainId = 'sec-main'
  const entranceId = 'sec-entrance'

  return {
    id: ESTIMATE_ID,
    estimateType: 'maintenance',
    name: 'Coral Bay HOA — Contract Test',
    aspireNumber: 'CB-2026-SEED',
    aspireOpportunityId: null,
    aspireSyncStatus: 'synced',
    propertyId: null,
    clientName: 'Coral Bay HOA',
    customerType: 'commercial',
    aspireBranchId: 1,
    branchCity: 'Orlando, FL',
    acreage: 8.2,
    mowingOccurrences: null,
    pruningOccurrences: null,
    turfFertOccurrences: null,
    shrubFertOccurrences: null,
    ipmOccurrences: null,
    irrigationOccurrences: null,
    contractValueCents: CORAL_BAY_CONTRACT_VALUE_CENTS,
    homesBudget: null,
    commonAreaBudget: null,
    targetMargin: 0.22,
    status: 'approved',
    lifecycle: 'bidding',
    aspireOwner: 'estimating',
    priority: 'high',
    winProbability: 0.9,
    siteWalkDate: null,
    dueBackDate: '2026-10-01',
    isRush: false,
    anticipatedCloseDate: null,
    serviceStartDate: '2027-01-01',
    assignedLsEstimator: null,
    assignedIrrEstimator: null,
    crmRep: null,
    sections: [
      {
        id: mainId,
        estimateId: ESTIMATE_ID,
        name: 'Main Property',
        squareFeet: 342_000,
        sortOrder: 0,
        services: [
          service(mainId, { id: 'svc-1', label: 'Mowing & Edging', qty: 12, unitSellCents: 350, sortOrder: 0 }),
          service(mainId, { id: 'svc-2', label: 'Landscape Bed Maintenance', qty: 12, unitSellCents: 200, sortOrder: 1 }),
          service(mainId, { id: 'svc-3', label: 'Fertilization', qty: 4, unitSellCents: 300, sortOrder: 2 }),
          service(mainId, { id: 'svc-4', label: 'Weed Control', qty: 6, unitSellCents: 200, sortOrder: 3 }),
          service(mainId, { id: 'svc-5', label: 'Tree Canopy Trimming', qty: 4, unitSellCents: 250, sortOrder: 4 }),
        ],
      },
      {
        id: entranceId,
        estimateId: ESTIMATE_ID,
        name: 'Entrance & Amenity Areas',
        squareFeet: 28_500,
        sortOrder: 1,
        services: [
          service(entranceId, { id: 'svc-6', label: 'Shrub & Hedge Trimming', qty: 6, unitSellCents: 1400, sortOrder: 0 }),
          service(entranceId, { id: 'svc-7', label: 'Irrigation System Maint.', qty: 12, unitSellCents: 1000, sortOrder: 1 }),
          service(entranceId, {
            id: 'svc-8',
            label: 'Mulch Application',
            qty: 1,
            unitSellCents: 420_000,
            sortOrder: 2,
            billingType: 'one_time',
          }),
          service(entranceId, {
            id: 'svc-9',
            label: 'Annual Flower Installation',
            qty: 1,
            unitSellCents: 860_000,
            sortOrder: 3,
            billingType: 'one_time',
          }),
        ],
      },
    ],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  }
}
