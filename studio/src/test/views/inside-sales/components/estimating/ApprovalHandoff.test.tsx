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
        value={{ activeTab: 'approval', setActiveTab: () => {}, openEstimate, setOpenEstimate, openEstimateAt: () => {} }}
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
    expect(screen.getByTestId('tier-row-manager')).not.toHaveTextContent(
      'Required for this estimate',
    )
  })

  it('renders the ladder from approval_tiers rows — changing a row changes the UI with no code change', () => {
    const est = buildMaintenanceEstimate({ contractValueCents: 15_000_000 })
    const customTiers: ApprovalTier[] = [
      { id: 't1', roleKey: 'manager', label: 'Branch Manager', minValueCents: 0, maxValueCents: 20_000_000, order: 1, estimateType: 'maintenance' },
      { id: 't2', roleKey: 'ceo', label: 'Chief Operating Officer', minValueCents: 20_000_000, maxValueCents: null, order: 2, estimateType: 'maintenance' },
    ]
    render(<Harness estimate={est} tiers={customTiers} />)

    // With the edited rows, $150K now routes to Branch Manager (<$200K).
    expect(screen.getByTestId('required-tier')).toHaveTextContent('Branch Manager')
    expect(screen.getByText('Chief Operating Officer')).toBeInTheDocument()
    expect(screen.getAllByTestId(/tier-row-/)).toHaveLength(2)
    // The seed's mid-band tiers are not rendered.
    expect(screen.queryByText('Vice President')).not.toBeInTheDocument()
  })

  it('shows the CEO >$1M mechanism open-item footnote', () => {
    render(<Harness estimate={buildMaintenanceEstimate()} />)
    expect(
      screen.getByText(/CEO mechanism above \$1M is an open item/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/configurable, not hard-coded/i)).toBeInTheDocument()
  })
})

describe('ApprovalHandoff — install routes through the same tier ladder', () => {
  it('computes the required tier for an install estimate from the install ladder — no "no approval matrix" state', () => {
    // $150K install → Regional Director band ($100K–$250K), same as maintenance.
    render(<Harness estimate={buildInstallEstimate({ contractValueCents: 15_000_000, status: 'pending_approval' })} />)

    expect(screen.queryByText(/no approval matrix/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('no-approval-matrix')).not.toBeInTheDocument()
    expect(screen.getByTestId('required-tier')).toHaveTextContent('Regional Director')
    expect(screen.getAllByTestId(/tier-row-/)).toHaveLength(4)
    expect(screen.getByTestId('tier-row-regional_director')).toHaveTextContent(
      'Required for this estimate',
    )
    // The tiered approve flow is ENABLED for install now.
    expect(screen.getByRole('button', { name: /approve & hand back to sales/i })).toBeEnabled()
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
