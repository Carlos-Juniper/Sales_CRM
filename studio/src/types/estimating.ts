// ---------------------------------------------------------------------------
// Estimating domain model
//
// Single source of truth for the Estimating tab. Every queue, editor engine,
// margin view, approval flow, and discrepancy review reads these types.
// Money is integer cents; percentages are decimals (0.22 = 22%).
// ---------------------------------------------------------------------------

// ----- Config reference types -----------------------------------------------

/** Aspire-derived branch option returned by GET /api/estimating/config/branches. */
export interface BranchOption {
  city: string
  aspire_branch_id: number
}

// ----- Core enums ----------------------------------------------------------

/**
 * The single most important field in the redesign. Set implicitly at intake
 * (maintenance intake form vs install proposal-request form) and IMMUTABLE
 * after creation. There is no UI to switch it; every downstream tool renders
 * automatically off this value.
 */
export type EstimateType = 'maintenance' | 'install'

/** §3.2 status enum — final set pending confirmation with Carlos. */
export type EstimateStatus =
  | 'new_from_sales'
  | 'queued'
  | 'in_progress'
  | 'review'
  | 'pending_approval'
  | 'approved'
  | 'handed_back'
  | 'won'
  | 'lost'

/** Drives ownership transfer: WON flips `aspireOwner` from estimating to crm. */
export type EstimateLifecycle = 'bidding' | 'won'

export type AspireOwner = 'estimating' | 'crm'

/**
 * Async Aspire push state (mirrors the backend column). Properties start
 * 'unsynced' (local-only) and are pushed ONLY when an estimate is submitted
 * for them ('pending' = queued/in-flight at trigger time).
 */
export type AspireSyncStatus = 'unsynced' | 'pending' | 'synced' | 'failed'

/**
 * CANONICAL app-owned property record — the single source of
 * truth for every physical location, across verticals. `propertyType` drives
 * estimating/Aspire logic; `sourceType`/`sourceId` trace provenance back to
 * the vertical prospecting table the row was promoted from ('manual' when
 * hand-entered).
 */
export interface Property {
  id: string
  name: string
  /** Business category: 'hoa', 'hospital', 'cemetery', 'park', 'gov', 'manual', … */
  propertyType?: string | null
  /** Provenance table ('hoa', …) or 'manual'. */
  sourceType?: string | null
  /** Row id in the vertical table; null when sourceType==='manual'. */
  sourceId?: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  /** City-level branch key (e.g. "Orlando, FL"). */
  branchCity: string | null
  customerType: string | null
  managementCompanyId: string | null
  acreage: number | null
  units: number | null
  aspirePropertyId: number | null
  aspireSyncStatus: AspireSyncStatus
  createdAt: string | null
  updatedAt: string | null
}

export interface CreatePropertyPayload {
  name: string
  /** Canonical origin fields; default 'manual' on the server. */
  propertyType?: string | null
  sourceType?: string | null
  sourceId?: string | null
  address1?: string
  address2?: string | null
  city?: string
  state?: string
  zip?: string
  branchCity?: string | null
  customerType?: string | null
  managementCompanyId?: string | null
  acreage?: number | null
  units?: number | null
}

/**
 * A property's existing Aspire opportunity, surfaced in the intake dedup panel.
 * Shape mirrors Aspire's record loosely — best-effort read, so keep it permissive.
 */
export interface AspireOpportunitySummary {
  OpportunityID: number
  OpportunityNumber?: number | string | null
  OpportunityName?: string | null
  OpportunityStatusName?: string | null
  [key: string]: unknown
}

export type EstimatePriority = 'urgent' | 'high' | 'medium'

/** BRD I-6.1 (maintenance) customer types. */
export type MaintenanceCustomerType = 'commercial' | 'cdd' | 'hoa' | 'government'

/** Install customer types. */
export type InstallCustomerType =
  | 'commercial'
  | 'government'
  | 'land_residential'
  | 'home_residential'

export type CustomerType = MaintenanceCustomerType | InstallCustomerType

