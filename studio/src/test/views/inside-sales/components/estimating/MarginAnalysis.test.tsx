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

import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/utils'
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

const maint = buildMaintenanceEstimate()
const install = buildInstallEstimate()

describe('MarginAnalysis — KPI cards from the live estimate model', () => {
  it('shows contract value, total cost, overall margin (vs target) and target margin', () => {
    renderTab(maint)
    const groups = serviceGroupMargins(maint)
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
    const groups = serviceGroupMargins(maint)
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

    const groups = serviceGroupMargins(maint)
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
    const groups = serviceGroupMargins(maint)
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

describe('MarginAnalysis — install branch (materials-inclusive, II-9.7)', () => {
  it('renders the install-specific materials-inclusive graphic instead of the maintenance view', () => {
    renderTab(install)
    const panel = screen.getByTestId('margin-groups-install')
    expect(panel).toHaveTextContent(/materials-inclusive/i)
    expect(screen.queryByTestId('margin-groups-maintenance')).not.toBeInTheDocument()
  })

  it('shows the labor/material cost split per group', () => {
    renderTab(install)
    const groups = serviceGroupMargins(install)
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
    const groups = serviceGroupMargins(install)
    const rows = screen.getAllByTestId('margin-group-row')
    groups.forEach((g, i) => {
      expect(within(rows[i]).getByTestId('group-margin-value')).toHaveAttribute(
        'data-band',
        marginBand(g.marginPct, DEFAULT_MARGIN_BANDS),
      )
    })
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
