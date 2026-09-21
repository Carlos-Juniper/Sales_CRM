import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { EditLeadModal } from '@/views/inside-sales/components/EditLeadModal'
import type { Lead } from '@/types'

const mockUpdateLead = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useLeads', () => ({
  useUpdateLead: () => ({
    mutateAsync: mockUpdateLead,
    isPending: false,
  }),
}))

const baseLead: Lead = {
  id: 'lead-1',
  property_name: 'Coral Bay HOA',
  address: '123 Main St',
  city: 'Fort Myers',
  state: 'FL',
  zip: '33901',
  lat: 26.64,
  lng: -81.87,
  lead_type: 'HOA',
  score: 80,
  score_factors: null,
  estimated_acreage: 10,
  estimated_contract_value: 120000,
  units: null,
  contact_id: null,
  contact_name: null,
  contact_email: null,
  contact_linkedin: null,
  current_provider: null,
  source: 'manual',
  source_url: null,
  bid_deadline: null,
  status: 'new',
  assigned_to: null,
  created_by: null,
  notes: null,
  handoff_notes: null,
  ai_linkedin_draft: null,
  branch_id: null,
  distance_miles: null,
  aspire_opportunity_id: null,
  division_id: null,
  property_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => { mockUpdateLead.mockClear() })

function renderModal(lead = baseLead, onClose = vi.fn()) {
  render(<EditLeadModal lead={lead} open={true} onClose={onClose} />)
  return { onClose }
}

describe('EditLeadModal — lead type buttons', () => {
  it('renders all five lead type buttons with display labels', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'HOA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commercial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deathcare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resort' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Healthcare' })).toBeInTheDocument()
  })

  it('selecting Healthcare stores the raw "healthcare" value in the patch payload', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Healthcare' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockUpdateLead).toHaveBeenCalledTimes(1))
    const { body } = mockUpdateLead.mock.calls[0][0] as { id: string; body: Record<string, unknown> }
    expect(body.lead_type).toBe('healthcare')
  })

  it('selecting Resort stores the raw "resort" value in the patch payload', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Resort' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockUpdateLead).toHaveBeenCalledTimes(1))
    const { body } = mockUpdateLead.mock.calls[0][0] as { id: string; body: Record<string, unknown> }
    expect(body.lead_type).toBe('resort')
  })
})

describe('EditLeadModal — cancel', () => {
  it('"Cancel" button calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(baseLead, onClose)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