// ----- Approval settings ---------------------------------------

/**
 * Per-estimate on-approval settings. BRD I-7 note: BM + RD are typically both
 * tagged on the return to the CRM regardless of tier — default true.
 * Open item: whether notify-both is per-estimate or a global setting.
 */
export interface EstimateApprovalSettings {
  notifyBmRdOnReturn: boolean
}

// ----- Estimate (discriminated union on estimateType) ----------------------

export interface EstimateBase {
  id: string
  name: string
  /** Aspire opportunity #; nullable until synced. Render via displayRef(), not directly. */
  aspireNumber: string | null
  /** Aspire OpportunityID (write-back key); null until the push lands. External ref only. */
  aspireOpportunityId: number | null
  /** Async push state; drives the sync-status chip + retry affordance. */
  aspireSyncStatus: AspireSyncStatus
  /** Link to the app-owned property (source of truth); null for legacy rows. */
  propertyId: string | null
  /**
   * Pipeline kanban redesign — logical ref to the sales lead this estimate was
   * created against. Drives the lead→estimate status write-back: creating an
   * estimate with a leadId moves that lead from Qualifying to Estimating.
   * Optional/absent for estimates with no originating lead (e.g. direct
   * Aspire import).
   */
  leadId?: string | null
  clientName: string
  /**
   * Aspire BranchID (identity) — the service-line-encoded branch row the crew
   * rates vary at (e.g. Fort Myers Install=1403 vs Maintenance=3696). Set at
   * intake from the selected {@link BranchOption}; null only for legacy rows
   * created before the id was carried. Use THIS for branch identity/scoping.
   */
  aspireBranchId: number | null
  /**
   * Human-readable branch city label (e.g. "Fort Myers, FL"). Display only —
   * never an identity key (the map is not uniquely reversible). Mirrors the
   * legacy `estimates.branch` column until Slice 14 drops it.
   */
  branchCity: string | null
  /**
   * Frozen loaded-crew-rate snapshot, integer cents/hr, captured at submission
   * (Slice 7). Present (non-null) once an estimate reaches review/pending_approval/
   * approved; NULL for in_progress / handed-back / pre-migration rows. The Margin
   * Analysis panel prices maintenance margin off THIS when present, so a later
   * branch-rate change never moves a frozen estimate's displayed margin (§2.6).
   * Null ⇒ fall through to the live branch rate, then to a loud no-rate state —
   * NEVER an invented default (§2.3, no-fallback).
   */
  crewRateCentsPerHour?: number | null
  /**
   * Submitted-at crew rate preserved when clearing on hand-back to in_progress
   * (§2.6, migration 024). Non-null when an estimate was handed back after a
   * freeze and the branch rate has since changed. The Margin Analysis panel
   * shows "Crew rate changed $X.XX → $Y.YY since this was submitted" when this
   * differs from the current live branch rate. Null for fresh in_progress
   * estimates and pre-migration rows.
   */
  priorCrewRateCentsPerHour?: number | null
  acreage: number | null
  /** Derived roll-up, persisted for queue/reporting. Integer cents. */
  contractValueCents: number
  /**
   * Split-contract homes budget, in dollars (not cents). Null is unknown —
   * a blank intake field — and must never be rendered or summed as $0.
   * A real 0 is a known zero. Always present on list and GET.
   */
  homesBudget: number | null
  /**
   * Split-contract common-area budget, in dollars (not cents). Same null
   * contract as {@link homesBudget}.
   */
  commonAreaBudget: number | null
  /** Decimal, default 0.22 (branch standard). */
  targetMargin: number
  status: EstimateStatus
  lifecycle: EstimateLifecycle
  aspireOwner: AspireOwner
  priority: EstimatePriority
  /** 0.20–1.00 (BRD I-6.1 / II). */
  winProbability: number
  siteWalkDate: string | null
  /** SLA clock. */
  dueBackDate: string
  anticipatedCloseDate: string | null
  serviceStartDate: string | null
  /** Landscape estimator user id. */
  assignedLsEstimator: string | null
  /** Irrigation estimator user id. */
  assignedIrrEstimator: string | null
  /** The salesperson ("the CRM" — a person, not a system). */
  crmRep: string | null
  /** On-approval notification settings; absent ⇒ defaults (notify both ON). */
  approvalSettings?: EstimateApprovalSettings
  /** Optional queue-card notes (e.g. intake context from Sales, walk notes). */
  notes?: string | null
  /**
   * §3.2 — install RFI status, tracked as a first-class field and
   * surfaced in the queue/editor. Capture/display only: nothing gates approval
   * on it. Null/absent for maintenance and legacy rows.
   */
  rfiStatus?: string | null
  /**
   * Takeoff metadata (Takeoff Insert stat grid). Written either by estimator
   * entry or by Beam ingest, which converts Attentive's sq ft / ft into the
   * acres and miles these fields hold. Acreage & sqft stay DERIVED from sections.
   */
  turfAreaAcres?: number | null
  curbMiles?: number | null
  /**
   * Set when Beam redelivered measurements after this estimate was priced.
   * Non-null means the displayed price may be stale and the estimator has a
   * diff to accept — Beam never silently overwrites a priced estimate.
   */
  takeoffChangedAt?: string | null
  sections: EstimateSection[]
  createdAt: string
  updatedAt: string
}

