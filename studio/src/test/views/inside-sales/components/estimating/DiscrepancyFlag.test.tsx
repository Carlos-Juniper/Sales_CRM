// ---------------------------------------------------------------------------
// Handoff 06 — Discrepancy Review tab (DiscrepancyFlag component).
//
// Acceptance criteria under test:
//  - Threshold slider (1–25%, default 10%) is config-backed and re-evaluates
//    all rows live; flagged rows restyle and stat cards update.
//  - Editing Plan / Add% / Measured / Opp recomputes Bid QTY, Δ, Status live.
//  - Δ vs Opp shows independently of the flag (blue when ≠ 0).
//  - CRM banner switches flagged/clean; "Surface to CRM" toasts via the
//    shared toast.
//  - Blue-cell convention on estimator-editable inputs.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import type { ReactNode } from 'react'
import type { TakeoffLine } from '@/types/estimating'
import { buildInstallEstimate } from '@/mocks/estimatingData'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import {
  EstimatingShellContext,
  type EstimatingShellApi,
} from '@/views/inside-sales/components/estimating/useEstimatingShell'
import { DiscrepancyFlag } from '@/views/inside-sales/components/estimating/DiscrepancyFlag'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'

const install = buildInstallEstimate()

function shellApi(): EstimatingShellApi {
  return {
    activeTab: 'discrepancy',
    setActiveTab: () => {},
    openEstimate: install,
    setOpenEstimate: () => {},
  }
}

function Wrap({ children }: { children: ReactNode }) {
  return (
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider value={shellApi()}>
        {children}
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>
  )
}

function lines(): TakeoffLine[] {
  return [
    // Clean: no flag, Δ 0.
    { id: 'a', estimateId: install.id, description: "Mahogany 10'-12'", uom: 'ea', planQty: 24, addPct: 0.05, measuredQty: 24, opportunityQty: 24 },
    // 15% deviation: flagged at 10%, clean at 20%. Δ +15.
    { id: 'b', estimateId: install.id, description: 'Irrigation lateral line', uom: 'FT', planQty: 100, addPct: 0.1, measuredQty: 115, opportunityQty: 100 },
    // No flag, but the opportunity qty is stale: Δ −4 (independent signal).
    { id: 'c', estimateId: install.id, description: 'Bahia sod', uom: 'pallet', planQty: 20, addPct: 0, measuredQty: 20, opportunityQty: 24 },
  ]
}

function renderTab(initialLines: TakeoffLine[] = lines()) {
  return render(
    <Wrap>
      <DiscrepancyFlag initialLines={initialLines} />
    </Wrap>,
  )
}

describe('DiscrepancyFlag — stat cards & threshold slider', () => {
  it('renders the four stat cards with counts derived from the lines', () => {
    renderTab()
    expect(screen.getByText('Takeoff lines')).toBeInTheDocument()
    expect(screen.getByTestId('stat-line-count')).toHaveTextContent('3')
    expect(screen.getByText('Flagged (> threshold)')).toBeInTheDocument()
    expect(screen.getByTestId('stat-flagged-count')).toHaveTextContent('1')
    expect(screen.getByText('Δ vs Opportunity ≠ 0')).toBeInTheDocument()
    expect(screen.getByTestId('stat-opp-delta-count')).toHaveTextContent('2')
    expect(screen.getByText('Flag threshold')).toBeInTheDocument()
    expect(screen.getByTestId('stat-threshold-pct')).toHaveTextContent('10')
  })

  it('config-backs the slider: default 10, min 1, max 25', () => {
    renderTab()
    const slider = screen.getByLabelText('Flag threshold') as HTMLInputElement
    expect(slider).toHaveValue('10')
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '25')
  })

  it('moving the slider re-evaluates all rows live (15% line unflags at 20%)', () => {
    renderTab()
    expect(screen.getByTestId('stat-flagged-count')).toHaveTextContent('1')
    expect(screen.getAllByText('Review')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('Flag threshold'), { target: { value: '20' } })

    expect(screen.getByTestId('stat-threshold-pct')).toHaveTextContent('20')
    expect(screen.getByTestId('stat-flagged-count')).toHaveTextContent('0')
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
    expect(screen.getAllByText('OK')).toHaveLength(3)
  })

  it('tightening the threshold flags more rows and restyles them amber', () => {
    renderTab()
    fireEvent.change(screen.getByLabelText('Flag threshold'), { target: { value: '1' } })
    // b (15%) still flagged; a and c have 0% deviation and stay OK.
    expect(screen.getByTestId('stat-flagged-count')).toHaveTextContent('1')
    const flaggedRow = screen.getByText('Irrigation lateral line').closest('tr')!
    expect(flaggedRow.className).toContain('fffbeb')
    const okRow = screen.getByText('Bahia sod').closest('tr')!
    expect(okRow.className).not.toContain('fffbeb')
  })
})

