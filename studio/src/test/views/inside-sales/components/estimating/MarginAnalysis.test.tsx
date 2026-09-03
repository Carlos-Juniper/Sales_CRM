// ---------------------------------------------------------------------------
// Margin Analysis tab (MarginAnalysis component).
//
// Acceptance criteria under test:
//  - KPIs compute from the live estimate model (same source as the editor);
//    an edited line changes these numbers.
//  - Service-group panel re-aggregates by service across all sections
//    (cost-basis) with % share, margin %, bar, cost/price.
//  - Margin colors come from the config `margin_bands` (band attribute).
//  - View branches by estimateType: maintenance = hours-driven cost-basis;
//    install = materials-inclusive graphic (BRD II-9.7).
//  - Benchmark verdict + 3 cards compute against CONFIG bands (labeled
//    provisional), not inline literals.
//  - "Last 10 tree-work sale prices" strip renders median/range/chips.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import type { ReactNode } from 'react'
import type { Estimate, MaintenanceEstimate } from '@/types/estimating'
import { buildInstallEstimate, buildMaintenanceEstimate } from '@/mocks/estimatingData'
import { contractTotal, groupMargin, marginBand } from '@/lib/estimating/calc'
import { DEFAULT_MARGIN_BANDS } from '@/lib/estimating/config'
import {
  MARGIN_BENCHMARKS,
  benchmarkStatus,
  medianCents,
  perAcreCents,
  serviceGroupMargins,
} from '@/lib/estimating/margins'
import { formatCents } from '@/lib/estimating/maintenance'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import {
  EstimatingShellContext,
  type EstimatingShellApi,
} from '@/views/inside-sales/components/estimating/useEstimatingShell'
import { MarginAnalysis } from '@/views/inside-sales/components/estimating/MarginAnalysis'

function Wrap({ estimate, children }: { estimate: Estimate | null; children: ReactNode }) {
  const shell: EstimatingShellApi = {
    activeTab: 'margins',
    setActiveTab: () => {},
    openEstimate: estimate,
    setOpenEstimate: () => {},
    openEstimateAt: () => {},
  }
  return (
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider value={shell}>{children}</EstimatingShellContext.Provider>
    </EstimatingToastProvider>
  )
}

function renderTab(estimate: Estimate | null) {
  return render(
    <Wrap estimate={estimate}>
      <MarginAnalysis />
    </Wrap>,
  )
}

// Slice 11b: maintenance margin needs a resolved crew rate; the panel resolves
// snapshot→live→null and refuses a number when null. The shared maintenance
// fixture carries a FROZEN snapshot so these existing panel assertions price
// against a deterministic rate with no branch fetch (the no-rate + live-rate
// paths are covered in the dedicated crew-rate block below).
const CREW_RATE = 18_000
const maint = { ...buildMaintenanceEstimate(), crewRateCentsPerHour: CREW_RATE }
const install = buildInstallEstimate()

