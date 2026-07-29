// ---------------------------------------------------------------------------
// Handoff 10 — Takeoff Insert (maintenance-only).
//
// Estimating's ONLY maintenance output to the CRM (the salesperson, a person)
// is a takeoff insert: the scanned property boundary image + acreage stats.
// Never a proposal, quote document, or pricing letter.
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

async function openTakeoffTab(estimate: MaintenanceEstimate | null) {
  const user = userEvent.setup()
  render(<EstimatingPage initialOpenEstimate={estimate} />)
  await user.click(screen.getByRole('tab', { name: 'Takeoff Insert' }))
  return user
}

beforeEach(() => {
  seedUser()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  vi.restoreAllMocks()
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

  it('always shows the "Manual takeoff — human interpreted" badge', async () => {
    await openTakeoffTab(buildMaintenanceEstimate())
    expect(screen.getByText('Manual takeoff — human interpreted')).toBeInTheDocument()
  })

  it('displays the uploaded scan image and switches the action to "Replace scan"', async () => {
    const user = await openTakeoffTab(buildMaintenanceEstimate())
    const file = new File(['scan-bytes'], 'dobson-ranch-boundary.png', { type: 'image/png' })

    await user.upload(screen.getByLabelText(/upload scanned map/i), file)

    const img = await screen.findByRole('img', { name: /scanned property boundary map/i })
    expect(img).toHaveAttribute('src', 'blob:mock-scan')
    expect(screen.getByText('dobson-ranch-boundary.png')).toBeInTheDocument()
    expect(screen.getByText('Replace scan')).toBeInTheDocument()
    // Badge persists over the real scan — human interpretation is deliberate.
    expect(screen.getByText('Manual takeoff — human interpreted')).toBeInTheDocument()
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

  it('shows turf area and curb miles slots with a "—" fallback while metadata source is open', async () => {
    await openTakeoffTab(buildMaintenanceEstimate())
    expect(screen.getByText('Turf area')).toBeInTheDocument()
    expect(screen.getByText('Curb miles')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
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
    const user = await openTakeoffTab(buildMaintenanceEstimate())

    await user.click(screen.getByRole('button', { name: /download/i }))

    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent('Takeoff insert downloaded')
  })

  it('"Attach & hand off" attaches the insert, advances handoff state, and disables itself', async () => {
    // Must be the MSW-seeded maintenance estimate so the PATCH finds it.
    const seeded = mockEstimatesV2[0] as MaintenanceEstimate
    expect(seeded.estimateType).toBe('maintenance')

    const user = await openTakeoffTab(seeded)
    await user.click(screen.getByRole('button', { name: /attach & hand off/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Takeoff insert attached — handed off to the CRM',
    )
    // Handoff state advanced: the action is spent.
    const spent = await screen.findByRole('button', { name: /handed off/i })
    expect(spent).toBeDisabled()
  })
})
