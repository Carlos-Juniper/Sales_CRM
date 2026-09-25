import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { buildMaintenanceEstimate, buildInstallEstimate } from '@/mocks/estimatingData'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'

function seedUser() {
  // Handoff 50 §2: the tab bar is now role-gated. These tests exercise the
  // full estimating workspace (editor, takeoff, margins…), so they run as an
  // estimator — the persona that sees every tab. Sales-only visibility is
  // covered by estimatingTabs.test.ts.
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'maintenance_estimating' }) })
}

const ALL_TAB_LABELS = [
  'Estimate Queue',
  'Line-Item Editor',
  'Takeoff',
  'Materials Calculator',
  'Margin Analysis',
  'Discrepancy Review',
  'Approval & Handoff',
  'Approval Queue',
  'ITB Tracker',
]

describe('EstimatingPage shell', () => {
  beforeEach(() => {
    seedUser()
  })

  it('renders the Estimating header title and redesign subtitle', () => {
    render(<EstimatingPage />)
    expect(screen.getByRole('heading', { name: 'Estimating' })).toBeInTheDocument()
    expect(
      screen.getByText('Intake-driven · manual takeoff · hours-driven kits · value-tiered approval'),
    ).toBeInTheDocument()
  })

  it('renders all 9 config-driven tabs when no estimate is open', () => {
    render(<EstimatingPage />)
    for (const label of ALL_TAB_LABELS) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
  })

  it('shows Estimate Queue tab content by default, with the queue tab active', () => {
    render(<EstimatingPage />)
    expect(screen.getByRole('tab', { name: 'Estimate Queue' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Margin Analysis' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('switching tabs updates the active state and gives the active tab the brand-green highlight', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    const editorTab = screen.getByRole('tab', { name: 'Line-Item Editor' })
    await user.click(editorTab)

    expect(editorTab).toHaveAttribute('aria-selected', 'true')
    expect(editorTab.className).toContain('2E7D52')
    expect(screen.getByRole('tab', { name: 'Estimate Queue' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('does not render the "Not visible to Sales" pill', () => {
    render(<EstimatingPage />)
    expect(screen.queryByText('Not visible to Sales')).not.toBeInTheDocument()
  })

  it('renders the notifications bell', () => {
    render(<EstimatingPage />)
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument()
  })

  describe('estimateType-aware tab visibility', () => {
    it('an open maintenance estimate hides Materials Calculator and Discrepancy Review', () => {
      render(<EstimatingPage initialOpenEstimate={buildMaintenanceEstimate()} />)
      expect(screen.queryByRole('tab', { name: 'Materials Calculator' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Discrepancy Review' })).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Takeoff' })).toBeInTheDocument()
    })

    it('an open install estimate hides Takeoff', () => {
      render(<EstimatingPage initialOpenEstimate={buildInstallEstimate()} />)
      expect(screen.queryByRole('tab', { name: 'Takeoff' })).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Materials Calculator' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Discrepancy Review' })).toBeInTheDocument()
    })
  })

  // Placeholder tab tests are removed as each feature is implemented:
  // - Materials Calculator (MaterialsCalculator)
  // - Discrepancy Review (DiscrepancyFlag)
  // - Approval & Handoff (ApprovalHandoff)
  // - Approval Queue (ApprovalQueue)
  // - ITB Tracker (ItbTracker)
  // All feature tabs are now implemented; no placeholder tabs remain.
})

describe('EstimatingPage feature tabs (existing components)', () => {
  beforeEach(() => {
    seedUser()
  })

  // Margin Analysis reads the OPEN estimate from the shell.
  it('switches to Margin Analysis tab on click (empty state while browsing)', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('tab', { name: 'Margin Analysis' }))
    expect(await screen.findByTestId('margin-empty')).toBeInTheDocument()
  })

  // Line-Item Editor mounted through the shell.
  it('Line-Item Editor: shows an empty state when no estimate is open', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('tab', { name: 'Line-Item Editor' }))
    expect(screen.getByTestId('editor-empty')).toBeInTheDocument()
    expect(screen.getByText(/no estimate open/i)).toBeInTheDocument()
  })

  it('Line-Item Editor: an open maintenance estimate renders the maintenance engine (no mode toggle)', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage initialOpenEstimate={buildMaintenanceEstimate()} />)

    await user.click(screen.getByRole('tab', { name: 'Line-Item Editor' }))
    expect(screen.getByTestId('maintenance-editor')).toBeInTheDocument()
    expect(screen.getAllByTestId('section-card').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('install-editor')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('Line-Item Editor: an open install estimate never renders the maintenance engine', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage initialOpenEstimate={buildInstallEstimate()} />)

    await user.click(screen.getByRole('tab', { name: 'Line-Item Editor' }))
    expect(screen.getByTestId('install-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('maintenance-editor')).not.toBeInTheDocument()
  })

  it('MarginAnalysis renders KPI cards for the open estimate', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage initialOpenEstimate={buildMaintenanceEstimate()} />)

    await user.click(screen.getByRole('tab', { name: 'Margin Analysis' }))
    await screen.findByTestId('margin-kpi-contract')

    expect(screen.getByText('Total contract value')).toBeInTheDocument()
    expect(screen.getByText('Total cost')).toBeInTheDocument()
    expect(screen.getByText('Overall gross margin')).toBeInTheDocument()
    expect(screen.getByText('Target margin')).toBeInTheDocument()
  })

  it('MarginAnalysis renders the service-group panel and benchmark check', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage initialOpenEstimate={buildMaintenanceEstimate()} />)

    await user.click(screen.getByRole('tab', { name: 'Margin Analysis' }))
    expect(await screen.findByText('Margin by service group')).toBeInTheDocument()
    expect(screen.getByTestId('margin-groups-maintenance')).toBeInTheDocument()
    expect(screen.getByTestId('benchmark-panel')).toBeInTheDocument()
  })
})

