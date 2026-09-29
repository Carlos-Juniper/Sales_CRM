/**
 * Commissions feature types owned by the studio UI.
 * Formatting helpers live in lib/commissions.ts (not here) to match the
 * repo convention of types files containing only data shapes.
 * Keep every shape this page reads here. A backend cleanup that drops
 * unused commission types must not remove these.
 */

export type CommissionStatus = 'approved' | 'paid' | 'cancelled'

export type CommissionInstallmentStatus =
  | 'paid'
  | 'due'
  | 'upcoming'
  | 'cancelled'
  | 'pending_billing_data'

export type CommissionPayoutBucket = 'dated' | 'unscheduled' | 'pending_billing_data'

export type CommissionEstimateType = 'maintenance' | 'install'

export interface CommissionInstallment {
  id: string
  installment_number: number
  payout_period: string
  payout_period_label: string
  payout_date: string | null
  amount_cents: number | null
  status: CommissionInstallmentStatus
  billing_installment_number: number | null
  collected_amount_cents: number | null
  bucket: CommissionPayoutBucket
  payable: boolean
}

export interface Commission {
  id: string
  estimate_id: string
  lead_id: string
  user_id: string
  contract_value_cents: number
  commission_rate: number  // Decimal (0.05 = 5%)
  commission_amount_cents: number
  status: CommissionStatus
  approved_at: string | null
  paid_at: string | null
  payment_period: string | null
  notes: string | null
  created_at: string
  updated_at: string

  // Joined fields. users.name, users.email, and leads.property_name are NOT NULL.
  // estimates.estimate_type is ENUM('maintenance','install') NOT NULL.
  // estimates.estimate_number and aspire_number are nullable.
  rep_name: string
  rep_email: string
  property_name: string
  estimate_number: number | null
  aspire_number: string | null
  estimate_type: CommissionEstimateType

  // plan_key is the plan stored on this commission. plan_name and
  // rep_plan_key are the rep's current assignment (null if none).
  close_quarter: string | null
  plan_key: string | null
  rep_plan_key: string | null
  plan_name: string | null
  client_type: string | null
  contract_start_date: string | null
  payable: boolean
  payout_period: string
  payout_period_label: string
  installments: CommissionInstallment[]
}

export interface CommissionNextPayout {
  payout_period: string
  payout_period_label: string
  payout_date: string
  amount_cents: number
  bucket: 'dated'
}

export interface CommissionSummary {
  scheduled_ytd_cents: number
  paid_ytd_cents: number
  next_payout: CommissionNextPayout | null
  upcoming_cents: number
  due_cents: number
  // Current user_commission_plans row for the requested rep. Null when the
  // rep has no assignment (legacy commission_rates still apply).
  plan_key: string | null
  plan_name: string | null
}

export interface CommissionRep {
  id: string
  name: string
  email: string
  commission_rate: number | null
  effective_date: string | null
  plan_key: string | null
  plan_name: string | null
}

export interface MarkPaidResponse {
  success: boolean
}

export interface CommissionPayoutRow {
  payout_period: string
  payout_period_label: string
  payout_date: string | null
  amount_cents: number | null
  amount_partial: boolean
  status: CommissionInstallmentStatus
  bucket: CommissionPayoutBucket
}

export interface CommissionQuarterInstallment extends CommissionPayoutRow {
  installment_number: number
}

export interface CommissionCloseQuarter {
  close_quarter: string
  sales_count: number
  commission_total_cents: number
  installments: CommissionQuarterInstallment[]
}

export type CommissionPayoutPeriod = CommissionPayoutRow

export interface CommissionPayoutSchedule {
  user_id: string
  year: number | null
  quarters: CommissionCloseQuarter[]
  by_payout_period: CommissionPayoutPeriod[]
}

export interface CommissionFilters {
  user_id?: string
  status?: CommissionStatus
  estimate_type?: CommissionEstimateType
  start_date?: string
  end_date?: string
}