export interface MaintenanceEstimate extends EstimateBase {
  estimateType: 'maintenance'
  customerType: MaintenanceCustomerType
}

export interface InstallEstimate extends EstimateBase {
  estimateType: 'install'
  customerType: InstallCustomerType
}

export type Estimate = MaintenanceEstimate | InstallEstimate

// ----- Sections / services / components ------------------------------------

/**
 * Sections exist for both estimate types. The pricing engine for a section's
 * rows is keyed off the PARENT estimate's `estimateType`, never a per-section
 * mode. Acreage is derived (`squareFeet / 43560`), never stored.
 */
export interface EstimateSection {
  id: string
  estimateId: string
  name: string
  /** Drives maintenance pricing. */
  squareFeet: number
  sortOrder: number
  services: SectionService[]
}

export interface SectionService {
  id: string
  sectionId: string
  catalogItemId: string | null
  /**
   * Per-line LS/IR override for the ITB EST LS $ / EST IR $ split. `null`
   * derives the discipline from the catalog item's `serviceType` (irrigation
   * vs. landscape); a manual line with no catalog item defaults to landscape
   * unless set explicitly here.
   */
  discipline?: 'landscape' | 'irrigation' | null
  label: string
  /** Occurrences/yr (maintenance) or quantity (install). */
  qty: number
  /** `/yr`, `ea`, `plt`, `FT`, `30g`, … */
  uom: string
  /** Maintenance hours adder, decimal (0.10 = +10%). */
  complexityPct: number
  /**
   * Integer cents. Install: unit sell price (U/P).
   * Maintenance: rate per 1,000 sqft per occurrence.
   */
  unitSellCents: number | null
  /** Install SUB COST, integer cents. */
  embeddedCostCents: number | null
  /** Install per-line GM% target (e.g. ~0.45 irrigation). */
  targetGm: number | null
  /** Tracked for production planning; does NOT drive price. */
  hours: number | null
  sortOrder: number
  /** Contract generator fields (from catalog_items, for approved/won maintenance estimates) */
  serviceType?: string | null
  scopeText?: string | null
  /**
   * Per-line override of the contract's recurring/one-time split. `null`
   * derives it from the catalog item's `billingType`; a hand-entered line has
   * no catalog item, so without an explicit value here it resolves to null and
   * drops out of the contract's 12-month payment-schedule base. Same override
   * shape as `discipline`.
   */
  billingType?: 'recurring' | 'one_time' | null
  /** Install kit breakdown (expandable rows). Empty for maintenance. */
  components: SectionServiceComponent[]
}

export type ComponentKind = 'labor' | 'material'

