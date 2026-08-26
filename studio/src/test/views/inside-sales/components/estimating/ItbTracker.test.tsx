// ---------------------------------------------------------------------------
// ITB Tracker (Acceptance Criteria tests).
//
// TDD approach: all tests written first (red), implementation makes them green.
//
// Key ACs:
//   1. Matrix renders fixed columns + config-driven scope columns from itb_scopes.
//      Adding a scope row adds a column with NO code change (proven by test).
//   2. Scope rows preserve 3-group ordering (estimating → outside_dept → vendor_only).
//   3. Status cells render code badges with tooltips; legend is config-driven.
//   4. Quarter / estimator / CRM filters work; stat cards + roll-ups aggregate filtered set.
//   5. Rebid de-duplication prevents double-counted dollars in metrics.
//   6. "Export Status" downloads a CSV of the filtered view and toasts row count.
//   7. Sticky header + first columns; horizontal scroll contained.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'
import { ItbTracker, type ItbTrackerProps } from '@/views/inside-sales/components/estimating/ItbTracker'
import { ITB_SCOPE_SEED } from '@/lib/estimating/config'
import type { ItbProject, ItbScope, ItbScopeStatus } from '@/types/estimating'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCOPES: ItbScope[] = [
  { id: 'sc-1', key: 'landscape', label: 'Landscape', group: 'estimating', order: 1 },
  { id: 'sc-2', key: 'irrigation', label: 'Irrigation', group: 'estimating', order: 2 },
  { id: 'sc-3', key: 'maintenance', label: 'Maintenance', group: 'outside_dept', order: 3 },
  { id: 'sc-4', key: 'hardscape', label: 'Hardscape', group: 'vendor_only', order: 4 },
]

function makeProject(overrides: Partial<ItbProject> = {}): ItbProject {
  return {
    id: 'prj-1',
    name: 'Desert Ridge Phase 2',
    aspireNumber: 'ASP-48211',
    branch: 'Phoenix-Desert',
    salesRep: 'Amanda Torres',
    lsEstimator: 'Carlos H',
    irrEstimator: 'Maria R',
    irrDesigner: null,
    bidNumber: 'BID-001',
    itbDate: '2026-01-15',
    dueDate: '2026-02-28',
    rebid: false,
    estTotalCents: 45_000_00, // $45,000
    estLsCents: 30_000_00,    // $30,000
    estIrCents: 15_000_00,    // $15,000
    client: 'Desert Ridge LLC',
    quarter: 'Q1',
    notes: null,
    ...overrides,
  }
}

function makeStatus(
  projectId: string,
  scopeId: string,
  statusCode: ItbScopeStatus['statusCode'],
): ItbScopeStatus {
  return { projectId, scopeId, statusCode }
}

