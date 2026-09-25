import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createWrapper, render, makeUser } from '@/test/utils'
import { server } from '@/mocks/server'
import { useAuthStore } from '@/store/authStore'
import { ProposalBuilder } from '@/views/inside-sales/components/estimating/ProposalBuilder'
import { useProposalDocument } from '@/hooks/useProposalDocument'
import type { Lead } from '@/types'
import type { Estimate } from '@/types/estimating'
import { MOCK_CLIENT_REFERENCES, MOCK_TEAM_MEMBERS } from '@/mocks/proposalRoster'

const lead: Lead = {
  id: 'lead-001',
  property_name: 'Coral Bay HOA',
  address: '123 Coral Way',
  city: 'Fort Myers',
  state: 'FL',
  zip: '33901',
  lat: 26.65,
  lng: -81.77,
  lead_type: 'HOA',
  score: 80,
  score_factors: [],
  estimated_acreage: 10,
  estimated_contract_value: 1000,
  contact_name: 'Pat',
  contact_email: 'pat@example.com',
  contact_linkedin: null,
  current_provider: null,
  source: 'manual',
  source_url: null,
  bid_deadline: null,
  status: 'approved',
  assigned_to: null,
  notes: null,
  handoff_notes: null,
  ai_linkedin_draft: null,
  branch_id: 'b1',
  distance_miles: null,
  aspire_opportunity_id: null,
  division_id: null,
  property_id: 'prop-1',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
}

function quietNeighbors() {
  server.use(
    http.get('*/api/proposals/config/branches', () => HttpResponse.json([])),
    http.get('*/api/leads/:id/attachments', () => HttpResponse.json([])),
    http.get('*/api/estimating/estimates/:id/attachments', () => HttpResponse.json([])),
  )
}

function installRosters(regionHeader: string | null) {
  const teamUrls: URL[] = []
  const refUrls: URL[] = []
  const headers = regionHeader ? { 'X-Region-Filter': regionHeader } : undefined
  server.use(
    http.get('*/api/proposals/config/team-members', ({ request }) => {
      teamUrls.push(new URL(request.url))
      return HttpResponse.json(MOCK_TEAM_MEMBERS, { headers })
    }),
    http.get('*/api/proposals/config/client-references', ({ request }) => {
      refUrls.push(new URL(request.url))
      return HttpResponse.json(MOCK_CLIENT_REFERENCES, { headers })
    }),
  )
  return { teamUrls, refUrls }
}

function branchTeamUrls(urls: URL[]) {
  return urls.filter((url) => !url.searchParams.has('team_type'))
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ id: 'user-001', name: 'Test Rep' }) })
  quietNeighbors()
})

