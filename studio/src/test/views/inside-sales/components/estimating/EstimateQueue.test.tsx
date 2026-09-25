// ---------------------------------------------------------------------------
// Estimate Queue tests (Acceptance Criteria §3).
//
// The queue is the estimator's landing view: live stat cards, filter/sort bar,
// the two intake CTAs,
// and clickable estimate cards that open the Line-Item Editor with the engine
// keyed off `estimateType` (no mode prompt, ever).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, makeUser } from '@/test/utils'
import { server } from '@/mocks/server'
import { useAuthStore } from '@/store/authStore'
import { buildMaintenanceEstimate, buildInstallEstimate } from '@/mocks/estimatingData'
import { EstimateQueue } from '@/views/inside-sales/components/estimating/EstimateQueue'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import {
  EstimatingShellContext,
  type EstimatingShellApi,
} from '@/views/inside-sales/components/estimating/useEstimatingShell'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'
import type { Estimate } from '@/types/estimating'

// Radix Select needs these DOM APIs that jsdom does not implement.
window.HTMLElement.prototype.hasPointerCapture = vi.fn()
window.HTMLElement.prototype.releasePointerCapture = vi.fn()
window.HTMLElement.prototype.scrollIntoView = vi.fn()

const DAY = 86400000
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString()

/**
 * Four estimates spanning both types, all four §3.2 queue statuses shown on
 * cards, and all three SLA states (threshold-config default is 4 days):
 *   Alpha   maintenance · in_progress · 10d left (ok)      · $600K · medium
 *   Bravo   maintenance · queued      ·  2d left (at risk) · $400K · high
 *   Charlie install     · review      ·  1d overdue        · $900K · urgent
 *   Delta   install     · new_from_sales · 14d left (ok)   · $600K · medium
 */
function fixtures(): Estimate[] {
  return [
    buildMaintenanceEstimate({
      id: 'q-m1',
      name: 'Alpha Ranch HOA',
      status: 'in_progress',
      priority: 'medium',
      dueBackDate: inDays(10),
      contractValueCents: 60_000_000,
    }),
    buildMaintenanceEstimate({
      id: 'q-m2',
      name: 'Bravo Gardens HOA',
      status: 'queued',
      priority: 'high',
      dueBackDate: inDays(2),
      contractValueCents: 40_000_000,
      notes: 'Board meets monthly — service visibility is high.',
    }),
    buildInstallEstimate({
      id: 'q-i1',
      name: 'Charlie Streetscape',
      status: 'review',
      priority: 'urgent',
      dueBackDate: inDays(-1),
      contractValueCents: 90_000_000,
    }),
    buildInstallEstimate({
      id: 'q-i2',
      name: 'Delta Amenity Center',
      status: 'new_from_sales',
      priority: 'medium',
      dueBackDate: inDays(14),
      contractValueCents: 60_000_000,
    }),
  ]
}

/**
 * Scoped-query mock: the SERVER applies row-level branch scope from the
 * session (BRD I-9.5) — pass `serverScope` to simulate it. The
 * client sends no branch param.
 */
function seedScopedList(estimates: Estimate[], serverScope?: string) {
  const requests: URL[] = []
  server.use(
    http.get('/api/estimating/estimates', ({ request }) => {
      const url = new URL(request.url)
      requests.push(url)
      return HttpResponse.json(
        serverScope ? estimates.filter((e) => e.branchCity === serverScope) : estimates,
      )
    }),
  )
  return requests
}

interface RenderQueueOptions {
  estimates?: Estimate[]
  serverScope?: string
  onMaintenanceIntake?: () => void
  onInstallIntake?: () => void
}

function renderQueue({ estimates = fixtures(), serverScope, ...props }: RenderQueueOptions = {}) {
  const requests = seedScopedList(estimates, serverScope)
  const shell: EstimatingShellApi = {
    activeTab: 'queue',
    setActiveTab: vi.fn(),
    openEstimate: null,
    setOpenEstimate: vi.fn(),
    openEstimateAt: vi.fn(),
  }
  render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider value={shell}>
        <EstimateQueue {...props} />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>,
  )
  return { shell, requests }
}

async function cardNames(): Promise<string[]> {
  const cards = await screen.findAllByTestId('queue-card')
  return cards.map((c) => within(c).getByTestId('queue-card-name').textContent ?? '')
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ branch_id: 'b1' }) })
})

// ----- Stat cards (AC 1) -----------------------------------------------------

