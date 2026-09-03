// ---------------------------------------------------------------------------
// Handoff 42 — Documents section (formerly Credentials): unified license,
// certification, and insurance CRUD.
//
// ACs tested:
//   1. One unified section manages all three document kinds (license,
//      certification, insurance) in a single list with kind selector.
//   2. Creating a document requires kind, name, and expiryDate; insurance can be
//      created by any BM (not admin-gated in the UI).
//   3. Deactivating a document calls DELETE (soft-delete); "include expired"
//      toggle re-queries with include_expired=true.
//   4. BM sees company-wide rows as read-only; branch-scoped rows show controls.
//   5. Each row supports uploading exactly one file via /scan; view link via
//      media-url signer (not a hand-built URL).
//   6. Expiry banner uses server isExpired flag — client never recomputes.
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
import { CredentialsSection } from '@/views/settings/credentials/CredentialsSection'
import type { LicenseSettingsRow } from '@/views/settings/credentials/CredentialsSection'

const BRANCH_ID = 42

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BRANCH_LICENSE: LicenseSettingsRow = {
  id: 'lic-1',
  kind: 'license',
  name: 'General Contractor License',
  issuingBody: 'DBPR',
  identifier: 'CGC-123456',
  holderName: 'Juniper Landscaping',
  aspireBranchId: BRANCH_ID,
  issuedDate: '2020-01-01',
  expiryDate: '2027-01-01',
  objectKey: null,
  active: true,
  sortOrder: 0,
  updatedAt: '2024-01-01T00:00:00Z',
}

const COMPANY_LICENSE: LicenseSettingsRow = {
  id: 'lic-2',
  kind: 'license',
  name: 'Pesticide Applicator',
  issuingBody: 'FDACS',
  identifier: 'JA-789',
  holderName: 'Juniper Corp',
  aspireBranchId: null, // company-wide
  issuedDate: '2019-06-01',
  expiryDate: '2025-06-01',
  objectKey: null,
  active: true,
  sortOrder: 1,
  updatedAt: '2024-06-01T00:00:00Z',
}

const EXPIRED_LICENSE: LicenseSettingsRow = {
  id: 'lic-3',
  kind: 'certification',
  name: 'Irrigation Certification',
  issuingBody: 'IA',
  identifier: 'IC-000',
  holderName: 'Branch Team',
  aspireBranchId: BRANCH_ID,
  issuedDate: '2018-01-01',
  expiryDate: '2023-01-01',
  objectKey: null,
  active: true,
  sortOrder: 2,
  updatedAt: '2023-01-01T00:00:00Z',
}

// Insurance is now a unified document row with kind='insurance'
const INSURANCE_DOC: LicenseSettingsRow = {
  id: 'ins-1',
  kind: 'insurance',
  name: 'General Liability',
  issuingBody: null,
  identifier: null,
  holderName: null,
  aspireBranchId: BRANCH_ID,
  issuedDate: null,
  expiryDate: '2099-12-31', // far future — non-expired
  objectKey: 'credentials/insurance/ins-1.pdf',
  active: true,
  sortOrder: 3,
  updatedAt: '2024-01-15T10:00:00Z',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderComp(
  props: { aspireBranchId?: number | null } = {},
  role = 'manager',
) {
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
        <TooltipProvider>
          <CredentialsSection aspireBranchId={props.aspireBranchId ?? BRANCH_ID} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockDocuments(docs: LicenseSettingsRow[]) {
  server.use(
    http.get('*/api/settings/licenses', () =>
      HttpResponse.json(docs),
    ),
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ role: 'manager' }) })
  // Default: empty list so tests that don't care about content still load
  mockDocuments([])
  server.use(
    http.get('*/api/proposals/config/licenses', () =>
      HttpResponse.json({ licenses: [], certifications: [] }),
    ),
  )
})

// ── AC-1: Unified section manages all three kinds ─────────────────────────────

