// ---------------------------------------------------------------------------
// Handoff 12 — Install Proposal Request Modal tests (Acceptance Criteria §3).
//
// Opened from EstimateQueue's "Install intake" CTA. Submitting creates an
// install estimate (estimateType='install', status='new_from_sales'), starts
// the SLA clock, and routes to the editor. Save Draft persists without
// submitting. Duplicate/New client/Bond checkboxes persist.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, makeUser } from '@/test/utils'
import { server } from '@/mocks/server'
import { useAuthStore } from '@/store/authStore'
import { buildInstallEstimate } from '@/mocks/estimatingData'
import {
  EstimatingShellContext,
  type EstimatingShellApi,
} from '@/views/inside-sales/components/estimating/useEstimatingShell'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { InstallIntakeModal } from '@/views/inside-sales/components/estimating/InstallIntakeModal'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'
import type { Estimate } from '@/types/estimating'
import type { CreateEstimatePayload } from '@/api/estimating'

// jsdom stubs for Radix Dialog
window.HTMLElement.prototype.hasPointerCapture = vi.fn()
window.HTMLElement.prototype.releasePointerCapture = vi.fn()
window.HTMLElement.prototype.scrollIntoView = vi.fn()

// ----- Helpers ---------------------------------------------------------------

function makeShell(overrides?: Partial<EstimatingShellApi>): EstimatingShellApi {
  return {
    activeTab: 'queue',
    setActiveTab: vi.fn(),
    openEstimate: null,
    setOpenEstimate: vi.fn(),
    ...overrides,
  }
}

interface RenderModalOptions {
  open?: boolean
  onClose?: () => void
  shell?: EstimatingShellApi
}

function renderModal({ open = true, onClose = vi.fn(), shell }: RenderModalOptions = {}) {
  const resolvedShell = shell ?? makeShell()
  render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider value={resolvedShell}>
        <InstallIntakeModal open={open} onClose={onClose} onCreated={vi.fn()} />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>,
  )
  return { shell: resolvedShell, onClose }
}

/** Fill the minimum required fields for a valid submission (fast path using fireEvent). */
function fillMinimumFieldsFast() {
  // Requestor section — use exact label text to avoid ambiguity with client fields
  fireEvent.change(screen.getByLabelText(/^requested by/i), { target: { value: 'Alex Reyes' } })
  fireEvent.change(screen.getByLabelText(/^phone \*/i), { target: { value: '602-555-9000' } })
  fireEvent.change(screen.getByLabelText(/^email \*/i), { target: { value: 'areyes@juniper.com' } })
  // Opportunity section
  fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: 'Greenfield Estate Install' } })
  // Property section
  fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: 'Greenfield Estate' } })
  fireEvent.change(screen.getByLabelText(/^address \*/i), { target: { value: '500 Desert Vista Dr' } })
  fireEvent.change(screen.getByLabelText(/^city \*/i), { target: { value: 'Scottsdale' } })
  fireEvent.change(screen.getByLabelText(/^state \*/i), { target: { value: 'AZ' } })
  fireEvent.change(screen.getByLabelText(/^zip \*/i), { target: { value: '85251' } })
  // Client section
  fireEvent.change(screen.getByLabelText(/^company \*/i), { target: { value: 'Greenfield Development LLC' } })
  fireEvent.change(screen.getByLabelText(/contact person/i), { target: { value: 'Morgan Pierce' } })
}

/** Wait for async branch options to appear then select one — required before submit (Handoff 28). */
async function selectInstallBranch() {
  await screen.findByRole('option', { name: 'Bradenton, FL' })
  fireEvent.change(screen.getByLabelText(/install branch/i), { target: { value: 'Bradenton, FL' } })
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ branch_id: 'b1' }) })
})

