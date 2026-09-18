export const LEAD_TYPES = ['HOA', 'commercial', 'deathcare', 'resort', 'healthcare'] as const
export type LeadType = (typeof LEAD_TYPES)[number]

// Unified communication channel type (calendar/notes only)
export type CommChannel = 'note' | 'meeting'

// Unified activity item from /api/leads/{id}/activity
export interface ActivityItem {
  id: string
  channel: CommChannel
  direction: 'out'
  body: string
  performed_by: string
  performed_at: string
  external_message_id?: string | null
}

// Connections status
export interface ConnectionsStatus {
  graph: { connected: boolean }
}

export type LeadStatus =
  | 'new'
  | 'reviewed'
  | 'contacted'
  | 'qualified'
  | 'disqualified'
  | 'proposal_sent'
  | 'won'
  | 'lost'
  | 'estimating'
  | 'op_review'
  | 'approved'

// The ten canonical business roles — one role vocabulary,
// mirrored by backend validation in api/authz.py.
export type UserRole =
  | 'procurement'
  | 'sales'
  | 'inside_sales'
  | 'admin'
  | 'manager'
  | 'regional_director'
  | 'maintenance_estimating'
  | 'install_estimating'
  | 'vice_president'
  | 'ceo'
  // Handoff 50 §3: cross-branch owner of company-wide proposal assets
  // (portfolio, client references, team bios/headshots). Not an estimator or
  // approver — see api/authz.py MARKETING_ROLES.
  | 'marketing'

export const CANONICAL_ROLES: readonly UserRole[] = [
  'procurement',
  'sales',
  'inside_sales',
  'admin',
  'manager',
  'regional_director',
  'maintenance_estimating',
  'install_estimating',
  'vice_president',
  'ceo',
  'marketing',
] as const

// Legacy auth role still present in older JWTs / un-migrated rows; it
// normalizes to `sales` (see useRole/normalizeRole and sql/migrations/004).
export type LegacyUserRole = 'outside_sales'

export type BidStatus =
  | 'pending'
  | 'pursuing'
  | 'submitted'
  | 'no_bid'
  | 'won'
  | 'lost'

export interface ScoreFactor {
  name: string
  score: number
  max: number
  description: string
}

export interface Lead {
  id: string
  property_name: string
  address: string
  city: string
  state: string
  zip: string
  lat: number
  lng: number
  lead_type: LeadType
  score: number | null
  score_factors: ScoreFactor[] | null
  estimated_acreage: number
  estimated_contract_value: number
  units?: number | null
  contact_id?: string | null
  contact_name: string | null
  contact_email: string | null
  contact_linkedin: string | null
  current_provider: string | null
  source: string
  source_url: string | null
  bid_deadline: string | null
  status: LeadStatus
  assigned_to: string | null
  /** users.id of the manual creator; null for every scraped lead. */
  created_by?: string | null
  notes: string | null
  handoff_notes: string | null
  ai_linkedin_draft: string | null
  branch_id: string | null
  distance_miles: number | null
  aspire_opportunity_id: string | null
  division_id: number | null
  /** Canonical properties.id (replaces the removed hoa_property_id). */
  property_id?: string | null
  created_at: string
  updated_at: string
}

export interface Bid {
  id: string
  title: string
  agency: string
  service_types: string[]
  deadline: string
  estimated_value: number
  status: BidStatus
  branch_id: string
  assigned_estimator_id: string | null
  lead_id: string | null
  submission_notes: string | null
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  name: string
  email: string
  // Canonical role; legacy values may still arrive from un-migrated rows.
  role: UserRole | LegacyUserRole
  branch_id: string
  avatar_initials: string
}

export interface InsideSalesSummary {
  new_leads_today: number
  leads_contacted_this_week: number
  open_bids: number
  bids_due_this_week: number
  pipeline_value: number
  overdue_follow_ups: number
  won_this_month: number
  won_value_this_month: number
}

export interface MonthlyRevenue {
  month: string
  won: number
  forecast: number
  pipeline: number
}

export interface KanbanColumn {
  id: LeadStatus
  title: string
  color: string
  leads: Lead[]
}

export interface AssignCrmPayload {
  lead_id: string
  assigned_to: string
  handoff_notes: string
}

export interface AuthUser {
  id: string
  email: string
  name: string
  // Canonical role; legacy values may still arrive in pre-migration JWTs and
  // are normalized in useRole (normalizeRole).
  role: UserRole | LegacyUserRole
  branch_id: string
  avatar_initials: string
  token?: string
}

// ── Microsoft Graph / Calendar ────────────────────────────────────────────────

export interface CalendarEventAttendee {
  emailAddress: { address: string; name?: string }
  type?: 'required' | 'optional'
}

export interface CalendarEventDateTime {
  dateTime: string
  timeZone: string
}

export interface CalendarEvent {
  id: string
  subject: string
  start: CalendarEventDateTime
  end: CalendarEventDateTime
  attendees: CalendarEventAttendee[]
  onlineMeeting?: { joinUrl: string } | null
  bodyPreview?: string
  webLink?: string
  isOrganizer?: boolean
  type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster'
  seriesMasterId?: string | null
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown'
  isCancelled?: boolean
}

export interface CalendarEventUpdatePayload {
  subject?: string
  start_iso?: string
  end_iso?: string
  attendees?: string[]
  body?: string
}

export interface CalendarEventCreatePayload {
  subject: string
  start_iso: string
  end_iso: string
  attendees?: string[]
  body?: string
  online_meeting?: boolean
}

export interface ScheduleMeetingPayload {
  subject: string
  start_iso: string
  end_iso: string
  attendees?: string[]
  body?: string
  online_meeting?: boolean
}
