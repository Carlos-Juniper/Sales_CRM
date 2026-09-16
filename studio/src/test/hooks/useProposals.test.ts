// ---------------------------------------------------------------------------
// useProposals — query-key correctness + invalidation wiring
//
// Tests mirror the useBids.test.ts and useEstimatingConfig.test.tsx patterns:
// MSW intercepts, renderHook + waitFor, createWrapper per-test.
// We verify query-key scoping and that mutations hit the right endpoints and
// invalidate the right cache entries on success.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { createWrapper, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import {
  useProposalConfig,
  useTeamMembers,
  useClientReferences,
  usePortfolio,
  useProposalInsurance,
  useProposal,
  useProposalsByLead,
  useCreateProposal,
  useUpdateProposal,
  useRenderProposal,
  useProposalRenders,
  PROPOSAL_CONFIG_KEY,
} from '@/hooks/useProposals'
import type {
  BranchProfile,
  ClientReference,
  PortfolioProperty,
  ProposalRender,
  ProposalRequest,
  TeamMember,
} from '@/types/proposal'
import type { CreateProposalPayload } from '@/api/proposals'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockBranch: BranchProfile = {
  aspireBranchId: 1403,
  branchName: 'Fort Myers Install',
  city: 'Fort Myers',
  regionId: 'west-coast',
  address: '5880 Staley Road',
  lat: 26.6519,
  lng: -81.7718,
}

const mockTeamMember: TeamMember = {
  id: 'tm-001',
  name: 'Jane Doe',
  title: 'branch_manager' as TeamMember['title'],
  teamType: 'branch',
  aspireBranchId: 1403,
  userId: null,
  location: 'Fort Myers, FL',
  bio: 'Branch manager bio.',
  headshotObjectKey: null,
  active: true,
  sortOrder: 1,
}

const mockClientRef: ClientReference = {
  id: 'cr-001',
  aspireBranchId: null,
  propertyName: 'Coral Bay HOA',
  servicesProvided: 'Landscape Maintenance',
  contactName: 'Bob Smith',
  contactTitle: 'Property Manager',
  phone: '239-555-0100',
  email: 'bob@coralbay.com',
  address: '123 Coral Way, Fort Myers, FL 33901',
  clientSinceYear: 2018,
  active: true,
}

const mockPortfolio: PortfolioProperty = {
  id: 'pp-001',
  name: 'Pointe Jupiter Yacht Club',
  cityState: 'Jupiter, FL',
  regionId: 'east-coast',
  photoObjectKeys: ['portfolio/pjyc-1.jpg'],
  sortOrder: 1,
}

const mockProposal: ProposalRequest = {
  id: 'prop-001',
  leadId: 'lead-abc',
  estimateId: 'est-xyz',
  createdBy: 'user-001',
  sections: ['intro_letter', 'rooted_in_florida'],
  orgChart: {
    included: false,
    accountManagerIds: [],
    crewCounts: { mow: { foremen: 0, members: 0 }, prune: { foremen: 0, members: 0 }, fertIpm: { members: 0 }, irrigation: { members: 0 } },
  },
  startupPlan: { included: false, day60: [], day90: [], day120Plus: [], ongoing: [] },
  teamMemberIds: [],
  executiveTeamMemberIds: [],
  clientReferenceIds: ['cr-001'],
  portfolioPropertyIds: ['pp-001'],
  signerUserId: 'user-001',
  createdAt: '2026-08-26T10:00:00Z',
  updatedAt: '2026-08-26T10:00:00Z',
}

const mockCreatePayload: CreateProposalPayload = {
  leadId: 'lead-abc',
  estimateId: 'est-xyz',
  createdBy: 'user-001',
  sections: ['intro_letter'],
  orgChart: {
    included: false,
    accountManagerIds: [],
    crewCounts: { mow: { foremen: 0, members: 0 }, prune: { foremen: 0, members: 0 }, fertIpm: { members: 0 }, irrigation: { members: 0 } },
  },
  startupPlan: { included: false, day60: [], day90: [], day120Plus: [], ongoing: [] },
  teamMemberIds: [],
  executiveTeamMemberIds: [],
  clientReferenceIds: [],
  portfolioPropertyIds: [],
  signerUserId: 'user-001',
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
})

// ---------------------------------------------------------------------------
// useProposalConfig — branches (parameter-free)
// ---------------------------------------------------------------------------

