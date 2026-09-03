// ---------------------------------------------------------------------------
// Takeoff Insert (maintenance-only).
//
// Estimating's ONLY maintenance output to the CRM (the salesperson, a person)
// is a takeoff insert: the scanned property boundary image + acreage stats.
// Never a proposal, quote document, or pricing letter.
//
// The tab is durable:
//   * the uploaded scan persists via the real GCS attachment flow
//     (presign → PUT → confirm) as an estimate-scoped `takeoff_scan`
//     attachment that survives reload;
//   * turf area & curb miles are manual, editable (blue-cell convention)
//     and persist on the estimate. Beam AI automated takeoff is the future
//     source (paused) — acreage & sqft stay derived from sections.
//
// Rendered through EstimatingPage via the `initialOpenEstimate` test seam so
// shell context (tabs, toast) matches production wiring.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import {
  buildMaintenanceEstimate,
  mockEstimatesV2,
} from '@/mocks/estimatingData'
import type { MaintenanceEstimate } from '@/types/estimating'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'

function seedUser() {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
}

// jsdom implements neither createObjectURL nor revokeObjectURL.
const createObjectURL = vi.fn(() => 'blob:mock-scan')
const revokeObjectURL = vi.fn()

// jsdom has no real XHR upload; stub the presigned GCS PUT (MSW handles the
// fetch-based presign/confirm around it).
function stubXhr({ networkError = false }: { networkError?: boolean } = {}) {
  function MockXHR(this: {
    open: () => void
    setRequestHeader: () => void
    send: (body: unknown) => void
    upload: { onprogress: ((e: ProgressEvent) => void) | null }
    onload: (() => void) | null
    onerror: (() => void) | null
    status: number
  }) {
    this.open = vi.fn()
    this.setRequestHeader = vi.fn()
    this.upload = { onprogress: null }
    this.onload = null
    this.onerror = null
    this.status = 200
    this.send = () => {
      Promise.resolve().then(() => {
        if (networkError) this.onerror?.()
        else this.onload?.()
      })
    }
  }
  vi.stubGlobal('XMLHttpRequest', MockXHR)
}

async function openTakeoffTab(estimate: MaintenanceEstimate | null) {
  const user = userEvent.setup()
  const view = render(<EstimatingPage initialOpenEstimate={estimate} />)
  await user.click(screen.getByRole('tab', { name: 'Takeoff Insert' }))
  return { user, view }
}

/** The MSW-seeded maintenance estimate — persistence endpoints know its id. */
function seededMaintenance(): MaintenanceEstimate {
  const seeded = mockEstimatesV2[0] as MaintenanceEstimate
  expect(seeded.estimateType).toBe('maintenance')
  return seeded
}