describe('CredentialsSection — unified documents section', () => {
  it('renders the documents section under credentials testid', async () => {
    mockDocuments([BRANCH_LICENSE, INSURANCE_DOC])

    renderComp({}, 'admin')

    expect(await screen.findByTestId('settings-section-credentials')).toBeInTheDocument()
    // One unified list area
    expect(screen.getByTestId('credentials-licenses-area')).toBeInTheDocument()
    // All document kinds appear in the same list
    expect(await screen.findByText('General Contractor License')).toBeInTheDocument()
    expect(await screen.findByText('General Liability')).toBeInTheDocument()
  })

  it('shows kind badge for each document row', async () => {
    mockDocuments([BRANCH_LICENSE, INSURANCE_DOC])

    renderComp({}, 'admin')

    await screen.findByText('General Contractor License')
    // Kind badges are rendered as text
    expect(screen.getByText('license')).toBeInTheDocument()
    expect(screen.getByText('insurance')).toBeInTheDocument()
  })

  it('shows a single expiry-warning banner when a license has isExpired=true from the API', async () => {
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({
          licenses: [{ ...EXPIRED_LICENSE, isExpired: true }],
          certifications: [],
        }),
      ),
    )
    mockDocuments([EXPIRED_LICENSE])

    renderComp({}, 'admin')

    const banner = await screen.findByTestId('credentials-expiry-banner')
    expect(banner).toBeInTheDocument()
    // Only ONE banner element
    expect(screen.getAllByTestId('credentials-expiry-banner')).toHaveLength(1)
  })

  it('does NOT show the expiry banner when no rows are flagged expired by the API', async () => {
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({
          licenses: [{ ...BRANCH_LICENSE, isExpired: false }],
          certifications: [],
        }),
      ),
    )
    mockDocuments([BRANCH_LICENSE])

    renderComp({}, 'admin')

    await screen.findByText('General Contractor License')
    expect(screen.queryByTestId('credentials-expiry-banner')).not.toBeInTheDocument()
  })

  it('shows expiry banner when an insurance document row has a past expiryDate', async () => {
    const expiredInsuranceDoc: LicenseSettingsRow = {
      ...INSURANCE_DOC,
      expiryDate: '2020-01-01', // past — banner fires on expired insurance rows
    }
    mockDocuments([expiredInsuranceDoc])

    renderComp({}, 'admin')

    const banner = await screen.findByTestId('credentials-expiry-banner')
    expect(banner).toBeInTheDocument()
  })
})

// ── AC-2: Creating a document requires kind, name, expiryDate ─────────────────

describe('CredentialsSection — document creation', () => {
  it('shows the Add document button for BMs (not admin-gated)', async () => {
    mockDocuments([])

    // BM (manager role) should see the Add button for branch-scoped creation
    renderComp({ aspireBranchId: BRANCH_ID }, 'manager')

    // Wait for loading to complete (empty state text appears after fetch)
    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add document/i })).toBeInTheDocument()
  })

  it('kind selector includes License, Certification, and Insurance options', async () => {
    mockDocuments([])

    renderComp({}, 'admin')

    // Wait for loading to finish
    await screen.findByText(/no documents yet/i)
    fireEvent.click(screen.getByRole('button', { name: /add document/i }))

    const kindSelect = screen.getByRole('combobox')
    const options = Array.from(kindSelect.querySelectorAll('option')).map((o) => o.value)
    expect(options).toContain('license')
    expect(options).toContain('certification')
    expect(options).toContain('insurance')
  })

  it('POSTs to /api/settings/licenses with kind, name, and expiryDate', async () => {
    mockDocuments([])

    let postedBody: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/settings/licenses', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...INSURANCE_DOC, id: 'ins-new', ...postedBody }, { status: 201 })
      }),
    )

    renderComp({}, 'admin')

    // Wait for loading to finish
    await screen.findByText(/no documents yet/i)
    fireEvent.click(screen.getByRole('button', { name: /add document/i }))

    // Set kind to insurance
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'insurance' } })
    // Fill name
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'General Liability' } })
    // Fill expiry date
    fireEvent.change(screen.getByLabelText(/expiry date/i), { target: { value: '2027-12-31' } })

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(postedBody?.kind).toBe('insurance')
    expect(postedBody?.name).toBe('General Liability')
    expect(postedBody?.expiryDate).toBe('2027-12-31')
  })
})

// ── AC-3: Deactivate (soft-delete) + include-expired toggle ──────────────────

describe('CredentialsSection — deactivate and include-expired toggle', () => {
  it('fires DELETE /api/settings/licenses/:id on deactivate', async () => {
    mockDocuments([BRANCH_LICENSE])

    let deletedId: string | null = null
    server.use(
      http.delete('*/api/settings/licenses/:id', ({ params }) => {
        deletedId = params.id as string
        return HttpResponse.json({ id: params.id, active: false })
      }),
    )

    renderComp({}, 'admin')
    await screen.findByText('General Contractor License')

    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }))

    await waitFor(() => expect(deletedId).toBe('lic-1'))
  })

  it('passes include_expired=true when the toggle is on', async () => {
    let capturedUrl: string | null = null
    server.use(
      http.get('*/api/settings/licenses', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json([EXPIRED_LICENSE])
      }),
    )

    renderComp({}, 'admin')

    await waitFor(() => expect(capturedUrl).not.toBeNull())
    capturedUrl = null // reset to capture the toggled call

    const toggle = await screen.findByRole('checkbox', { name: /include.*expired|show.*inactive/i })
    fireEvent.click(toggle)

    await waitFor(() => expect(capturedUrl).toContain('include_expired=true'))
  })

  it('shows an expired row when include-expired is on', async () => {
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({
          licenses: [{ ...EXPIRED_LICENSE, isExpired: true }],
          certifications: [],
        }),
      ),
    )
    server.use(
      http.get('*/api/settings/licenses', ({ request }) => {
        const url = new URL(request.url)
        const includeExpired = url.searchParams.get('include_expired')
        return HttpResponse.json(includeExpired === 'true' ? [EXPIRED_LICENSE] : [])
      }),
    )

    renderComp({}, 'admin')

    const toggle = await screen.findByRole('checkbox', { name: /include.*expired|show.*inactive/i })
    fireEvent.click(toggle)

    expect(await screen.findByText('Irrigation Certification')).toBeInTheDocument()
  })
})