// ---------------------------------------------------------------------------
// AC §3 bullet 1 — All sections render as editable inputs
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — field rendering (AC §3 bullet 1)', () => {
  it('renders the Sales-authored banner', () => {
    renderModal()
    expect(screen.getByText(/sales-authored/i)).toBeInTheDocument()
    expect(screen.getByText(/estimating queue/i)).toBeInTheDocument()
  })

  it('renders the Requestor section fields', () => {
    renderModal()
    expect(screen.getByLabelText(/lead id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^requested by/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/install branch/i)).toBeInTheDocument()
    // "Phone *" in requestor; "Client phone number" in client — use specific pattern
    expect(screen.getByLabelText(/^phone \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^email \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/request date/i)).toBeInTheDocument()
  })

  it('renders the Requestor section checkboxes: New client, Bond required, Duplicate', () => {
    renderModal()
    expect(screen.getByLabelText(/new client/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/bond required/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/duplicate/i)).toBeInTheDocument()
  })

  it('renders the Dates & Probability section', () => {
    renderModal()
    expect(screen.getByLabelText(/internal deadline/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/client deadline/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/anticipated close/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/win probability/i)).toBeInTheDocument()
  })

  it('renders win probability constrained to 20–100%', () => {
    renderModal()
    const winInput = screen.getByLabelText(/win probability/i)
    expect(winInput).toHaveAttribute('min', '20')
    expect(winInput).toHaveAttribute('max', '100')
  })

  it('renders the SLA note with calendar day count', () => {
    renderModal()
    expect(screen.getByText(/14-calendar-day sla/i)).toBeInTheDocument()
  })

  it('renders the Opportunity section fields', () => {
    renderModal()
    expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/estimated value/i)).toBeInTheDocument()
    // Industry dropdown (native select)
    expect(screen.getByLabelText(/industry/i)).toBeInTheDocument()
  })

  it('renders all four industry options: Commercial, Government, Land residential, Home residential', () => {
    renderModal()
    const select = screen.getByLabelText(/industry/i) as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.text)
    expect(options).toContain('Commercial')
    expect(options).toContain('Government')
    expect(options).toContain('Land residential')
    expect(options).toContain('Home residential')
  })

  it('renders all five service type checkboxes', () => {
    renderModal()
    expect(screen.getByLabelText(/landscape install/i)).toBeInTheDocument()
    // Use queryAllByLabelText — "Irrigation" service type checkbox may share label text with "Irrigation plan provided"
    const irrCheckboxes = screen.getAllByLabelText(/^irrigation$/i)
    expect(irrCheckboxes.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText(/^hardscape$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/grading.*drainage|drainage.*grading/i)).toBeInTheDocument()
    // "Lighting" service type checkbox
    expect(screen.getAllByLabelText(/^lighting$/i).length).toBeGreaterThanOrEqual(1)
  })

  it('renders the Property section fields', () => {
    renderModal()
    expect(screen.getByLabelText(/property name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/acreage/i)).toBeInTheDocument()
    // "Address *" in property; "Client mailing address" in client
    expect(screen.getByLabelText(/^address \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^city \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^state \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^zip \*/i)).toBeInTheDocument()
  })

  it('renders the Client section fields', () => {
    renderModal()
    expect(screen.getByLabelText(/^company \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/contact person/i)).toBeInTheDocument()
  })

  it('renders the Landscape scope section', () => {
    renderModal()
    // heading
    expect(screen.getByText(/landscape scope/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/planting beds/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/trees \(count\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/shrubs.*groundcover|groundcover.*shrubs/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/sod.*turf|turf.*sod/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/mulch.*dg|dg.*mulch/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/hardscape area|hardscape.*sf/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/grading.*cut-fill|cut-fill/i)).toBeInTheDocument()
  })

  it('renders the Irrigation scope section', () => {
    renderModal()
    expect(screen.getByText(/irrigation scope/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/zones/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/controller type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/water source/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/static pressure/i)).toBeInTheDocument()
  })

  it('renders the RFI status section as a first-class field', () => {
    renderModal()
    // Both the section heading ("RFI Tracking") and the label ("RFI status") should be present
    expect(screen.getByText(/rfi tracking/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/rfi status/i)).toBeInTheDocument()
  })

  it('renders attachment areas: property map, RFP, and other files', () => {
    renderModal()
    expect(screen.getByText(/property map/i)).toBeInTheDocument()
    expect(screen.getByText(/rfp document/i)).toBeInTheDocument()
    expect(screen.getByText(/attach other files/i)).toBeInTheDocument()
  })

  it('renders Send to Estimating and Save Draft buttons', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /send to estimating/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Handoff 28 — Branch field populated from Aspire config endpoint
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — Aspire-derived install branch (Handoff 28)', () => {
  it('starts with no branch selected (empty placeholder)', () => {
    renderModal()
    const select = screen.getByLabelText(/install branch/i) as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('loads branch options from GET /config/branches?kind=install', async () => {
    renderModal()
    // MSW handler returns Bradenton, FL for install kind (see handlers.ts).
    const option = await screen.findByRole('option', { name: 'Bradenton, FL' })
    expect(option).toBeInTheDocument()
  })

  it('does NOT include fallback-only cities (like Bonita Springs, FL) in the install list', async () => {
    renderModal()
    // The default mock only returns the cities it's configured with.
    await screen.findByRole('option', { name: 'Bradenton, FL' })
    expect(screen.queryByRole('option', { name: 'Bonita Springs, FL' })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC §3 bullet 6 — Duplicate/New client/Bond checkboxes persist
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — Requestor checkboxes (AC §3 bullet 6)', () => {
  it('toggles Duplicate checkbox and keeps state', async () => {
    const user = userEvent.setup()
    renderModal()
    const dup = screen.getByLabelText(/duplicate/i) as HTMLInputElement
    expect(dup.checked).toBe(false)
    await user.click(dup)
    expect(dup.checked).toBe(true)
  })

  it('toggles New client checkbox', async () => {
    const user = userEvent.setup()
    renderModal()
    const nc = screen.getByLabelText(/new client/i) as HTMLInputElement
    expect(nc.checked).toBe(false)
    await user.click(nc)
    expect(nc.checked).toBe(true)
  })

  it('toggles Bond required checkbox', async () => {
    const user = userEvent.setup()
    renderModal()
    const bond = screen.getByLabelText(/bond required/i) as HTMLInputElement
    expect(bond.checked).toBe(false)
    await user.click(bond)
    expect(bond.checked).toBe(true)
  })

  it('sends duplicate=true in payload when Duplicate checkbox is checked', async () => {
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ id: 'dup-test', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'dup-test' }, { status: 201 })
      }),
    )

    renderModal()
    fireEvent.click(screen.getByLabelText(/duplicate/i))
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    const payload = created[0].intake!.payload as Record<string, unknown>
    expect(payload.isDuplicate).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC §3 bullet 2 — RFI status is a first-class tracked field
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — RFI status (AC §3 bullet 2)', () => {
  it('captures RFI status in the submitted payload', async () => {
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'rfi-test' }, { status: 201 })
      }),
    )

    renderModal()
    fireEvent.change(screen.getByLabelText(/rfi status/i), {
      target: { value: 'Awaiting GC response on storm drain details' },
    })
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    const payload = created[0].intake!.payload as Record<string, unknown>
    expect(payload.rfiStatus).toBe('Awaiting GC response on storm drain details')
  })

  it('sends rfiStatus as a first-class tracked field on the create payload (Handoff 24 §3.2)', async () => {
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'rfi-first-class' }, { status: 201 })
      }),
    )

    renderModal()
    fireEvent.change(screen.getByLabelText(/rfi status/i), {
      target: { value: 'Awaiting GC response on storm drain details' },
    })
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    // First-class field on the estimate row — not just free text inside the payload.
    expect(created[0].rfiStatus).toBe('Awaiting GC response on storm drain details')
  })

  it('sends rfiStatus null when the field is left blank', async () => {
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'rfi-blank' }, { status: 201 })
      }),
    )

    renderModal()
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].rfiStatus).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC §3 bullet 3 — PDF attachments persist to attachments (no parsing)
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — file attachments (AC §3 bullet 3)', () => {
  it('accepts a PDF for the property map and displays its name', async () => {
    const user = userEvent.setup()
    renderModal()

    const file = new File(['%PDF'], 'site-plan.pdf', { type: 'application/pdf' })
    const area = document.querySelector('[data-testid="install-property-map-file-area"]')!
    const input = area.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    expect(screen.getByText(/site-plan\.pdf/i)).toBeInTheDocument()
  })

  it('accepts a PDF for the RFP document', async () => {
    const user = userEvent.setup()
    renderModal()

    const file = new File(['%PDF'], 'rfp-greenfield.pdf', { type: 'application/pdf' })
    const area = document.querySelector('[data-testid="install-rfp-file-area"]')!
    const input = area.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    expect(screen.getByText(/rfp-greenfield\.pdf/i)).toBeInTheDocument()
  })

  it('includes attachment filename snapshot in the submitted payload', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'attach-test' }, { status: 201 })
      }),
      // Presign endpoint — called after create for the actual upload.
      http.post('/api/estimating/estimates/:id/attachments/presign', () =>
        HttpResponse.json(
          { attachmentId: 'att-1', objectKey: 'estimating/attach-test/att-1.pdf', uploadUrl: 'http://localhost/__mock_gcs_upload/sess-1' },
          { status: 201 },
        ),
      ),
      http.put('http://localhost/__mock_gcs_upload/sess-1', () => new HttpResponse(null, { status: 200 })),
      http.post('/api/estimating/estimates/:id/attachments/:aid/confirm', () =>
        HttpResponse.json({ id: 'att-1', status: 'stored', downloadable: true }),
      ),
    )

    renderModal()
    const file = new File(['%PDF'], 'property-plan.pdf', { type: 'application/pdf' })
    const area = document.querySelector('[data-testid="install-property-map-file-area"]')!
    const input = area.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    const payload = created[0].intake!.payload as { attachments: { propertyMap: string } }
    // Filename snapshot is preserved in the intake payload JSON for human reference.
    expect(payload.attachments.propertyMap).toBe('property-plan.pdf')
    // The structured intake.attachments array is no longer sent in the create payload —
    // real uploads happen via presign/confirm after estimate creation.
    expect(created[0].intake?.attachments).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// AC §3 bullet 4 — "Send to Estimating" creates install estimate
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — Send to Estimating (AC §3 bullet 4)', () => {
  it('POSTs an estimate with estimateType="install" on submit', async () => {
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ id: 'test-install-1', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-install-1' }, { status: 201 })
      }),
    )

    renderModal()
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].estimateType).toBe('install')
    expect(created[0].status).toBe('new_from_sales')
  })

  it('sets dueBackDate (SLA clock starts on create)', async () => {
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-install-2' }, { status: 201 })
      }),
    )

    renderModal()
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].dueBackDate).toBeTruthy()
  })

  it('routes to the editor tab after successful submit (install engine, no mode prompt)', async () => {
    const fakeEstimate = buildInstallEstimate({ id: 'test-install-3', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-install-3' }, { status: 201 })
      }),
    )

    const shell = makeShell()
    renderModal({ shell })
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(shell.setOpenEstimate).toHaveBeenCalled())
    const opened = vi.mocked(shell.setOpenEstimate).mock.calls[0][0] as Estimate
    expect(opened.estimateType).toBe('install')
    expect(shell.setActiveTab).toHaveBeenCalledWith('editor')
    // No mode prompt
    expect(screen.queryByText(/select.*mode|choose.*mode|editor mode/i)).not.toBeInTheDocument()
  })

  it('shows a success toast: "Install request sent to Estimating"', async () => {
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-install-4' }, { status: 201 })
      }),
    )

    renderModal()
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() =>
      expect(document.body).toHaveTextContent(/install request sent to estimating/i),
    )
  })

  it('calls onCreated callback so the queue can refresh', async () => {
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })
    const onCreated = vi.fn()

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-install-5' }, { status: 201 })
      }),
    )

    const shell = makeShell()
    render(
      <EstimatingToastProvider>
        <EstimatingShellContext.Provider value={shell}>
          <InstallIntakeModal open={true} onClose={vi.fn()} onCreated={onCreated} />
        </EstimatingShellContext.Provider>
      </EstimatingToastProvider>,
    )
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })
})

