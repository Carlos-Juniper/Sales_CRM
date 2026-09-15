// ---------------------------------------------------------------------------
// BidTab — Proposal section tests (updated for WS2)
//
// WS2: Generate Proposal is always rendered when a lead exists — no estimate
// required, no lead status gate. Groups 1 and 2 (button absent) are retired;
// the approved-estimate query always fires (query is now unconditional).
//
// Test groups (WS2):
//  1. Proposal section renders for any lead (no gate on status or estimate)
//  2. Clicking Generate Proposal opens ProposalBuilder
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { estimatingApi } from '@/api/estimating'
import type { Lead, LeadStatus } from '@/types'
import type { Estimate } from '@/types/estimating'
import { BidTab } from '@/views/inside-sales/components/BidTab'

// ---------------------------------------------------------------------------
// Mock proposal hooks — ProposalBuilder is rendered inside BidTab when the
// button is clicked; mock hooks so it renders without needing MSW proposal
// endpoints. Mirrors the convention in ProposalBuilder.test.tsx.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useProposals', () => ({
  useTeamMembers: vi.fn(() => ({ data: [], isLoading: false })),
  useClientReferences: vi.fn(() => ({ data: [], isLoading: false })),
  usePortfolio: vi.fn(() => ({ data: [], isLoading: false })),
  useProposal: vi.fn(() => ({ data: undefined, isLoading: false })),
  useCreateProposal: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false, error: null })),
  useUpdateProposal: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false, error: null })),
  useProposalConfig: vi.fn(() => ({
    branches: [],
    insurance: null,
    loaded: true,
  })),
  useProposalMediaUrl: vi.fn(() => ({ data: undefined, isLoading: false })),
}))

// Mock bids hooks so BidTab's Bid section doesn't require bid MSW endpoints.
vi.mock('@/hooks/useBids', () => ({
  useBidByLeadId: vi.fn(() => ({ data: null })),
  useCreateBid: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateBid: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}))

vi.mock('@/hooks/useLeads', () => ({
  useUpdateLead: vi.fn(() => ({ mutateAsync: vi.fn() })),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-test',
    property_name: 'Coral Bay HOA',
    address: '123 Coral Way',
    city: 'Fort Myers',
    state: 'FL',
    zip: '33901',
    lat: 26.6519,
    lng: -81.7718,
    lead_type: 'HOA',
    score: 88,
    score_factors: [],
    estimated_acreage: 45,
    estimated_contract_value: 185000,
    contact_name: 'Jennifer Walsh',
    contact_email: 'jwalsh@coralbay.org',
    contact_linkedin: null,
    current_provider: 'TruGreen',
    source: 'manual',
    source_url: null,
    bid_deadline: null,
    status: 'approved',
    assigned_to: null,
    notes: null,
    handoff_notes: null,
    ai_linkedin_draft: null,
    branch_id: 'b1',
    distance_miles: 5.2,
    aspire_opportunity_id: null,
    division_id: null,
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
    ...overrides,
  }
}

const approvedEstimate = {
  id: 'est-approved',
  name: 'Coral Bay HOA',
  estimateType: 'maintenance' as const,
  status: 'approved' as const,
  leadId: 'lead-test',
  aspireBranchId: 3696,
  branchCity: 'Fort Myers, FL',
  contractValueCents: 18500000,
  acreage: 45,
  sections: [],
  notes: null,
  crmRep: null,
  assignedLsEstimator: null,
  assignedIrrEstimator: null,
  aspireNumber: null,
  aspireOpportunityId: null,
  aspireSyncStatus: 'synced' as const,
  aspireOwner: 'crm' as const,
  lifecycle: 'won' as const,
  siteWalkDate: null,
  dueBackDate: '2026-09-01T00:00:00Z',
  clientName: 'Coral Bay HOA',
  customerType: 'hoa' as const,
  targetMargin: 0.2,
  winProbability: 0.8,
  priority: 'high' as const,
  propertyId: null,
  anticipatedCloseDate: null,
  serviceStartDate: null,
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-26T10:00:00Z',
} as Estimate

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ name: 'Test Rep', role: 'inside_sales' }) })
})

// ---------------------------------------------------------------------------
// Group 1 (WS2): Proposal section always renders when lead exists
// ---------------------------------------------------------------------------

describe('BidTab — WS2: Proposal section always renders for any lead', () => {
  const allStatuses: LeadStatus[] = [
    'new', 'reviewed', 'contacted', 'qualified', 'estimating', 'op_review', 'proposal_sent', 'approved',
  ]

  it.each(allStatuses)(
    'renders Generate Proposal button when lead.status = %s (no estimate required)',
    async (status) => {
      vi.spyOn(estimatingApi, 'list').mockResolvedValue([])
      render(<BidTab lead={makeLead({ status })} />)

      // WS2: button always renders once the loading state resolves
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /generate proposal/i })).toBeInTheDocument()
      })
    },
  )

  it('always calls the estimating list API regardless of lead status', async () => {
    const listSpy = vi.spyOn(estimatingApi, 'list').mockResolvedValue([])
    render(<BidTab lead={makeLead({ status: 'estimating' })} />)

    await waitFor(() => {
      // The query is now unconditional (WS2 removed the `enabled: lead.status === 'approved'` gate)
      expect(listSpy).toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// Group 3: button present when both conditions met; clicking opens ProposalBuilder
// ---------------------------------------------------------------------------

describe('BidTab — Proposal section present when lead approved + approved estimate exists', () => {
  it('renders the Proposal section label and Generate Proposal button', async () => {
    vi.spyOn(estimatingApi, 'list').mockResolvedValue([approvedEstimate])
    render(<BidTab lead={makeLead({ status: 'approved' })} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate proposal/i })).toBeInTheDocument()
    })
    // Section heading
    expect(screen.getByText(/^Proposal$/i)).toBeInTheDocument()
  })

  it('clicking Generate Proposal renders ProposalBuilder (empty-state prompt disappears)', async () => {
    vi.spyOn(estimatingApi, 'list').mockResolvedValue([approvedEstimate])
    const user = userEvent.setup()
    render(<BidTab lead={makeLead({ status: 'approved' })} />)

    const btn = await screen.findByRole('button', { name: /^Generate Proposal$/ })
    await user.click(btn)

    // Empty-state prompt is gone once ProposalBuilder is mounted
    expect(screen.queryByText(/no proposal generated yet/i)).not.toBeInTheDocument()
    // ProposalBuilder's submit button is now present
    expect(screen.getByTestId('submit-proposal')).toBeInTheDocument()
  })

  it('passes the approved estimate to ProposalBuilder (verified via API call params)', async () => {
    const listSpy = vi.spyOn(estimatingApi, 'list').mockResolvedValue([approvedEstimate])
    render(<BidTab lead={makeLead({ status: 'approved' })} />)

    await screen.findByRole('button', { name: /generate proposal/i })

    // Confirm the query was issued with the correct leadId + status params
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-test', status: 'approved' }),
    )
  })
})
