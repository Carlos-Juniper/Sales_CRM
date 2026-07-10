export const LEAD_TYPES = ['HOA', 'commercial', 'deathcare', 'resort'] as const
export type LeadType = (typeof LEAD_TYPES)[number]

// Unified communication channel type (source of truth for all three slices)
export type CommChannel = 'email' | 'call' | 'sms' | 'linkedin' | 'note' | 'meeting'

// Unified activity item from /api/leads/{id}/activity
export interface ActivityItem {
  id: string
  channel: CommChannel
  direction: 'in' | 'out'
  body: string
  performed_by: string
  performed_at: string
  subject?: string
  recording_url?: string | null
  duration_seconds?: number | null
  transcript_summary?: string | null
  external_message_id?: string | null
}

// Contact consent record
export interface ContactConsent {
  contact_id: string
  do_not_call: boolean
  do_not_text: boolean
  do_not_email: boolean
  consent_call: boolean
  consent_text: boolean
  consent_captured_at: string | null
  consent_source: string | null
  consent_by: string | null
  updated_at: string | null
}

// Connections status
export interface ConnectionsStatus {
  graph: { connected: boolean }
  telephony: { configured: boolean; provider: string }
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
  | 'handed_off'

export type UserRole =
  | 'inside_sales'
  | 'outside_sales'
  | 'manager'

export type BidStatus =
  | 'pending'
  | 'pursuing'
  | 'submitted'
  | 'no_bid'
  | 'won'
  | 'lost'

export type OutreachChannel = 'email' | 'call' | 'sms' | 'linkedin' | 'note' | 'meeting'

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
  notes: string | null
  handoff_notes: string | null
  ai_email_draft: string | null
  ai_linkedin_draft: string | null
  branch_id: string | null
  distance_miles: number | null
  aspire_opportunity_id: string | null
  division_id: number | null
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
  role: UserRole
  branch_id: string
  avatar_initials: string
}

export interface OutreachHistory {
  id: string
  lead_id: string
  channel: OutreachChannel
  message: string
  sent_at: string
  direction: 'in' | 'out'           // 'out' = we sent, 'in' = they replied
  sender_name?: string               // for inbound messages, the contact's name
  response_received: boolean
  response_at: string | null
  sequence_step: number
  next_follow_up: string | null
}

export interface OutreachQueueSummary {
  lead_id: string
  last_message: string
  last_message_direction: 'in' | 'out'
  last_message_at: string
  last_message_channel: OutreachChannel
  unread: boolean
  overdue: boolean
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

export interface HandoffPayload {
  lead_id: string
  assigned_to: string
  handoff_notes: string
  last_outreach_message?: string
  division_id?: number | null
}

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
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
