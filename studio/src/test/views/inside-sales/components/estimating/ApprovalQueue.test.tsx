// ---------------------------------------------------------------------------
// Approval Queue & Review Drawer (Acceptance Criteria).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { estimatingApi } from '@/api/estimating'
import { APPROVAL_TIER_SEED } from '@/lib/estimating/config'
import { buildMaintenanceEstimate, toCreatePayload } from '@/mocks/estimatingData'
import type { Estimate } from '@/types/estimating'
import { ApprovalQueue } from '@/views/inside-sales/components/estimating/ApprovalQueue'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'

const setActiveTab = vi.fn()
const setOpenEstimateSpy = vi.fn()

function Harness({ estimates }: { estimates: Estimate[] }) {
  const [openEstimate, setOpenEstimate] = useState<Estimate | null>(null)
  return (
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{
          activeTab: 'approvalQueue',
          setActiveTab,
          openEstimate,
          setOpenEstimate: (e) => {
            setOpenEstimateSpy(e)
            setOpenEstimate(e)
          },
        }}
      >
        <ApprovalQueue tiers={APPROVAL_TIER_SEED} estimates={estimates} />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>
  )
}

/** Pending-approval maintenance fixture with uniform complexity for clean math. */
function pending(
  valueCents: number,
  { name, complexity = 0.1, margin = 0.22, updatedAt }: { name?: string; complexity?: number; margin?: number; updatedAt?: string } = {},
): Estimate {
  const est = buildMaintenanceEstimate({
    status: 'pending_approval',
    contractValueCents: valueCents,
    targetMargin: margin,
    ...(name ? { name } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  })
  est.sections.forEach((s) => s.services.forEach((v) => (v.complexityPct = complexity)))
  return est
}

/** Seed a fixture into the MSW store so approve/send-back endpoints resolve. */
async function seed(fixture: Estimate): Promise<Estimate> {
  const created = await estimatingApi.create(toCreatePayload(fixture))
  // MSW sets updatedAt=now; keep uniform complexity + value from the fixture.
  return created
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: makeUser({ name: 'Amanda Torres', role: 'manager' }) })
})

// ----- Routing & role switcher -----------------------------------------------------

describe('ApprovalQueue — routing (config-driven)', () => {
  it('filters the queue to the active role via tierForValue', async () => {
    const bmEst = pending(9_500_000, { name: 'Legacy HOA Peoria' })
    const rdEst = pending(15_000_000, { name: 'Silverleaf HOA' })
    render(<Harness estimates={[bmEst, rdEst]} />)

    // default view: Manager
    expect(screen.getByText('Legacy HOA Peoria')).toBeInTheDocument()
    expect(screen.queryByText('Silverleaf HOA')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'RD' }))
    expect(screen.getByText('Silverleaf HOA')).toBeInTheDocument()
    expect(screen.queryByText('Legacy HOA Peoria')).not.toBeInTheDocument()
  })

  it('shows the empty state when nothing routes to the viewer', async () => {
    render(<Harness estimates={[pending(9_500_000)]} />)
    await userEvent.click(screen.getByRole('button', { name: 'CEO' }))
    expect(screen.getByText(/queue is clear/i)).toBeInTheDocument()
  })

  it('only pending_approval estimates appear', () => {
    const inProgress = buildMaintenanceEstimate({
      status: 'in_progress',
      contractValueCents: 9_000_000,
      name: 'Not Routed Yet',
    })
    render(<Harness estimates={[inProgress, pending(9_500_000, { name: 'Routed' })]} />)
    expect(screen.getByText('Routed')).toBeInTheDocument()
    expect(screen.queryByText('Not Routed Yet')).not.toBeInTheDocument()
  })
})

// ----- Stats -----------------------------------------------------------------------

describe('ApprovalQueue — stats', () => {
  it('computes awaiting count, value pending, and oldest waiting with severity color', () => {
    const a = pending(9_500_000, { updatedAt: daysAgo(4) })
    const b = pending(4_000_000, { updatedAt: daysAgo(1) })
    render(<Harness estimates={[a, b]} />)

    expect(screen.getByTestId('stat-awaiting')).toHaveTextContent('2')
    expect(screen.getByTestId('stat-value-pending')).toHaveTextContent('$135,000')
    const oldest = screen.getByTestId('stat-oldest')
    expect(oldest).toHaveTextContent('4 days')
    expect(oldest).toHaveAttribute('data-severity', 'red')
  })

  it('amber at 3 days waiting', () => {
    render(<Harness estimates={[pending(9_500_000, { updatedAt: daysAgo(3) })]} />)
    expect(screen.getByTestId('stat-oldest')).toHaveAttribute('data-severity', 'amber')
  })
})

// ----- Escalation banner on cards ---------------------------------------------------

