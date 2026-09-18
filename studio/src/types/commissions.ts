/**
 * Commissions feature types.
 * Formatting helpers live in lib/commissions.ts (not here) to match the
 * repo convention of types files containing only data shapes.
 */

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
}

export interface CommissionSummary {
  scheduled_ytd_cents: number
  paid_ytd_cents: number
}

export interface CommissionRep {
  id: string
  name: string
  email: string
  commission_rate?: number   // null/undefined = no active rate on file
  effective_date?: string
}

export interface CommissionFilters {
  user_id?: string
  status?: 'approved' | 'paid' | 'cancelled'
  estimate_type?: 'maintenance' | 'install'
  start_date?: string
  end_date?: string
}
