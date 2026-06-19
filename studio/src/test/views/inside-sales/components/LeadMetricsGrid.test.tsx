import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { LeadMetricsGrid } from '@/views/inside-sales/components/LeadMetricsGrid'
import type { Lead } from '@/types'

// ── Fixture ───────────────────────────────────────────────────────

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'l1',
    property_name: 'Silverleaf HOA',
    address: '1234 Desert Ridge Blvd',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85050',
    lat: 33.69,
    lng: -111.97,
    lead_type: 'HOA',
    score: 88,
    score_factors: [],
    estimated_acreage: 45,
    estimated_contract_value: 185000,
    contact_name: 'Jennifer Walsh',
    contact_email: 'jwalsh@silverleafhoa.org',
    contact_linkedin: null,
    current_provider: null,
    source: 'hoa_usa',
    source_url: null,
    bid_deadline: null,
    status: 'new',
    assigned_to: null,
    notes: null,
    handoff_notes: null,
    ai_email_draft: null,
    ai_linkedin_draft: null,
    branch_id: 'b1',
    distance_miles: 8.4,
    aspire_opportunity_id: null,
    division_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('LeadMetricsGrid — tile labels have no emojis', () => {
  it('renders "Score" label without ⚡ emoji', () => {
    render(<LeadMetricsGrid lead={makeLead()} />)
    expect(screen.queryByText(/⚡/)).not.toBeInTheDocument()
    expect(screen.getByText('Score')).toBeInTheDocument()
  })

  it('renders "Bid Due" label without 🔥 emoji', () => {
    render(<LeadMetricsGrid lead={makeLead({ bid_deadline: '2099-12-31' })} />)
    expect(screen.queryByText(/🔥/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Bid Due').length).toBeGreaterThan(0)
  })

  it('renders "Distance" label without ◎ emoji', () => {
    render(<LeadMetricsGrid lead={makeLead()} />)
    expect(screen.queryByText(/◎/)).not.toBeInTheDocument()
    expect(screen.getByText('Distance')).toBeInTheDocument()
  })
})

describe('LeadMetricsGrid — no AI hook callout', () => {
  it('does not render any AI hook or score_factors callout section', () => {
    const leadWithFactors = makeLead({
      score_factors: [{ label: 'Large lot', impact: 'high' }] as unknown as never[],
    })
    render(<LeadMetricsGrid lead={leadWithFactors} />)
    expect(screen.queryByText(/hook/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ai/i)).not.toBeInTheDocument()
  })
})

describe('LeadMetricsGrid — tile content', () => {
  it('renders the estimated contract value', () => {
    render(<LeadMetricsGrid lead={makeLead({ estimated_contract_value: 185000 })} />)
    expect(screen.getByText('$185K')).toBeInTheDocument()
  })

  it('renders the lead score', () => {
    render(<LeadMetricsGrid lead={makeLead({ score: 88 })} />)
    expect(screen.getByText('88')).toBeInTheDocument()
  })

  it('renders distance in miles', () => {
    render(<LeadMetricsGrid lead={makeLead({ distance_miles: 8.4 })} />)
    expect(screen.getByText('8.4 mi')).toBeInTheDocument()
  })

  it('renders "—" for Bid Due when no bid_deadline is set', () => {
    render(<LeadMetricsGrid lead={makeLead({ bid_deadline: null })} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