describe('MarginAnalysis — KPI cards from the live estimate model', () => {
  it('shows contract value, total cost, overall margin (vs target) and target margin', () => {
    renderTab(maint)
    const groups = serviceGroupMargins(maint, CREW_RATE)
    const contract = contractTotal(maint)
    const cost = groups.reduce((s, g) => s + g.costCents, 0)
    const overall = groupMargin(contract, cost)

    expect(screen.getByTestId('margin-kpi-contract')).toHaveTextContent(formatCents(contract))
    expect(screen.getByTestId('margin-kpi-cost')).toHaveTextContent(formatCents(cost))
    expect(screen.getByTestId('margin-kpi-margin')).toHaveTextContent(
      `${(overall * 100).toFixed(1)}%`,
    )
    // ±X% vs target (percentage points against the 22% branch standard)
    const delta = (overall - maint.targetMargin) * 100
    expect(screen.getByTestId('margin-kpi-margin')).toHaveTextContent(
      `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs target`,
    )
    expect(screen.getByTestId('margin-kpi-target')).toHaveTextContent('22%')
    expect(screen.getByTestId('margin-kpi-target')).toHaveTextContent('branch standard')
  })

  it('recomputes when the estimate model changes (editing a line flows through)', () => {
    const { rerender } = renderTab(maint)
    const before = screen.getByTestId('margin-kpi-contract').textContent

    // Same single model the editor mutates: bump one line's occurrences.
    const edited: MaintenanceEstimate = {
      ...maint,
      sections: maint.sections.map((s, i) =>
        i === 0
          ? { ...s, services: s.services.map((v, j) => (j === 0 ? { ...v, qty: v.qty + 10 } : v)) }
          : s,
      ),
    }
    rerender(
      <Wrap estimate={edited}>
        <MarginAnalysis />
      </Wrap>,
    )
    const after = screen.getByTestId('margin-kpi-contract').textContent
    expect(after).not.toBe(before)
    expect(after).toContain(formatCents(contractTotal(edited)))
  })

  it('overall margin card carries the config band, not a hardcoded threshold', () => {
    renderTab(maint)
    const groups = serviceGroupMargins(maint, CREW_RATE)
    const contract = contractTotal(maint)
    const cost = groups.reduce((s, g) => s + g.costCents, 0)
    const band = marginBand(groupMargin(contract, cost), DEFAULT_MARGIN_BANDS)
    expect(screen.getByTestId('margin-kpi-margin')).toHaveAttribute('data-band', band)
  })

  it('renders an empty state when no estimate is open', () => {
    renderTab(null)
    expect(screen.getByTestId('margin-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('margin-kpi-contract')).not.toBeInTheDocument()
  })
})

describe('MarginAnalysis — margin by service group (maintenance, hours-driven)', () => {
  it('renders one row per service label, aggregated across sections', () => {
    renderTab(maint)
    const panel = screen.getByTestId('margin-groups-maintenance')
    const rows = within(panel).getAllByTestId('margin-group-row')
    expect(rows).toHaveLength(4) // Mowing merged across both sections

    const groups = serviceGroupMargins(maint, CREW_RATE)
    const mowing = groups[0]
    const mowingRow = rows[0]
    expect(mowingRow).toHaveTextContent('Mowing')
    expect(mowingRow).toHaveTextContent(`${Math.round(mowing.shareOfContract * 100)}% of contract`)
    expect(mowingRow).toHaveTextContent(`${(mowing.marginPct * 100).toFixed(1)}%`)
    expect(mowingRow).toHaveTextContent(`Cost: ${formatCents(mowing.costCents)}`)
    expect(mowingRow).toHaveTextContent(`Price: ${formatCents(mowing.priceCents)}`)
  })

  it('colors every group margin by the config band and renders the scaled bar', () => {
    renderTab(maint)
    const groups = serviceGroupMargins(maint, CREW_RATE)
    const rows = screen.getAllByTestId('margin-group-row')
    groups.forEach((g, i) => {
      const expected = marginBand(g.marginPct, DEFAULT_MARGIN_BANDS)
      expect(within(rows[i]).getByTestId('group-margin-value')).toHaveAttribute(
        'data-band',
        expected,
      )
      expect(within(rows[i]).getByTestId('group-margin-bar')).toBeInTheDocument()
    })
    // The fixture exercises more than one band — proves colors are not static.
    const bands = new Set(groups.map((g) => marginBand(g.marginPct, DEFAULT_MARGIN_BANDS)))
    expect(bands.size).toBeGreaterThan(1)
  })

  it('labels the maintenance view as the hours-driven cost-basis view', () => {
    renderTab(maint)
    expect(screen.getByTestId('margin-groups-maintenance')).toHaveTextContent(/hours-driven/i)
    expect(screen.queryByTestId('margin-groups-install')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Slice 11b (§2.3 / §2.6): crew-rate resolution at the PANEL boundary.
//
// Maintenance margin is hours × loaded crew rate. With no resolvable rate the
// panel REFUSES a margin (loud failure beats a confidently-wrong number an
// approver then approves). With a rate it prints a provenance line naming the
// number that priced the margin. A frozen snapshot must not move when the live
// branch rate changes (§2.6 stability). The hook is unit-tested separately;
// these assert the rendered panel.
// ---------------------------------------------------------------------------
describe('MarginAnalysis — crew-rate no-fallback panel state (§2.3 / §2.6)', () => {
  const BRANCH_ID = 3696

  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ name: 'Rita Delgado', role: 'inside_sales' }) })
  })

  function mockBranchRate(crewRateCentsPerHour: number | null) {
    server.use(
      http.get(`/api/settings/branch/${BRANCH_ID}`, () =>
        HttpResponse.json({ aspireBranchId: BRANCH_ID, crewRateCentsPerHour }),
      ),
    )
  }

  it('refuses a margin number and shows the no-crew-rate notice when none resolves', async () => {
    // No snapshot + branch has no configured rate ⇒ resolved rate is null.
    mockBranchRate(null)
    const noRate = { ...buildMaintenanceEstimate(), aspireBranchId: BRANCH_ID }
    renderTab(noRate)

    const notice = await screen.findByTestId('margin-no-crew-rate')
    expect(notice).toHaveTextContent(`No crew rate configured for ${noRate.branchCity}`)
    // The panel prints NO margin figure — the KPI cards and group rows are gone.
    expect(screen.queryByTestId('margin-kpi-margin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('margin-group-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('crew-rate-provenance')).not.toBeInTheDocument()
  })

  it('links the no-crew-rate notice to the branch crew-rate settings', async () => {
    mockBranchRate(null)
    const noRate = { ...buildMaintenanceEstimate(), aspireBranchId: BRANCH_ID }
    renderTab(noRate)

    const link = await screen.findByTestId('crew-rate-settings-link')
    expect(link).toHaveAttribute('href', `/settings/branch/${BRANCH_ID}/crew-rate`)
  })

  it('renders the provenance line from the frozen snapshot rate', () => {
    // review-status estimate carrying its own frozen snapshot: the snapshot wins,
    // no branch fetch happens, and the provenance prints the snapshot rate.
    const frozen = {
      ...buildMaintenanceEstimate(),
      status: 'review' as const,
      crewRateCentsPerHour: 18_000,
    }
    renderTab(frozen)
    const prov = screen.getByTestId('crew-rate-provenance')
    expect(prov).toHaveAttribute('data-source', 'snapshot')
    expect(prov).toHaveTextContent('Priced at $180.00/hr loaded crew rate')
    expect(prov).toHaveTextContent(frozen.branchCity as string)
    // A margin IS shown — the snapshot is a valid rate.
    expect(screen.getByTestId('margin-kpi-margin')).toBeInTheDocument()
  })

  it('a frozen snapshot ignores a differing live branch rate (§2.6 stability)', async () => {
    // Live rate moved to $250/hr AFTER submission; the frozen estimate must keep
    // pricing at its $180 snapshot — the displayed margin must not drift.
    mockBranchRate(25_000)
    const frozen = {
      ...buildMaintenanceEstimate(),
      aspireBranchId: BRANCH_ID,
      status: 'review' as const,
      crewRateCentsPerHour: 18_000,
    }
    renderTab(frozen)
    const groups = serviceGroupMargins(frozen, 18_000)
    const cost = groups.reduce((s, g) => s + g.costCents, 0)
    const overall = groupMargin(contractTotal(frozen), cost)

    const before = screen.getByTestId('margin-kpi-margin').textContent
    expect(screen.getByTestId('crew-rate-provenance')).toHaveTextContent(
      'Priced at $180.00/hr loaded crew rate',
    )
    expect(screen.getByTestId('margin-kpi-margin')).toHaveTextContent(`${(overall * 100).toFixed(1)}%`)
    // Let the (ignored) live read settle — the snapshot number must not change.
    await waitFor(() => expect(screen.getByTestId('margin-kpi-cost')).toBeInTheDocument())
    expect(screen.getByTestId('margin-kpi-margin').textContent).toBe(before)
  })

  it('prices from the live branch rate when there is no snapshot', async () => {
    mockBranchRate(19_500)
    const live = { ...buildMaintenanceEstimate(), aspireBranchId: BRANCH_ID }
    renderTab(live)

    const prov = await screen.findByTestId('crew-rate-provenance')
    expect(prov).toHaveAttribute('data-source', 'live')
    expect(prov).toHaveTextContent('Priced at $195.00/hr loaded crew rate')
    // The displayed cost matches the live rate, not the removed 18_000 literal.
    const groups = serviceGroupMargins(live, 19_500)
    const cost = groups.reduce((s, g) => s + g.costCents, 0)
    expect(screen.getByTestId('margin-kpi-cost')).toHaveTextContent(formatCents(cost))
  })
})

describe('MarginAnalysis — install branch (materials-inclusive, II-9.7)', () => {
  it('renders the install-specific materials-inclusive graphic instead of the maintenance view', () => {
    renderTab(install)
    const panel = screen.getByTestId('margin-groups-install')
    expect(panel).toHaveTextContent(/materials-inclusive/i)
    expect(screen.queryByTestId('margin-groups-maintenance')).not.toBeInTheDocument()
  })

  it('shows the labor/material cost split per group', () => {
    renderTab(install)
    const groups = serviceGroupMargins(install, 0)
    const rows = screen.getAllByTestId('margin-group-row')
    expect(rows).toHaveLength(groups.length)
    const trees = groups[0]
    expect(rows[0]).toHaveTextContent(`Materials: ${formatCents(trees.materialCostCents)}`)
    expect(rows[0]).toHaveTextContent(`Labor: ${formatCents(trees.laborCostCents)}`)
    // Materials share of cost — install pricing is materials-driven.
    const matShare = Math.round((trees.materialCostCents / trees.costCents) * 100)
    expect(rows[0]).toHaveTextContent(`${matShare}% of cost`)
    expect(within(rows[0]).getByTestId('group-cost-split-bar')).toBeInTheDocument()
  })

  it('still colors install group margins from the same config bands', () => {
    renderTab(install)
    const groups = serviceGroupMargins(install, 0)
    const rows = screen.getAllByTestId('margin-group-row')
    groups.forEach((g, i) => {
      expect(within(rows[i]).getByTestId('group-margin-value')).toHaveAttribute(
        'data-band',
        marginBand(g.marginPct, DEFAULT_MARGIN_BANDS),
      )
    })
  })
})

// ---------------------------------------------------------------------------
// §2.6 hand-back rate-change notice (Handoff 38, Slice 11b deferred item).
//
// When an in_progress estimate has priorCrewRateCentsPerHour set (meaning it
// was handed back after a freeze) AND the current live branch rate differs from
// that prior rate, the panel shows:
//   "Crew rate changed $X.XX/hr → $Y.YY/hr since this was submitted."
//
// If prior equals the live rate (no change) or prior is null, render nothing.
// ---------------------------------------------------------------------------
describe('MarginAnalysis — crew-rate-changed notice (§2.6 hand-back)', () => {
  const BRANCH_ID = 3696

  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ name: 'Estimator', role: 'maintenance_estimating' }) })
  })

  function mockBranchRate(crewRateCentsPerHour: number | null) {
    server.use(
      http.get(`/api/settings/branch/${BRANCH_ID}`, () =>
        HttpResponse.json({ aspireBranchId: BRANCH_ID, crewRateCentsPerHour }),
      ),
    )
  }

  it('shows the rate-changed notice when prior differs from current live rate', async () => {
    // Prior rate: $180.00/hr (submitted-at); current live: $195.00/hr
    mockBranchRate(19_500)
    const estimate = {
      ...buildMaintenanceEstimate(),
      status: 'in_progress' as const,
      aspireBranchId: BRANCH_ID,
      crewRateCentsPerHour: null,
      priorCrewRateCentsPerHour: 18_000,
    }
    renderTab(estimate)

    const notice = await screen.findByTestId('crew-rate-changed-notice')
    expect(notice).toHaveTextContent('$180.00')
    expect(notice).toHaveTextContent('$195.00')
    expect(notice).toHaveTextContent('since this was submitted')
  })

  it('does not show the notice when prior equals the current live rate (no change)', async () => {
    // Same rate — no drift since submission
    mockBranchRate(18_000)
    const estimate = {
      ...buildMaintenanceEstimate(),
      status: 'in_progress' as const,
      aspireBranchId: BRANCH_ID,
      crewRateCentsPerHour: null,
      priorCrewRateCentsPerHour: 18_000,
    }
    renderTab(estimate)

    // Wait for live fetch to settle
    await screen.findByTestId('crew-rate-provenance')
    expect(screen.queryByTestId('crew-rate-changed-notice')).not.toBeInTheDocument()
  })

  it('does not show the notice when priorCrewRateCentsPerHour is null', async () => {
    // No prior rate means this is a fresh in_progress (never been through a freeze cycle)
    mockBranchRate(19_500)
    const estimate = {
      ...buildMaintenanceEstimate(),
      status: 'in_progress' as const,
      aspireBranchId: BRANCH_ID,
      crewRateCentsPerHour: null,
      priorCrewRateCentsPerHour: null,
    }
    renderTab(estimate)

    await screen.findByTestId('crew-rate-provenance')
    expect(screen.queryByTestId('crew-rate-changed-notice')).not.toBeInTheDocument()
  })

  it('does not show the notice on a frozen estimate (review status)', () => {
    // Review status has a snapshot — it is not in_progress, so no notice
    const estimate = {
      ...buildMaintenanceEstimate(),
      status: 'review' as const,
      crewRateCentsPerHour: 18_000,
      priorCrewRateCentsPerHour: 16_000,
    }
    renderTab(estimate)
    expect(screen.queryByTestId('crew-rate-changed-notice')).not.toBeInTheDocument()
  })
})