describe('ApprovalQueue — CEO >$1M open-item banner', () => {
  it('flags >$1M estimates with the CEO open-item banner', async () => {
    render(<Harness estimates={[pending(124_000_000, { name: 'Maricopa County' })]} />)
    await userEvent.click(screen.getByRole('button', { name: 'CEO' }))
    expect(screen.getByText('Maricopa County')).toBeInTheDocument()
    expect(screen.getByText(/CEO mechanism to confirm/i)).toBeInTheDocument()
  })
})

// ----- Review drawer ----------------------------------------------------------------

describe('ApprovalQueue — review drawer', () => {
  it('opens read-only: group rows render but no line-item edit paths exist', async () => {
    const est = pending(9_500_000)
    render(<Harness estimates={[est]} />)
    await userEvent.click(screen.getByText(est.name))

    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText(/read-only — line items are estimator-owned/i)).toBeInTheDocument()
    for (const section of est.sections) {
      expect(within(drawer).getByText(section.name)).toBeInTheDocument()
    }
    // the ONLY interactive value controls are the two audited levers
    expect(within(drawer).getAllByRole('slider')).toHaveLength(2)
    expect(within(drawer).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(drawer).queryAllByRole('spinbutton')).toHaveLength(0)
  })

  it('recomputes effCost/liveValue/liveTier live and resets to original', async () => {
    const est = pending(9_500_000) // cost0 $74,100 · comp0 10 · margin0 22
    render(<Harness estimates={[est]} />)
    await userEvent.click(screen.getByText(est.name))
    const drawer = screen.getByRole('dialog')

    expect(within(drawer).getByTestId('live-total')).toHaveTextContent('$95,000')
    expect(within(drawer).getByTestId('lever-readout')).toHaveTextContent('Cost $74,100 · was $95,000')
    expect(within(drawer).getByTestId('routes-to')).toHaveTextContent('Routes to Manager')

    // margin 22 → 30: liveValue = 74,100/0.70 = $105,857 → Regional Director
    fireEvent.change(within(drawer).getByRole('slider', { name: /gross margin/i }), {
      target: { value: '30' },
    })
    expect(within(drawer).getByTestId('live-total')).toHaveTextContent('$105,857')
    expect(within(drawer).getByTestId('routes-to')).toHaveTextContent('Routes to Regional Director')

    // complexity 10 → 20: effCost ×1.10 = $81,510
    fireEvent.change(within(drawer).getByRole('slider', { name: /complexity/i }), {
      target: { value: '20' },
    })
    expect(within(drawer).getByTestId('lever-readout')).toHaveTextContent('Cost $81,510')

    // reset both → back to original
    await userEvent.click(within(drawer).getByRole('button', { name: /reset complexity/i }))
    await userEvent.click(within(drawer).getByRole('button', { name: /reset margin/i }))
    expect(within(drawer).getByTestId('live-total')).toHaveTextContent('$95,000')
    expect(within(drawer).getByTestId('routes-to')).toHaveTextContent('Routes to Manager')
  })

  it('over-ceiling adjustment disables Approve — the primary becomes a plain "Save adjustment" (no Escalate)', async () => {
    const est = pending(9_500_000)
    render(<Harness estimates={[est]} />)
    await userEvent.click(screen.getByText(est.name))
    const drawer = screen.getByRole('dialog')

    expect(within(drawer).queryByTestId('over-ceiling-banner')).not.toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeInTheDocument()

    fireEvent.change(within(drawer).getByRole('slider', { name: /gross margin/i }), {
      target: { value: '30' },
    })
    const banner = within(drawer).getByTestId('over-ceiling-banner')
    expect(banner).toHaveTextContent(/above your approval ceiling/i)
    // Informational: the estimate re-routes on save; no escalate framing anywhere.
    expect(banner).toHaveTextContent(/routes it to/i)
    expect(banner).not.toHaveTextContent(/escalat/i)
    expect(within(drawer).getByRole('button', { name: 'Save adjustment' })).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(within(drawer).queryByText(/escalate/i)).not.toBeInTheDocument()
  })

  it('changed levers within ceiling relabel the primary to "Save adjustment & approve"', async () => {
    const est = pending(9_500_000)
    render(<Harness estimates={[est]} />)
    await userEvent.click(screen.getByText(est.name))
    const drawer = screen.getByRole('dialog')
    fireEvent.change(within(drawer).getByRole('slider', { name: /complexity/i }), {
      target: { value: '12' },
    })
    expect(
      within(drawer).getByRole('button', { name: /save adjustment & approve/i }),
    ).toBeInTheDocument()
  })
})

// ----- Actions & status transitions ---------------------------------------------------