// ── Real CRM lead context (stub removed) ────────────────────────

const requestEstimateProperty = {
  id: 'prop-1',
  name: 'Pelican Bay',
  propertyType: 'hoa',
  sourceType: 'hoa',
  sourceId: 'h1',
  address1: '6620 Pelican Bay Blvd',
  address2: null,
  city: 'Naples',
  state: 'FL',
  zip: '34108',
  branchCity: 'Naples',
  customerType: 'hoa',
  managementCompanyId: 'pm1',
  aspirePropertyId: null,
  aspireSyncStatus: 'unsynced' as const,
  createdAt: null,
  updatedAt: null,
}

const requestEstimateLead = {
  id: 'lead-77',
  property_name: 'Pelican Bay',
  status: 'new',
  assigned_to: 'Marisol Vega',
  score: 65,
  property_id: 'prop-1',
}

describe('EstimatingPage — property engagement lead context', () => {
  beforeEach(() => {
    seedUser()
  })

  it('"Request estimate" arrival opens the intake pre-filled with REAL lead context — never the L-TBD stub', async () => {
    render(<EstimatingPage />, {
      initialEntries: [
        {
          pathname: '/inside-sales/estimating',
          state: { requestEstimateProperty, requestEstimateLead },
        },
      ],
    })

    // Intake modal auto-opens with the property; banner reflects the real lead
    expect(await screen.findByText(/sourced from crm pipeline/i)).toBeInTheDocument()
    expect(screen.getByText(/lead-77/)).toBeInTheDocument()
    expect(screen.getByText(/Marisol Vega/)).toBeInTheDocument()
    expect(screen.getByText(/65%/)).toBeInTheDocument()
    expect(screen.queryByText(/L-TBD/)).not.toBeInTheDocument()
  })

  it('queue-CTA intake (no property yet) shows no L-TBD stub anywhere', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(await screen.findByRole('button', { name: /maintenance intake/i }))

    expect(await screen.findByText(/maintenance intake/i, { selector: 'h2' })).toBeInTheDocument()
    expect(screen.queryByText(/L-TBD/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Sales Rep/)).not.toBeInTheDocument()
  })
})
