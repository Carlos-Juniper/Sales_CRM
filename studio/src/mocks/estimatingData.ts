import type {
  CatalogItem,
  EstimateQueueItem,
  LegacyEstimate,
  LineItem,
  BidOutcomeLog,
  Estimate,
  MaintenanceEstimate,
  InstallEstimate,
  EstimateSection,
  SectionService,
  SectionServiceComponent,
  TakeoffLine,
  IntakeAttachment,
} from '@/types/estimating'

function li(
  id: string,
  category: LineItem['category'],
  description: string,
  quantity: number,
  unit: string,
  unitCost: number,
  unitPrice: number,
): LineItem {
  return {
    id,
    category,
    description,
    quantity,
    unit,
    unit_cost: unitCost,
    unit_price: unitPrice,
    total_cost: quantity * unitCost,
    total_price: quantity * unitPrice,
    margin_pct: ((unitPrice - unitCost) / unitPrice) * 100,
  }
}

function computeEstimateTotals(est: LegacyEstimate): LegacyEstimate {
  const cost = est.line_items.reduce((s, l) => s + l.total_cost, 0)
  const price = est.line_items.reduce((s, l) => s + l.total_price, 0)
  const overhead = cost * (est.overhead_pct / 100)
  return {
    ...est,
    subtotal_cost: cost,
    overhead_amount: overhead,
    total_cost: cost + overhead,
    total_price: price,
    margin_pct: price > 0 ? ((price - (cost + overhead)) / price) * 100 : 0,
  }
}

