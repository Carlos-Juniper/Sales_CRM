// ---------------------------------------------------------------------------
// Slice 13b — H37 config sections: team roster, client references, portfolio.
//
// team-roster:        renders branch members; create fires POST with aspireBranchId;
//                     deactivate fires DELETE; company-wide row is read-only to a manager.
// client-references:  same shape (create/deactivate for the branch; read-only for company-wide).
// portfolio:          admin sees the section; create/edit fire the right calls.
//                     (Portfolio lives only under Sales now — the Company admin
//                     gate that used to guard it was removed with that slug.)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import {
  render as rtlRender,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import { makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import type { TeamMember, ClientReference } from '@/types/proposal'
import { TeamRosterSection } from '@/views/settings/branch/TeamRosterSection'
import { ClientReferencesSection } from '@/views/settings/branch/ClientReferencesSection'
import { PortfolioSection } from '@/views/settings/company/PortfolioSection'

const BRANCH_ID = 42

// ── Shared fixtures ──────────────────────────────────────────────────────────

const BRANCH_MEMBER: TeamMember = {
  id: 'tm-1',
  name: 'Alice Appleseed',
  title: 'manager',
  teamType: 'branch',
  aspireBranchId: BRANCH_ID,
  userId: null,
  location: 'Naples, FL',
  bio: 'Branch manager at Naples.',
  headshotObjectKey: null,
  active: true,
  sortOrder: 0,
}

const COMPANY_WIDE_MEMBER: TeamMember = {
  id: 'tm-2',
  name: 'Bob CEO',
  title: 'executive',
  teamType: 'executive',
  aspireBranchId: null,
  userId: null,
  location: 'HQ',
  bio: 'Company executive.',
  headshotObjectKey: null,
  active: true,
  sortOrder: 0,
}

const BRANCH_REF: ClientReference = {
  id: 'cr-1',
  aspireBranchId: BRANCH_ID,
  propertyName: 'Lakewood HOA',
  servicesProvided: 'Full maintenance',
  contactName: 'Carol Contact',
  contactTitle: 'Property Manager',
  phone: '555-1234',
  email: 'carol@lakewood.com',
  address: '100 Lake Dr, Naples FL 34102',
  clientSinceYear: 2020,
  active: true,
}

const COMPANY_WIDE_REF: ClientReference = {
  id: 'cr-2',
  aspireBranchId: null,
  propertyName: 'Global Corp',
  servicesProvided: 'Landscaping',
  contactName: 'Dan Director',
  contactTitle: null,
  phone: '555-5678',
  email: 'dan@globalcorp.com',
  address: '200 Corp Ave, Miami FL 33101',
  clientSinceYear: 2018,
  active: true,
}

const PORTFOLIO_PROPERTY = {
  id: 'pp-1',
  name: 'Oceanfront Villa',
  cityState: 'Naples, FL',
  regionId: 'southeast',
  photoObjectKeys: [],
  sortOrder: 0,
}

// ── Render helpers ───────────────────────────────────────────────────────────

function renderComp(ui: React.ReactElement, role = 'manager') {
  useAuthStore.setState({ user: makeUser({ role: role as never }) })
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
  return rtlRender(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── MSW helpers ──────────────────────────────────────────────────────────────

function mockTeamMembers(rows = [BRANCH_MEMBER]) {
  server.use(
    http.get('*/api/proposals/config/team-members', () =>
      HttpResponse.json(rows),
    ),
  )
}

function mockClientReferences(rows = [BRANCH_REF]) {
  server.use(
    http.get('*/api/proposals/config/client-references', () =>
      HttpResponse.json(rows),
    ),
  )
}

function mockPortfolio(rows = [PORTFOLIO_PROPERTY]) {
  server.use(
    http.get('*/api/proposals/config/portfolio', () =>
      HttpResponse.json(rows),
    ),
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ role: 'manager' }) })
})

// ── Team Roster ──────────────────────────────────────────────────────────────

