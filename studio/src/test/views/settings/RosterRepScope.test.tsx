// Per-rep client references and team roster on the proposal settings page.
// Portfolio stays shared: no rep selector and no rep_id.

import { describe, it, expect, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import { makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'
import type { ClientReference, TeamMember } from '@/types/proposal'
import { MarketingSection } from '@/views/settings/marketing/MarketingSection'

const REPS = [
  {
    id: 'rep-2',
    name: 'Riley Rep',
    email: 'riley@example.com',
    role: 'sales',
    branch_id: 'b1',
    avatar_initials: 'RR',
  },
  {
    id: 'rep-3',
    name: 'Quinn Rep',
    email: 'quinn@example.com',
    role: 'sales',
    branch_id: 'b1',
    avatar_initials: 'QR',
  },
]

const MEMBER: TeamMember = {
  id: 'tm-1',
  name: 'Alice Appleseed',
  title: 'account_manager',
  teamType: 'branch',
  aspireBranchId: null,
  userId: null,
  ownerUserId: 'rep-2',
  location: null,
  bio: 'Bio',
  headshotObjectKey: null,
  active: true,
  sortOrder: 0,
}

const LEGACY_MEMBER: TeamMember = {
  ...MEMBER,
  id: 'tm-legacy',
  name: 'Legacy Lead',
  ownerUserId: null,
}

const REFERENCE: ClientReference = {
  id: 'cr-1',
  aspireBranchId: null,
  ownerUserId: 'rep-2',
  propertyName: 'Lakewood HOA',
  servicesProvided: 'Maintenance',
  contactName: 'Carol Contact',
  contactTitle: null,
  phone: '555-1234',
  email: 'carol@lakewood.com',
  address: '100 Lake Dr',
  clientSinceYear: 2020,
  active: true,
}

function renderSection(slug: string, role: UserRole, id = 'user-1') {
  useAuthStore.setState({ user: makeUser({ role, id }) })
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
  return rtlRender(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider>
          <MarketingSection slug={slug} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: null })
})

describe('sales rep roster scope', () => {
  it('shows no dropdown and scopes team-roster calls to their own id', async () => {
    let listUrl: URL | undefined
    let postUrl: URL | undefined
    let postBody: Record<string, unknown> | null = null
    let deleteUrl: URL | undefined
    server.use(
      http.get('*/api/users', () => {
        throw new Error('sales rep should not load the rep directory')
      }),
      http.get('*/api/proposals/config/team-members', ({ request }) => {
        listUrl = new URL(request.url)
        return HttpResponse.json([MEMBER, LEGACY_MEMBER])
      }),
      http.post('*/api/settings/team-members', async ({ request }) => {
        postUrl = new URL(request.url)
        postBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...MEMBER, id: 'tm-new' }, { status: 201 })
      }),
      http.delete('*/api/settings/team-members/:id', ({ request }) => {
        deleteUrl = new URL(request.url)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderSection('team-roster', 'sales', 'rep-self')

    expect(screen.queryByTestId('settings-rep-picker')).not.toBeInTheDocument()
    expect(await screen.findByText('Alice Appleseed')).toBeInTheDocument()
    expect(screen.getByTestId('team-member-tm-legacy-legacy')).toHaveTextContent('Legacy')
    expect(screen.queryByTestId('team-member-tm-1-legacy')).not.toBeInTheDocument()
    expect(listUrl?.searchParams.get('rep_id')).toBe('rep-self')
    expect(listUrl?.searchParams.get('region_id')).toBe('all')

    fireEvent.click(screen.getAllByRole('button', { name: /deactivate/i })[0])
    await waitFor(() => expect(deleteUrl).toBeDefined())
    expect(deleteUrl?.pathname).toContain('/team-members/tm-1')
    expect(deleteUrl?.searchParams.get('rep_id')).toBe('rep-self')

    fireEvent.click(screen.getByRole('button', { name: /add team member/i }))
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Person' } })
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'manager' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(postBody).not.toBeNull())
    expect(postBody).toMatchObject({ repId: 'rep-self', name: 'New Person' })
    expect(postUrl?.searchParams.get('rep_id')).toBe('rep-self')
  })

  it('scopes client-reference reads and writes to their own id', async () => {
    let listUrl: URL | undefined
    let postUrl: URL | undefined
    let postBody: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/proposals/config/client-references', ({ request }) => {
        listUrl = new URL(request.url)
        return HttpResponse.json([REFERENCE])
      }),
      http.post('*/api/settings/client-references', async ({ request }) => {
        postUrl = new URL(request.url)
        postBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...REFERENCE, id: 'cr-new' }, { status: 201 })
      }),
    )

    renderSection('client-references', 'sales', 'rep-self')
    expect(screen.queryByTestId('settings-rep-picker')).not.toBeInTheDocument()
    expect(await screen.findByText('Lakewood HOA')).toBeInTheDocument()
    expect(listUrl?.searchParams.get('rep_id')).toBe('rep-self')
    expect(listUrl?.searchParams.get('region_id')).toBe('all')

    fireEvent.click(screen.getByRole('button', { name: /add client reference/i }))
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: 'Sunset HOA' } })
    fireEvent.change(screen.getByLabelText(/contact name/i), { target: { value: 'Eve Manager' } })
    fireEvent.change(screen.getByLabelText(/^phone/i), { target: { value: '555-9999' } })
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'eve@sunset.com' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(postBody).not.toBeNull())
    expect(postBody).toMatchObject({ repId: 'rep-self', propertyName: 'Sunset HOA' })
    expect(postUrl?.searchParams.get('rep_id')).toBe('rep-self')
  })

  it('shows the server detail when a roster read is forbidden', async () => {
    server.use(
      http.get('*/api/proposals/config/team-members', () =>
        HttpResponse.json(
          { detail: 'You can view only your own client references and team roster.' },
          { status: 403 },
        ),
      ),
    )
    renderSection('team-roster', 'sales', 'rep-self')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can view only your own client references and team roster.',
    )
  })
})

