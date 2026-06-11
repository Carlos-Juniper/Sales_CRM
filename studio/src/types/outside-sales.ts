// Phase 2 — Outside Sales types (stubbed)

export interface SiteWalkCapture {
  id: string
  lead_id: string
  rep_id: string
  photos: SitePhoto[]
  voice_note_url: string | null
  notes: string
  captured_at: string
}

export interface SitePhoto {
  id: string
  url: string
  caption: string
  taken_at: string
}

export interface ProposalDraft {
  id: string
  lead_id: string
  estimator_id: string
  line_items: ProposalLineItem[]
  total_value: number
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  created_at: string
}

export interface ProposalLineItem {
  id: string
  service: string
  quantity: number
  unit_price: number
  total: number
  notes: string
}