// ---------------------------------------------------------------------------
// Pipeline kanban redesign — leadId drives the lead→estimate write-back
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — leadId (Pipeline kanban redesign)', () => {
  it('sends the Lead ID field as a top-level leadId on the create payload', async () => {
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'lead-id-test' }, { status: 201 })
      }),
    )

    renderModal()
    fireEvent.change(screen.getByLabelText(/lead id/i), { target: { value: 'lead-123' } })
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].leadId).toBe('lead-123')
  })

  it('sends leadId null when the field is left blank', async () => {
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'lead-id-blank' }, { status: 201 })
      }),
    )

    renderModal()
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].leadId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC §3 bullet 5 — "Save draft" persists without submitting
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — Save Draft (AC §3 bullet 5)', () => {
  it('does NOT POST an estimate when Save Draft is clicked', async () => {
    const user = userEvent.setup()
    const postCalls: unknown[] = []
    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        postCalls.push(await request.json())
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    renderModal()
    await user.click(screen.getByRole('button', { name: /save draft/i }))

    // Give async handlers a chance to run
    await new Promise((r) => setTimeout(r, 50))
    expect(postCalls).toHaveLength(0)
  })

  it('shows a "Draft saved" confirmation after Save Draft', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('button', { name: /save draft/i }))
    await waitFor(() =>
      expect(document.body).toHaveTextContent(/draft saved/i),
    )
  })
})

