// ---------------------------------------------------------------------------
// Slice 15b — Credentials section: insurance + licenses/certifications CRUD.
//
// ACs tested:
//   1. One section shows BOTH insurance AND licenses under a single expiry banner.
//   2. Deactivating a license calls DELETE (soft-delete); "include expired" toggle
//      re-queries with include_expired=true and the row still appears.
//   3. BM sees company-wide (aspireBranchId===null) license as read-only; branch-
//      scoped license shows controls.
//   4. Scan upload POSTs to /api/settings/licenses/:id/scan; view link is built
//      via the /api/proposals/config/media-url signer (not a hand-built URL).
//   5. Expiry banner uses the server isExpired flag (client never recomputes from
//      the date string itself).
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
import type { LicenseSettingsRow, InsuranceCert } from '@/views/settings/credentials/CredentialsSection'

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
  // NOTE: isExpired comes from the /proposals/config/licenses endpoint,
  // NOT from the /settings/licenses endpoint (which lacks isExpired).
  objectKey: null,
  active: true,
  sortOrder: 2,
  updatedAt: '2023-01-01T00:00:00Z',
}

const INSURANCE_CERT: InsuranceCert = {
  id: 'ins-1',
  objectKey: 'credentials/insurance/ins-1.pdf',
  expiryDate: '2099-12-31', // far future — non-expired
  label: 'General Liability',
  uploadedAt: '2024-01-15T10:00:00Z',
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

function mockLicenses(licenses: LicenseSettingsRow[], certifications: LicenseSettingsRow[] = []) {
  server.use(
    http.get('*/api/settings/licenses', () =>
      HttpResponse.json([...licenses, ...certifications]),
    ),
  )
}

function mockInsurance(certs: InsuranceCert[]) {
  server.use(
    http.get('*/api/settings/insurance', () =>
      HttpResponse.json(certs),
    ),
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ role: 'manager' }) })
  // Default: empty lists so tests that don't care about content still load
  mockLicenses([])
  mockInsurance([])
})

// ── AC-1: One section, one banner covering both insurance and licenses ─────────

describe('CredentialsSection — unified section with shared expiry banner', () => {
  it('renders both insurance and license subsections in a single section', async () => {
    mockLicenses([BRANCH_LICENSE])
    mockInsurance([INSURANCE_CERT])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )

    renderComp({}, 'admin')

    // Both sub-areas appear under a single credentials wrapper
    expect(await screen.findByTestId('settings-section-credentials')).toBeInTheDocument()
    // Insurance area
    expect(screen.getByTestId('credentials-insurance-area')).toBeInTheDocument()
    // Licenses area
    expect(screen.getByTestId('credentials-licenses-area')).toBeInTheDocument()
    // License data visible (async — wait for fetch)
    expect(await screen.findByText('General Contractor License')).toBeInTheDocument()
  })

  it('shows a single expiry-warning banner when a license row has isExpired=true from the API', async () => {
    // The /proposals/config/licenses endpoint returns isExpired.
    // We stub that endpoint for the banner check (banner uses the proposals endpoint).
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({
          licenses: [{ ...EXPIRED_LICENSE, isExpired: true }],
          certifications: [],
        }),
      ),
    )
    mockInsurance([])
    mockLicenses([EXPIRED_LICENSE])

    renderComp({}, 'admin')

    // Wait for the banner to appear
    const banner = await screen.findByTestId('credentials-expiry-banner')
    expect(banner).toBeInTheDocument()
    // Only ONE banner element exists covering the whole section
    const banners = screen.getAllByTestId('credentials-expiry-banner')
    expect(banners).toHaveLength(1)
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
    mockInsurance([INSURANCE_CERT])
    mockLicenses([BRANCH_LICENSE])

    renderComp({}, 'admin')

    await screen.findByText('General Contractor License')
    // No banner when nothing is expired
    expect(screen.queryByTestId('credentials-expiry-banner')).not.toBeInTheDocument()
  })

  it('shows expiry banner when insurance expiryDate is in the past (server-flagged via isExpired on license list)', async () => {
    // Insurance expiry is surfaced through the insurance list + the banner.
    // We flag an insurance cert as expired by having a past expiryDate; the
    // banner logic checks expiryDate server value, not recomputes.
    const expiredInsurance: InsuranceCert = {
      ...INSURANCE_CERT,
      expiryDate: '2020-01-01', // past date — component reads this field verbatim
    }
    mockInsurance([expiredInsurance])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )
    mockLicenses([])

    renderComp({}, 'admin')

    const banner = await screen.findByTestId('credentials-expiry-banner')
    expect(banner).toBeInTheDocument()
  })
})

// ── AC-2: Deactivate (soft-delete) + include-expired toggle ──────────────────

describe('CredentialsSection — deactivate and include-expired toggle', () => {
  it('fires DELETE /api/settings/licenses/:id on deactivate', async () => {
    mockLicenses([BRANCH_LICENSE])
    mockInsurance([])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [{ ...BRANCH_LICENSE, isExpired: false }], certifications: [] }),
      ),
    )

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
    mockInsurance([])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )

    let capturedUrl: string | null = null
    server.use(
      http.get('*/api/settings/licenses', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json([EXPIRED_LICENSE])
      }),
    )

    renderComp({}, 'admin')

    // Wait for initial load
    await waitFor(() => expect(capturedUrl).not.toBeNull())
    capturedUrl = null // reset to capture the toggled call

    // Toggle "include expired"
    const toggle = await screen.findByRole('checkbox', { name: /include.*expired|show.*inactive/i })
    fireEvent.click(toggle)

    await waitFor(() => expect(capturedUrl).toContain('include_expired=true'))
  })

  it('still shows an expired row when include-expired is on', async () => {
    mockInsurance([])
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

    // The expired row now appears
    expect(await screen.findByText('Irrigation Certification')).toBeInTheDocument()
  })
})