export const mockEstimateQueue: EstimateQueueItem[] = [
  {
    id: 'eq1',
    lead_id: 'l8',
    property_name: 'Maricopa County — Facilities RFP',
    lead_type: 'commercial',
    assigned_to: 'u5',
    priority: 'urgent',
    deadline: new Date(Date.now() + 21 * 86400000).toISOString(),
    status: 'in_progress',
    estimated_acreage: 200,
    estimated_contract_value: 780000,
    site_walk_date: new Date(Date.now() - 2 * 86400000).toISOString(),
    site_walk_notes: 'Multiple facilities spread across county. Main campus ~80 acres, 14 satellite locations averaging 8-10 acres each. Irrigation systems vary — some older drip, some smart controllers. Parking lot medians included.',
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'eq2',
    lead_id: 'l2',
    property_name: 'City of Tempe — Parks RFP',
    lead_type: 'commercial',
    assigned_to: 'u5',
    priority: 'high',
    deadline: new Date(Date.now() + 9 * 86400000).toISOString(),
    status: 'review',
    estimated_acreage: 120,
    estimated_contract_value: 420000,
    site_walk_date: new Date(Date.now() - 5 * 86400000).toISOString(),
    site_walk_notes: 'Three main parks: Tempe Town Lake (45 ac), McClintock (30 ac), Big Surf (45 ac). Heavy foot traffic. Organic fertilizer program required. Tree canopy inventory needed.',
    created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
  },
  {
    id: 'eq3',
    lead_id: 'l4',
    property_name: 'Dobson Ranch HOA',
    lead_type: 'HOA',
    assigned_to: 'u5',
    priority: 'medium',
    deadline: new Date(Date.now() + 18 * 86400000).toISOString(),
    status: 'queued',
    estimated_acreage: 60,
    estimated_contract_value: 240000,
    site_walk_date: new Date(Date.now() + 3 * 86400000).toISOString(),
    site_walk_notes: null,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'eq4',
    lead_id: 'l1',
    property_name: 'Silverleaf HOA',
    lead_type: 'HOA',
    assigned_to: 'u6',
    priority: 'urgent',
    deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
    status: 'in_progress',
    estimated_acreage: 45,
    estimated_contract_value: 185000,
    site_walk_date: new Date(Date.now() - 1 * 86400000).toISOString(),
    site_walk_notes: 'High-end luxury community. Premium plant materials expected. Drip irrigation in good condition. Lighting may need upgrade add-on. HOA board meets monthly — service visibility is high.',
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: 'eq5',
    lead_id: 'l7',
    property_name: 'Desert Ridge Marketplace',
    lead_type: 'commercial',
    assigned_to: null,
    priority: 'low',
    deadline: new Date(Date.now() + 35 * 86400000).toISOString(),
    status: 'queued',
    estimated_acreage: 35,
    estimated_contract_value: 145000,
    site_walk_date: null,
    site_walk_notes: null,
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
  {
    id: 'eq6',
    lead_id: 'l10',
    property_name: 'Legacy HOA Peoria',
    lead_type: 'HOA',
    assigned_to: 'u6',
    priority: 'medium',
    deadline: new Date(Date.now() + 22 * 86400000).toISOString(),
    status: 'queued',
    estimated_acreage: 55,
    estimated_contract_value: 215000,
    site_walk_date: new Date(Date.now() + 7 * 86400000).toISOString(),
    site_walk_notes: null,
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'eq7',
    lead_id: 'l12',
    property_name: 'Town of Gilbert Parks RFP',
    lead_type: 'commercial',
    assigned_to: 'u5',
    priority: 'high',
    deadline: new Date(Date.now() - 14 * 86400000).toISOString(),
    status: 'approved',
    estimated_acreage: 95,
    estimated_contract_value: 355000,
    site_walk_date: new Date(Date.now() - 35 * 86400000).toISOString(),
    site_walk_notes: 'WON — Contract awarded. 8 municipal parks, mix of turf and desert. Irrigation modernization included. Kick-off next month.',
    created_at: new Date(Date.now() - 50 * 86400000).toISOString(),
  },
  {
    id: 'eq8',
    lead_id: 'l13',
    property_name: 'Surprise Farms HOA',
    lead_type: 'HOA',
    assigned_to: null,
    priority: 'medium',
    deadline: new Date(Date.now() + 28 * 86400000).toISOString(),
    status: 'queued',
    estimated_acreage: 38,
    estimated_contract_value: 128000,
    site_walk_date: null,
    site_walk_notes: null,
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
]

export const mockEstimates: LegacyEstimate[] = [
  computeEstimateTotals({
    id: 'est1',
    queue_item_id: 'eq2',
    lead_id: 'l2',
    property_name: 'City of Tempe — Parks RFP',
    version: 1,
    ai_generated: true,
    line_items: [
      li('t1-l1', 'labor', 'Mowing — Tempe Town Lake (45 ac)', 52, 'visits', 3200, 3840),
      li('t1-l2', 'labor', 'Mowing — McClintock Park (30 ac)', 52, 'visits', 2100, 2520),
      li('t1-l3', 'labor', 'Mowing — Big Surf Area (45 ac)', 52, 'visits', 2900, 3480),
      li('t1-l4', 'labor', 'Irrigation mgmt & monthly checks', 12, 'months', 1800, 2160),
      li('t1-l5', 'labor', 'Tree trimming (2 cycles/yr)', 2, 'cycles', 8500, 10200),
      li('t1-l6', 'labor', 'Detail cleanup & edging', 52, 'weeks', 950, 1140),
      li('t1-m1', 'materials', 'Organic fertilizer program (3 apps)', 3, 'applications', 4200, 5040),
      li('t1-m2', 'materials', 'Pre-emergent herbicide (2 apps)', 2, 'applications', 2100, 2520),
      li('t1-m3', 'materials', 'Seasonal color rotations', 3, 'rotations', 3800, 4560),
      li('t1-m4', 'materials', 'Mulch refresh (2×/yr)', 2, 'applications', 2600, 3120),
      li('t1-e1', 'equipment', 'Equipment depreciation/usage', 12, 'months', 2200, 2530),
      li('t1-e2', 'equipment', 'Fuel & vehicle costs', 12, 'months', 1400, 1610),
      li('t1-o1', 'overhead', 'Supervision (site foreman)', 12, 'months', 4200, 4830),
      li('t1-o2', 'overhead', 'GL insurance allocation', 1, 'year', 3800, 4370),
      li('t1-s1', 'subcontractor', 'Irrigation system repairs (allowance)', 1, 'allowance', 8000, 9600),
      li('t1-s2', 'subcontractor', 'Arborist services (large trees)', 1, 'allowance', 6500, 7800),
    ],
    subtotal_cost: 0,
    overhead_pct: 12,
    overhead_amount: 0,
    total_cost: 0,
    total_price: 0,
    margin_pct: 0,
    target_margin_pct: 18,
    notes: 'AI-generated estimate from site walk data. Quantities pending confirmation. Pre-bid meeting scheduled. Organic program requirement adds ~8% to materials cost vs. standard bid.',
    status: 'review',
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 86400000).toISOString(),
  }),
  computeEstimateTotals({
    id: 'est2',
    queue_item_id: 'eq4',
    lead_id: 'l1',
    property_name: 'Silverleaf HOA',
    version: 1,
    ai_generated: true,
    line_items: [
      li('s1-l1', 'labor', 'Weekly mowing & edging (45 ac)', 52, 'visits', 1850, 2220),
      li('s1-l2', 'labor', 'Monthly detail & cleanup', 12, 'months', 1200, 1440),
      li('s1-l3', 'labor', 'Irrigation inspections', 12, 'months', 800, 960),
      li('s1-l4', 'labor', 'Tree & shrub trimming (4×/yr)', 4, 'visits', 2800, 3360),
      li('s1-m1', 'materials', 'Premium mulch refresh (2×/yr)', 2, 'applications', 3200, 3840),
      li('s1-m2', 'materials', 'Fertilization program (4 apps)', 4, 'applications', 1800, 2160),
      li('s1-m3', 'materials', 'Weed control (monthly)', 12, 'months', 600, 720),
      li('s1-m4', 'materials', 'Seasonal color — premium annuals', 3, 'rotations', 4500, 5400),
      li('s1-e1', 'equipment', 'Equipment usage', 12, 'months', 1200, 1380),
      li('s1-o1', 'overhead', 'Account management', 12, 'months', 1500, 1725),
      li('s1-o2', 'overhead', 'Insurance allocation', 1, 'year', 2200, 2530),
    ],
    subtotal_cost: 0,
    overhead_pct: 10,
    overhead_amount: 0,
    total_cost: 0,
    total_price: 0,
    margin_pct: 0,
    target_margin_pct: 20,
    notes: 'Premium HOA. White-glove service tier expected. Premium materials pricing applied. Lighting upgrade potential add-on scope (~$18K).',
    status: 'in_progress',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 86400000).toISOString(),
  }),
  computeEstimateTotals({
    id: 'est3',
    queue_item_id: 'eq7',
    lead_id: 'l12',
    property_name: 'Town of Gilbert Parks RFP',
    version: 2,
    ai_generated: false,
    line_items: [
      li('g1-l1', 'labor', 'Mowing — 8 parks (95 ac total)', 52, 'weeks', 5800, 6960),
      li('g1-l2', 'labor', 'Athletic field grooming', 52, 'weeks', 2400, 2880),
      li('g1-l3', 'labor', 'Irrigation system management', 12, 'months', 3200, 3840),
      li('g1-l4', 'labor', 'Tree maintenance program', 2, 'cycles', 9500, 11400),
      li('g1-m1', 'materials', 'Fertilization (4 apps, 95 ac)', 4, 'applications', 5200, 6240),
      li('g1-m2', 'materials', 'Pre-emergent (2 apps)', 2, 'applications', 3100, 3720),
      li('g1-m3', 'materials', 'Overseeding — athletic fields', 1, 'season', 4800, 5760),
      li('g1-e1', 'equipment', 'Equipment fleet allocation', 12, 'months', 3800, 4370),
      li('g1-e2', 'equipment', 'Fuel & transportation', 12, 'months', 2100, 2415),
      li('g1-o1', 'overhead', 'Project supervision', 12, 'months', 5500, 6325),
      li('g1-o2', 'overhead', 'Insurance & bonding', 1, 'year', 6200, 7130),
      li('g1-s1', 'subcontractor', 'Irrigation modernization (Y1)', 1, 'project', 22000, 26400),
    ],
    subtotal_cost: 0,
    overhead_pct: 10,
    overhead_amount: 0,
    total_cost: 0,
    total_price: 0,
    margin_pct: 0,
    target_margin_pct: 18,
    notes: 'WON estimate — approved and under contract. Version 2 after scope refinement with Gilbert Parks Dept. Irrigation modernization in Y1 only.',
    status: 'approved',
    created_at: new Date(Date.now() - 50 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 14 * 86400000).toISOString(),
  }),
]

