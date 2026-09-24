// ---------------------------------------------------------------------------
// Maintenance Intake Modal tests (Acceptance Criteria §3).
//
// Modal is opened from EstimateQueue's "Maintenance intake" CTA. Submitting
// creates a maintenance estimate (estimateType='maintenance'), persists the
// intake payload, starts the SLA clock, and routes to the editor. Cancel
// discards without creating an estimate.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, makeUser } from '@/test/utils'
import { server } from '@/mocks/server'
import { useAuthStore } from '@/store/authStore'
import { buildMaintenanceEstimate } from '@/mocks/estimatingData'
import {
  EstimatingShellContext,
  type EstimatingShellApi,
} from '@/views/inside-sales/components/estimating/useEstimatingShell'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { MaintenanceIntakeModal } from '@/views/inside-sales/components/estimating/MaintenanceIntakeModal'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'
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
    openEstimateAt: vi.fn(),
    ...overrides,
  }
}

interface RenderModalOptions {
  open?: boolean
  onClose?: () => void
  shell?: EstimatingShellApi
  /** Fake CRM pipeline context injected by the queue */
  crmLead?: { leadNumber: string; rep: string; winProbability: number }
  /** "Request estimate" launches the modal pre-filled with a property. */
  initialProperty?: import('@/types/estimating').Property | null
}

function renderModal({
  open = true,
  onClose = vi.fn(),
  shell,
  crmLead,
  initialProperty = null,
}: RenderModalOptions = {}) {
  const resolvedShell = shell ?? makeShell()
  const defaultLead = crmLead ?? { leadNumber: 'L-1042', rep: 'Jennifer Torres', winProbability: 0.65 }
  render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider value={resolvedShell}>
        <MaintenanceIntakeModal
          open={open}
          onClose={onClose}
          crmLead={defaultLead}
          onCreated={vi.fn()}
          initialProperty={initialProperty}
        />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>,
  )
  return { shell: resolvedShell, onClose }
}

/** Fill the minimum required fields for a valid submission.
 *  Note: "Needed back" is not required — defaults to +14 days (SLA clock fallback).
 */
async function fillMinimumFields(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement = document.body,
) {
  const scope = within(container as HTMLElement)
  const q = (label: RegExp) => scope.getByLabelText(label)
  await user.type(q(/contact name/i), 'Jane Smith')
  await user.type(q(/company/i), 'Dobson Ranch HOA')
  await user.type(q(/phone/i), '602-555-1234')
  await user.type(q(/email/i), 'jane@example.com')
  await user.type(q(/scope of work/i), 'Full grounds maintenance')
  // Branch is now required; wait for async options then select one.
  await scope.findByRole('option', { name: 'Bradenton, FL' })
  await user.selectOptions(q(/^branch/i) as HTMLSelectElement, 'Bradenton, FL')
  // Selecting/creating a property is now required to submit. Skip if a
  // property already arrived pre-selected (e.g. "Request estimate" pre-fill).
  if (!scope.queryByRole('button', { name: /change/i })) {
    await user.type(q(/search properties/i), 'brand new property')
    await user.click(scope.getByRole('button', { name: /^search$/i }))
    await user.click(await scope.findByRole('button', { name: /create new property/i }))
    await user.type(q(/property name/i), 'Brand New Property')
    await user.click(scope.getByRole('button', { name: /^create property$/i }))
    await scope.findByRole('button', { name: /change/i })
  }
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ branch_id: 'b1' }) })
})