describe('MarginAnalysis — benchmark check', () => {
  it('shows the verdict badge from the config $/acre band', () => {
    renderTab(maint)
    const status = benchmarkStatus(perAcreCents(maint), MARGIN_BENCHMARKS.perAcre)
    const verdictText = { ok: 'In range', low: 'Below typical', high: 'Above typical' }[status]
    expect(screen.getByTestId('bench-verdict')).toHaveTextContent(verdictText)
    expect(screen.getByTestId('bench-verdict')).toHaveAttribute('data-status', status)
  })

  it('renders the three benchmark cards against config bands, labeled provisional', () => {
    renderTab(maint)
    const perAcre = screen.getByTestId('bench-card-per-acre')
    expect(perAcre).toHaveTextContent('$3,100–$3,900/ac')
    const annual = screen.getByTestId('bench-card-annual')
    expect(annual).toHaveTextContent('$340K–$460K')
    const mowing = screen.getByTestId('bench-card-mowing')
    expect(mowing).toHaveTextContent('$1,150 median')

    // Provisional labeling — production sources these from won-bid history (III-6).
    expect(screen.getByTestId('benchmark-panel')).toHaveTextContent(/provisional/i)
    // Explicit copy: a gut-check, not a pricing rule.
    expect(screen.getByTestId('benchmark-panel')).toHaveTextContent(
      /a gut-check before approval, not a pricing rule/i,
    )
  })

  it('omits the mowing card when the estimate has no mowing group (install)', () => {
    renderTab(install)
    expect(screen.queryByTestId('bench-card-mowing')).not.toBeInTheDocument()
    expect(screen.getByTestId('bench-card-per-acre')).toBeInTheDocument()
    expect(screen.getByTestId('bench-card-annual')).toBeInTheDocument()
  })

  it('renders the last-10 tree-work strip with computed median, range and 10 chips', () => {
    renderTab(maint)
    const strip = screen.getByTestId('tree-sales-strip')
    const median = medianCents(MARGIN_BENCHMARKS.treeWorkSaleCents)
    const sorted = [...MARGIN_BENCHMARKS.treeWorkSaleCents].sort((a, b) => a - b)
    expect(strip).toHaveTextContent(`median $${(median / 100_000).toFixed(1)}K`)
    expect(strip).toHaveTextContent(
      `range $${(sorted[0] / 100_000).toFixed(1)}K–$${(sorted[9] / 100_000).toFixed(1)}K`,
    )
    expect(within(strip).getAllByTestId('tree-chip')).toHaveLength(10)
  })
})