export interface SectionServiceComponent {
  id: string
  sectionServiceId: string
  kind: ComponentKind
  label: string
  /** Editable (blue-cell). */
  qty: number
  /** Editable (blue-cell). Integer cents. */
  unitCostCents: number
  hours: number | null
  sortOrder: number
}

// ----- Catalog / kits -------------------------------------------------------

export type KitType = 'maintenance_hours' | 'install_quantity'

export interface CatalogItem {
  id: string
  description: string
  uom: string
  unitCostCents: number
  unitSellCents: number
  targetGm: number
  kitType: KitType
  /** Maintenance: units per labor hour. Null for install kits. */
  productionRate: number | null
  branch: string
  active: boolean
  serviceType: string
}

// ----- Materials calculator (config-driven formulas) ------------------------

export type MaterialComputeType =
  | 'divPiece'
  | 'divRoll'
  | 'aggregate'
  | 'sod'
  | 'mulch'
  | 'fert'
  | 'backfill'

export interface MaterialComputeInput {
  sqft?: number
  linearFt?: number
  depthIn?: number
  /** Waste/add factor, e.g. 0.10 = +10%. Default 0 when absent. */
  addPct?: number
  /** Mulch: number of tree rings (each adds extra material). */
  treeRings?: number
  /** Backfill: container/planter count (when computing by count × size). */
  count?: number
}

export interface MaterialComputeResult {
  units: number
  uom: string
}

/** Raw config row — persisted as data, never hardcoded logic. */
export interface MaterialCalcRow {
  id: string
  materialKey: string
  label: string
  computeType: MaterialComputeType
  /** Piece lengths, roll SF, depth tables, pallet SF, bag coverage, … */
  factors: Record<string, number | Record<string, number>>
  unitSellCents: number
  unitCostCents: number
  uom: string
  /** Slot for future freight tables / volume-price thresholds (44,000 SF+). */
  volumeQuoteThresholdSf?: number
}

/** Config row hydrated by the formula engine — each material declares its own conversion. */
export interface MaterialCalc extends MaterialCalcRow {
  compute: (input: MaterialComputeInput) => MaterialComputeResult
}

// ----- Takeoff / discrepancy review ------------------------------------------

/**
 * `bidQty`, `flagged`, and `deltaVsOpp` are derived via calc helpers — the
 * discrepancy threshold is a config value (default 10%, range 1–25%), never
 * baked into the row.
 */
export interface TakeoffLine {
  id: string
  estimateId: string
  description: string
  uom: string
  planQty: number
  /** Decimal adder, e.g. 0.10. */
  addPct: number
  measuredQty: number
  /**
   * LOCALLY-set, manually-editable opportunity qty (drives Δ vs Opp). Never
   * read from Aspire (locked decision); on estimate Save the
   * backend pushes it one-way to OpportunityServiceItem.ItemQuantity for
   * lines that carry a catalogItemId.
   */
  opportunityQty: number
  /** Nullable kit link enabling the Aspire qty push. */
  catalogItemId?: string | null
}

// ----- Approval tiers (config-driven) ----------------------------------------

/**
 * Tier role keys equal the canonical auth roles, so
 * the JWT role checks directly against the routed tier.
 */
export type ApprovalRoleKey = 'manager' | 'regional_director' | 'vice_president' | 'ceo'

export interface ApprovalTier {
  id: string
  roleKey: ApprovalRoleKey
  label: string
  minValueCents: number
  /** Null = unbounded. Max is exclusive; min inclusive. */
  maxValueCents: number | null
  order: number
  /**
   * Which estimate type this ladder applies to. Install uses the same
   * ladder as maintenance (its own rows, mirrored $ bands).
   */
  estimateType: EstimateType
}

// ----- ITB tracker ------------------------------------------------------------

export type ItbScopeGroup = 'estimating' | 'outside_dept' | 'vendor_only'

/** Config-driven scope definitions — admin-extensible without migration. */
export interface ItbScope {
  id: string
  key: string
  label: string
  group: ItbScopeGroup
  order: number
}