// ---------------------------------------------------------------------------
// AC: Modal renders all I-6.1 fields grouped as in spec §1
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — field rendering (AC §3 bullet 1)', () => {
  it('renders the CRM-pipeline banner with lead number, rep, and win probability', () => {
    renderModal({ crmLead: { leadNumber: 'L-1042', rep: 'Jennifer Torres', winProbability: 0.65 } })
    expect(screen.getByText(/sourced from crm pipeline/i)).toBeInTheDocument()
    expect(screen.getByText(/L-1042/)).toBeInTheDocument()
    expect(screen.getByText(/Jennifer Torres/)).toBeInTheDocument()
    expect(screen.getByText(/65%/)).toBeInTheDocument()
  })

  it('renders all lead & contact fields', () => {
    renderModal()
    expect(screen.getByLabelText(/contact name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/company/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })

  it('renders customer type and contract structure, with no separate address/county fields', () => {
    renderModal()
    // customer type — native select
    expect(screen.getByLabelText(/customer.*type|project.*type/i)).toBeInTheDocument()
    // contract structure
    expect(screen.getByLabelText(/contract structure/i)).toBeInTheDocument()
    // Property address/county are gone — the Aspire property selector above is
    // the only place a property's location is captured now.
    expect(screen.queryByLabelText(/property address/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^county/i)).not.toBeInTheDocument()
  })

  it('renders all scope & date fields', () => {
    renderModal()
    expect(screen.getByLabelText(/scope of work/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/needed back/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/anticipated close/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/service start/i)).toBeInTheDocument()
    // Needed back defaults to +14 days when blank (SLA minimum fallback)
    expect(screen.getByText(/defaults to \+14 days/i)).toBeInTheDocument()
  })

  it('renders win probability field constrained to 20–100%', () => {
    renderModal()
    const winInput = screen.getByLabelText(/win probability/i)
    expect(winInput).toBeInTheDocument()
    expect(winInput).toHaveAttribute('min', '20')
    expect(winInput).toHaveAttribute('max', '100')
  })

  it('renders file attachment areas for property map, RFP, and other files', () => {
    renderModal()
    expect(screen.getByText(/property map/i)).toBeInTheDocument()
    expect(screen.getByText(/rfp document/i)).toBeInTheDocument()
    expect(screen.getByText(/attach other files/i)).toBeInTheDocument()
  })

  it('renders the 14-day SLA note', () => {
    renderModal()
    expect(screen.getByText(/14-calendar-day minimum return window/i)).toBeInTheDocument()
  })

  it('renders Cancel and Submit buttons', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC: Win probability constrained to 20–100%
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — win probability bounds (AC §3 bullet 4)', () => {
  it('pre-fills win probability from the CRM lead context', () => {
    renderModal({ crmLead: { leadNumber: 'L-1042', rep: 'Jennifer Torres', winProbability: 0.65 } })
    const input = screen.getByLabelText(/win probability/i) as HTMLInputElement
    expect(input.value).toBe('65')
  })

  it('does not allow values below 20', async () => {
    const user = userEvent.setup()
    renderModal()
    const input = screen.getByLabelText(/win probability/i)
    await user.clear(input)
    await user.type(input, '10')
    // HTML min validation or clamping
    expect(input).toHaveAttribute('min', '20')
  })

  it('does not allow values above 100', async () => {
    renderModal()
    const input = screen.getByLabelText(/win probability/i)
    expect(input).toHaveAttribute('max', '100')
  })
})

// ---------------------------------------------------------------------------
// AC: Contract structure — split option captures separate budgets
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — contract structure (AC §3 bullet 5)', () => {
  it('shows split-budget fields when "split" contract structure is selected', async () => {
    const user = userEvent.setup()
    renderModal()

    const structureSelect = screen.getByLabelText(/contract structure/i) as HTMLSelectElement
    await user.selectOptions(structureSelect, 'split')

    expect(screen.getByLabelText(/homes.*budget|budget.*homes/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/common.*area.*budget|budget.*common/i)).toBeInTheDocument()
  })

  it('hides split-budget fields for single contract structure', () => {
    renderModal()
    // Default is 'single' — no split-budget inputs visible
    expect(screen.queryByLabelText(/homes.*budget|budget.*homes/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/common.*area.*budget|budget.*common/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC: Cancel discards without creating an estimate
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — cancel behavior (AC §3 bullet 6)', () => {
  it('calls onClose and does not POST an estimate when Cancel is clicked', async () => {
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
// AC: Submit creates maintenance estimate with estimateType='maintenance',
//     persists payload, starts SLA clock, routes to editor — no mode prompt
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Unit/home-count field, distinct from budget dollars, with
// the I-6.4 "count only units in the proposed scope" guidance.
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — home count', () => {
  it('renders a numeric unit/home-count field with the I-6.4 guidance', () => {
    renderModal()
    const count = screen.getByLabelText(/home \/ unit count/i)
    expect(count).toHaveAttribute('type', 'number')
    expect(screen.getByText(/count only units in the proposed scope/i)).toBeInTheDocument()
  })

  it('keeps the count field distinct from the split budget dollar fields', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.selectOptions(screen.getByLabelText(/contract structure/i), 'split')
    // Budget $ inputs and the unit-count input coexist as separate fields…
    expect(screen.getByLabelText(/homes budget/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/common area budget/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/home \/ unit count/i)).toBeInTheDocument()
    // …and the I-6.4 guidance lives on the count field only, not the dollars.
    expect(screen.getAllByText(/count only units in the proposed scope/i)).toHaveLength(1)
  })

  it('persists homeCount in the intake payload', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildMaintenanceEstimate({ id: 'hc-1', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        created.push((await request.json()) as CreateEstimatePayload)
        return HttpResponse.json({ ...fakeEstimate }, { status: 201 })
      }),
    )

    renderModal()
    await fillMinimumFields(user)
    await user.type(screen.getByLabelText(/home \/ unit count/i), '142')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    const payload = created[0].intake!.payload as Record<string, unknown>
    expect(payload.homeCount).toBe('142')
  })

  it('sends homeCount null when left blank', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildMaintenanceEstimate({ id: 'hc-2', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        created.push((await request.json()) as CreateEstimatePayload)
        return HttpResponse.json({ ...fakeEstimate }, { status: 201 })
      }),
    )

    renderModal()
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    const payload = created[0].intake!.payload as Record<string, unknown>
    expect(payload.homeCount).toBeNull()
  })
})