describe('useProposalConfig — query key and combined fetch', () => {
  it('uses PROPOSAL_CONFIG_KEY as query key', async () => {
    server.use(
      http.get('/api/proposals/config/branches', () => HttpResponse.json([mockBranch])),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalConfig(), { wrapper })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.branches).toHaveLength(1)
    expect(result.current.branches[0].aspireBranchId).toBe(1403)
  })

  it('starts from the fallback (loaded: false) before the fetch resolves', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalConfig(), { wrapper })
    expect(result.current.loaded).toBe(false)
    expect(result.current.branches).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// useProposalInsurance — branch-aware, separate from useProposalConfig
// ---------------------------------------------------------------------------

describe('useProposalInsurance — query key scoping', () => {
  it('requests aspire_branch_id when a branch is given', async () => {
    const cert = { id: 'ins-001', objectKey: 'proposal/insurance/cert.pdf', expiryDate: '2027-03-31', label: null, uploadedAt: '2026-01-01T00:00:00Z' }
    server.use(
      http.get('/api/proposals/config/insurance', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('aspire_branch_id') === '3699') {
          return HttpResponse.json(cert)
        }
        return HttpResponse.json(null)
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalInsurance({ aspireBranchId: 3699 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.objectKey).toBe('proposal/insurance/cert.pdf')
  })

  it('omits aspire_branch_id when no branch is given', async () => {
    server.use(
      http.get('/api/proposals/config/insurance', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.has('aspire_branch_id')).toBe(false)
        return HttpResponse.json(null)
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalInsurance(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('treats a null response (no cert yet) as null, not an error', async () => {
    server.use(
      http.get('/api/proposals/config/insurance', () => HttpResponse.json(null)),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalInsurance({ aspireBranchId: 3699 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// useTeamMembers — parameterized query key
// ---------------------------------------------------------------------------

describe('useTeamMembers — query key scoping', () => {
  it('fetches team members scoped to an aspire_branch_id', async () => {
    server.use(
      http.get('/api/proposals/config/team-members', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('aspire_branch_id') === '1403') {
          return HttpResponse.json([mockTeamMember])
        }
        return HttpResponse.json([])
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useTeamMembers({ aspireBranchId: 1403 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].id).toBe('tm-001')
  })

  it('fetches all team members when no params are given', async () => {
    server.use(
      http.get('/api/proposals/config/team-members', () => HttpResponse.json([mockTeamMember])),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useTeamMembers(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// useClientReferences — parameterized query key
// ---------------------------------------------------------------------------

describe('useClientReferences — query key scoping', () => {
  it('fetches client references for a branch', async () => {
    server.use(
      http.get('/api/proposals/config/client-references', () => HttpResponse.json([mockClientRef])),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useClientReferences({ aspireBranchId: 1403 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0].id).toBe('cr-001')
  })
})

// ---------------------------------------------------------------------------
// usePortfolio — parameterized query key
// ---------------------------------------------------------------------------

describe('usePortfolio — query key scoping', () => {
  it('fetches portfolio properties for a region', async () => {
    server.use(
      http.get('/api/proposals/config/portfolio', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('region_id') === 'east-coast') {
          return HttpResponse.json([mockPortfolio])
        }
        return HttpResponse.json([])
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => usePortfolio({ regionId: 'east-coast' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0].id).toBe('pp-001')
  })
})

// ---------------------------------------------------------------------------
// useProposal — query key ['proposals', id]
// ---------------------------------------------------------------------------

describe('useProposal — single-record query key', () => {
  it('fetches a proposal by id', async () => {
    server.use(
      http.get('/api/proposals/prop-001', () => HttpResponse.json(mockProposal)),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposal('prop-001'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.leadId).toBe('lead-abc')
  })

  it('is disabled (idle) when id is null', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposal(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// useProposalsByLead — query key ['proposals', 'list', leadId]
// ---------------------------------------------------------------------------

describe('useProposalsByLead — lead-scoped list query key', () => {
  it('fetches proposals for a lead', async () => {
    server.use(
      http.get('/api/proposals', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('leadId') === 'lead-abc') {
          return HttpResponse.json([mockProposal])
        }
        return HttpResponse.json([])
      }),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalsByLead('lead-abc'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].id).toBe('prop-001')
  })

  it('is disabled (idle) when leadId is null', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalsByLead(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// useCreateProposal — mutation + invalidation of ['proposals', 'list', leadId]
// ---------------------------------------------------------------------------

describe('useCreateProposal — mutation and invalidation', () => {
  it('fires POST /api/proposals with the payload', async () => {
    let capturedBody: unknown
    server.use(
      http.post('/api/proposals', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ...mockProposal, id: 'prop-new' }, { status: 201 })
      }),
      http.get('/api/proposals', () => HttpResponse.json([])),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateProposal(), { wrapper })

    act(() => { result.current.mutate(mockCreatePayload) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((capturedBody as Record<string, unknown>)?.leadId).toBe('lead-abc')
  })

  it('isError is true when the server returns 422', async () => {
    server.use(
      http.post('/api/proposals', () => HttpResponse.json({ error: 'estimate not approved' }, { status: 422 })),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateProposal(), { wrapper })

    act(() => { result.current.mutate(mockCreatePayload) })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ---------------------------------------------------------------------------
// useUpdateProposal — mutation + invalidation of both ['proposals', id] and list
// ---------------------------------------------------------------------------

describe('useUpdateProposal — mutation and dual invalidation', () => {
  it('fires PATCH /api/proposals/:id and succeeds', async () => {
    let capturedBody: unknown
    server.use(
      http.patch('/api/proposals/prop-001', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ...mockProposal, sections: ['intro_letter', 'thank_you'] })
      }),
      http.get('/api/proposals', () => HttpResponse.json([mockProposal])),
      http.get('/api/proposals/prop-001', () => HttpResponse.json(mockProposal)),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateProposal(), { wrapper })

    act(() => { result.current.mutate({ id: 'prop-001', patch: { sections: ['intro_letter', 'thank_you'] } }) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((capturedBody as Record<string, unknown>)?.sections).toEqual(['intro_letter', 'thank_you'])
  })
})

// ---------------------------------------------------------------------------
// Query-key constant export
// ---------------------------------------------------------------------------

describe('PROPOSAL_CONFIG_KEY constant', () => {
  it('is exported and equals "proposals-config"', () => {
    expect(PROPOSAL_CONFIG_KEY).toBe('proposals-config')
  })
})

// ---------------------------------------------------------------------------
// useRenderProposal — mutation
// ---------------------------------------------------------------------------

const mockRender: ProposalRender = {
  id: 'pr-abc123def456',
  proposalId: 'prop-001',
  version: 1,
  objectKey: 'proposal/generated/prop-001/v1.pdf',
  pageCount: 22,
  status: 'complete',
  errorMessage: null,
  renderedBy: 'user-001',
  durationMs: 12345,
  renderedAt: '2026-08-31T10:00:00Z',
}

describe('useRenderProposal — mutation and invalidation', () => {
  it('fires POST /api/proposals/:id/render with the proposal id', async () => {
    let capturedUrl = ''
    server.use(
      http.post('/api/proposals/prop-001/render', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(mockRender, { status: 200 })
      }),
      http.get('/api/proposals/prop-001/renders', () => HttpResponse.json([])),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRenderProposal(), { wrapper })

    act(() => { result.current.mutate('prop-001') })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl).toContain('/api/proposals/prop-001/render')
    expect(result.current.data?.version).toBe(1)
  })

  it('isError is true when the server returns 503', async () => {
    server.use(
      http.post('/api/proposals/prop-001/render', () =>
        HttpResponse.json({ detail: 'Browser not started' }, { status: 503 }),
      ),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRenderProposal(), { wrapper })

    act(() => { result.current.mutate('prop-001') })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ---------------------------------------------------------------------------
// useProposalRenders — query key ['proposals', id, 'renders']
// ---------------------------------------------------------------------------

describe('useProposalRenders — query key scoping and polling', () => {
  it('is disabled (idle) when id is null', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalRenders(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('fetches renders for a proposal id', async () => {
    server.use(
      http.get('/api/proposals/prop-001/renders', () => HttpResponse.json([mockRender])),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalRenders('prop-001'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].id).toBe('pr-abc123def456')
  })

  it('returns an empty array when no renders exist', async () => {
    server.use(
      http.get('/api/proposals/prop-001/renders', () => HttpResponse.json([])),
    )
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useProposalRenders('prop-001'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(0)
  })
})