describe('EstimateQueue — summary stat cards', () => {
  it('computes all four stats from the live queried estimate set', async () => {
    renderQueue()

    const total = await screen.findByTestId('stat-total-queue')
    expect(within(total).getByText('Total Queue')).toBeInTheDocument()
    // The list is now a React Query fetch (useEstimates) — wait for it to
    // resolve rather than asserting on the initial "0" render.
    await within(total).findByText('4')

    // At risk = within the config threshold OR past due (Bravo + Charlie).
    const sla = screen.getByTestId('stat-sla-at-risk')
    expect(within(sla).getByText('SLA at Risk')).toBeInTheDocument()
    expect(within(sla).getByText('2')).toBeInTheDocument()
    expect(within(sla).getByText(/14-day window/)).toBeInTheDocument()

    // Active = in build or review (Alpha in_progress + Charlie review).
    const active = screen.getByTestId('stat-active')
    expect(within(active).getByText('Active')).toBeInTheDocument()
    expect(within(active).getByText('2')).toBeInTheDocument()

    // Aggregate value: 600K + 400K + 900K + 600K = $2.5M.
    const value = screen.getByTestId('stat-queue-value')
    expect(within(value).getByText('Queue Value')).toBeInTheDocument()
    expect(within(value).getByText('$2.5M')).toBeInTheDocument()
  })

  it('SLA-at-risk excludes estimates comfortably outside the config threshold', async () => {
    renderQueue({
      estimates: [
        buildMaintenanceEstimate({ name: 'Far Out', dueBackDate: inDays(30) }),
      ],
    })
    const sla = await screen.findByTestId('stat-sla-at-risk')
    expect(within(sla).getByText('0')).toBeInTheDocument()
  })
})

// ----- Filter & sort (AC 2) ---------------------------------------------------

describe('EstimateQueue — status filter', () => {
  it('filters the card list by status', async () => {
    const user = userEvent.setup()
    renderQueue()
    await screen.findAllByTestId('queue-card')

    await user.click(screen.getByRole('combobox', { name: /status/i }))
    await user.click(screen.getByRole('option', { name: 'Review' }))

    expect(await cardNames()).toEqual(['Charlie Streetscape'])

    await user.click(screen.getByRole('combobox', { name: /status/i }))
    await user.click(screen.getByRole('option', { name: 'All Statuses' }))
    expect(await cardNames()).toHaveLength(4)
  })
})

describe('EstimateQueue — sorting', () => {
  it('sorts by priority by default (urgent → high → medium)', async () => {
    renderQueue()
    expect(await cardNames()).toEqual([
      'Charlie Streetscape',
      'Bravo Gardens HOA',
      'Alpha Ranch HOA',
      'Delta Amenity Center',
    ])
  })

  it('sorts by deadline (soonest due-back first)', async () => {
    const user = userEvent.setup()
    renderQueue()
    await screen.findAllByTestId('queue-card')
    await user.click(screen.getByRole('button', { name: /deadline/i }))
    expect(await cardNames()).toEqual([
      'Charlie Streetscape',
      'Bravo Gardens HOA',
      'Alpha Ranch HOA',
      'Delta Amenity Center',
    ])
  })

  it('sorts by value (largest first)', async () => {
    const user = userEvent.setup()
    renderQueue()
    await screen.findAllByTestId('queue-card')
    await user.click(screen.getByRole('button', { name: /value/i }))
    expect(await cardNames()).toEqual([
      'Charlie Streetscape',
      'Alpha Ranch HOA',
      'Delta Amenity Center',
      'Bravo Gardens HOA',
    ])
  })

  it('sorts by acreage (largest first; derived from sections when not stored)', async () => {
    const user = userEvent.setup()
    renderQueue()
    await screen.findAllByTestId('queue-card')
    await user.click(screen.getByRole('button', { name: /acreage/i }))
    // Maintenance fixtures derive 165,000 sqft ≈ 3.8 ac; installs store 2.1 ac.
    expect(await cardNames()).toEqual([
      'Alpha Ranch HOA',
      'Bravo Gardens HOA',
      'Charlie Streetscape',
      'Delta Amenity Center',
    ])
  })

  it('re-clicking the active sort chip flips its direction', async () => {
    const user = userEvent.setup()
    renderQueue()
    await screen.findAllByTestId('queue-card')
    await user.click(screen.getByRole('button', { name: /priority/i }))
    expect(await cardNames()).toEqual([
      'Alpha Ranch HOA',
      'Delta Amenity Center',
      'Bravo Gardens HOA',
      'Charlie Streetscape',
    ])
  })
})

// ----- Intake CTAs (AC 3) -------------------------------

