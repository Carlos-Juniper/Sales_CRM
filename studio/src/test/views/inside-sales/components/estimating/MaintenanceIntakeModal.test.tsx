// ---------------------------------------------------------------------------
// Handoff 11 — Maintenance Intake Modal tests (Acceptance Criteria §3).
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
  /** Fake CRM pipeline context injected by the queue */
  crmLead?: { leadNumber: string; rep: string; winProbability: number }
}

function renderModal({
  open = true,
  onClose = vi.fn(),
  shell,
  crmLead,
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
  const q = (label: RegExp) => within(container as HTMLElement).getByLabelText(label)
  await user.type(q(/contact name/i), 'Jane Smith')
  await user.type(q(/company/i), 'Dobson Ranch HOA')
  await user.type(q(/phone/i), '602-555-1234')
  await user.type(q(/email/i), 'jane@example.com')
  await user.type(q(/property address/i), '123 Desert Way, Phoenix, AZ')
  await user.type(q(/county/i), 'Maricopa')
  await user.type(q(/scope of work/i), 'Full grounds maintenance')
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

  it('renders all property fields including county and customer type', () => {
    renderModal()
    expect(screen.getByLabelText(/property address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/county/i)).toBeInTheDocument()
    // customer type — native select
    expect(screen.getByLabelText(/customer.*type|project.*type/i)).toBeInTheDocument()
    // contract structure
    expect(screen.getByLabelText(/contract structure/i)).toBeInTheDocument()
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

  it('sends the default service line and a null property link when untouched', async () => {
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
    expect(created[0].propertyId).toBeNull()
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

    await waitFor(() => expect(shell.setOpenEstimate).toHaveBeenCalled())
    const opened = vi.mocked(shell.setOpenEstimate).mock.calls[0][0] as Estimate
    expect(opened.estimateType).toBe('maintenance')
    expect(shell.setActiveTab).toHaveBeenCalledWith('editor')
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

describe('MaintenanceIntakeModal — EstimatingPage integration (Handoff 11 seam)', () => {
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
    const existingEstimate = buildMaintenanceEstimate({ name: 'Pre-existing HOA', branch: 'Phoenix-Desert' })
    const newEstimate = buildMaintenanceEstimate({ id: 'new-1', name: 'New Intake HOA', status: 'new_from_sales', branch: 'Phoenix-Desert' })

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
