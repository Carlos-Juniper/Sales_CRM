// ---------------------------------------------------------------------------
// Slice 10b — Users admin section (§2.8 "authorize, not create").
//
// The admin surface that consumes the Slice 6 backend:
//   * lists current users (role + active state), inactive rows stay visible
//   * authorizes a NEW user by PICKING a person from the M365 directory
//     typeahead (name+email autofill — typos impossible), then role + branches
//   * hard-blocks a `sales` user with an unresolved Aspire rep: the backend's
//     EXACT §2.8 422 copy is surfaced and a "Link Aspire Rep" action appears;
//     a non-sales user saves with no Aspire warning
//   * edits role/branches via PATCH (branches are a replace-set)
//   * deactivates via PATCH { active: false } — never a DELETE — and the row
//     shows inactive
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
import { makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { UsersSection } from '@/views/settings/company/users/UsersSection'

// Verbatim §2.8 copy the backend returns on the sales hard-block. The UI must
// display whatever the API returns — this constant only lets the test assert a
// recognizable fragment, it is NOT hardcoded into the component.
const BLOCK_COPY =
  'No Aspire contact matches this email. Create an Aspire user with the same ' +
  'email address, then click Link Aspire Rep. Until then, estimates from this ' +
  'rep push to Aspire without a sales rep — and opportunities already pushed ' +
  'must be corrected in Aspire by hand.'

const USERS = [
  {
    id: 'u-carla',
    name: 'Carla Reyes',
    email: 'carla@juniper.com',
    role: 'sales',
    active: 1,
    aspire_rep_id: 42,
    branches: [101],
  },
  {
    id: 'u-omar',
    name: 'Omar Diaz',
    email: 'omar@juniper.com',
    role: 'manager',
    active: 0,
    aspire_rep_id: null,
    branches: [],
  },
]

const BRANCHES = [
  { aspireBranchId: 101, branchName: 'Naples', city: 'Naples' },
  { aspireBranchId: 202, branchName: 'Sarasota', city: 'Sarasota' },
]

function mockUsers(rows: unknown[] = USERS) {
  server.use(http.get('*/api/users', () => HttpResponse.json(rows)))
}
function mockBranches(rows = BRANCHES) {
  server.use(http.get('*/api/settings/branches', () => HttpResponse.json(rows)))
}
function mockDirectory(
  candidates: Array<{ name: string; email: string }> = [
    { name: 'Nina Park', email: 'nina.park@juniper.com' },
  ],
) {
  server.use(
    http.get('*/api/settings/users/directory', () =>
      HttpResponse.json(candidates),
    ),
  )
}

function renderSection(role = 'admin') {
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
        <UsersSection slug="users" label="Users" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ role: 'admin' }) })
  mockUsers()
  mockBranches()
  mockDirectory()
})

// ── List ─────────────────────────────────────────────────────────────────────

describe('UsersSection — list', () => {
  it('renders current users with role and active state', async () => {
    renderSection()
    expect(await screen.findByText('Carla Reyes')).toBeInTheDocument()
    expect(screen.getByText('carla@juniper.com')).toBeInTheDocument()
    // Deactivated user stays listed (historical) and is visibly marked inactive.
    const omarRow = screen.getByTestId('user-row-u-omar')
    expect(omarRow).toHaveTextContent('Omar Diaz')
    expect(omarRow).toHaveTextContent(/inactive/i)
    // Active user is not marked inactive.
    expect(screen.getByTestId('user-row-u-carla')).not.toHaveTextContent(
      /inactive/i,
    )
  })

  it('refuses to render the users admin surface for a non-admin', () => {
    renderSection('manager')
    expect(screen.getByTestId('settings-section-users')).toHaveTextContent(
      /admin/i,
    )
    expect(screen.queryByText('Carla Reyes')).not.toBeInTheDocument()
  })
})

// ── Directory typeahead + authorize ──────────────────────────────────────────