// ── AC-3: BM read-only for company-wide rows ──────────────────────────────────

describe('CredentialsSection — BM read-only for company-wide licenses', () => {
  it('BM sees company-wide license as read-only (no deactivate control)', async () => {
    mockInsurance([])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )
    mockLicenses([COMPANY_LICENSE]) // aspireBranchId === null

    renderComp({ aspireBranchId: BRANCH_ID }, 'manager')

    await screen.findByText('Pesticide Applicator')

    // The read-only badge should be present
    expect(screen.getByTestId('license-lic-2-readonly')).toBeInTheDocument()
    // No deactivate button next to the company-wide row — the controls are absent
    const deactivateButtons = screen.queryAllByRole('button', { name: /deactivate/i })
    expect(deactivateButtons).toHaveLength(0)
  })

  it('BM can edit a branch-scoped license (has deactivate control)', async () => {
    mockInsurance([])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )
    mockLicenses([BRANCH_LICENSE]) // aspireBranchId === BRANCH_ID

    renderComp({ aspireBranchId: BRANCH_ID }, 'manager')

    await screen.findByText('General Contractor License')

    // Branch-scoped row: NO read-only badge, HAS deactivate button
    expect(screen.queryByTestId('license-lic-1-readonly')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument()
  })

  it('admin can edit company-wide licenses (no read-only restriction)', async () => {
    mockInsurance([])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )
    mockLicenses([COMPANY_LICENSE])

    renderComp({ aspireBranchId: BRANCH_ID }, 'admin')

    await screen.findByText('Pesticide Applicator')

    // Admin sees no readonly badge and sees controls
    expect(screen.queryByTestId('license-lic-2-readonly')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument()
  })
})

// ── AC-4: Scan upload → media-url signer ──────────────────────────────────────

describe('CredentialsSection — scan upload and media-url signer', () => {
  it('POSTs to /api/settings/licenses/:id/scan on upload', async () => {
    const licenseWithNoScan: LicenseSettingsRow = { ...BRANCH_LICENSE, objectKey: null }
    mockLicenses([licenseWithNoScan])
    mockInsurance([])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )

    let uploadedToId: string | null = null
    server.use(
      http.post('*/api/settings/licenses/:id/scan', ({ params }) => {
        uploadedToId = params.id as string
        return HttpResponse.json({ id: params.id, objectKey: `credentials/licenses/${params.id}.pdf` })
      }),
    )

    renderComp({}, 'admin')
    await screen.findByText('General Contractor License')

    // Find and trigger the upload input
    const uploadInput = screen.getByTestId('license-lic-1-scan-upload')
    const file = new File(['pdf content'], 'scan.pdf', { type: 'application/pdf' })
    fireEvent.change(uploadInput, { target: { files: [file] } })

    await waitFor(() => expect(uploadedToId).toBe('lic-1'))
  })

  it('calls the media-url signer to build the view link (not a hand-built URL)', async () => {
    const licenseWithScan: LicenseSettingsRow = {
      ...BRANCH_LICENSE,
      objectKey: 'credentials/licenses/lic-1.pdf',
    }
    mockLicenses([licenseWithScan])
    mockInsurance([])
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({ licenses: [], certifications: [] }),
      ),
    )

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

    // The view link should appear and trigger the signer
    await waitFor(() => expect(signerCalled).toBe(true))
    expect(signerKey).toBe('credentials/licenses/lic-1.pdf')

    // The rendered href uses the signed URL
    const viewLink = screen.getByRole('link', { name: /view scan|view|download/i })
    expect(viewLink).toHaveAttribute('href', 'https://signed.example.com/lic-1.pdf')
  })
})

// ── AC-5: Expiry banner uses server isExpired (no client recompute) ───────────

describe('CredentialsSection — server-side isExpired only', () => {
  it('shows expiry banner given API isExpired=true even if expiryDate appears future-like', async () => {
    // The date itself is technically in the future but the server says expired.
    // The component must trust the server's isExpired flag, not recompute.
    const serverSaysExpired = {
      ...BRANCH_LICENSE,
      expiryDate: '2099-01-01', // would look non-expired if client recomputed
      isExpired: true,           // but server says expired
    }
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({
          licenses: [serverSaysExpired],
          certifications: [],
        }),
      ),
    )
    mockInsurance([])
    mockLicenses([BRANCH_LICENSE])

    renderComp({}, 'admin')

    // Banner must appear because the server said isExpired=true
    const banner = await screen.findByTestId('credentials-expiry-banner')
    expect(banner).toBeInTheDocument()
  })

  it('does NOT show expiry banner when server isExpired=false even if expiryDate is in the past', async () => {
    // Simulate a grace period or future-dating edge case where server says not expired.
    const serverSaysNotExpired = {
      ...BRANCH_LICENSE,
      expiryDate: '2020-01-01', // past date
      isExpired: false,          // but server says not expired
    }
    server.use(
      http.get('*/api/proposals/config/licenses', () =>
        HttpResponse.json({
          licenses: [serverSaysNotExpired],
          certifications: [],
        }),
      ),
    )
    mockInsurance([])
    mockLicenses([BRANCH_LICENSE])

    renderComp({}, 'admin')

    await screen.findByText('General Contractor License')
    // No banner because server said isExpired=false
    expect(screen.queryByTestId('credentials-expiry-banner')).not.toBeInTheDocument()
  })
})