describe('marketing and admin pick a rep', () => {
  it.each(['marketing', 'admin'] as const)(
    '%s sees the dropdown and does not fetch until a rep is picked',
    async (role) => {
      let rosterGets = 0
      let usersRole: string | null = null
      server.use(
        http.get('*/api/users', ({ request }) => {
          usersRole = new URL(request.url).searchParams.get('role')
          return HttpResponse.json(REPS)
        }),
        http.get('*/api/proposals/config/team-members', () => {
          rosterGets += 1
          return HttpResponse.json([])
        }),
      )

      renderSection('team-roster', role, `${role}-1`)
      const picker = (await screen.findByTestId('settings-rep-picker')) as HTMLSelectElement
      expect(picker.className).toContain('bg-[var(--bg)]')
      expect(picker.className).toContain('border-[var(--border)]')
      expect(screen.getByText(/select a sales rep to view and edit their team roster/i)).toBeInTheDocument()
      expect(rosterGets).toBe(0)
      await waitFor(() => expect(usersRole).toBe('sales'))
      expect(rosterGets).toBe(0)
    },
  )

  it.each(['marketing', 'admin'] as const)(
    '%s scopes team-roster reads and writes to the picked rep',
    async (role) => {
      const lists: URL[] = []
      let postUrl: URL | undefined
      let postBody: Record<string, unknown> | null = null
      let deleteUrl: URL | undefined
      server.use(
        http.get('*/api/users', ({ request }) => {
          expect(new URL(request.url).searchParams.get('role')).toBe('sales')
          return HttpResponse.json(REPS)
        }),
        http.get('*/api/proposals/config/team-members', ({ request }) => {
          lists.push(new URL(request.url))
          return HttpResponse.json([MEMBER])
        }),
        http.post('*/api/settings/team-members', async ({ request }) => {
          postUrl = new URL(request.url)
          postBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({ ...MEMBER, id: 'tm-new' }, { status: 201 })
        }),
        http.delete('*/api/settings/team-members/:id', ({ request }) => {
          deleteUrl = new URL(request.url)
          return new HttpResponse(null, { status: 204 })
        }),
      )

      renderSection('team-roster', role, `${role}-1`)
      const picker = (await screen.findByTestId('settings-rep-picker')) as HTMLSelectElement
      expect(lists).toHaveLength(0)
      await screen.findByRole('option', { name: 'Riley Rep' })

      fireEvent.change(picker, { target: { value: 'rep-2' } })
      expect(await screen.findByText('Alice Appleseed')).toBeInTheDocument()
      expect(lists.at(-1)?.searchParams.get('rep_id')).toBe('rep-2')
      expect(lists.at(-1)?.searchParams.get('region_id')).toBe('all')

      fireEvent.change(picker, { target: { value: 'rep-3' } })
      await waitFor(() => expect(lists.at(-1)?.searchParams.get('rep_id')).toBe('rep-3'))
      expect(lists.at(-1)?.searchParams.get('region_id')).toBe('all')

      fireEvent.change(picker, { target: { value: 'rep-2' } })
      await screen.findByText('Alice Appleseed')

      fireEvent.click(screen.getByRole('button', { name: /add team member/i }))
      fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Person' } })
      fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'manager' } })
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
      await waitFor(() => expect(postBody).not.toBeNull())
      expect(postBody).toMatchObject({ repId: 'rep-2' })
      expect(postUrl?.searchParams.get('rep_id')).toBe('rep-2')

      fireEvent.click(screen.getByRole('button', { name: /deactivate/i }))
      await waitFor(() => expect(deleteUrl?.searchParams.get('rep_id')).toBe('rep-2'))
    },
  )

  it.each(['marketing', 'admin'] as const)(
    '%s scopes client-reference reads and writes to the picked rep',
    async (role) => {
      let listUrl: URL | undefined
      let postUrl: URL | undefined
      let postBody: Record<string, unknown> | null = null
      let patchUrl: URL | undefined
      server.use(
        http.get('*/api/users', () => HttpResponse.json(REPS)),
        http.get('*/api/proposals/config/client-references', ({ request }) => {
          listUrl = new URL(request.url)
          return HttpResponse.json([REFERENCE])
        }),
        http.post('*/api/settings/client-references', async ({ request }) => {
          postUrl = new URL(request.url)
          postBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({ ...REFERENCE, id: 'cr-new' }, { status: 201 })
        }),
        http.patch('*/api/settings/client-references/:id', async ({ request }) => {
          patchUrl = new URL(request.url)
          return HttpResponse.json(REFERENCE)
        }),
      )

      renderSection('client-references', role)
      const picker = (await screen.findByTestId('settings-rep-picker')) as HTMLSelectElement
      expect(listUrl).toBeUndefined()
      await screen.findByRole('option', { name: 'Riley Rep' })

      fireEvent.change(picker, { target: { value: 'rep-2' } })
      expect(await screen.findByText('Lakewood HOA')).toBeInTheDocument()
      expect(listUrl?.searchParams.get('rep_id')).toBe('rep-2')
      expect(listUrl?.searchParams.get('region_id')).toBe('all')

      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
      fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: 'Lakewood Estates' } })
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
      await waitFor(() => expect(patchUrl?.searchParams.get('rep_id')).toBe('rep-2'))

      fireEvent.click(await screen.findByRole('button', { name: /add client reference/i }))
      fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: 'Sunset HOA' } })
      fireEvent.change(screen.getByLabelText(/contact name/i), { target: { value: 'Eve Manager' } })
      fireEvent.change(screen.getByLabelText(/^phone/i), { target: { value: '555-9999' } })
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'eve@sunset.com' } })
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
      await waitFor(() => expect(postBody).not.toBeNull())
      expect(postBody).toMatchObject({ repId: 'rep-2', propertyName: 'Sunset HOA' })
      expect(postUrl?.searchParams.get('rep_id')).toBe('rep-2')
    },
  )

  it('shows a write 403 detail on the form', async () => {
    server.use(
      http.get('*/api/users', () => HttpResponse.json(REPS)),
      http.get('*/api/proposals/config/team-members', () => HttpResponse.json([])),
      http.post('*/api/settings/team-members', () =>
        HttpResponse.json(
          { detail: 'This row belongs to a different rep.' },
          { status: 403 },
        ),
      ),
    )
    renderSection('team-roster', 'marketing')
    const picker = (await screen.findByTestId('settings-rep-picker')) as HTMLSelectElement
    await screen.findByRole('option', { name: 'Riley Rep' })
    fireEvent.change(picker, { target: { value: 'rep-2' } })
    fireEvent.click(await screen.findByRole('button', { name: /add team member/i }))
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Person' } })
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'manager' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This row belongs to a different rep.')
  })
})