export const mockBidOutcomes: BidOutcomeLog[] = [
  {
    id: 'bo1',
    lead_id: 'l12',
    bid_id: 'b4',
    property_name: 'Town of Gilbert Parks RFP',
    lead_type: 'commercial',
    outcome: 'won',
    bid_amount: 355000,
    competitor_bid: null,
    loss_reason: null,
    loss_notes: null,
    logged_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    logged_by: 'David Lee',
  },
  {
    id: 'bo2',
    lead_id: 'l14',
    bid_id: null,
    property_name: 'Mesa Arts Center',
    lead_type: 'commercial',
    outcome: 'lost',
    bid_amount: 42000,
    competitor_bid: 36000,
    loss_reason: 'price_too_high',
    loss_notes: 'Lost to AZ Grounds — $6K lower. Our cost structure may be too high for commercial accounts under $50K. Recommend reviewing small-commercial pricing model.',
    logged_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    logged_by: 'David Lee',
  },
  {
    id: 'bo3',
    lead_id: 'l9',
    bid_id: null,
    property_name: 'Ocotillo Lakes HOA',
    lead_type: 'HOA',
    outcome: 'lost',
    bid_amount: 89000,
    competitor_bid: 85000,
    loss_reason: 'incumbent_retained',
    loss_notes: 'HOA board voted to retain Cactus Care LLC (8+ year relationship). Proposal was $4K higher. Follow-up in Q1 2027 when contract expires.',
    logged_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    logged_by: 'David Lee',
  },
  {
    id: 'bo4',
    lead_id: 'l6',
    bid_id: 'b2',
    property_name: 'SUSD Grounds Maintenance',
    lead_type: 'commercial',
    outcome: 'pending',
    bid_amount: 310000,
    competitor_bid: null,
    loss_reason: null,
    loss_notes: 'Proposal submitted. Awaiting evaluation board decision by end of month.',
    logged_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    logged_by: 'David Lee',
  },
  {
    id: 'bo5',
    lead_id: null,
    bid_id: 'b7',
    property_name: 'Mesa Community College',
    lead_type: 'commercial',
    outcome: 'no_bid',
    bid_amount: 0,
    competitor_bid: null,
    loss_reason: 'budget_cut',
    loss_notes: 'Budget ceiling $140K. Our cost floor $155K. Not viable without unsustainable margins.',
    logged_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    logged_by: 'David Lee',
  },
  {
    id: 'bo6',
    lead_id: null,
    bid_id: null,
    property_name: 'Glendale HOA Portfolio',
    lead_type: 'HOA',
    outcome: 'won',
    bid_amount: 285000,
    competitor_bid: 295000,
    loss_reason: null,
    loss_notes: null,
    logged_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    logged_by: 'Amanda Torres',
  },
  {
    id: 'bo7',
    lead_id: null,
    bid_id: null,
    property_name: 'City of Peoria Sports Complex',
    lead_type: 'commercial',
    outcome: 'lost',
    bid_amount: 195000,
    competitor_bid: 182000,
    loss_reason: 'competitor_relationship',
    loss_notes: 'Lost to Greenway Services — long-standing relationship with Parks Director. Strong technical score; price differential hurt us. Recommend executive relationship building in Peoria.',
    logged_at: new Date(Date.now() - 75 * 86400000).toISOString(),
    logged_by: 'Amanda Torres',
  },
  {
    id: 'bo8',
    lead_id: null,
    bid_id: null,
    property_name: 'Scottsdale Financial Plaza',
    lead_type: 'commercial',
    outcome: 'won',
    bid_amount: 68000,
    competitor_bid: 72000,
    loss_reason: null,
    loss_notes: null,
    logged_at: new Date(Date.now() - 45 * 86400000).toISOString(),
    logged_by: 'David Lee',
  },
  {
    id: 'bo9',
    lead_id: null,
    bid_id: null,
    property_name: 'Chandler Medical Campus',
    lead_type: 'commercial',
    outcome: 'lost',
    bid_amount: 112000,
    competitor_bid: 108000,
    loss_reason: 'scope_mismatch',
    loss_notes: 'Client wanted in-house crew with our supervision only — model we do not offer. Scope mismatch from the outset.',
    logged_at: new Date(Date.now() - 55 * 86400000).toISOString(),
    logged_by: 'David Lee',
  },
  {
    id: 'bo10',
    lead_id: null,
    bid_id: null,
    property_name: 'Avondale Community Parks',
    lead_type: 'commercial',
    outcome: 'won',
    bid_amount: 168000,
    competitor_bid: 172000,
    loss_reason: null,
    loss_notes: null,
    logged_at: new Date(Date.now() - 120 * 86400000).toISOString(),
    logged_by: 'Amanda Torres',
  },
]

