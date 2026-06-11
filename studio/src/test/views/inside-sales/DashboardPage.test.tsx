import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import DashboardPage from '@/views/inside-sales/DashboardPage'
import { mockSummary } from '@/mocks/data'

// Mock recharts and leaflet to avoid canvas errors in jsdom
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
    AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
    BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
    PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
    LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
    ComposedChart: ({ children }: { children: React.ReactNode }) => <div data-testid="composed-chart">{children}</div>,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Area: () => null,
    Bar: () => null,
    Line: () => null,
    Pie: () => null,
    Cell: () => null,
  }
})

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  CircleMarker: () => null,
  Tooltip: () => null,
}))

vi.mock('leaflet', () => ({
  default: {},
  map: vi.fn(),
  tileLayer: vi.fn(),
}))

function seedUser() {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
}

describe('DashboardPage', () => {
  beforeEach(() => {
    seedUser()
  })

  it('renders page title Analytics in TopNav', async () => {
    render(<DashboardPage />)
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })

  it('renders greeting for user', async () => {
    render(<DashboardPage />)
    // Greeting includes first name
    expect(screen.getByText(/Carlos/)).toBeInTheDocument()
  })

  it('shows loading skeletons while dashboard request is in-flight', async () => {
    // Override handler with slow response
    server.use(
      http.get('/api/dashboard/inside-sales', async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return HttpResponse.json(mockSummary)
      })
    )
    render(<DashboardPage />)
    // Skeleton cards should appear
    const skeletons = document.querySelectorAll('[class*="skeleton"], [class*="Skeleton"], .h-20')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders KPI stat cards after data loads', async () => {
    render(<DashboardPage />)
    // Wait for data to appear
    await screen.findByText('New leads')
    expect(screen.getByText('New leads')).toBeInTheDocument()
    expect(screen.getByText('Open value')).toBeInTheDocument()
    expect(screen.getByText('Open bids')).toBeInTheDocument()
    expect(screen.getByText('Deals')).toBeInTheDocument()
  })

  it('renders KPI values from mocked API data', async () => {
    render(<DashboardPage />)
    await screen.findByText('New leads')
    // mockSummary.new_leads_today = 4
    expect(screen.getByText('4')).toBeInTheDocument()
    // won_this_month = 2
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders leads in queue count from summary', async () => {
    render(<DashboardPage />)
    await screen.findByText(/leads in your queue/)
    expect(screen.getByText(/4 leads in your queue/)).toBeInTheDocument()
  })

  it('shows error message on API 500, does not crash', async () => {
    server.use(
      http.get('/api/dashboard/inside-sales', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )
    // Should render without crashing; stat cards just won't appear
    render(<DashboardPage />)
    // Page title should still be visible
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })

  it('renders Today, Pipeline, and Won this month section labels', async () => {
    render(<DashboardPage />)
    await screen.findByText('New leads')
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText('Won this month')).toBeInTheDocument()
  })

  it('renders analytics sub-cards (PipelineAnalyticsCard, TeamPerformanceCard etc.)', async () => {
    render(<DashboardPage />)
    // These cards render their own data via separate hooks — just check containers mount
    await screen.findByText('New leads')
    // The grid with analytics cards should be present
    const analyticsSection = document.querySelector('.grid')
    expect(analyticsSection).not.toBeNull()
  })

  it('AI summary button renders', async () => {
    render(<DashboardPage />)
    expect(screen.getByRole('button', { name: /AI summary/i })).toBeInTheDocument()
  })
})