/**
 * Confirmed legend (Carlos, 2026-08-06; BRD II-9.12): P Pending ·
 * C Created Request · S Sent · R Received · U Updated · X 100% Complete ·
 * '-' Non-Applicable.
 */
export type ItbStatusCode = 'P' | 'C' | 'S' | 'R' | 'U' | 'X' | '-'

export interface ItbScopeStatus {
  projectId: string
  scopeId: string
  statusCode: ItbStatusCode
}

export interface ItbProject {
  id: string
  /**
   * The estimate that auto-generated this project (1:1 LOCKED —
   * one estimate → one ITB project, created at intake from either form).
   * Optional/null only for legacy rows seeded before auto-generation.
   */
  estimateId?: string | null
  name: string
  aspireNumber: string | null
  branch: string
  salesRep: string | null
  lsEstimator: string | null
  irrEstimator: string | null
  irrDesigner: string | null
  bidNumber: string | null
  itbDate: string
  dueDate: string
  rebid: boolean
  estTotalCents: number
  /** Landscape / irrigation dollar split, integer cents. */
  estLsCents: number
  estIrCents: number
  client: string
  quarter: string
  notes: string | null
}

// ----- Intake -----------------------------------------------------------------

export interface IntakeSubmission {
  id: string
  estimateId: string
  estimateType: EstimateType
  /** Raw intake payload, persisted verbatim. */
  payload: Record<string, unknown>
  submittedBy: string
  createdAt: string
}

/**
 * §3.3 — a "Save draft" row: a partial intake persisted server-side
 * (intake_submissions, is_draft=1) BEFORE any estimate exists. Per-user and
 * device-independent; saving/resuming a draft never creates an estimate and
 * never triggers an Aspire push.
 */
export interface IntakeDraft {
  id: string
  estimateType: EstimateType
  /** Partial intake form state, persisted verbatim. */
  payload: Record<string, unknown>
  submittedBy: string
  isDraft: true
  createdAt: string
}

// 'takeoff_scan' — the Takeoff Insert scanned boundary map;
// estimate-scoped (no intake submission) and may be an image, not just PDF.
//
// 'proposal_contract' | 'proposal_measurements' | 'proposal_other' (Handoff 47)
// — the three estimate-scoped proposal documents appended to the rendered PDF.
// Contract is PDF-only; measurements/other accept images too.
export type AttachmentKind =
  | 'property_map'
  | 'rfp'
  | 'other'
  | 'takeoff_scan'
  | 'proposal_contract'
  | 'proposal_measurements'
  | 'proposal_other'
export type AttachmentStatus = 'pending' | 'stored' | 'failed' | 'deleted'

/** Intake attachment row — enriched with GCS columns added in the attachment feature. */
export interface IntakeAttachment {
  id: string
  /** Null for estimate-scoped rows (takeoff scans have no intake submission). */
  intakeSubmissionId: string | null
  /** Direct estimate link (takeoff scans); null for legacy intake rows. */
  estimateId: string | null
  fileName: string
  contentType: string
  sizeBytes: number
  /** Deprecated — object_key is the durable GCS reference. Legacy rows keep this empty. */
  url?: string
  kind: AttachmentKind
  uploadedBy: string | null
  status: AttachmentStatus
  objectKey: string | null
  /** True only when status='stored' AND objectKey is set. Legacy rows are false. */
  downloadable: boolean
  /** Stable order for 'other' proposal attachments (Handoff 47); 0 otherwise. */
  sortOrder: number
  /** Server-side page count recorded at confirm for proposal documents; null for
   *  images before confirm and for pre-032 rows. */
  pageCount: number | null
  createdAt: string
}

// ----- Adjustments audit --------------------------------------------------------

export type AdjustmentField = 'complexity' | 'margin'

/** Every approver complexity/margin adjustment, auditable + revertible (BRD III-1). */
export interface EstimateAdjustment {
  id: string
  estimateId: string
  actor: string
  field: AdjustmentField
  fromValue: number
  toValue: number
  createdAt: string
}