describe('proposal region switcher', () => {
  it('defaults to My region and sends no region_id when the header is not readable', async () => {
    const { teamUrls, refUrls } = installRosters(null)
    render(<ProposalBuilder lead={lead} />)

    expect(await screen.findByText(/West Coast AM/)).toBeInTheDocument()
    expect(screen.getByTestId('team-region-switcher')).toHaveValue('mine')
    expect(screen.getByTestId('client-reference-region-switcher')).toHaveValue('mine')
    expect(teamUrls.length).toBeGreaterThan(0)
    expect(refUrls.length).toBeGreaterThan(0)
    expect(teamUrls.every((url) => !url.searchParams.has('region_id'))).toBe(true)
    expect(refUrls.every((url) => !url.searchParams.has('region_id'))).toBe(true)
  })

  it('picking a region sends region_id for that roster only', async () => {
    const user = userEvent.setup()
    const { teamUrls, refUrls } = installRosters(null)
    render(<ProposalBuilder lead={lead} />)
    await screen.findAllByRole('option', { name: 'East Coast' })

    await user.selectOptions(screen.getByTestId('team-region-switcher'), 'east-coast')

    await waitFor(() => {
      expect(
        branchTeamUrls(teamUrls).some((url) => url.searchParams.get('region_id') === 'east-coast'),
      ).toBe(true)
    })
    expect(
      teamUrls
        .filter((url) => url.searchParams.get('team_type') === 'executive')
        .every((url) => !url.searchParams.has('region_id')),
    ).toBe(true)
    expect(refUrls.every((url) => !url.searchParams.has('region_id'))).toBe(true)
  })

  it('All regions sends region_id=all', async () => {
    const user = userEvent.setup()
    const { refUrls } = installRosters(null)
    render(<ProposalBuilder lead={lead} />)
    await screen.findAllByRole('option', { name: 'All regions' })

    await user.selectOptions(screen.getByTestId('client-reference-region-switcher'), 'all')

    await waitFor(() => {
      expect(refUrls.some((url) => url.searchParams.get('region_id') === 'all')).toBe(true)
    })
  })

  it('labels null-region rows All regions', async () => {
    installRosters(null)
    render(<ProposalBuilder lead={lead} />)

    expect(await screen.findByTestId('team-member-tm-all-all-regions')).toHaveTextContent('All regions')
    expect(screen.queryByTestId('team-member-tm-west-all-regions')).not.toBeInTheDocument()
    expect(screen.getByTestId('client-ref-cr-all-all-regions')).toHaveTextContent('All regions')
    expect(screen.queryByTestId('client-ref-cr-west-all-regions')).not.toBeInTheDocument()
  })

  it('preselects the single region named by a readable X-Region-Filter header', async () => {
    const { teamUrls } = installRosters('west-coast')
    render(<ProposalBuilder lead={lead} />)

    await waitFor(() => {
      expect(screen.getByTestId('team-region-switcher')).toHaveValue('west-coast')
    })
    const branchUrls = branchTeamUrls(teamUrls)
    expect(branchUrls[0].searchParams.has('region_id')).toBe(false)
    expect(branchUrls.some((url) => url.searchParams.get('region_id') === 'west-coast')).toBe(true)
  })

  it('keeps My region when the header is all or lists several regions', async () => {
    installRosters('central,west-coast')
    render(<ProposalBuilder lead={lead} />)
    expect(await screen.findByText(/West Coast AM/)).toBeInTheDocument()
    expect(screen.getByTestId('team-region-switcher')).toHaveValue('mine')
    expect(screen.getByTestId('client-reference-region-switcher')).toHaveValue('mine')
  })

  it('still sends aspire_branch_id together with the chosen region', async () => {
    const user = userEvent.setup()
    const { teamUrls } = installRosters(null)
    const estimate = {
      id: 'est-1',
      estimateType: 'maintenance',
      contractValueCents: 100,
      aspireBranchId: 1403,
    } as Estimate
    render(<ProposalBuilder lead={lead} estimate={estimate} />)
    await screen.findAllByRole('option', { name: 'Central' })

    expect(branchTeamUrls(teamUrls)[0].searchParams.get('aspire_branch_id')).toBe('1403')
    expect(branchTeamUrls(teamUrls)[0].searchParams.has('region_id')).toBe(false)

    await user.selectOptions(screen.getByTestId('team-region-switcher'), 'central')
    await waitFor(() => {
      expect(
        branchTeamUrls(teamUrls).some(
          (url) =>
            url.searchParams.get('region_id') === 'central' &&
            url.searchParams.get('aspire_branch_id') === '1403',
        ),
      ).toBe(true)
    })
  })
})

describe('useProposalDocument region scope', () => {
  it('loads team members and client references with region_id=all', async () => {
    const urls: string[] = []
    server.use(
      http.get('*/api/proposals/config/team-members', ({ request }) => {
        urls.push(request.url)
        return HttpResponse.json([])
      }),
      http.get('*/api/proposals/config/client-references', ({ request }) => {
        urls.push(request.url)
        return HttpResponse.json([])
      }),
      http.get('*/api/proposals/prop-doc', () =>
        HttpResponse.json({
          id: 'prop-doc',
          leadId: '',
          estimateId: null,
          sections: [],
          teamMemberIds: [],
          executiveTeamMemberIds: [],
          clientReferenceIds: [],
          portfolioPropertyIds: [],
        }),
      ),
      http.get('*/api/proposals/prop-doc/signer', () =>
        HttpResponse.json({
          name: null,
          title: null,
          phone: null,
          email: null,
          branchAddress: null,
        }),
      ),
    )
    const { wrapper } = createWrapper()
    renderHook(() => useProposalDocument('prop-doc'), { wrapper })

    await waitFor(() => expect(urls.length).toBeGreaterThanOrEqual(3))
    for (const url of urls) {
      expect(new URL(url).searchParams.get('region_id')).toBe('all')
    }
    expect(urls.some((url) => new URL(url).searchParams.get('team_type') === 'executive')).toBe(true)
  })
})
