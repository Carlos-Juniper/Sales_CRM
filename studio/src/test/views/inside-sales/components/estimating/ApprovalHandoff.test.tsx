// ---------------------------------------------------------------------------
// Handoff 08 — Approval & Handoff tab (Acceptance Criteria).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { estimatingApi } from '@/api/estimating'
import {
  buildMaintenanceEstimate,
  buildInstallEstimate,
  toCreatePayload,
} from '@/mocks/estimatingData'
import type { ApprovalTier, Estimate } from '@/types/estimating'
import { ApprovalHandoff } from '@/views/inside-sales/components/estimating/ApprovalHandoff'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'

function Harness({ estimate, tiers }: { estimate: Estimate | null; tiers?: ApprovalTier[] }) {
  const [openEstimate, setOpenEstimate] = useState<Estimate | null>(estimate)
  return (
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{ activeTab: 'approval', setActiveTab: () => {}, openEstimate, setOpenEstimate }}
      >
        <ApprovalHandoff tiers={tiers} />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>
  )
}

/** Seed a fresh estimate into the MSW store so PATCH/POST endpoints resolve. */
async function seedEstimate(fixture: Estimate): Promise<Estimate> {
  return estimatingApi.create(toCreatePayload(fixture))
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ name: 'Rita Delgado', role: 'inside_sales' }) })
})

describe('ApprovalHandoff — tier routing (config-driven)', () => {
  it('computes the required tier from the config ladder and highlights it', () => {
    // $150K contract → Regional Director band ($100K–$250K) per BRD I-7 seed.
    const est = buildMaintenanceEstimate({ contractValueCents: 15_000_000 })
    render(<Harness estimate={est} />)

    expect(screen.getByText('$150,000')).toBeInTheDocument()
    expect(screen.getByTestId('required-tier')).toHaveTextContent('Regional Director')
    const active = screen.getByTestId('tier-row-regional_director')
    expect(active).toHaveTextContent('Required for this estimate')
    expect(screen.getByTestId('tier-row-branch_manager')).not.toHaveTextContent(
      'Required for this estimate',
    )
  })

  it('renders the ladder from approval_tiers rows — changing a row changes the UI with no code change', () => {
    const est = buildMaintenanceEstimate({ contractValueCents: 15_000_000 })
    const customTiers: ApprovalTier[] = [
      { id: 't1', roleKey: 'branch_manager', label: 'Branch Manager', minValueCents: 0, maxValueCents: 20_000_000, order: 1, estimateType: 'maintenance' },
      { id: 't2', roleKey: 'coo', label: 'Chief Operating Officer', minValueCents: 20_000_000, maxValueCents: null, order: 2, estimateType: 'maintenance' },
    ]
    render(<Harness estimate={est} tiers={customTiers} />)

    // With the edited rows, $150K now routes to Branch Manager (<$200K).
    expect(screen.getByTestId('required-tier')).toHaveTextContent('Branch Manager')
    expect(screen.getByText('Chief Operating Officer')).toBeInTheDocument()
    expect(screen.getAllByTestId(/tier-row-/)).toHaveLength(2)
    // The seed's mid-band tiers are not rendered.
    expect(screen.queryByText('Business Partner')).not.toBeInTheDocument()
  })

  it('shows the BP title / COO mechanism open-item footnote', () => {
    render(<Harness estimate={buildMaintenanceEstimate()} />)
    expect(
      screen.getByText(/"BP" senior-ops title and the COO mechanism above \$1M are open items/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/configurable, not hard-coded/i)).toBeInTheDocument()
  })
})

describe('ApprovalHandoff — install has no approval matrix (open item)', () => {
  it('shows the "no matrix defined" state and disables the approve flow — no silent maintenance-ladder reuse', () => {
    render(<Harness estimate={buildInstallEstimate()} />)

    expect(
      screen.getByText(/no approval matrix defined for install estimates/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/pending confirmation/i)).toBeInTheDocument()
    // No maintenance tiers leak into the install view.
    expect(screen.queryByText('Branch Manager')).not.toBeInTheDocument()
    expect(screen.queryByTestId(/tier-row-/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve & hand back to sales/i })).toBeDisabled()
  })
})

describe('ApprovalHandoff — on-approval settings', () => {
  it('defaults the notify-both toggle ON (current practice) and persists changes to the estimate', async () => {
    const user = userEvent.setup()
    const est = await seedEstimate(buildMaintenanceEstimate())
    render(<Harness estimate={est} />)

    const toggle = screen.getByRole('switch', {
      name: /notify both branch manager & regional director on return/i,
    })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await waitFor(async () => {
      const persisted = await estimatingApi.get(est.id)
      expect(persisted.approvalSettings?.notifyBmRdOnReturn).toBe(false)
    })
  })

  it('explains the in-platform handback (no email) with the salesperson named', () => {
    render(<Harness estimate={buildMaintenanceEstimate()} />)
    expect(screen.getByText(/in-platform via status change — no email handoff/i)).toBeInTheDocument()
  })
})

describe('ApprovalHandoff — approve & hand back to Sales', () => {
  it('performs the status transition, writes actor+timestamp audit records, and toasts', async () => {
    const user = userEvent.setup()
    const est = await seedEstimate(buildMaintenanceEstimate({ status: 'pending_approval' }))
    render(<Harness estimate={est} />)

    await user.click(screen.getByRole('button', { name: /approve & hand back to sales/i }))

    // Status transition persisted server-side.
    await waitFor(async () => {
      const updated = await estimatingApi.get(est.id)
      expect(updated.status).toBe('handed_back')
    })

    // Audit trail: pending_approval → approved → handed_back, with actor + timestamp.
    const records = await estimatingApi.listStatusTransitions(est.id)
    expect(records.map((r) => r.to)).toEqual(['approved', 'handed_back'])
    for (const r of records) {
      expect(r.actor).toBe('Rita Delgado')
      expect(Number.isNaN(Date.parse(r.at))).toBe(false)
    }

    // Shared toast confirms.
    expect(await screen.findByRole('status')).toHaveTextContent(/handed back to sales/i)
  })

  it('disables the CTA once the estimate is already handed back', async () => {
    const est = buildMaintenanceEstimate({ status: 'handed_back' })
    render(<Harness estimate={est} />)
    expect(screen.getByRole('button', { name: /approve & hand back to sales/i })).toBeDisabled()
  })
})

describe('ApprovalHandoff — empty state', () => {
  it('prompts to open an estimate when none is open', () => {
    render(<Harness estimate={null} />)
    expect(screen.getByText(/open an estimate/i)).toBeInTheDocument()
  })
})