describe('UsersSection — authorize from M365 directory', () => {
  it('queries the directory and autofills the picked candidate email', async () => {
    let directoryQuery: string | null = null
    server.use(
      http.get('*/api/settings/users/directory', ({ request }) => {
        directoryQuery = new URL(request.url).searchParams.get('q')
        return HttpResponse.json([
          { name: 'Nina Park', email: 'nina.park@juniper.com' },
        ])
      }),
    )
    renderSection()
    await screen.findByText('Carla Reyes')

    fireEvent.change(screen.getByTestId('directory-search'), {
      target: { value: 'nina' },
    })
    await waitFor(() => expect(directoryQuery).toBe('nina'))

    // Pick the candidate → email autofills (admin never types it).
    fireEvent.click(await screen.findByText('nina.park@juniper.com'))
    expect(screen.getByTestId('authorize-selected-email')).toHaveTextContent(
      'nina.park@juniper.com',
    )
  })

  it('authorizes a non-sales user with no Aspire warning', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/settings/users', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          { id: 'u-new', email: body.email, name: body.name, role: body.role, active: 1 },
          { status: 201 },
        )
      }),
    )
    renderSection()
    await screen.findByText('Carla Reyes')

    fireEvent.change(screen.getByTestId('directory-search'), {
      target: { value: 'nina' },
    })
    fireEvent.click(await screen.findByText('nina.park@juniper.com'))
    fireEvent.change(screen.getByTestId('authorize-role'), {
      target: { value: 'procurement' },
    })
    fireEvent.click(screen.getByRole('button', { name: /authorize/i }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({
      name: 'Nina Park',
      email: 'nina.park@juniper.com',
      role: 'procurement',
    })
    // No Aspire block copy for a non-sales role.
    expect(screen.queryByText(/no aspire contact matches/i)).not.toBeInTheDocument()
  })

  it('surfaces the backend §2.8 copy and a Link Aspire Rep control when a sales rep is unresolved', async () => {
    server.use(
      http.post('*/api/settings/users', () =>
        HttpResponse.json({ detail: BLOCK_COPY }, { status: 422 }),
      ),
    )
    renderSection()
    await screen.findByText('Carla Reyes')

    fireEvent.change(screen.getByTestId('directory-search'), {
      target: { value: 'nina' },
    })
    fireEvent.click(await screen.findByText('nina.park@juniper.com'))
    fireEvent.change(screen.getByTestId('authorize-role'), {
      target: { value: 'maintenance_sales' },
    })
    fireEvent.click(screen.getByRole('button', { name: /authorize/i }))

    // The EXACT backend copy is surfaced (not recomputed in the frontend).
    expect(await screen.findByText(/no aspire contact matches this email/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /link aspire rep/i }),
    ).toBeInTheDocument()
  })
})

// ── Enriched fields: active flag + branches + aspireRepId ────────────────────