describe('EstimateQueue — intake CTAs', () => {
  it('invokes the Maintenance intake seam (modal opener)', async () => {
    const user = userEvent.setup()
    const onMaintenanceIntake = vi.fn()
    renderQueue({ onMaintenanceIntake })
    await screen.findAllByTestId('queue-card')

    await user.click(screen.getByRole('button', { name: /maintenance intake/i }))
    expect(onMaintenanceIntake).toHaveBeenCalledTimes(1)
  })

  it('invokes the Install Intake seam (modal opener)', async () => {
    const user = userEvent.setup()
    const onInstallIntake = vi.fn()
    renderQueue({ onInstallIntake })
    await screen.findAllByTestId('queue-card')

    await user.click(screen.getByRole('button', { name: /install intake/i }))
    expect(onInstallIntake).toHaveBeenCalledTimes(1)
  })

  it('falls back to a clearly-marked stub toast until the modals land', async () => {
    const user = userEvent.setup()
    renderQueue()
    await screen.findAllByTestId('queue-card')

    await user.click(screen.getByRole('button', { name: /maintenance intake/i }))
    expect(await screen.findByText(/Maintenance intake modal is not wired up yet/i)).toBeInTheDocument()
  })
})

// ----- Card rendering (AC 4) ---------------------------------------------------

describe('EstimateQueue — card fields', () => {
  it('renders priority, status, type tag, name, acreage, value, walk date, SLA and rep', async () => {
    renderQueue()
    const cards = await screen.findAllByTestId('queue-card')
    const bravo = cards.find((c) => within(c).queryByText('Bravo Gardens HOA'))!

    expect(within(bravo).getByText('High')).toBeInTheDocument()
    expect(within(bravo).getByText('Queued')).toBeInTheDocument()
    expect(within(bravo).getByText('HOA')).toBeInTheDocument()
    expect(within(bravo).getByText('3.8 ac')).toBeInTheDocument()
    expect(within(bravo).getByText('$400K')).toBeInTheDocument()
    expect(within(bravo).getByText(/^Walk:/)).toBeInTheDocument()
    expect(within(bravo).getByText('2d left — SLA risk')).toBeInTheDocument()
    // Assigned rep: fixture assigns u5 → Casey Nguyen (CN). User data loads
    // via a separate useUsers() query, so wait for it to settle.
    await waitFor(() => {
      expect(within(bravo).getByText('CN')).toBeInTheDocument()
      expect(within(bravo).getByText(/Casey/)).toBeInTheDocument()
    })
    // Optional italic notes line.
    expect(within(bravo).getByText(/Board meets monthly/)).toBeInTheDocument()
  })

  it('shows the "New — from Sales" status badge for install submissions', async () => {
    renderQueue()
    const cards = await screen.findAllByTestId('queue-card')
    const delta = cards.find((c) => within(c).queryByText('Delta Amenity Center'))!
    expect(within(delta).getByText('New — from Sales')).toBeInTheDocument()
    expect(within(delta).getByText('install')).toBeInTheDocument()
  })

  it('shows an overdue SLA label and escalates the card border when breached', async () => {
    renderQueue()
    const cards = await screen.findAllByTestId('queue-card')
    const charlie = cards.find((c) => within(c).queryByText('Charlie Streetscape'))!
    expect(within(charlie).getByText('1d overdue — SLA breached')).toBeInTheDocument()
    expect(charlie.className).toMatch(/border-red/)

    const alpha = cards.find((c) => within(c).queryByText('Alpha Ranch HOA'))!
    expect(within(alpha).getByText('10d left')).toBeInTheDocument()
    expect(alpha.className).not.toMatch(/border-red/)
  })
})

// ----- Card → editor routing (AC 5) ---------------------------------------------

describe('EstimateQueue — opening an estimate', () => {
  it('clicking a maintenance card opens it in the editor with no mode prompt', async () => {
    const user = userEvent.setup()
    const { shell } = renderQueue()
    await screen.findAllByTestId('queue-card')
    await user.click(screen.getByText('Alpha Ranch HOA'))

    expect(shell.openEstimateAt).toHaveBeenCalledTimes(1)
    const [opened, tab] = vi.mocked(shell.openEstimateAt).mock.calls[0]!
    expect(opened.id).toBe('q-m1')
    expect(opened.estimateType).toBe('maintenance')
    expect(tab).toBe('editor')
    // The queue never asks the user to pick an engine/mode.
    expect(screen.queryByText(/select .*mode|choose .*mode|editor mode/i)).not.toBeInTheDocument()
  })

  it('clicking an install card opens it in the editor keyed off estimateType', async () => {
    const user = userEvent.setup()
    const { shell } = renderQueue()
    await screen.findAllByTestId('queue-card')
    await user.click(screen.getByText('Charlie Streetscape'))

    const [opened, tab] = vi.mocked(shell.openEstimateAt).mock.calls[0]!
    expect(opened.id).toBe('q-i1')
    expect(opened.estimateType).toBe('install')
    expect(tab).toBe('editor')
  })
})