// ---------------------------------------------------------------------------
// Handoff 00 fixtures — the new single-source estimate model.
// One full maintenance estimate and one full install estimate, built through
// shared builders so tests and MSW handlers stay consistent.
// ---------------------------------------------------------------------------

import { contractTotal } from '@/lib/estimating/calc'
import { INSTALL_KIT_CATALOG } from '@/lib/estimating/install'
import type { CreateEstimatePayload } from '@/api/estimating'

let fixtureSeq = 0
function fid(prefix: string): string {
  fixtureSeq += 1
  return `${prefix}-${fixtureSeq}`
}

function svc(
  sectionId: string,
  overrides: Partial<SectionService> & Pick<SectionService, 'label' | 'qty' | 'uom'>,
): SectionService {
  return {
    id: fid('svc'),
    sectionId,
    catalogItemId: null,
    complexityPct: 0,
    unitSellCents: null,
    embeddedCostCents: null,
    targetGm: null,
    hours: null,
    sortOrder: 0,
    components: [],
    ...overrides,
  }
}

function comp(
  sectionServiceId: string,
  kind: SectionServiceComponent['kind'],
  label: string,
  qty: number,
  unitCostCents: number,
  hours: number | null = null,
  sortOrder = 0,
): SectionServiceComponent {
  return { id: fid('cmp'), sectionServiceId, kind, label, qty, unitCostCents, hours, sortOrder }
}

