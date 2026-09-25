/**
 * Commissions feature types.
 * Formatting helpers live in lib/commissions.ts (not here) to match the
 * repo convention of types files containing only data shapes.
 */

export interface CommissionInstallment {
  id: string
  installment_number: number
  payout_period: string | null
  payout_date: string | null
  amount_cents: number | null
  status: 'paid' | 'cancelled' | 'due' | 'upcoming' | 'pending_billing_data'
  billing_installment_number: number | null
  collected_amount_cents: number | null
}

export interface Commission {
  id: string
  estimate_id: string
  lead_id: string
  user_id: string
  contract_value_cents: number
  commission_rate: number  // Decimal (0.05 = 5%)
  commission_amount_cents: number
  status: 'approved' | 'paid' | 'cancelled'
  approved_at: string | null
  paid_at: string | null
  payment_period: string | null
  notes: string | null
  created_at: string
  updated_at: string

  // Joined fields from API
  rep_name?: string
  rep_email?: string
  property_name?: string
  estimate_number?: number
  aspire_number?: string
  estimate_type?: 'maintenance' | 'install'

  // Cadence + plan snapshot (added; existing fields above are unchanged)
  close_quarter: string | null
  plan_key: string | null
  client_type: string | null
  contract_start_date: string | null
  installments: CommissionInstallment[]
}

export interface CommissionNextPayout {
  payout_period: string
  payout_date: string
  amount_cents: number
}

export interface CommissionSummary {
  scheduled_ytd_cents: number
  paid_ytd_cents: number
  next_payout: CommissionNextPayout | null
  upcoming_cents: number
  due_cents: number
}

export interface CommissionRep {
  id: string
  name: string
  email: string
  commission_rate?: number   // null/undefined = no active rate on file
  effective_date?: string
  plan_key: string
  plan_name: string
}

export interface CommissionQuarterInstallment {
  installment_number: number
  payout_period: string | null
  payout_date: string | null
  amount_cents: number | null
  status: 'paid' | 'cancelled' | 'due' | 'upcoming' | 'pending_billing_data'
}

export interface CommissionCloseQuarter {
  close_quarter: string
  sales_count: number
  commission_total_cents: number
  installments: CommissionQuarterInstallment[]
}

export interface CommissionPayoutPeriod {
  payout_period: string | null
  payout_date: string | null
  amount_cents: number | null
  status: 'paid' | 'cancelled' | 'due' | 'upcoming' | 'pending_billing_data'
}

export interface CommissionPayoutSchedule {
  user_id: string
  year: number
  quarters: CommissionCloseQuarter[]
  by_payout_period: CommissionPayoutPeriod[]
}

export interface CommissionFilters {
  user_id?: string
  status?: 'approved' | 'paid' | 'cancelled'
  estimate_type?: 'maintenance' | 'install'
  start_date?: string
  end_date?: string
}