beforeEach(() => {
  seedUser()
  stubXhr()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

describe('TakeoffInsert — maintenance-only visibility', () => {
  it('renders the insert for an open maintenance estimate', async () => {
    await openTakeoffTab(buildMaintenanceEstimate())
    expect(screen.getByRole('heading', { name: 'Takeoff insert' })).toBeInTheDocument()
    expect(
      screen.getByText(/Estimating's only output to the CRM — the scanned property image \+ acreage/i),
    ).toBeInTheDocument()
  })

  it('shows an open-an-estimate empty state when no estimate is open', async () => {
    await openTakeoffTab(null)
    expect(screen.queryByRole('heading', { name: 'Takeoff insert' })).not.toBeInTheDocument()
    expect(screen.getByText(/open a maintenance estimate/i)).toBeInTheDocument()
  })
})

describe('TakeoffInsert — scanned map card', () => {
  it('shows a graceful placeholder when no scan is uploaded', async () => {
    await openTakeoffTab(buildMaintenanceEstimate())
    expect(screen.getByText('Scanned property boundary map')).toBeInTheDocument()
    expect(screen.getByText(/Manually drawn & QA'd by estimator/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /scanned property boundary map/i })).not.toBeInTheDocument()
  })

  it('always shows the "Estimator QA\'d — human interpreted" badge', async () => {
    await openTakeoffTab(buildMaintenanceEstimate())
    expect(screen.getByText("Estimator QA'd — human interpreted")).toBeInTheDocument()
  })
})

describe('TakeoffInsert — scan persistence', () => {
  it('uploading a scan previews it immediately and persists it as a takeoff_scan attachment', async () => {
    const { user } = await openTakeoffTab(seededMaintenance())
    const file = new File(['scan-bytes'], 'dobson-ranch-boundary.png', { type: 'image/png' })

    await user.upload(screen.getByLabelText(/upload scanned map/i), file)

    // Instant local preview while the GCS flow runs in the background.
    const img = await screen.findByRole('img', { name: /scanned property boundary map/i })
    expect(img).toHaveAttribute('src', 'blob:mock-scan')
    expect(screen.getByText('dobson-ranch-boundary.png')).toBeInTheDocument()
    expect(screen.getByText('Replace scan')).toBeInTheDocument()
    // Badge persists over the real scan — human interpretation is deliberate.
    expect(screen.getByText("Estimator QA'd — human interpreted")).toBeInTheDocument()

    // The presign → PUT → confirm flow completed: the scan is durable now.
    expect(await screen.findByText(/saved to estimate/i)).toBeInTheDocument()
  })

  it('a persisted scan survives reload and is shown via the signed download URL', async () => {
    // First session: upload + persist.
    const first = await openTakeoffTab(seededMaintenance())
    const file = new File(['scan-bytes'], 'reload-boundary.png', { type: 'image/png' })
    await first.user.upload(screen.getByLabelText(/upload scanned map/i), file)
    expect(await screen.findByText(/saved to estimate/i)).toBeInTheDocument()
    first.view.unmount()

    // Second session (fresh mount = "reload"): the scan comes back from the
    // attachments API + signed GET URL, not from any in-memory blob.
    await openTakeoffTab(seededMaintenance())
    const img = await screen.findByRole('img', { name: /scanned property boundary map/i })
    expect(img.getAttribute('src')).toContain('__mock_gcs_download')
    expect(await screen.findByText('reload-boundary.png')).toBeInTheDocument()
  })
})

describe('TakeoffInsert — stat grid', () => {
  it('derives square footage and acreage from the estimate sections (sqft/43560)', async () => {
    // Fixture: 120,000 + 45,000 sqft = 165,000 sqft → 3.788 ac → "3.8 ac"
    await openTakeoffTab(buildMaintenanceEstimate())
    expect(screen.getByText('Total acreage')).toBeInTheDocument()
    expect(screen.getByText('3.8 ac')).toBeInTheDocument()
    expect(screen.getByText('Square footage')).toBeInTheDocument()
    expect(screen.getByText('165,000')).toBeInTheDocument()
  })

  it('renders turf area and curb miles as editable blue-cell inputs (empty when unset)', async () => {
    await openTakeoffTab(buildMaintenanceEstimate())
    const turf = screen.getByLabelText('Turf area (acres)')
    const curb = screen.getByLabelText('Curb miles')
    expect(turf).toHaveValue(null)
    expect(curb).toHaveValue(null)
    // Blue-cell convention — the estimator-editable visual language.
    expect(turf.className).toContain('bg-[#eff6ff]')
    expect(turf.className).toContain('border-[#bfdbfe]')
    expect(curb.className).toContain('bg-[#eff6ff]')
  })

  it('shows persisted turf/curb values from the estimate', async () => {
    await openTakeoffTab(
      buildMaintenanceEstimate({ turfAreaAcres: 2.4, curbMiles: 1.1 }),
    )
    expect(screen.getByLabelText('Turf area (acres)')).toHaveValue(2.4)
    expect(screen.getByLabelText('Curb miles')).toHaveValue(1.1)
  })
})

describe('TakeoffInsert — manual turf/curb persistence', () => {
  it('persists turf area on blur via the estimate PATCH', async () => {
    const { user } = await openTakeoffTab(seededMaintenance())
    const turf = screen.getByLabelText('Turf area (acres)')

    await user.clear(turf)
    await user.type(turf, '12.5')
    await user.tab()

    expect(await screen.findByRole('status')).toHaveTextContent('Takeoff details saved')
    expect(screen.getByLabelText('Turf area (acres)')).toHaveValue(12.5)
  })

  it('persists curb miles on blur via the estimate PATCH', async () => {
    const { user } = await openTakeoffTab(seededMaintenance())
    const curb = screen.getByLabelText('Curb miles')

    await user.clear(curb)
    await user.type(curb, '3.4')
    await user.tab()

    expect(await screen.findByRole('status')).toHaveTextContent('Takeoff details saved')
    expect(screen.getByLabelText('Curb miles')).toHaveValue(3.4)
  })
})

describe('TakeoffInsert — no-proposal business rule', () => {
  it('states the hard rule: no proposal, quote document, or pricing letter here', async () => {
    await openTakeoffTab(buildMaintenanceEstimate())
    expect(
      screen.getByText(
        'No proposal, quote document, or pricing letter is generated on the maintenance tab. Sales assembles the customer-facing proposal in the CRM from this insert plus the approved estimate.',
      ),
    ).toBeInTheDocument()
  })
})

describe('TakeoffInsert — actions', () => {
  it('Download exports the insert and confirms with the shared toast', async () => {
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const { user } = await openTakeoffTab(buildMaintenanceEstimate())

    await user.click(screen.getByRole('button', { name: /download/i }))

    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent('Takeoff insert downloaded')
  })

  it('"Attach & hand off" attaches the insert, advances handoff state, and disables itself', async () => {
    // Must be the MSW-seeded maintenance estimate so the PATCH finds it. The
    // mock now enforces the status machine: `handed_back` is only
    // legal from `approved`, so walk the seed there first.
    const seeded = seededMaintenance()
    // The MSW store row is a structuredClone of the seed — advance it to
    // `approved` through the same PATCH endpoint (a legal in_progress →
    // approved edge) before handing off.
    const approve = await fetch(`/api/estimating/estimates/${seeded.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(approve.status).toBe(200)

    const { user } = await openTakeoffTab({ ...seeded, status: 'approved' })
    await user.click(screen.getByRole('button', { name: /attach & hand off/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Takeoff insert attached — handed off to the CRM',
    )
    // Handoff state advanced: the action is spent.
    const spent = await screen.findByRole('button', { name: /handed off/i })
    expect(spent).toBeDisabled()
  })
})