describe('DiscrepancyFlag — table & live recompute', () => {
  it('renders each line with description, UOM, computed Bid QTY and status', () => {
    renderTab()
    expect(screen.getByText("Mahogany 10'-12'")).toBeInTheDocument()
    expect(screen.getByText('ea')).toBeInTheDocument()
    // bid = ceil(24 × 1.05) = 26 ; ceil(100 × 1.1) = 110 ; ceil(20 × 1) = 20
    expect(screen.getByTestId('bid-qty-a')).toHaveTextContent('26')
    expect(screen.getByTestId('bid-qty-b')).toHaveTextContent('110')
    expect(screen.getByTestId('bid-qty-c')).toHaveTextContent('20')
    expect(screen.getAllByText('OK')).toHaveLength(2)
    expect(screen.getAllByText('Review')).toHaveLength(1)
  })

  it('editing Plan QTY recomputes Bid QTY and Status live', async () => {
    const user = userEvent.setup()
    renderTab()
    const plan = screen.getByLabelText("Plan QTY — Mahogany 10'-12'")
    await user.clear(plan)
    await user.type(plan, '12')
    // bid = ceil(12 × 1.05) = 13 ; measured 24 vs plan 12 = 100% dev → Review
    expect(screen.getByTestId('bid-qty-a')).toHaveTextContent('13')
    expect(screen.getByTestId('stat-flagged-count')).toHaveTextContent('2')
    expect(screen.getAllByText('Review')).toHaveLength(2)
  })

  it('editing Add % recomputes Bid QTY (whole-percent input, ceil applied)', async () => {
    const user = userEvent.setup()
    renderTab()
    const add = screen.getByLabelText("Add % — Mahogany 10'-12'")
    await user.clear(add)
    await user.type(add, '10')
    expect(screen.getByTestId('bid-qty-a')).toHaveTextContent('27') // ceil(24 × 1.1)
  })

  it('editing Measured re-evaluates the flag and Δ live', async () => {
    const user = userEvent.setup()
    renderTab()
    const measured = screen.getByLabelText('Measured — Bahia sod')
    await user.clear(measured)
    await user.type(measured, '25')
    // 25% deviation on plan 20 → flagged; Δ vs opp = 25 − 24 = +1
    expect(screen.getByTestId('stat-flagged-count')).toHaveTextContent('2')
    expect(screen.getByTestId('delta-c')).toHaveTextContent('+1')
  })

  it('editing Opp (Aspire) recomputes Δ live', async () => {
    const user = userEvent.setup()
    renderTab()
    const opp = screen.getByLabelText('Opp (Aspire) — Bahia sod')
    await user.clear(opp)
    await user.type(opp, '20')
    expect(screen.getByTestId('delta-c')).toHaveTextContent('0')
    expect(screen.getByTestId('stat-opp-delta-count')).toHaveTextContent('1')
  })

  it('shows Δ vs Opp blue when ≠ 0 and muted at 0 — independent of the flag', () => {
    renderTab()
    // c is unflagged (OK) but has Δ −4 → blue.
    const deltaC = screen.getByTestId('delta-c')
    expect(deltaC).toHaveTextContent('-4')
    expect(deltaC.className).toContain('1d4ed8')
    // a has Δ 0 → not blue.
    expect(screen.getByTestId('delta-a').className).not.toContain('1d4ed8')
  })

  it('uses the blue-cell convention on all estimator-editable inputs', () => {
    renderTab()
    for (const label of [
      "Plan QTY — Mahogany 10'-12'",
      "Add % — Mahogany 10'-12'",
      'Measured — Bahia sod',
      'Opp (Aspire) — Bahia sod',
    ]) {
      const input = screen.getByLabelText(label)
      expect(input.className).toContain('eff6ff')
      expect(input.className).toContain('bfdbfe')
    }
  })
})

describe('DiscrepancyFlag — CRM banner & surface action', () => {
  it('shows the amber banner with count + threshold when lines are flagged', () => {
    renderTab()
    expect(
      screen.getByText(
        '1 line(s) diverge beyond the 10% threshold — surface to the CRM for the qualifying-notes decision.',
      ),
    ).toBeInTheDocument()
  })

  it('switches to the neutral reconciled banner when nothing is flagged', () => {
    renderTab()
    fireEvent.change(screen.getByLabelText('Flag threshold'), { target: { value: '20' } })
    expect(
      screen.getByText(
        'No lines exceed the threshold. Bid quantities reconcile with measured takeoff.',
      ),
    ).toBeInTheDocument()
  })

  it('"Surface to CRM" toasts the flagged-line count via the shared toast', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: /surface to crm/i }))
    expect(await screen.findByText('1 discrepancy line(s) surfaced to CRM')).toBeInTheDocument()
  })

  it('"Surface to CRM" toasts a nothing-to-surface message when clean', async () => {
    const user = userEvent.setup()
    renderTab()
    fireEvent.change(screen.getByLabelText('Flag threshold'), { target: { value: '20' } })
    await user.click(screen.getByRole('button', { name: /surface to crm/i }))
    expect(
      await screen.findByText('Nothing to surface — all lines reconcile'),
    ).toBeInTheDocument()
  })
})

describe('DiscrepancyFlag — shell integration', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
  })

  it('mounts on the Discrepancy Review tab for an open install estimate', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage initialOpenEstimate={install} />)
    await user.click(screen.getByRole('tab', { name: 'Discrepancy Review' }))
    expect(screen.getByText('Takeoff lines')).toBeInTheDocument()
    expect(screen.getByLabelText('Flag threshold')).toBeInTheDocument()
    // Install fixture seeds the sample takeoff lines.
    const table = screen.getByRole('table')
    expect(within(table).getByText('Bermuda sod')).toBeInTheDocument()
  })
})