const DAY = 86400000

/** A full maintenance estimate: section-based, hours-driven services. */
export function buildMaintenanceEstimate(
  overrides: Partial<MaintenanceEstimate> = {},
): MaintenanceEstimate {
  const estimateId = fid('est-maint')
  const s1: EstimateSection = {
    id: fid('sec'),
    estimateId,
    name: 'Common Area',
    squareFeet: 120000,
    sortOrder: 0,
    services: [],
  }
  s1.services = [
    svc(s1.id, { label: 'Mowing', qty: 42, uom: '/yr', complexityPct: 0.1, unitSellCents: 450, hours: 1.6, sortOrder: 0 }),
    svc(s1.id, { label: 'Detail / Bed Maintenance', qty: 26, uom: '/yr', complexityPct: 0.05, unitSellCents: 320, hours: 2.2, sortOrder: 1 }),
    svc(s1.id, { label: 'Irrigation Inspection', qty: 12, uom: '/yr', complexityPct: 0, unitSellCents: 180, hours: 0.8, sortOrder: 2 }),
  ]
  const s2: EstimateSection = {
    id: fid('sec'),
    estimateId,
    name: 'Entry & Medians',
    squareFeet: 45000,
    sortOrder: 1,
    services: [],
  }
  s2.services = [
    svc(s2.id, { label: 'Mowing', qty: 42, uom: '/yr', complexityPct: 0.15, unitSellCents: 450, hours: 0.7, sortOrder: 0 }),
    svc(s2.id, { label: 'Seasonal Color Rotation', qty: 3, uom: '/yr', complexityPct: 0, unitSellCents: 2200, hours: 6, sortOrder: 1 }),
  ]

  const base: MaintenanceEstimate = {
    id: estimateId,
    estimateType: 'maintenance',
    name: 'Dobson Ranch HOA — Grounds Maintenance',
    aspireNumber: 'ASP-48211',
    aspireOpportunityId: 630956,
    aspireSyncStatus: 'synced',
    propertyId: null,
    leadId: null,
    clientName: 'Dobson Ranch HOA',
    branch: 'Phoenix-Desert',
    customerType: 'hoa',
    acreage: null,
    contractValueCents: 0,
    targetMargin: 0.22,
    status: 'in_progress',
    lifecycle: 'bidding',
    aspireOwner: 'estimating',
    priority: 'high',
    winProbability: 0.6,
    siteWalkDate: new Date(Date.now() - 4 * DAY).toISOString(),
    dueBackDate: new Date(Date.now() + 10 * DAY).toISOString(),
    anticipatedCloseDate: new Date(Date.now() + 45 * DAY).toISOString(),
    serviceStartDate: null,
    assignedLsEstimator: 'u5',
    assignedIrrEstimator: null,
    crmRep: 'u2',
    sections: [s1, s2],
    createdAt: new Date(Date.now() - 6 * DAY).toISOString(),
    updatedAt: new Date(Date.now() - DAY).toISOString(),
  }
  const merged = { ...base, ...overrides }
  merged.contractValueCents = overrides.contractValueCents ?? contractTotal(merged)
  return merged
}