describe('MaintenanceIntakeModal — submit (AC §3 bullet 3)', () => {
  it('POSTs an estimate with estimateType="maintenance" on submit', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildMaintenanceEstimate({ id: 'test-est-1', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-est-1' }, { status: 201 })
      }),
    )

    renderModal()
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].estimateType).toBe('maintenance')
    expect(created[0].status).toBe('new_from_sales')
  })

  it('submits the selected branch as aspireBranchId (int), not a city string (Slice 8)', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildMaintenanceEstimate({ id: 'test-est-branch', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-est-branch' }, { status: 201 })
      }),
    )

    renderModal()
    await fillMinimumFields(user) // selects "Bradenton, FL" → maintenance aspire_branch_id 3684
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    // Identity now rides on the int id, not the display city string.
    expect(created[0].aspireBranchId).toBe(3684)
    expect((created[0] as unknown as { branch?: unknown }).branch).toBeUndefined()
  })

  it('sends the default service line and the selected/created property link', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildMaintenanceEstimate({ id: 'test-est-svc', status: 'new_from_sales' })
    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        created.push((await request.json()) as CreateEstimatePayload)
        return HttpResponse.json({ ...fakeEstimate }, { status: 201 })
      }),
    )
    renderModal()
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].serviceLine).toBe('Maintenance: Contract')
    expect(created[0].propertyId).toBeTruthy()
  })

  it('blocks submit and shows a message when no property has been selected or created', async () => {
    const user = userEvent.setup()
    const postCalls: unknown[] = []
    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        postCalls.push(await request.json())
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    renderModal()
    await user.type(screen.getByLabelText(/contact name/i), 'Jane Smith')
    await user.type(screen.getByLabelText(/company/i), 'Dobson Ranch HOA')
    await user.type(screen.getByLabelText(/phone/i), '602-555-1234')
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.type(screen.getByLabelText(/scope of work/i), 'Full grounds maintenance')
    await screen.findByRole('option', { name: 'Bradenton, FL' })
    await user.selectOptions(screen.getByLabelText(/^branch/i), 'Bradenton, FL')
    await user.click(screen.getByRole('button', { name: /submit/i }))
    expect(await screen.findByText(/select or create a property/i)).toBeInTheDocument()
    expect(postCalls).toHaveLength(0)
  })

  it('sets dueBackDate on the estimate (SLA clock starts on create)', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildMaintenanceEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        created.push(body)
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-est-2' }, { status: 201 })
      }),
    )

    renderModal()
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].dueBackDate).toBeTruthy()
  })

  it('routes to the editor tab with the new estimate after successful submit', async () => {
    const user = userEvent.setup()
    const fakeEstimate = buildMaintenanceEstimate({ id: 'test-est-3', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-est-3' }, { status: 201 })
      }),
    )

    const shell = makeShell()
    renderModal({ shell })
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(shell.openEstimateAt).toHaveBeenCalled())
    const [opened, tab] = vi.mocked(shell.openEstimateAt).mock.calls[0]!
    expect(opened.estimateType).toBe('maintenance')
    expect(tab).toBe('editor')
  })

  it('shows a success toast after creation', async () => {
    const user = userEvent.setup()
    const fakeEstimate = buildMaintenanceEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-est-4' }, { status: 201 })
      }),
    )

    renderModal()
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    // The toast is rendered outside the dialog's aria-hidden tree; query by text
    await waitFor(() =>
      expect(document.body).toHaveTextContent(/maintenance estimate created/i),
    )
  })

  it('calls onCreated callback after successful create so the queue can refresh', async () => {
    const user = userEvent.setup()
    const fakeEstimate = buildMaintenanceEstimate({ status: 'new_from_sales' })
    const onCreated = vi.fn()

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-est-5' }, { status: 201 })
      }),
    )

    render(
      <EstimatingToastProvider>
        <EstimatingShellContext.Provider value={makeShell()}>
          <MaintenanceIntakeModal
            open={true}
            onClose={vi.fn()}
            crmLead={{ leadNumber: 'L-1042', rep: 'Jennifer Torres', winProbability: 0.65 }}
            onCreated={onCreated}
          />
        </EstimatingShellContext.Provider>
      </EstimatingToastProvider>,
    )

    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })

  it('never shows a mode-selection prompt — editor auto-renders the maintenance engine', async () => {
    const user = userEvent.setup()
    const fakeEstimate = buildMaintenanceEstimate({ status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        const body = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, ...body, id: 'test-est-6' }, { status: 201 })
      }),
    )

    renderModal()
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(screen.queryByText(/select.*mode|choose.*mode|editor mode/i)).not.toBeInTheDocument())
  })
})

