// ---------------------------------------------------------------------------
// Proposal domain model
//
// Types for the Generate Proposal feature (Handoff 37 — Proposify Replacement).
// Produces Juniper's standard sales proposal package as in-app, print-ready HTML.
// Money is integer cents; no `any`. See handoffs/37-proposal-export-and-generator.md.
//
// Amendment A (2026-08-26): branch key changed from string to aspireBranchId: number | null;
// BranchProfile is now a frontend read-model (not a table); region is regionId: string;
// TeamMemberTitle aligned to CANONICAL_ROLES in api/authz.py; userId added to TeamMember.
// ---------------------------------------------------------------------------

/** All page keys in the proposal — required pages are always included; optional ones
 *  appear only when present in ProposalRequest.sections. */
export type ProposalSectionKey =
  | 'cover'
  | 'intro_letter' | 'rooted_in_florida' | 'local_landscape_experts' | 'org_chart'
  | 'services_design' | 'services_maintenance' | 'services_installation' | 'services_turf'
  | 'services_irrigation' | 'services_arboriculture' | 'services_storm_response'
  | 'services_enhancements' | 'services_aquatics' | 'services_safety_training' | 'services_juniper_cares'
  | 'startup_communication' | 'customer_care' | 'meet_our_team' | 'client_references' | 'insurance'
  | 'portfolio' | 'thank_you'
  // optional
  | 'startup_plan_30_60_90' | 'juniper_sync' | 'juniper_mapping' | 'meet_our_team_executive'

export type TeamMemberType = 'branch' | 'executive'

/**
 * Amendment A.4: aligned to api/authz.py CANONICAL_ROLES where overlap exists.
 * - 'branch_manager' → 'manager'  (CANONICAL_ROLES uses 'manager', not 'branch_manager')
 * - 'regional_director' kept (exact match in CANONICAL_ROLES)
 * - 'account_manager', 'agronomy_manager', 'irrigation_manager', 'production_manager', 'executive'
 *   kept as-is — no canonical equivalent; these are proposal-roster-specific titles.
 */
export type TeamMemberTitle =
  | 'regional_director' | 'manager' | 'account_manager'
  | 'agronomy_manager' | 'irrigation_manager' | 'production_manager' | 'executive'

/** Config row — one per person eligible to appear in a proposal. Seeded/admin-managed, never hardcoded. */
export interface TeamMember {
  id: string
  name: string
  title: TeamMemberTitle
  teamType: TeamMemberType
  // Amendment A.1: Aspire BranchID; null = corporate/executive roster.
  aspireBranchId: number | null
  // Amendment A.4: when set, name/title/branch derive from users + user_branches.
  // Non-CRM users (production managers, foremen) carry userId: null with their own name/title.
  userId: string | null
  location: string | null
  bio: string
  headshotObjectKey: string | null   // GCS, same pattern as IntakeAttachment.objectKey
  active: boolean
  sortOrder: number
}

/**
 * Amendment A.2: NOT a table — `crm.branches` already holds all 56 offices keyed on aspire_branch_id.
 * This is a frontend READ-MODEL projected from `crm.branches`, plus the three columns Amendment A.2
 * adds to that table: lat, lng, region_id.
 * Do NOT persist regionalDirectorId/branchManagerId here — derive from user_branches + users.role.
 */
export interface BranchProfile {
  aspireBranchId: number   // crm.branches.aspire_branch_id
  branchName: string
  city: string
  regionId: string         // -> crm.regions
  address: string
  lat: number
  lng: number
}

/** Coverage table read-model — office names grouped by state, deduped on address. */
export interface BranchCoverageGroup {
  state: string
  stateName: string
  branches: string[]
}

/**
 * A license or certification Juniper holds. expiryDate null means non-expiring;
 * isExpired is computed server-side so a skewed client clock cannot flip it.
 */
export interface LicenseCertification {
  id: string
  kind: 'license' | 'certification'
  name: string
  issuingBody: string | null
  identifier: string | null
  holderName: string | null
  aspireBranchId: number | null   // null = company-wide
  issuedDate: string | null
  expiryDate: string | null
  objectKey: string | null
  isExpired: boolean
  active: boolean
}

export interface LicenseCertificationGroups {
  licenses: LicenseCertification[]
  certifications: LicenseCertification[]
}

export interface ClientReference {
  id: string
  aspireBranchId: number | null   // Amendment A.1: null = usable company-wide
  propertyName: string
  servicesProvided: string
  contactName: string
  contactTitle: string | null
  phone: string
  email: string
  address: string
  clientSinceYear: number
  active: boolean
}

export interface PortfolioProperty {
  id: string
  name: string
  cityState: string
  regionId: string          // Amendment A.3: -> crm.regions, not a union type
  photoObjectKeys: string[]
  beforeAfterObjectKeys?: { before: string; after: string } | null
  sortOrder: number
}

/** Numeric-only crew counts — no names below Production Manager (§3 of the handoff). */
export interface OrgChartCrewCounts {
  mow: { foremen: number; members: number }
  prune: { foremen: number; members: number }
  fertIpm: { members: number }
  irrigation: { members: number }
}

export interface OrgChartInput {
  included: boolean
  accountManagerIds: string[]
  agronomyManagerId?: string | null
  irrigationManagerId?: string | null
  productionManagerId?: string | null
  crewCounts: OrgChartCrewCounts
}

/** The 30-60-90 optional page: Day Zero/30 render from a static seed; the rest are free text per proposal. */
export interface StartupPlanInput {
  included: boolean
  day60: string[]
  day90: string[]
  day120Plus: string[]
  ongoing: string[]
}

/** Server-side PDF render result — one row per render attempt stored in proposal_renders. */
export interface ProposalRender {
  id: string
  proposalId: string
  version: number
  objectKey: string
  /** Signed GCS URL included when status === 'complete'. */
  downloadUrl?: string | null
  pageCount: number | null
  status: 'complete' | 'pending' | 'failed'
  errorMessage: string | null
  renderedBy: string
  durationMs: number | null
  renderedAt: string
}

/** Persisted row — every generated proposal is saved so it can be reopened/edited (no ephemeral-only state, per CLAUDE.md). */
export interface ProposalRequest {
  id: string
  leadId: string
  estimateId: string
  createdBy: string          // user id
  sections: ProposalSectionKey[]           // which optional sections are included (required ones are implicit)
  orgChart: OrgChartInput
  startupPlan: StartupPlanInput
  teamMemberIds: string[]                  // Meet Our Team picks (page 8)
  executiveTeamMemberIds: string[]         // optional Meet Our Team — Executive
  clientReferenceIds: string[]
  portfolioPropertyIds: string[]
  signerUserId: string                     // who signs the letter/thank-you pages
  createdAt: string
  updatedAt: string
}