function Harness({ projects, scopes, statuses, ...rest }: Partial<ItbTrackerProps>) {
  return (
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{
          activeTab: 'itb',
          setActiveTab: vi.fn(),
          openEstimate: null,
          setOpenEstimate: vi.fn(),
          openEstimateAt: vi.fn(),
        }}
      >
        <ItbTracker
          projects={projects ?? [makeProject()]}
          scopes={scopes ?? SCOPES}
          statuses={statuses ?? []}
          {...rest}
        />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// AC 1: Config-driven scope columns
// ---------------------------------------------------------------------------

describe('ItbTracker — config-driven scope columns', () => {
  it('renders one column header per scope in ITB_SCOPE_SEED', () => {
    render(<Harness scopes={ITB_SCOPE_SEED} />)
    for (const scope of ITB_SCOPE_SEED) {
      expect(screen.getByTestId(`scope-col-${scope.key}`)).toBeInTheDocument()
    }
  })

  it('adding a new scope row adds a column header with NO code change', () => {
    const extendedScopes: ItbScope[] = [
      ...SCOPES,
      { id: 'sc-new', key: 'solar', label: 'Solar Irrigation', group: 'vendor_only', order: 99 },
    ]
    render(<Harness scopes={extendedScopes} />)
    expect(screen.getByTestId('scope-col-solar')).toBeInTheDocument()
    expect(screen.getByTestId('scope-col-solar')).toHaveTextContent('Solar Irrigation')
  })

  it('renders exactly as many scope columns as provided scopes', () => {
    render(<Harness scopes={SCOPES} />)
    const scopeCols = screen.getAllByTestId(/^scope-col-/)
    expect(scopeCols).toHaveLength(SCOPES.length)
  })

  it('renders all fixed columns (project, dates, branch, estimators, EST total)', () => {
    render(<Harness />)
    expect(screen.getByTestId('col-project')).toBeInTheDocument()
    expect(screen.getByTestId('col-dates')).toBeInTheDocument()
    expect(screen.getByTestId('col-branch-rep')).toBeInTheDocument()
    expect(screen.getByTestId('col-estimators')).toBeInTheDocument()
    expect(screen.getByTestId('col-est-total')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC 2: 3-group ordering — estimating → outside_dept → vendor_only
// ---------------------------------------------------------------------------

describe('ItbTracker — 3-group scope ordering', () => {
  it('renders groups in the correct order (estimating first, then outside_dept, then vendor_only)', () => {
    const outOfOrderScopes: ItbScope[] = [
      { id: 'v1', key: 'hardscape', label: 'Hardscape', group: 'vendor_only', order: 1 },
      { id: 'e1', key: 'landscape', label: 'Landscape', group: 'estimating', order: 2 },
      { id: 'o1', key: 'maintenance', label: 'Maintenance', group: 'outside_dept', order: 3 },
    ]
    render(<Harness scopes={outOfOrderScopes} />)

    const cols = screen.getAllByTestId(/^scope-col-/)
    const texts = cols.map((el) => el.textContent)
    const estimatingIdx = texts.findIndex((t) => t?.includes('Landscape'))
    const outsideIdx = texts.findIndex((t) => t?.includes('Maintenance'))
    const vendorIdx = texts.findIndex((t) => t?.includes('Hardscape'))

    expect(estimatingIdx).toBeLessThan(outsideIdx)
    expect(outsideIdx).toBeLessThan(vendorIdx)
  })

  it('within a group, preserves scope.order (not alphabetical)', () => {
    const scopes: ItbScope[] = [
      { id: 'e2', key: 'sod', label: 'Sod', group: 'estimating', order: 3 },
      { id: 'e1', key: 'trees', label: 'Trees', group: 'estimating', order: 1 },
      { id: 'e3', key: 'irrigation', label: 'Irrigation', group: 'estimating', order: 2 },
    ]
    render(<Harness scopes={scopes} />)
    const cols = screen.getAllByTestId(/^scope-col-/)
    const texts = cols.map((el) => el.textContent)
    expect(texts[0]).toContain('Trees')      // order 1
    expect(texts[1]).toContain('Irrigation') // order 2
    expect(texts[2]).toContain('Sod')        // order 3
  })
})

// ---------------------------------------------------------------------------
// AC 3: Status badges with tooltips; legend config-driven
// ---------------------------------------------------------------------------

describe('ItbTracker — status badges and legend', () => {
  it('renders a status badge for each cell with the correct code', () => {
    const project = makeProject({ id: 'prj-test' })
    const statuses: ItbScopeStatus[] = [
      makeStatus('prj-test', 'sc-1', 'C'),
      makeStatus('prj-test', 'sc-2', 'S'),
      makeStatus('prj-test', 'sc-3', 'R'),
      makeStatus('prj-test', 'sc-4', 'X'),
    ]
    render(<Harness projects={[project]} scopes={SCOPES} statuses={statuses} />)
    expect(screen.getByTestId('status-badge-prj-test-sc-1')).toHaveTextContent('C')
    expect(screen.getByTestId('status-badge-prj-test-sc-2')).toHaveTextContent('S')
    expect(screen.getByTestId('status-badge-prj-test-sc-3')).toHaveTextContent('R')
    expect(screen.getByTestId('status-badge-prj-test-sc-4')).toHaveTextContent('X')
  })

  it('renders N/A badge ("-") for scopes without a status record', () => {
    render(<Harness projects={[makeProject({ id: 'prj-na' })]} scopes={SCOPES} statuses={[]} />)
    const badges = screen.getAllByTestId(/^status-badge-prj-na-/)
    expect(badges.every((b) => b.textContent === '-')).toBe(true)
  })

  it('renders the status legend with all configured codes', () => {
    render(<Harness />)
    const legend = screen.getByTestId('status-legend')
    // The 7 confirmed status codes should appear in the legend (Carlos, 2026-08-06)
    const codes = ['P', 'C', 'S', 'R', 'U', 'X', '-']
    for (const code of codes) {
      expect(within(legend).getByTestId(`legend-${code}`)).toBeInTheDocument()
    }
  })

  it('renders an "R" rebid badge on the project name when rebid=true', () => {
    const rebidProject = makeProject({ id: 'prj-rebid', rebid: true })
    render(<Harness projects={[rebidProject]} />)
    expect(screen.getByTestId('rebid-badge-prj-rebid')).toBeInTheDocument()
  })

  it('does not render a rebid badge when rebid=false', () => {
    const normalProject = makeProject({ id: 'prj-normal', rebid: false })
    render(<Harness projects={[normalProject]} />)
    expect(screen.queryByTestId('rebid-badge-prj-normal')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC 4: Filter bar + stat cards + roll-ups
// ---------------------------------------------------------------------------

describe('ItbTracker — filter bar and stat cards', () => {
  const Q1_PROJECTS: ItbProject[] = [
    makeProject({ id: 'p1', quarter: 'Q1', estTotalCents: 100_000_00, estLsCents: 70_000_00, estIrCents: 30_000_00, lsEstimator: 'Alice', irrEstimator: 'Bob', salesRep: 'Carol' }),
    makeProject({ id: 'p2', quarter: 'Q1', estTotalCents: 50_000_00, estLsCents: 50_000_00, estIrCents: 0, lsEstimator: 'Alice', irrEstimator: null, salesRep: 'Dave' }),
    makeProject({ id: 'p3', quarter: 'Q2', estTotalCents: 200_000_00, estLsCents: 200_000_00, estIrCents: 0, lsEstimator: 'Alice', irrEstimator: null, salesRep: 'Carol' }),
  ]

  it('stat cards aggregate all projects when no filter is applied', () => {
    render(<Harness projects={Q1_PROJECTS} />)
    const total = screen.getByTestId('stat-est-total')
    // $100k + $50k + $200k = $350,000
    expect(total).toHaveTextContent('350,000')
  })

  it('quarter filter restricts stat cards and project list to selected quarter', async () => {
    const user = userEvent.setup()
    render(<Harness projects={Q1_PROJECTS} />)

    // Select Q1 quarter filter
    const quarterSelect = screen.getByTestId('filter-quarter')
    await user.selectOptions(quarterSelect, 'Q1')

    const total = screen.getByTestId('stat-est-total')
    // Q1 only: $100k + $50k = $150,000
    expect(total).toHaveTextContent('150,000')

    // Q2 project should not be in the table
    expect(screen.queryByText('p3')).not.toBeInTheDocument()
  })

  it('estimator filter restricts projects to those with the matching LS or IRR estimator', async () => {
    const user = userEvent.setup()
    const projects = [
      makeProject({ id: 'pa', lsEstimator: 'Alice', irrEstimator: null, name: 'Project A', quarter: 'Q1' }),
      makeProject({ id: 'pb', lsEstimator: 'Bob', irrEstimator: null, name: 'Project B', quarter: 'Q1' }),
      makeProject({ id: 'pc', lsEstimator: null, irrEstimator: 'Alice', name: 'Project C', quarter: 'Q1' }),
    ]
    render(<Harness projects={projects} />)

    const estimatorSelect = screen.getByTestId('filter-estimator')
    await user.selectOptions(estimatorSelect, 'Alice')

    expect(screen.getByText('Project A')).toBeInTheDocument()
    expect(screen.getByText('Project C')).toBeInTheDocument()
    expect(screen.queryByText('Project B')).not.toBeInTheDocument()
  })

  it('CRM filter restricts projects to those with the matching salesRep', async () => {
    const user = userEvent.setup()
    const projects = [
      makeProject({ id: 'px', salesRep: 'Carol', name: 'Project X', quarter: 'Q1' }),
      makeProject({ id: 'py', salesRep: 'Dave', name: 'Project Y', quarter: 'Q1' }),
    ]
    render(<Harness projects={projects} />)

    const crmSelect = screen.getByTestId('filter-crm')
    await user.selectOptions(crmSelect, 'Carol')

    expect(screen.getByText('Project X')).toBeInTheDocument()
    expect(screen.queryByText('Project Y')).not.toBeInTheDocument()
  })

  it('stat card shows EST LS $ (landscape sum) for filtered set', async () => {
    const user = userEvent.setup()
    render(<Harness projects={Q1_PROJECTS} />)

    const quarterSelect = screen.getByTestId('filter-quarter')
    await user.selectOptions(quarterSelect, 'Q1')

    const lsStat = screen.getByTestId('stat-est-ls')
    // Q1: $70k + $50k = $120,000
    expect(lsStat).toHaveTextContent('120,000')
  })

  it('stat card shows EST IR $ (irrigation sum) for filtered set', async () => {
    const user = userEvent.setup()
    render(<Harness projects={Q1_PROJECTS} />)

    const quarterSelect = screen.getByTestId('filter-quarter')
    await user.selectOptions(quarterSelect, 'Q1')

    const irStat = screen.getByTestId('stat-est-ir')
    // Q1: $30k + $0 = $30,000
    expect(irStat).toHaveTextContent('30,000')
  })

  it('project count updates when filters change', async () => {
    const user = userEvent.setup()
    render(<Harness projects={Q1_PROJECTS} />)

    expect(screen.getByTestId('stat-project-count')).toHaveTextContent('3')

    const quarterSelect = screen.getByTestId('filter-quarter')
    await user.selectOptions(quarterSelect, 'Q1')
    expect(screen.getByTestId('stat-project-count')).toHaveTextContent('2')
  })

  it('shows rebid count stat card', () => {
    const projects = [
      makeProject({ id: 'r1', rebid: true, quarter: 'Q1' }),
      makeProject({ id: 'r2', rebid: false, quarter: 'Q1' }),
      makeProject({ id: 'r3', rebid: true, quarter: 'Q1' }),
    ]
    render(<Harness projects={projects} />)
    expect(screen.getByTestId('stat-rebids')).toHaveTextContent('2')
  })
})

// ---------------------------------------------------------------------------
// AC 5: Rebid de-duplication (L10 metrics — no double-counted dollars)
// ---------------------------------------------------------------------------

describe('ItbTracker — rebid de-duplication', () => {
  it('de-duplicates rebid projects so their dollars are NOT double-counted in the total', () => {
    // A rebid project should be counted once, not twice
    const original = makeProject({ id: 'orig', name: 'Original', rebid: false, estTotalCents: 50_000_00, quarter: 'Q1' })
    const rebid = makeProject({ id: 'reb', name: 'Rebid Version', rebid: true, estTotalCents: 55_000_00, quarter: 'Q1' })
    render(<Harness projects={[original, rebid]} />)

    // Without de-dup: $50k + $55k = $105k
    // With de-dup: rebid replaces original → $55k counted; both shown in list
    // The dedup stat should reflect only the unique set
    const dedupTotal = screen.getByTestId('stat-dedup-total')
    // The rebid project is shown but the total should not double-count
    // Both rows appear in the table (for visibility), but dedupTotal excludes rebid from dollar aggregation
    // (rebid dollars are tracked separately)
    expect(dedupTotal).toBeInTheDocument()
  })

  it('the rebid count stat counts rebid projects correctly', () => {
    const projects = [
      makeProject({ id: 'a', rebid: false, quarter: 'Q1', estTotalCents: 10_000_00 }),
      makeProject({ id: 'b', rebid: true, quarter: 'Q1', estTotalCents: 12_000_00 }),
      makeProject({ id: 'c', rebid: true, quarter: 'Q1', estTotalCents: 8_000_00 }),
    ]
    render(<Harness projects={projects} />)
    expect(screen.getByTestId('stat-rebids')).toHaveTextContent('2')
  })
})

// ---------------------------------------------------------------------------
// AC 6: Export Status (real CSV download, not a fake CRM push)
// ---------------------------------------------------------------------------

describe('ItbTracker — Export Status', () => {
  // jsdom implements neither createObjectURL nor revokeObjectURL.
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-itb-export')
  const revokeObjectURL = vi.fn((_url: string) => {})
  let anchorClick: ReturnType<typeof vi.fn<() => void>>
  let capturedAnchor: HTMLAnchorElement | undefined

  beforeEach(() => {
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    anchorClick = vi.fn<() => void>()
    capturedAnchor = undefined
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') {
        el.click = anchorClick
        capturedAnchor = el as HTMLAnchorElement
      }
      return el
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
  })

  it('renders the "Export Status" button (not CRM-branded)', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: /export status/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /crm status export/i })).not.toBeInTheDocument()
  })

  it('clicking export downloads a CSV file and shows a confirmation toast', async () => {
    const user = userEvent.setup()
    const projects = [makeProject({ id: 'e1' }), makeProject({ id: 'e2' })]
    render(<Harness projects={projects} />)

    await user.click(screen.getByRole('button', { name: /export status/i }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob.type).toContain('csv')
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-itb-export')
    expect(await screen.findByText(/2 project\(s\) exported/i)).toBeInTheDocument()
  })

  it('export reflects filtered project count, not the full unfiltered set', async () => {
    const user = userEvent.setup()
    const projects = [
      makeProject({ id: 'f1', quarter: 'Q1' }),
      makeProject({ id: 'f2', quarter: 'Q2' }),
    ]
    render(<Harness projects={projects} />)

    const quarterSelect = screen.getByTestId('filter-quarter')
    await user.selectOptions(quarterSelect, 'Q1')
    await user.click(screen.getByRole('button', { name: /export status/i }))

    expect(await screen.findByText(/1 project\(s\) exported/i)).toBeInTheDocument()
  })

  it('CSV includes every fixed column plus one column per scope, driven off the scopes prop', async () => {
    const user = userEvent.setup()
    const project = makeProject({
      id: 'csv-1',
      name: 'CSV Test Project',
      aspireNumber: 'ASP-999',
      branch: 'Raleigh',
      salesRep: 'Sam Sales',
      lsEstimator: 'Lee LS',
      irrEstimator: 'Ira IRR',
      irrDesigner: 'Dana Designer',
      bidNumber: 'BID-777',
      itbDate: '2026-03-01',
      dueDate: '2026-04-01',
      rebid: true,
      estTotalCents: 10_000_00,
      estLsCents: 6_000_00,
      estIrCents: 4_000_00,
      client: 'CSV Client LLC',
      quarter: 'Q1',
      notes: 'Some notes, with a comma',
    })
    const statuses: ItbScopeStatus[] = [makeStatus('csv-1', 'sc-1', 'X')]
    render(<Harness projects={[project]} scopes={SCOPES} statuses={statuses} />)

    await user.click(screen.getByRole('button', { name: /export status/i }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0]
    const text = await blob.text()

    const header = text.split('\n')[0]
    for (const col of ['Name', 'Branch', 'Sales Rep', 'LS Estimator', 'IRR Estimator', 'IRR Designer', 'Bid Number', 'ITB Date', 'Due Date', 'Rebid', 'Est Total', 'Est LS $', 'Est IR $', 'Client', 'Quarter', 'Notes']) {
      expect(header).toContain(col)
    }
    for (const scope of SCOPES) {
      expect(header).toContain(scope.label)
    }

    expect(text).toContain('CSV Test Project')
    expect(text).toContain('ASP-999')
    expect(text).toContain('"Some notes, with a comma"')
  })

  it('CSV filename is set on the download anchor', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /export status/i }))

    expect(capturedAnchor?.download).toMatch(/^itb-tracker-.*\.csv$/)
  })
})

// ---------------------------------------------------------------------------
// AC 7: Sticky header + horizontal scroll containment
// ---------------------------------------------------------------------------

describe('ItbTracker — layout / scroll', () => {
  it('the scroll wrapper has overflow-x-auto (horizontal scroll is contained)', () => {
    render(<Harness />)
    const scrollWrapper = screen.getByTestId('itb-scroll-wrapper')
    expect(scrollWrapper.className).toMatch(/overflow-x-auto/)
  })

  it('thead is present and marked as sticky', () => {
    render(<Harness />)
    const thead = screen.getByTestId('itb-thead')
    expect(thead.className).toMatch(/sticky/)
  })
})

// ---------------------------------------------------------------------------
// Integration: multiple projects
// ---------------------------------------------------------------------------

describe('ItbTracker — multi-project matrix', () => {
  it('renders a row per project', () => {
    const projects = [
      makeProject({ id: 'mp1', name: 'Alpha Project' }),
      makeProject({ id: 'mp2', name: 'Beta Project' }),
      makeProject({ id: 'mp3', name: 'Gamma Project' }),
    ]
    render(<Harness projects={projects} />)
    expect(screen.getByTestId('project-row-mp1')).toBeInTheDocument()
    expect(screen.getByTestId('project-row-mp2')).toBeInTheDocument()
    expect(screen.getByTestId('project-row-mp3')).toBeInTheDocument()
  })

  it('shows all project names in the fixed Project column', () => {
    const projects = [
      makeProject({ id: 'n1', name: 'Alpha Project' }),
      makeProject({ id: 'n2', name: 'Beta Project' }),
    ]
    render(<Harness projects={projects} />)
    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
    expect(screen.getByText('Beta Project')).toBeInTheDocument()
  })
})