describe('shared portfolio', () => {
  it.each(['sales', 'marketing', 'admin'] as const)(
    '%s edits the portfolio with no rep selector and no rep_id',
    async (role) => {
      let portfolioUrl: URL | undefined
      let usersCalled = false
      server.use(
        http.get('*/api/users', () => {
          usersCalled = true
          return HttpResponse.json(REPS)
        }),
        http.get('*/api/proposals/config/portfolio', ({ request }) => {
          portfolioUrl = new URL(request.url)
          return HttpResponse.json([])
        }),
      )
      renderSection('portfolio', role, 'rep-self')
      expect(await screen.findByText(/no portfolio properties yet/i)).toBeInTheDocument()
      expect(screen.queryByTestId('settings-rep-picker')).not.toBeInTheDocument()
      expect(portfolioUrl?.searchParams.has('rep_id')).toBe(false)
      expect(usersCalled).toBe(false)
    },
  )
})

describe('roster mock handler', () => {
  it('returns 403 when a sales rep requests another rep', async () => {
    useAuthStore.setState({ user: makeUser({ id: 'rep-self', role: 'sales' }) })
    const res = await fetch('/api/proposals/config/team-members?rep_id=rep-2&region_id=all')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      detail: 'You can view only your own client references and team roster.',
    })
  })

  it('returns 400 when rep_id and user_id disagree', async () => {
    useAuthStore.setState({ user: makeUser({ id: 'mkt-1', role: 'marketing' }) })
    const res = await fetch('/api/proposals/config/client-references?rep_id=rep-2&user_id=rep-3')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      detail: 'rep_id and user_id must be the same rep.',
    })
  })
})