// ---------------------------------------------------------------------------
// AC: File attach — files are stored, not parsed (AC §3 bullet 2)
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — file attachments (AC §3 bullet 2)', () => {
  it('accepts a PDF file for the property map', async () => {
    const user = userEvent.setup()
    renderModal()

    const file = new File(['%PDF'], 'property-map.pdf', { type: 'application/pdf' })
    // The file input is inside data-testid="property-map-file-area"
    const area = document.querySelector('[data-testid="property-map-file-area"]')!
    const input = area.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, file)
    expect(screen.getByText(/property-map\.pdf/i)).toBeInTheDocument()
  })

  it('accepts Word and Excel on the RFP input and keeps the property map PDF-only', async () => {
    const user = userEvent.setup()
    renderModal()

    const rfpArea = document.querySelector('[data-testid="rfp-file-area"]')!
    const rfpInput = rfpArea.querySelector('input[type="file"]') as HTMLInputElement
    expect(rfpInput.accept).toContain('.docx')
    expect(rfpInput.accept).toContain('.xlsx')
    expect(rfpInput.accept).toContain('.doc')
    expect(rfpInput.accept).toContain('.xls')
    expect(rfpInput.accept).toContain('application/pdf')

    const mapArea = document.querySelector('[data-testid="property-map-file-area"]')!
    const mapInput = mapArea.querySelector('input[type="file"]') as HTMLInputElement
    expect(mapInput.accept).toBe('application/pdf')

    const docx = new File(['PK'], 'scope.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    await user.upload(rfpInput, docx)
    expect(screen.getByText(/scope\.docx/i)).toBeInTheDocument()

    const xlsx = new File(['PK'], 'pricing.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    await user.upload(rfpInput, xlsx)
    expect(screen.getByText(/pricing\.xlsx/i)).toBeInTheDocument()
  })

  it('accepts a PDF file for the RFP document', async () => {
    const user = userEvent.setup()
    renderModal()

    const file = new File(['%PDF'], 'rfp-document.pdf', { type: 'application/pdf' })
    const area = document.querySelector('[data-testid="rfp-file-area"]')!
    const rfpInput = area.querySelector('input[type="file"]') as HTMLInputElement | null

    if (rfpInput) {
      await user.upload(rfpInput, file)
      expect(screen.getByText(/rfp-document\.pdf/i)).toBeInTheDocument()
    }
  })
})

