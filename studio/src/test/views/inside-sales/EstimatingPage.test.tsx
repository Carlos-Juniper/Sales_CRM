import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { buildMaintenanceEstimate, buildInstallEstimate } from '@/mocks/estimatingData'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'

function seedUser() {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
}

const ALL_TAB_LABELS = [
  'Estimate Queue',
  'Line-Item Editor',
  'Takeoff Insert',
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
      expect(screen.getByRole('tab', { name: 'Takeoff Insert' })).toBeInTheDocument()
    })

    it('an open install estimate hides Takeoff Insert', () => {
      render(<EstimatingPage initialOpenEstimate={buildInstallEstimate()} />)
      expect(screen.queryByRole('tab', { name: 'Takeoff Insert' })).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Materials Calculator' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Discrepancy Review' })).toBeInTheDocument()
    })
  })

  // Placeholder tab tests are removed as each feature is implemented:
  // - Materials Calculator — Handoff 05 (MaterialsCalculator)
  // - Discrepancy Review — Handoff 06 (DiscrepancyFlag)
  // - Approval & Handoff — Handoff 08 (ApprovalHandoff)
  // - Approval Queue — Handoff 09 (ApprovalQueue)
  // - ITB Tracker — Handoff 13 (ItbTracker)
  // All feature tabs are now implemented; no placeholder tabs remain.
})

describe('EstimatingPage feature tabs (existing components)', () => {
  beforeEach(() => {
    seedUser()
  })

  // Handoff 07 — Margin Analysis reads the OPEN estimate from the shell.
  it('switches to Margin Analysis tab on click (empty state while browsing)', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('tab', { name: 'Margin Analysis' }))
    expect(await screen.findByTestId('margin-empty')).toBeInTheDocument()
  })

  // Handoff 03 — Line-Item Editor mounted through the shell.
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
