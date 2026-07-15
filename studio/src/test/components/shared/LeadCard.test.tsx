import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { LeadCard } from '@/components/shared/LeadCard'
import type { Lead } from '@/types'

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'l1',
    property_name: 'Test Property HOA',
    address: '123 Main St',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85001',
    lat: 33.44,
    lng: -112.07,
    lead_type: 'HOA',
    score: 75,
    score_factors: [],
    estimated_acreage: 10,
    estimated_contract_value: 50000,
    contact_name: 'John Doe',
    contact_email: 'john@example.com',
    contact_linkedin: null,
    current_provider: null,
    source: 'manual',
    source_url: null,
    bid_deadline: null,
    status: 'new',
    assigned_to: null,
    notes: null,
    handoff_notes: null,
    ai_linkedin_draft: null,
    branch_id: 'b1',
    distance_miles: 5.0,
    aspire_opportunity_id: null,
    division_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('LeadCard', () => {
  it('renders property name, city/state, type badge, score, and contract value', () => {
    render(<LeadCard lead={makeLead()} />)
    expect(screen.getByText('Test Property HOA')).toBeInTheDocument()
    expect(screen.getByText('Phoenix, AZ')).toBeInTheDocument()
    expect(screen.getByText('HOA')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('$50K')).toBeInTheDocument()
  })

  it('score 95 has green/high meter color', () => {
    const { container } = render(<LeadCard lead={makeLead({ score: 95 })} />)
    const fill = container.querySelector('.score-meter-fill') as HTMLElement
    expect(fill.style.getPropertyValue('--meter-color')).toBe('#2E7D52')
  })

  it('score 35 has orange/low meter color', () => {
    const { container } = render(<LeadCard lead={makeLead({ score: 35 })} />)
    const fill = container.querySelector('.score-meter-fill') as HTMLElement
    expect(fill.style.getPropertyValue('--meter-color')).toBe('#EA580C')
  })

  it('renders HOA type badge', () => {
    render(<LeadCard lead={makeLead({ lead_type: 'HOA' })} />)
    expect(screen.getByText('HOA')).toBeInTheDocument()
  })

  it('renders deathcare type badge', () => {
    render(<LeadCard lead={makeLead({ lead_type: 'deathcare' })} />)
    expect(screen.getByText('Deathcare')).toBeInTheDocument()
  })

  it('renders commercial type badge', () => {
    render(<LeadCard lead={makeLead({ lead_type: 'commercial' })} />)
    expect(screen.getByText('Commercial')).toBeInTheDocument()
  })

  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<LeadCard lead={makeLead()} onClick={onClick} />)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies selection ring class when isSelected=true', () => {
    const { container } = render(<LeadCard lead={makeLead()} isSelected />)
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('ring-1')
  })

  it('does not apply selection ring when isSelected=false', () => {
    const { container } = render(<LeadCard lead={makeLead()} isSelected={false} />)
    const card = container.firstChild as HTMLElement
    expect(card.className).not.toContain('ring-1')
  })

  it('renders gracefully when contact_name is null', () => {
    expect(() => render(<LeadCard lead={makeLead({ contact_name: null })} />)).not.toThrow()
    expect(screen.getByText('Test Property HOA')).toBeInTheDocument()
  })

  it('renders $0 when contract_value is 0', () => {
    render(<LeadCard lead={makeLead({ estimated_contract_value: 0 })} />)
    expect(screen.getByText('$0')).toBeInTheDocument()
  })

  it('renders bid deadline chip with urgent styling when deadline is past', () => {
    const pastDeadline = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    const { container } = render(<LeadCard lead={makeLead({ bid_deadline: pastDeadline })} />)
    const deadlineEl = container.querySelector('.text-orange-500')
    expect(deadlineEl).toBeInTheDocument()
  })

  it('renders no deadline row when bid_deadline is null', () => {
    render(<LeadCard lead={makeLead({ bid_deadline: null })} />)
    expect(screen.queryByText(/bid due/i)).not.toBeInTheDocument()
  })
})