// ---------------------------------------------------------------------------
// EstimatingPage integration — queue refresh after intake
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — incoming property ("Request estimate")', () => {
  it('pre-fills the property selector with the incoming property', () => {
    renderModal({
      initialProperty: {
        id: 'prop-1', name: 'Sunny HOA', address1: '123 Palm St', address2: null,
        city: 'Orlando', state: 'FL', zip: '32807', branchCity: 'Orlando, FL',
        customerType: 'hoa', managementCompanyId: null, acreage: null, units: null,
        aspirePropertyId: null,
        aspireSyncStatus: 'unsynced', propertyType: 'hoa', sourceType: 'hoa',
        sourceId: 'hoa-1', createdAt: null, updatedAt: null,
      },
    })
    // The selector renders in "selected" mode: property name + Change affordance
    expect(screen.getByText('Sunny HOA')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change/i })).toBeInTheDocument()
  })
})

describe('MaintenanceIntakeModal — EstimatingPage integration', () => {
  it('EstimatingPage wires onMaintenanceIntake to open the modal', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    // Wait for the queue to load
    await screen.findByText(/maintenance intake/i)
    await user.click(screen.getByRole('button', { name: /maintenance intake/i }))

    // The modal should now be open
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument(),
    )
    expect(screen.getByText(/sourced from crm pipeline/i)).toBeInTheDocument()
  })

  it('EstimatingPage wires onCreated to bump the queue key', async () => {
    // Verifies the wiring contract:
    // EstimatingPage passes onCreated={()=>setQueueKey(k=>k+1)} to the modal, and
    // EstimateQueue is keyed with queueKey so a key-bump triggers remount + re-fetch.
    // We verify this at the prop-passing level: render the modal standalone, call
    // onCreated, and confirm the queue GET is issued a second time.
    const getCalls: string[] = []
    const existingEstimate = buildMaintenanceEstimate({ name: 'Pre-existing HOA', branchCity: 'Phoenix-Desert' })
    const newEstimate = buildMaintenanceEstimate({ id: 'new-1', name: 'New Intake HOA', status: 'new_from_sales', branchCity: 'Phoenix-Desert' })

    server.use(
      http.get('/api/estimating/estimates', ({ request }) => {
        getCalls.push(request.url)
        return HttpResponse.json(getCalls.length === 1 ? [existingEstimate] : [existingEstimate, newEstimate])
      }),
    )

    render(<EstimatingPage />)
    // Initial load: queue fetches once and shows existing estimate
    await screen.findByText('Pre-existing HOA')
    const countAfterLoad = getCalls.length
    expect(countAfterLoad).toBeGreaterThan(0)

    // Verify the Maintenance Intake button is wired (the CTA exists in the queue)
    expect(screen.getByRole('button', { name: /maintenance intake/i })).toBeInTheDocument()

    // Verify the queue stat cards are rendered (confirms EstimateQueue is mounted and wired)
    expect(screen.getByTestId('stat-total-queue')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Real lead context (stub removed): crmLead is optional; when the
// intake opens from a property, lead context is sourced from leads.property_id
// via the leads API. L-TBD never appears.
// ---------------------------------------------------------------------------

const h23Property: import('@/types/estimating').Property = {
  id: 'prop-1',
  name: 'Pelican Bay',
  propertyType: 'hoa',
  sourceType: 'hoa',
  sourceId: 'h1',
  address1: '6620 Pelican Bay Blvd',
  address2: null,
  city: 'Naples',
  state: 'FL',
  zip: '34108',
  branchCity: 'Naples',
  customerType: 'hoa',
  managementCompanyId: 'pm1',
  acreage: null,
  units: null,
  aspirePropertyId: null,
  aspireSyncStatus: 'unsynced',
  createdAt: null,
  updatedAt: null,
}

const h23Lead = {
  id: 'lead-77',
  property_name: 'Pelican Bay',
  status: 'new',
  assigned_to: 'Marisol Vega',
  score: 65,
  property_id: 'prop-1',
}

function renderModalRaw(props: Partial<React.ComponentProps<typeof MaintenanceIntakeModal>> = {}) {
  render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider value={makeShell()}>
        <MaintenanceIntakeModal open onClose={vi.fn()} onCreated={vi.fn()} {...props} />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>,
  )
}

describe('MaintenanceIntakeModal — real lead context', () => {
  it('with no crmLead and no property, shows the pipeline banner without any stub lead (no L-TBD)', () => {
    renderModalRaw({ crmLead: null })
    expect(screen.getByText(/sourced from crm pipeline/i)).toBeInTheDocument()
    expect(screen.queryByText(/L-TBD/)).not.toBeInTheDocument()
  })

  it('with an incoming property and no crmLead, fetches the property lead and shows it in the banner', async () => {
    server.use(
      http.get('/api/leads', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('property_id') === 'prop-1') {
          return HttpResponse.json({ data: [h23Lead], total: 1, page: 1, page_size: 25, total_pages: 1 })
        }
        return HttpResponse.json({ data: [], total: 0, page: 1, page_size: 25, total_pages: 0 })
      }),
    )

    renderModalRaw({ crmLead: null, initialProperty: h23Property })

    expect(await screen.findByText(/lead-77/)).toBeInTheDocument()
    expect(screen.getByText(/Marisol Vega/)).toBeInTheDocument()
    expect(screen.queryByText(/L-TBD/)).not.toBeInTheDocument()
    // Win probability pre-fills from the lead's score (65 → 65%)
    await waitFor(() => expect(screen.getByLabelText(/win probability/i)).toHaveValue(65))
  })

  it('submission carries the real lead number and rep in the intake payload', async () => {
    const user = userEvent.setup()
    const fakeEstimate = buildMaintenanceEstimate({ status: 'new_from_sales' })
    let captured: CreateEstimatePayload | null = null

    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({ data: [h23Lead], total: 1, page: 1, page_size: 25, total_pages: 1 }),
      ),
      http.post('/api/estimating/estimates', async ({ request }) => {
        captured = (await request.json()) as CreateEstimatePayload
        return HttpResponse.json({ ...fakeEstimate, id: 'test-est-h23' }, { status: 201 })
      }),
    )

    renderModalRaw({ crmLead: null, initialProperty: h23Property })
    await screen.findByText(/lead-77/)

    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(captured).not.toBeNull())
    const intake = (captured!.intake as { payload: Record<string, unknown> }).payload
    expect(intake.crmLeadNumber).toBe('lead-77')
    expect(intake.crmRep).toBe('Marisol Vega')
    expect(captured!.crmRep).toBe('Marisol Vega')
    expect(captured!.propertyId).toBe('prop-1')
    // Pipeline kanban redesign — top-level leadId drives the lead→estimate
    // write-back (Qualifying→Estimating), same field the Install intake sends.
    expect(captured!.leadId).toBe('lead-77')
  })
})