/** A full install estimate: quantity-driven kits with labor/material components. */
export function buildInstallEstimate(
  overrides: Partial<InstallEstimate> = {},
): InstallEstimate {
  const estimateId = fid('est-inst')
  const s1: EstimateSection = {
    id: fid('sec'),
    estimateId,
    name: 'Phase 1 — Streetscape',
    squareFeet: 68000,
    sortOrder: 0,
    services: [],
  }
  const trees = svc(s1.id, {
    label: "Mahogany 10'-12' — Installed",
    qty: 24,
    uom: 'ea',
    unitSellCents: 125000,
    embeddedCostCents: 68750,
    targetGm: 0.45,
    hours: 3.5,
    sortOrder: 0,
  })
  trees.components = [
    comp(trees.id, 'material', "Mahogany 10'-12' (30g)", 1, 42500, null, 0),
    comp(trees.id, 'labor', 'Install crew', 3.5, 5200, 3.5, 1),
    comp(trees.id, 'material', 'Backfill + staking kit', 1, 8050, null, 2),
  ]
  const irrigation = svc(s1.id, {
    label: 'Irrigation lateral line',
    qty: 1400,
    uom: 'FT',
    unitSellCents: 250,
    embeddedCostCents: 138,
    targetGm: 0.45,
    hours: 0.02,
    sortOrder: 1,
  })
  irrigation.components = [
    comp(irrigation.id, 'material', '1" PVC lateral pipe', 1, 62, null, 0),
    comp(irrigation.id, 'labor', 'Trench + lay + backfill', 0.02, 3800, 0.02, 1),
  ]
  s1.services = [trees, irrigation]

  const s2: EstimateSection = {
    id: fid('sec'),
    estimateId,
    name: 'Phase 2 — Amenity Center',
    squareFeet: 22000,
    sortOrder: 1,
    services: [],
  }
  const sod = svc(s2.id, {
    label: 'Bermuda Sod — Installed',
    qty: 48,
    uom: 'plt',
    unitSellCents: 41500,
    embeddedCostCents: 26900,
    targetGm: 0.35,
    hours: 1.1,
    sortOrder: 0,
  })
  sod.components = [
    comp(sod.id, 'material', 'Bermuda sod pallet (450 SF)', 1, 19500, null, 0),
    comp(sod.id, 'labor', 'Grade + lay crew', 1.1, 5200, 1.1, 1),
  ]
  s2.services = [sod]

  const base: InstallEstimate = {
    id: estimateId,
    estimateType: 'install',
    name: 'Silverleaf — Phase 2 Installation',
    aspireNumber: 'ASP-51077',
    aspireOpportunityId: 631077,
    aspireSyncStatus: 'synced',
    propertyId: null,
    leadId: null,
    clientName: 'Silverleaf Development LLC',
    branch: 'Phoenix-Desert',
    customerType: 'commercial',
    acreage: 2.1,
    contractValueCents: 0,
    targetMargin: 0.22,
    status: 'in_progress',
    lifecycle: 'bidding',
    aspireOwner: 'estimating',
    priority: 'urgent',
    winProbability: 0.5,
    siteWalkDate: new Date(Date.now() - 2 * DAY).toISOString(),
    dueBackDate: new Date(Date.now() + 7 * DAY).toISOString(),
    anticipatedCloseDate: new Date(Date.now() + 30 * DAY).toISOString(),
    serviceStartDate: new Date(Date.now() + 90 * DAY).toISOString(),
    assignedLsEstimator: 'u5',
    assignedIrrEstimator: 'u6',
    crmRep: 'u2',
    sections: [s1, s2],
    createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
    updatedAt: new Date(Date.now() - DAY).toISOString(),
  }
  const merged = { ...base, ...overrides }
  merged.contractValueCents = overrides.contractValueCents ?? contractTotal(merged)
  return merged
}