describe('TeamRosterSection', () => {
  it("renders the branch's members from the list endpoint", async () => {
    mockTeamMembers([BRANCH_MEMBER])
    renderComp(<TeamRosterSection aspireBranchId={BRANCH_ID} />)
    expect(await screen.findByText('Alice Appleseed')).toBeInTheDocument()
  })

  it('shows a loading state while fetching', () => {
    // No server override → no response yet during render
    server.use(
      http.get('*/api/proposals/config/team-members', async () => {
        // Never resolves during this test — loading state is visible immediately
        await new Promise(() => {})
        return HttpResponse.json([])
      }),
    )
    renderComp(<TeamRosterSection aspireBranchId={BRANCH_ID} />)
    expect(screen.getByTestId('settings-section-team-roster')).toBeInTheDocument()
    // Loading spinner/text should be present before data arrives
    expect(
      screen.getByTestId('settings-section-team-roster'),
    ).toHaveTextContent(/loading/i)
  })

  it('fires POST /api/settings/team-members with aspireBranchId on create', async () => {
    mockTeamMembers([])
    let body: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/settings/team-members', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...BRANCH_MEMBER, id: 'tm-new' }, { status: 201 })
      }),
    )
    renderComp(<TeamRosterSection aspireBranchId={BRANCH_ID} />)

    // Open the create form
    fireEvent.click(await screen.findByRole('button', { name: /add member|add team member/i }))

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'New Person' },
    })
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'manager' },
    })
    fireEvent.change(screen.getByLabelText(/bio/i), {
      target: { value: 'Short bio.' },
    })

    fireEvent.click(screen.getByRole('button', { name: /save|create/i }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({
      aspireBranchId: BRANCH_ID,
      name: 'New Person',
    })
  })

  it('fires DELETE /api/settings/team-members/:id on deactivate', async () => {
    mockTeamMembers([BRANCH_MEMBER])
    let deletedId: string | null = null
    server.use(
      http.delete('*/api/settings/team-members/:id', ({ params }) => {
        deletedId = params.id as string
        return HttpResponse.json({}, { status: 200 })
      }),
    )
    renderComp(<TeamRosterSection aspireBranchId={BRANCH_ID} />)
    await screen.findByText('Alice Appleseed')

    fireEvent.click(screen.getByRole('button', { name: /deactivate|remove/i }))
    await waitFor(() => expect(deletedId).toBe('tm-1'))
  })

  it('renders a company-wide row as read-only for a branch manager', async () => {
    mockTeamMembers([BRANCH_MEMBER, COMPANY_WIDE_MEMBER])
    renderComp(<TeamRosterSection aspireBranchId={BRANCH_ID} />, 'manager')
    await screen.findByText('Bob CEO')

    // The company-wide row should be marked read-only (no deactivate button next to it)
    // We verify the read-only badge/label is present
    expect(screen.getByTestId('team-member-tm-2-readonly')).toBeInTheDocument()
  })
})

// ── Client References ────────────────────────────────────────────────────────

describe('ClientReferencesSection', () => {
  it("renders the branch's client references from the list endpoint", async () => {
    mockClientReferences([BRANCH_REF])
    renderComp(<ClientReferencesSection aspireBranchId={BRANCH_ID} />)
    expect(await screen.findByText('Lakewood HOA')).toBeInTheDocument()
  })

  it('fires POST /api/settings/client-references with aspireBranchId on create', async () => {
    mockClientReferences([])
    let body: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/settings/client-references', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...BRANCH_REF, id: 'cr-new' }, { status: 201 })
      }),
    )
    renderComp(<ClientReferencesSection aspireBranchId={BRANCH_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: /add reference|add client/i }))

    fireEvent.change(screen.getByLabelText(/property name/i), {
      target: { value: 'Sunset HOA' },
    })
    fireEvent.change(screen.getByLabelText(/services/i), {
      target: { value: 'Mowing' },
    })
    fireEvent.change(screen.getByLabelText(/contact name/i), {
      target: { value: 'Eve Manager' },
    })
    fireEvent.change(screen.getByLabelText(/phone/i), {
      target: { value: '555-9999' },
    })
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'eve@sunset.com' },
    })
    fireEvent.change(screen.getByLabelText(/address/i), {
      target: { value: '1 Sunset Dr' },
    })
    fireEvent.change(screen.getByLabelText(/since/i), {
      target: { value: '2022' },
    })

    fireEvent.click(screen.getByRole('button', { name: /save|create/i }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({
      aspireBranchId: BRANCH_ID,
      propertyName: 'Sunset HOA',
    })
  })

  it('fires DELETE /api/settings/client-references/:id on deactivate', async () => {
    mockClientReferences([BRANCH_REF])
    let deletedId: string | null = null
    server.use(
      http.delete('*/api/settings/client-references/:id', ({ params }) => {
        deletedId = params.id as string
        return HttpResponse.json({}, { status: 200 })
      }),
    )
    renderComp(<ClientReferencesSection aspireBranchId={BRANCH_ID} />)
    await screen.findByText('Lakewood HOA')

    fireEvent.click(screen.getByRole('button', { name: /deactivate|remove/i }))
    await waitFor(() => expect(deletedId).toBe('cr-1'))
  })

  it('renders a company-wide reference as read-only for a branch manager', async () => {
    mockClientReferences([BRANCH_REF, COMPANY_WIDE_REF])
    renderComp(<ClientReferencesSection aspireBranchId={BRANCH_ID} />, 'manager')
    await screen.findByText('Global Corp')

    expect(screen.getByTestId('client-ref-cr-2-readonly')).toBeInTheDocument()
  })
})