// ----- Branch scoping (AC 6) -----------------------------------------------------

describe('EstimateQueue — role & branch scoping (BRD I-9.5)', () => {
  it('sends NO branch param — scope is derived server-side from the session', async () => {
    const { requests } = renderQueue()
    await screen.findAllByTestId('queue-card')
    expect(requests[0].searchParams.get('branch')).toBeNull()
  })

  it('renders only what the server-scoped query returns', async () => {
    const outOfScope = buildInstallEstimate({
      name: 'Echo Raleigh Campus',
      branchCity: 'Raleigh',
    })
    renderQueue({
      estimates: [...fixtures(), outOfScope],
      serverScope: 'Phoenix-Desert',
    })

    await screen.findAllByTestId('queue-card')
    expect(screen.queryByText('Echo Raleigh Campus')).not.toBeInTheDocument()
    expect(await cardNames()).toHaveLength(4)
  })

  it('does not render the role and branch scope badge', async () => {
    renderQueue()
    await screen.findAllByTestId('queue-card')
    expect(screen.queryByText(/role & branch scoped/i)).not.toBeInTheDocument()
  })
})

// ----- Shell integration (AC 5, end to end through EstimatingPage) ---------------

describe('EstimateQueue — EstimatingPage integration', () => {
  // Handoff 50 §2: the Line-Item Editor tab is estimator/approver-owned, so
  // this end-to-end flow (queue → editor) runs as an estimator.
  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ role: 'maintenance_estimating', branch_id: 'b1' }) })
  })

  it('opening a maintenance estimate from the queue lands on the Line-Item Editor tab', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    // Default MSW seed: one maintenance + one install estimate (Phoenix-Desert).
    const card = await screen.findByText('Dobson Ranch HOA — Grounds Maintenance')
    await user.click(card)

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Line-Item Editor' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.queryByTestId('editor-empty')).not.toBeInTheDocument()
  })

  it('opening an install estimate routes to the editor without any mode prompt', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    const card = await screen.findByText('Silverleaf — Phase 2 Installation')
    await user.click(card)

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Line-Item Editor' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.queryByTestId('editor-empty')).not.toBeInTheDocument()
    expect(screen.queryByText(/select .*mode|choose .*mode|editor mode/i)).not.toBeInTheDocument()
  })
})

// ----- Aspire sync status on the card (Phase 2 wiring) -----------------------

describe('EstimateQueue — Aspire sync status', () => {
  it('surfaces the Aspire identifier on the card via displayRef', async () => {
    renderQueue({
      estimates: [
        buildMaintenanceEstimate({
          id: 'q-sync',
          name: 'Sync Identifier',
          aspireNumber: 'ASP-99999',
          aspireSyncStatus: 'synced',
        }),
      ],
    })
    expect(await screen.findByText('ASP-99999')).toBeInTheDocument()
  })

  it('offers a retry affordance on a failed estimate', async () => {
    renderQueue({
      estimates: [
        buildMaintenanceEstimate({
          id: 'q-failed',
          name: 'Failed Sync',
          aspireNumber: null,
          aspireSyncStatus: 'failed',
        }),
      ],
    })
    expect(await screen.findByText(/sync failed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry sync/i })).toBeInTheDocument()
  })
})

// ----- RFI status surfaced on the queue card (§3.2) ---------------

describe('EstimateQueue — RFI status surfaced (§3.2)', () => {
  it('shows the tracked RFI status on the queue card when present', async () => {
    renderQueue({
      estimates: [
        buildInstallEstimate({
          id: 'q-rfi',
          name: 'RFI Job',
          rfiStatus: 'Awaiting GC response on storm drain details',
        }),
      ],
    })
    const card = await screen.findByTestId('queue-card')
    expect(within(card).getByTestId('queue-rfi-status')).toHaveTextContent(
      /awaiting gc response/i,
    )
  })

  it('renders no RFI chip when rfiStatus is absent', async () => {
    renderQueue({
      estimates: [buildInstallEstimate({ id: 'q-no-rfi', name: 'No RFI Job' })],
    })
    await screen.findByTestId('queue-card')
    expect(screen.queryByTestId('queue-rfi-status')).not.toBeInTheDocument()
  })
})
