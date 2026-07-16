import { describe, it, expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { MeetingScheduler } from '@/views/inside-sales/components/MeetingScheduler'
import type { Lead } from '@/types'

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead1',
    property_name: 'Palm Grove HOA',
    address: '123 Palm St',
    city: 'Tampa',
    state: 'FL',
    zip: '33601',
    lat: 27.95,
    lng: -82.46,
    lead_type: 'HOA',
    score: 80,
    score_factors: [],
    estimated_acreage: 5,
    estimated_contract_value: 50000,
    contact_name: 'Jane Smith',
    contact_email: 'jane@palmgrove.com',
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
    distance_miles: 10,
    aspire_opportunity_id: null,
    division_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('MeetingScheduler — pre-chip behavior', () => {
  it('opens the EventFormDialog when Schedule meeting is clicked', async () => {
    const user = userEvent.setup()
    render(<MeetingScheduler lead={makeLead()} />)
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('pre-chips lead contact_email as a visible chip in the dialog', async () => {
    const user = userEvent.setup()
    render(<MeetingScheduler lead={makeLead()} />)
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }))
    expect(screen.getByText('jane@palmgrove.com')).toBeInTheDocument()
  })

  it('the pre-chipped email is removable', async () => {
    const user = userEvent.setup()
    render(<MeetingScheduler lead={makeLead()} />)
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }))
    const removeBtn = screen.getByRole('button', { name: /remove jane@palmgrove\.com/i })
    await user.click(removeBtn)
    expect(screen.queryByText('jane@palmgrove.com')).not.toBeInTheDocument()
  })

  it('does not pre-chip when lead has no contact_email', async () => {
    const user = userEvent.setup()
    render(<MeetingScheduler lead={makeLead({ contact_email: null })} />)
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }))
    const chips = document.querySelectorAll('[data-chip]')
    expect(chips).toHaveLength(0)
  })

  it('shows the timezone selector in the dialog', async () => {
    const user = userEvent.setup()
    render(<MeetingScheduler lead={makeLead()} />)
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }))
    expect(screen.getByRole('combobox', { name: /timezone/i })).toBeInTheDocument()
  })

  it('prefills subject with lead property name', async () => {
    const user = userEvent.setup()
    render(<MeetingScheduler lead={makeLead()} />)
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }))
    expect(screen.getByDisplayValue(/Palm Grove HOA/)).toBeInTheDocument()
  })
})