// ---------------------------------------------------------------------------
// Handoff 24 §3.3 — Save draft persists to the BACKEND (device-independent);
// replaces the old localStorage path. A draft never creates an estimate and
// never triggers an Aspire push.
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — backend Save Draft (Handoff 24 §3.3)', () => {
  it('POSTs the draft to /api/estimating/intake/drafts, not to localStorage', async () => {
    const user = userEvent.setup()
    const draftPosts: Array<Record<string, unknown>> = []
    const estimatePosts: unknown[] = []
    server.use(
      http.get('/api/estimating/intake/drafts', () => HttpResponse.json([])),
      http.post('/api/estimating/intake/drafts', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        draftPosts.push(body)
        return HttpResponse.json(
          {
            id: 'draft-1',
            estimateType: 'install',
            payload: body.payload,
            submittedBy: 'u1',
            isDraft: true,
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        )
      }),
      http.post('/api/estimating/estimates', async ({ request }) => {
        estimatePosts.push(await request.json())
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    renderModal()
    fireEvent.change(screen.getByLabelText(/opportunity name/i), {
      target: { value: 'Draft Opportunity' },
    })
    await user.click(screen.getByRole('button', { name: /save draft/i }))

    await waitFor(() => expect(draftPosts).toHaveLength(1))
    expect(draftPosts[0].estimateType).toBe('install')
    expect((draftPosts[0].payload as Record<string, unknown>).opportunityName).toBe(
      'Draft Opportunity',
    )
    // No estimate is created for a draft, and nothing lands in localStorage.
    expect(estimatePosts).toHaveLength(0)
    expect(localStorage.getItem('install-intake-draft')).toBeNull()
  })

  it('restores the latest backend draft when the modal opens (resume on another device)', async () => {
    server.use(
      http.get('/api/estimating/intake/drafts', () =>
        HttpResponse.json([
          {
            id: 'draft-9',
            estimateType: 'install',
            payload: { opportunityName: 'Resumed From Other Device' },
            submittedBy: 'u1',
            isDraft: true,
            createdAt: '2026-08-01T10:00:00Z',
          },
        ]),
      ),
    )

    renderModal()
    await waitFor(() =>
      expect(screen.getByLabelText(/opportunity name/i)).toHaveValue(
        'Resumed From Other Device',
      ),
    )
  })

  it('updates the same backend draft on subsequent saves (sends draftId)', async () => {
    const user = userEvent.setup()
    const draftPosts: Array<Record<string, unknown>> = []
    server.use(
      http.get('/api/estimating/intake/drafts', () => HttpResponse.json([])),
      http.post('/api/estimating/intake/drafts', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        draftPosts.push(body)
        return HttpResponse.json(
          {
            id: 'draft-1',
            estimateType: 'install',
            payload: body.payload,
            submittedBy: 'u1',
            isDraft: true,
            createdAt: new Date().toISOString(),
          },
          { status: draftPosts.length > 1 ? 200 : 201 },
        )
      }),
    )

    renderModal()
    await user.click(screen.getByRole('button', { name: /save draft/i }))
    await waitFor(() => expect(draftPosts).toHaveLength(1))
    expect(draftPosts[0].draftId).toBeUndefined()

    await user.click(screen.getByRole('button', { name: /save draft/i }))
    await waitFor(() => expect(draftPosts).toHaveLength(2))
    expect(draftPosts[1].draftId).toBe('draft-1')
  })

  it('deletes the backend draft after a successful submit', async () => {
    const deleted: string[] = []
    const fakeEstimate = buildInstallEstimate({ status: 'new_from_sales' })
    server.use(
      http.get('/api/estimating/intake/drafts', () =>
        HttpResponse.json([
          {
            id: 'draft-9',
            estimateType: 'install',
            payload: { opportunityName: 'Draft To Submit' },
            submittedBy: 'u1',
            isDraft: true,
            createdAt: '2026-08-01T10:00:00Z',
          },
        ]),
      ),
      http.delete('/api/estimating/intake/drafts/:id', ({ params }) => {
        deleted.push(String(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'draft-submit' }, { status: 201 })
      }),
    )

    renderModal()
    // Wait for the draft to be adopted (draftId bound) before submitting.
    await waitFor(() =>
      expect(screen.getByLabelText(/opportunity name/i)).toHaveValue('Draft To Submit'),
    )
    fillMinimumFieldsFast()
    await selectInstallBranch()
    fireEvent.click(screen.getByRole('button', { name: /send to estimating/i }))

    await waitFor(() => expect(deleted).toEqual(['draft-9']))
  })
})

// ---------------------------------------------------------------------------
// Cancel behavior
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — cancel behavior', () => {
  it('calls onClose and does not POST when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const postCalls: unknown[] = []
    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        postCalls.push(await request.json())
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    const onClose = vi.fn()
    renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(postCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// EstimatingPage integration — onInstallIntake wiring
// ---------------------------------------------------------------------------

describe('InstallIntakeModal — EstimatingPage integration (Handoff 12 seam)', () => {
  it('EstimatingPage wires onInstallIntake to open the Install modal', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await screen.findByText(/install intake/i)
    await user.click(screen.getByRole('button', { name: /install intake/i }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText(/sales-authored/i)).toBeInTheDocument()
  })
})