describe('ApprovalQueue — actions', () => {
  it('Approve walks pending_approval → approved → handed_back via the transition module', async () => {
    const est = await seed(pending(9_500_000, { name: 'Approve Me' }))
    render(<Harness estimates={[est]} />)

    const card = screen.getByTestId(`aq-card-${est.id}`)
    await userEvent.click(within(card).getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(screen.queryByTestId(`aq-card-${est.id}`)).not.toBeInTheDocument())
    const updated = await estimatingApi.get(est.id)
    expect(updated.status).toBe('handed_back')
    const transitions = await estimatingApi.listStatusTransitions(est.id)
    expect(transitions.map((t) => t.to)).toEqual(['approved', 'handed_back'])
    expect(transitions[0].actor).toBe('Amanda Torres')
  })

  it('Save adjustment & approve persists the levers, audits them, then approves', async () => {
    const est = await seed(pending(9_500_000, { name: 'Adjust Me' }))
    render(<Harness estimates={[est]} />)
    await userEvent.click(screen.getByText('Adjust Me'))
    const drawer = screen.getByRole('dialog')

    fireEvent.change(within(drawer).getByRole('slider', { name: /complexity/i }), {
      target: { value: '14' },
    })
    await userEvent.click(within(drawer).getByRole('button', { name: /save adjustment & approve/i }))

    await waitFor(() => expect(screen.queryByTestId(`aq-card-${est.id}`)).not.toBeInTheDocument())
    // PERSISTED audit (BRD III-1): from/to + actor, via POST /adjustments
    const trail = await estimatingApi.listAdjustments(est.id)
    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({
      estimateId: est.id,
      field: 'complexity',
      actor: 'Amanda Torres',
    })
    expect(trail[0].fromValue).toBeCloseTo(0.1)
    expect(trail[0].toValue).toBeCloseTo(0.14)

    const updated = await estimatingApi.get(est.id)
    expect(updated.status).toBe('handed_back')
    // complexity +4 pts scales cost: 74,100 × 1.04 / 0.78 = $98,800
    expect(updated.contractValueCents).toBe(Math.round(Math.round(9_500_000 * 0.78) * 1.04 / 0.78))
    // …and BOTH audit paths were written: adjustment row + status transitions.
    const transitions = await estimatingApi.listStatusTransitions(est.id)
    expect(transitions.map((t) => t.to)).toEqual(['approved', 'handed_back'])
  })

  it('saving an over-ceiling adjustment re-routes to the correct tier queue without approving', async () => {
    const est = await seed(pending(9_500_000, { name: 'Reroute Me' }))
    render(<Harness estimates={[est]} />)
    await userEvent.click(screen.getByText('Reroute Me'))
    const drawer = screen.getByRole('dialog')

    fireEvent.change(within(drawer).getByRole('slider', { name: /gross margin/i }), {
      target: { value: '30' },
    })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save adjustment' }))

    // leaves the MGR queue (now routed to RD by value) but is NOT approved
    await waitFor(() => expect(screen.queryByTestId(`aq-card-${est.id}`)).not.toBeInTheDocument())
    const updated = await estimatingApi.get(est.id)
    expect(updated.status).toBe('pending_approval')
    expect(updated.targetMargin).toBeCloseTo(0.3)
    const trail = await estimatingApi.listAdjustments(est.id)
    expect(trail.some((r) => r.field === 'margin')).toBe(true)

    // …and it now appears under the RD view — value-driven auto-routing
    await userEvent.click(screen.getByRole('button', { name: 'RD' }))
    expect(await screen.findByText('Reroute Me')).toBeInTheDocument()
  })

  it('Send back requires a reason and re-enters the estimator queue as a revision', async () => {
    const est = await seed(pending(9_500_000, { name: 'Send Me Back' }))
    render(<Harness estimates={[est]} />)

    const card = screen.getByTestId(`aq-card-${est.id}`)
    await userEvent.click(within(card).getByRole('button', { name: 'Send back' }))
    const drawer = screen.getByRole('dialog')

    const submit = within(drawer).getByRole('button', { name: /send back to estimator/i })
    expect(submit).toBeDisabled()

    await userEvent.click(within(drawer).getByRole('button', { name: 'Pricing concern' }))
    expect(submit).toBeEnabled()
    await userEvent.click(submit)

    await waitFor(() => expect(screen.queryByTestId(`aq-card-${est.id}`)).not.toBeInTheDocument())
    const updated = await estimatingApi.get(est.id)
    expect(updated.status).toBe('in_progress') // back in the estimator's queue
  })

  it('Open estimate hands the estimate to the shell and jumps to the editor', async () => {
    const est = pending(9_500_000)
    render(<Harness estimates={[est]} />)
    const card = screen.getByTestId(`aq-card-${est.id}`)
    await userEvent.click(within(card).getByRole('button', { name: /open estimate/i }))
    expect(setOpenEstimateSpy).toHaveBeenCalledWith(expect.objectContaining({ id: est.id }))
    expect(setActiveTab).toHaveBeenCalledWith('editor')
  })
})
