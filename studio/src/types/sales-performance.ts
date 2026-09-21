/**
 * Sales Performance feature types.
 * Formatting helpers live in lib/ (not here) to match the repo convention of
 * types files containing only data shapes.
 */

export interface WonDeal {
  id: string
  estimate_id: string
  property_name?: string
  estimate_type?: 'maintenance' | 'install'
  contract_value_cents: number
  notes?: string | null
  aspire_number?: string | null
  rep_name?: string
  rep_email?: string
  won_at: string
}

export interface LostDeal {
  id: string
  property_name?: string
  estimate_type?: 'maintenance' | 'install'
  contract_value_cents: number
  notes?: string | null
  aspire_number?: string | null
  aspire_lost_reason_id?: number | null
  rep_name?: string
  rep_email?: string
  lost_at: string
}

export interface LossCategory {
  aspire_lost_reason_id: number | null
  count: number
  total_cents: number
}

export interface SalesPerformanceSummary {
  won_count: number
  won_total_cents: number
  won_avg_cents: number
  lost_count: number
  lost_total_cents: number
  lost_avg_cents: number
  win_rate: number
  loss_categories: LossCategory[]
}

export interface SalesPerformanceFilters {
  user_id?: string
  start_date?: string
  end_date?: string
}