/** Takeoff lines for the install fixture (Discrepancy Review sample data). */
export function buildTakeoffLines(estimateId: string): TakeoffLine[] {
  return [
    { id: fid('tk'), estimateId, description: "Mahogany 10'-12'", uom: 'ea', planQty: 24, addPct: 0.05, measuredQty: 24, opportunityQty: 24 },
    { id: fid('tk'), estimateId, description: 'Irrigation lateral line', uom: 'FT', planQty: 1400, addPct: 0.1, measuredQty: 1640, opportunityQty: 1400 },
    { id: fid('tk'), estimateId, description: 'Bermuda sod', uom: 'SF', planQty: 21600, addPct: 0.05, measuredQty: 22100, opportunityQty: 21600 },
  ]
}

/** Strip server-assigned fields so a fixture can be POSTed as a create payload. */
export function toCreatePayload(estimate: Estimate): CreateEstimatePayload {
  const payload: Partial<Estimate> = { ...estimate }
  delete payload.id
  delete payload.createdAt
  delete payload.updatedAt
  return payload as CreateEstimatePayload
}

/** Seed data for the MSW in-memory store. */
export const mockEstimatesV2: Estimate[] = [buildMaintenanceEstimate(), buildInstallEstimate()]
export const mockTakeoffLines: TakeoffLine[] = buildTakeoffLines(mockEstimatesV2[1].id)

// ---------------------------------------------------------------------------
// Handoff 22 — catalog_items seed for GET /catalog-items. The maintenance
// rows mirror real workbook kits from sql/migrations/009_seed_catalog_items.sql
// (rated + deliberately UNRATED rows, so the production-rate save guard is
// exercisable in dev); the install rows reuse the kit literals (same ids, so
// editor fixtures resolve whether the config API has loaded or not).
// ---------------------------------------------------------------------------

const maintKit = (over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'description'>): CatalogItem => ({
  uom: 'Sq. Ft.',
  unitCostCents: 0,
  unitSellCents: 0,
  targetGm: 0.22,
  kitType: 'maintenance_hours',
  productionRate: null,
  branch: 'All Branches',
  active: true,
  serviceType: '',
  ...over,
})

export const CATALOG_ITEM_SEED: CatalogItem[] = [
  // maintenance_hours (production-rated — units per labor hour)
  maintKit({ id: 'kit-maint-3422', description: 'Standard Production Mowing', unitCostCents: 1750, productionRate: 67650, serviceType: 'Turf Area' }),
  maintKit({ id: 'kit-maint-3431', description: 'Bed Area Maintenance', unitCostCents: 1750, productionRate: 3000, serviceType: 'Bed Area' }),
  maintKit({ id: 'kit-maint-3432', description: 'Additional Round Up', unitCostCents: 1750, productionRate: 5000, serviceType: 'Bed Area' }),
  // maintenance_hours (UNRATED — saving a null-hours line against these must be
  // blocked by the guard until an estimator enters hours)
  maintKit({ id: 'kit-maint-3435', description: 'Prune Easy', serviceType: 'Bed Area' }),
  maintKit({ id: 'kit-maint-3440', description: 'Turf Area Fertilization', serviceType: 'Fertilization & Pest Control' }),
  // install_quantity — the literal rows ARE CatalogItems (plus vendor quotes)
  ...INSTALL_KIT_CATALOG.map((kit) => {
    const item: CatalogItem & { vendorPricesCents?: number[] } = { ...kit }
    delete item.vendorPricesCents
    return item as CatalogItem
  }),
]

/** Build a stored attachment fixture for tests. */
export function buildStoredAttachment(
  estimateId: string,
  submissionId: string,
  overrides?: Partial<IntakeAttachment>,
): IntakeAttachment {
  return {
    id: `att-test-${Date.now()}`,
    intakeSubmissionId: submissionId,
    estimateId: null,
    fileName: 'site_plan.pdf',
    contentType: 'application/pdf',
    sizeBytes: 512_000,
    kind: 'property_map',
    uploadedBy: 'u1',
    status: 'stored',
    objectKey: `estimating/${estimateId}/att-test.pdf`,
    downloadable: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/** Build a legacy (name-only) attachment fixture for tests. */
export function buildLegacyAttachment(submissionId: string): IntakeAttachment {
  return {
    id: `att-legacy-${Date.now()}`,
    intakeSubmissionId: submissionId,
    estimateId: null,
    fileName: 'old_rfp.pdf',
    contentType: '',
    sizeBytes: 0,
    kind: 'rfp',
    uploadedBy: null,
    status: 'stored',
    objectKey: null,
    downloadable: false,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  }
}