// ----- Margin bands (single canonical config) ------------------------------------

/** One canonical set — resolves the prototype's three conflicting definitions. */
export interface MarginBands {
  goodMin: number
  okMin: number
}

export type MarginBandLabel = 'good' | 'ok' | 'low'

/**
 * A margin_bands config row as returned by GET /api/estimating/config/margin-bands.
 * The canonical set the UI consumes is the row named 'default'.
 */
export interface MarginBandRow extends MarginBands {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Legacy types (pre-redesign prototype). Deprecated — retained only so the
// existing EstimateQueue / LineItemEditor / MarginAnalysis / ProposalExport
// components keep compiling until they are replaced.
// ---------------------------------------------------------------------------

/** @deprecated Use {@link EstimatePriority}. */
export type LegacyEstimatePriority = 'urgent' | 'high' | 'medium' | 'low'
/** @deprecated */
export type LineItemCategory = 'labor' | 'materials' | 'equipment' | 'overhead' | 'subcontractor'
/** @deprecated */
export type BidOutcomeType = 'won' | 'lost' | 'no_bid' | 'pending'
/** @deprecated */
export type LossReason =
  | 'price_too_high'
  | 'competitor_relationship'
  | 'scope_mismatch'
  | 'timeline_mismatch'
  | 'incumbent_retained'
  | 'budget_cut'
  | 'other'

/** @deprecated Superseded by {@link Estimate} + queue views over it. */
export interface EstimateQueueItem {
  id: string
  lead_id: string | null
  property_name: string
  lead_type: 'HOA' | 'commercial'
  assigned_to: string | null
  priority: LegacyEstimatePriority
  deadline: string
  status: EstimateStatus
  estimated_acreage: number
  estimated_contract_value: number
  site_walk_date: string | null
  site_walk_notes: string | null
  created_at: string
}

/** @deprecated Superseded by {@link SectionService}. */
export interface LineItem {
  id: string
  category: LineItemCategory
  description: string
  quantity: number
  unit: string
  unit_cost: number
  unit_price: number
  total_cost: number
  total_price: number
  margin_pct: number
}

/** @deprecated Superseded by the discriminated-union {@link Estimate}. */
export interface LegacyEstimate {
  id: string
  queue_item_id: string
  lead_id: string | null
  property_name: string
  version: number
  ai_generated: boolean
  line_items: LineItem[]
  subtotal_cost: number
  overhead_pct: number
  overhead_amount: number
  total_cost: number
  total_price: number
  margin_pct: number
  target_margin_pct: number
  notes: string
  status: EstimateStatus
  created_at: string
  updated_at: string
}

/** @deprecated */
export interface BidOutcomeLog {
  id: string
  lead_id: string | null
  bid_id: string | null
  property_name: string
  lead_type: 'HOA' | 'commercial'
  outcome: BidOutcomeType
  bid_amount: number
  competitor_bid: number | null
  loss_reason: LossReason | null
  loss_notes: string | null
  logged_at: string
  logged_by: string
}

/** @deprecated */
export interface MarginCategoryBreakdown {
  category: LineItemCategory
  label: string
  cost: number
  price: number
  margin_pct: number
  target_margin_pct: number
  historical_avg_pct: number
  weight_pct: number
}

/** @deprecated Legacy stub preserved for backward compat. */
export interface EstimateDraft {
  id: string
  estimate_queue_id: string
  ai_generated: boolean
  line_items: EstimateLineItem[]
  total_cost: number
  total_price: number
  margin_pct: number
  notes: string
  reviewed: boolean
}

/** @deprecated Legacy stub preserved for backward compat. */
export interface EstimateLineItem {
  id: string
  category: string
  description: string
  quantity: number
  unit: string
  unit_cost: number
  unit_price: number
  margin_pct: number
}

/** @deprecated Legacy stub preserved for backward compat. */
export interface MarginAnalysis {
  labor_pct: number
  materials_pct: number
  overhead_pct: number
  profit_pct: number
  total_margin_pct: number
}