describe('UsersSection — enriched backend fields', () => {
  it('reads active state from the real `active` field (not inferred)', async () => {
    // Omar has active: 0 — the row must show Inactive badge from that real flag.
    renderSection()
    await screen.findByText('Carla Reyes')
    const omarRow = screen.getByTestId('user-row-u-omar')
    expect(omarRow).toHaveTextContent(/inactive/i)
    // Carla has active: 1 — no Inactive badge.
    expect(screen.getByTestId('user-row-u-carla')).not.toHaveTextContent(/inactive/i)
    expect(screen.getByTestId('user-row-u-carla')).toHaveTextContent('Legacy: Sales (reassign)')
  })

  it('seeds the branch editor from the user real `branches` array', async () => {
    // Carla has branches: [101]. Opening the editor must pre-check branch 101
    // (Naples) and leave 202 (Sarasota) unchecked.
    renderSection()
    await screen.findByText('Carla Reyes')
    fireEvent.click(screen.getByRole('button', { name: /edit carla reyes/i }))
    // Branch 101 checkbox must be checked (seeded from real branches).
    const editRole = screen.getByTestId('edit-role-u-carla') as HTMLSelectElement
    expect(editRole.value).toBe('sales')
    expect(Array.from(editRole.options).map((option) => option.value)).toContain('sales')
    expect(Array.from(editRole.options).some((option) => option.text === 'Legacy: Sales (reassign)')).toBe(true)
    const naplesCheck = screen.getByTestId('edit-branch-u-carla-101') as HTMLInputElement
    expect(naplesCheck.checked).toBe(true)
    // Branch 202 must not be checked.
    const sarasotaCheck = screen.getByTestId('edit-branch-u-carla-202') as HTMLInputElement
    expect(sarasotaCheck.checked).toBe(false)
  })

  it('shows the Aspire rep hint for a sales user with a null aspireRepId', async () => {
    // Inject a sales user with no resolved rep id.
    mockUsers([
      {
        id: 'u-sal',
        name: 'Sal Unlinked',
        email: 'sal@juniper.com',
        role: 'sales',
        active: 1,
        aspire_rep_id: null,
        branches: [],
      },
    ])
    renderSection()
    // Open the editor for Sal — the "no Aspire rep" hint must appear.
    fireEvent.click(await screen.findByRole('button', { name: /edit sal unlinked/i }))
    expect(screen.getByTestId('aspire-rep-hint-u-sal')).toBeInTheDocument()
  })

  it('shows the Aspire rep hint for maintenance_sales and install_sales with no Aspire contact', async () => {
    mockUsers([
      {
        id: 'u-maint',
        name: 'Mia Maint',
        email: 'mia@juniper.com',
        role: 'maintenance_sales',
        active: 1,
        aspire_rep_id: null,
        branches: [],
      },
      {
        id: 'u-inst',
        name: 'Ian Install',
        email: 'ian@juniper.com',
        role: 'install_sales',
        active: 1,
        aspire_rep_id: null,
        branches: [],
      },
    ])
    renderSection()
    expect(await screen.findByText('Role: Maintenance Sales')).toBeInTheDocument()
    expect(screen.getByText('Role: Install Sales')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /edit mia maint/i }))
    expect(screen.getByTestId('aspire-rep-hint-u-maint')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /edit ian install/i }))
    expect(screen.getByTestId('aspire-rep-hint-u-inst')).toBeInTheDocument()
  })

  it('offers Maintenance Sales and Install Sales in the role picker', async () => {
    renderSection()
    await screen.findByText('Carla Reyes')
    fireEvent.change(screen.getByTestId('directory-search'), {
      target: { value: 'nina' },
    })
    fireEvent.click(await screen.findByText('nina.park@juniper.com'))
    const select = screen.getByTestId('authorize-role') as HTMLSelectElement
    const labels = Array.from(select.options).map((option) => option.text)
    const values = Array.from(select.options).map((option) => option.value)
    expect(labels).toEqual(expect.arrayContaining([
      'Inside Sales',
      'Maintenance Sales',
      'Install Sales',
      'VP of Sales',
      'Regional Director',
      'Vice President',
    ]))
    expect(values).toEqual(expect.arrayContaining([
      'inside_sales',
      'maintenance_sales',
      'install_sales',
      'vp_sales',
      'regional_director',
      'vice_president',
    ]))
    expect(values).not.toContain('sales')
    expect(values).not.toContain('outside_sales')
    expect(labels).not.toContain('Legacy: Sales (reassign)')
  })

  it('does NOT show the Aspire rep hint for a sales user with a resolved aspireRepId', async () => {
    // Carla has aspire_rep_id: 42 — no hint should appear.
    renderSection()
    await screen.findByText('Carla Reyes')
    fireEvent.click(screen.getByRole('button', { name: /edit carla reyes/i }))
    expect(screen.queryByTestId('aspire-rep-hint-u-carla')).not.toBeInTheDocument()
  })
})

// ── Edit / activate-deactivate ───────────────────────────────────────────────

describe('UsersSection — edit + deactivate', () => {
  it('deactivates via PATCH { active: false } and never issues a DELETE', async () => {
    let patchBody: Record<string, unknown> | null = null
    let deleteCalled = false
    server.use(
      http.patch('*/api/settings/users/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...USERS[0], active: 0 })
      }),
      http.delete('*/api/settings/users/:id', () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderSection()
    await screen.findByText('Carla Reyes')

    fireEvent.click(
      screen.getByRole('button', { name: /deactivate carla reyes/i }),
    )
    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody).toEqual({ active: false })
    expect(deleteCalled).toBe(false)
  })

  it('edits role/branches with a replace-set branches PATCH body', async () => {
    let patchBody: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/settings/users/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...USERS[0], role: 'manager' })
      }),
    )
    renderSection()
    await screen.findByText('Carla Reyes')

    // Open Carla's editor, change role and toggle a branch, save.
    fireEvent.click(screen.getByRole('button', { name: /edit carla reyes/i }))
    fireEvent.change(screen.getByTestId('edit-role-u-carla'), {
      target: { value: 'manager' },
    })
    // Add Sarasota (202) to her existing [101].
    fireEvent.click(screen.getByTestId('edit-branch-u-carla-202'))
    fireEvent.click(screen.getByRole('button', { name: /save carla reyes/i }))

    await waitFor(() => expect(patchBody).not.toBeNull())
    expect(patchBody).toMatchObject({ role: 'manager' })
    // Replace-set: the full branch set is sent, not an incremental add.
    expect(patchBody!.branches).toEqual(expect.arrayContaining([101, 202]))
    expect((patchBody!.branches as number[]).length).toBe(2)
  })
})