// ── Portfolio ────────────────────────────────────────────────────────────────

describe('PortfolioSection', () => {
  // Bug 4: portfolio loads without crashing (validates the _portfolio_property_out
  // coerce_row fix in proposals.py is reflected in the expected response shape).
  it('loads and renders portfolio properties from the config endpoint', async () => {
    mockPortfolio([PORTFOLIO_PROPERTY])
    renderComp(<PortfolioSection />, 'admin')
    // Name and cityState appear as direct text nodes.
    expect(await screen.findByText('Oceanfront Villa')).toBeInTheDocument()
    expect(screen.getByText('Naples, FL')).toBeInTheDocument()
    // regionId is rendered with a bullet prefix ("· southeast"); use regex.
    expect(screen.getByText(/southeast/)).toBeInTheDocument()
  })

  it('shows error state when the portfolio endpoint fails', async () => {
    server.use(
      http.get('*/api/proposals/config/portfolio', () =>
        HttpResponse.json({ detail: 'fail' }, { status: 500 }),
      ),
    )
    renderComp(<PortfolioSection />, 'admin')
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
  })

  it('admin sees the portfolio section with listed properties', async () => {
    mockPortfolio([PORTFOLIO_PROPERTY])
    renderComp(<PortfolioSection />, 'admin')
    expect(await screen.findByText('Oceanfront Villa')).toBeInTheDocument()
  })

  it('fires POST /api/settings/portfolio on create', async () => {
    mockPortfolio([])
    let body: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/settings/portfolio', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...PORTFOLIO_PROPERTY, id: 'pp-new' }, { status: 201 })
      }),
    )
    renderComp(<PortfolioSection />, 'admin')

    fireEvent.click(await screen.findByRole('button', { name: /add property|add portfolio/i }))

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'New Garden' },
    })
    fireEvent.change(screen.getByLabelText(/city.*state|location/i), {
      target: { value: 'Miami, FL' },
    })
    fireEvent.change(screen.getByLabelText(/region/i), {
      target: { value: 'southeast' },
    })

    fireEvent.click(screen.getByRole('button', { name: /save|create/i }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ name: 'New Garden' })
  })

  it('fires PATCH /api/settings/portfolio/:id on edit', async () => {
    mockPortfolio([PORTFOLIO_PROPERTY])
    let patchBody: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/settings/portfolio/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...PORTFOLIO_PROPERTY, name: 'Updated Villa' })
      }),
    )
    renderComp(<PortfolioSection />, 'admin')
    await screen.findByText('Oceanfront Villa')

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))

    const nameInput = screen.getByDisplayValue('Oceanfront Villa')
    fireEvent.change(nameInput, { target: { value: 'Updated Villa' } })

    fireEvent.click(screen.getByRole('button', { name: /save|update/i }))

    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody).toMatchObject({ name: 'Updated Villa' })
  })
})