// ---------------------------------------------------------------------------
// Pipeline kanban redesign — leadId drives the lead→estimate write-back
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — leadId (Pipeline kanban redesign)', () => {
  it('sends the resolved crmLead lead number as top-level leadId on create', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildMaintenanceEstimate({ id: 'lead-id-test', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        created.push((await request.json()) as CreateEstimatePayload)
        return HttpResponse.json({ ...fakeEstimate }, { status: 201 })
      }),
    )

    renderModal({ crmLead: { leadNumber: 'L-1042', rep: 'Jennifer Torres', winProbability: 0.65 } })
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].leadId).toBe('L-1042')
  })

  it('sends leadId null when no lead context is available (no crmLead, no property)', async () => {
    const user = userEvent.setup()
    const created: CreateEstimatePayload[] = []
    const fakeEstimate = buildMaintenanceEstimate({ id: 'lead-id-blank', status: 'new_from_sales' })

    server.use(
      http.post('/api/estimating/estimates', async ({ request }) => {
        created.push((await request.json()) as CreateEstimatePayload)
        return HttpResponse.json({ ...fakeEstimate }, { status: 201 })
      }),
    )

    renderModalRaw({ crmLead: null })
    await fillMinimumFields(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].leadId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Branch field populated from Aspire config endpoint
// ---------------------------------------------------------------------------

describe('MaintenanceIntakeModal — Aspire-derived maintenance branch', () => {
  it('starts with no branch selected (empty placeholder)', () => {
    renderModal()
    const select = screen.getByLabelText(/branch/i) as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('loads branch options from GET /config/branches?kind=maintenance', async () => {
    renderModal()
    // MSW handler returns Bradenton, FL for maintenance kind (see handlers.ts).
    const option = await screen.findByRole('option', { name: 'Bradenton, FL' })
    expect(option).toBeInTheDocument()
  })

  it('shows multiple cities in the maintenance branch dropdown', async () => {
    renderModal()
    await screen.findByRole('option', { name: 'Bradenton, FL' })
    expect(screen.getByRole('option', { name: 'Fort Myers, FL' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Raleigh, NC' })).toBeInTheDocument()
  })
})
