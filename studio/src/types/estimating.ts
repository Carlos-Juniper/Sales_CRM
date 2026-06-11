export type EstimateStatus = 'queued' | 'in_progress' | 'review' | 'approved' | 'sent'
export type EstimatePriority = 'urgent' | 'high' | 'medium' | 'low'
export type LineItemCategory = 'labor' | 'materials' | 'equipment' | 'overhead' | 'subcontractor'
export type BidOutcomeType = 'won' | 'lost' | 'no_bid' | 'pending'
export type LossReason =
  | 'price_too_high'
  | 'competitor_relationship'
  | 'scope_mismatch'
  | 'timeline_mismatch'
  | 'incumbent_retained'
  | 'budget_cut'
  | 'other'

export interface EstimateQueueItem {
  id: string
  lead_id: string | null
  property_name: string
  lead_type: 'HOA' | 'commercial'
  assigned_to: string | null
  priority: EstimatePriority
  deadline: string
  status: EstimateStatus
  estimated_acreage: number
  estimated_contract_value: number
  site_walk_date: string | null
  site_walk_notes: string | null
  created_at: string
}

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

export interface Estimate {
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
  status: 'draft' | 'review' | 'approved' | 'sent'
  created_at: string
  updated_at: string
}

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

// Legacy stubs preserved for backward compat
export interface EstimateQueue {
  id: string
  lead_id: string
  property_name: string
  assigned_to: string | null
  priority: 'high' | 'medium' | 'low'
  due_date: string
  status: 'queued' | 'in_progress' | 'review' | 'approved'
  site_walk_id: string | null
  created_at: string
}

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

export interface MarginAnalysis {
  labor_pct: number
  materials_pct: number
  overhead_pct: number
  profit_pct: number
  total_margin_pct: number
}