// ── AC-4: BM read-only for company-wide rows ──────────────────────────────────

describe('CredentialsSection — BM read-only for company-wide documents', () => {
  it('BM sees company-wide license as read-only (no deactivate control)', async () => {
    mockDocuments([COMPANY_LICENSE]) // aspireBranchId === null

    renderComp({ aspireBranchId: BRANCH_ID }, 'manager')

    await screen.findByText('Pesticide Applicator')

    expect(screen.getByTestId('license-lic-2-readonly')).toBeInTheDocument()
    const deactivateButtons = screen.queryAllByRole('button', { name: /deactivate/i })
    expect(deactivateButtons).toHaveLength(0)
  })

  it('BM can edit a branch-scoped license (has deactivate control)', async () => {
    mockDocuments([BRANCH_LICENSE]) // aspireBranchId === BRANCH_ID

    renderComp({ aspireBranchId: BRANCH_ID }, 'manager')

    await screen.findByText('General Contractor License')

    expect(screen.queryByTestId('license-lic-1-readonly')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument()
  })

  it('admin can edit company-wide documents (no read-only restriction)', async () => {
    mockDocuments([COMPANY_LICENSE])

    renderComp({ aspireBranchId: BRANCH_ID }, 'admin')

    await screen.findByText('Pesticide Applicator')

    expect(screen.queryByTestId('license-lic-2-readonly')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument()
  })
})

// ── AC-5: File upload per row → /scan endpoint ────────────────────────────────

describe('CredentialsSection — file upload and media-url signer', () => {
  it('POSTs to /api/settings/licenses/:id/scan on upload', async () => {
    const docWithNoFile: LicenseSettingsRow = { ...BRANCH_LICENSE, objectKey: null }
    mockDocuments([docWithNoFile])

    let uploadedToId: string | null = null
    server.use(
      http.post('*/api/settings/licenses/:id/scan', ({ params }) => {
        uploadedToId = params.id as string
        return HttpResponse.json({ id: params.id, objectKey: `credentials/licenses/${params.id}.pdf` })
      }),
    )

    renderComp({}, 'admin')
    await screen.findByText('General Contractor License')

    const uploadInput = screen.getByTestId('license-lic-1-scan-upload')
    const file = new File(['pdf content'], 'scan.pdf', { type: 'application/pdf' })
    fireEvent.change(uploadInput, { target: { files: [file] } })

    await waitFor(() => expect(uploadedToId).toBe('lic-1'))
  })

  it('calls the media-url signer to build the view link (not a hand-built URL)', async () => {
    const docWithFile: LicenseSettingsRow = {
      ...BRANCH_LICENSE,
      objectKey: 'credentials/licenses/lic-1.pdf',
    }
    mockDocuments([docWithFile])

    let signerCalled = false
    let signerKey: string | null = null
    server.use(
      http.get('*/api/proposals/config/media-url', ({ request }) => {
        signerCalled = true
        signerKey = new URL(request.url).searchParams.get('key')
        return HttpResponse.json({ url: 'https://signed.example.com/lic-1.pdf' })
      }),
    )

    renderComp({}, 'admin')
    await screen.findByText('General Contractor License')

    await waitFor(() => expect(signerCalled).toBe(true))
    expect(signerKey).toBe('credentials/licenses/lic-1.pdf')

    const viewLink = screen.getByRole('link', { name: /view scan|view|download/i })
    expect(viewLink).toHaveAttribute('href', 'https://signed.example.com/lic-1.pdf')
  })
})

// ── AC-6: Expiry banner uses server isExpired (no client recompute) ───────────

describe('CredentialsSection — server-side isExpired only', () => {
  it('shows expiry banner given API isExpired=true even if expiryDate appears future-like', async () => {
    const serverSaysExpired = {
      ...BRANCH_LICENSE,
      expiryDate: '2099-01-01',
      isExpired: true, // server says expired despite future date
    }
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({
          licenses: [serverSaysExpired],
          certifications: [],
        }),
      ),
    )
    mockDocuments([BRANCH_LICENSE])

    renderComp({}, 'admin')

    const banner = await screen.findByTestId('credentials-expiry-banner')
    expect(banner).toBeInTheDocument()
  })

  it('does NOT show expiry banner when server isExpired=false even if expiryDate is in the past', async () => {
    const serverSaysNotExpired = {
      ...BRANCH_LICENSE,
      expiryDate: '2020-01-01',
      isExpired: false, // server says not expired despite past date
    }
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({
          licenses: [serverSaysNotExpired],
          certifications: [],
        }),
      ),
    )
    mockDocuments([BRANCH_LICENSE])

    renderComp({}, 'admin')

    await screen.findByText('General Contractor License')
    expect(screen.queryByTestId('credentials-expiry-banner')).not.toBeInTheDocument()
  })
})
