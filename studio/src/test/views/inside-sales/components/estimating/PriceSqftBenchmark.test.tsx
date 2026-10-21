// Company-wide $/sq ft benchmark next to the open job's price per sq ft.
//
// Acceptance: peers at 2¢ and 4¢ (mean 3.0¢) beside a 3.3¢ job read
// "Avg 3.0¢ · +10%". sampleSize 0 reads "No benchmark yet" and never a
// made-up average. A below-average job uses a minus sign.

import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import type { Estimate, EstimateSection, MaintenanceEstimate, SectionService } from '@/types/estimating'
import { contractTotal } from '@/lib/estimating/calc'
import { formatCents } from '@/lib/money'
import { buildMaintenanceEstimate } from '@/mocks/estimatingData'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import {
  EstimatingShellContext,
  type EstimatingShellApi,
} from '@/views/inside-sales/components/estimating/useEstimatingShell'
import { MarginAnalysis } from '@/views/inside-sales/components/estimating/MarginAnalysis'

function Wrap({ estimate, children }: { estimate: Estimate; children: ReactNode }) {
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

function line(
  sectionId: string,
  overrides: Partial<SectionService> & Pick<SectionService, 'id' | 'label'>,
): SectionService {
  return {
    sectionId,
    serviceKitId: null,
    qty: 1,
    uom: '/yr',
    complexityPct: 0,
    unitSellCents: 0,
    embeddedCostCents: null,
    targetGm: null,
    hours: 1,
    sortOrder: 0,
    components: [],
    ...overrides,
  }
}

function turfJob(centsPerSqft: number, extra: EstimateSection[] = []): MaintenanceEstimate {
  const section: EstimateSection = {
    id: 'sec-turf',
    estimateId: 'est-job',
    name: 'Turf',
    squareFeet: 10_000,
    sortOrder: 0,
    serviceCategoryId: null,
    services: [
      line('sec-turf', {
        id: 'svc-mow',
        label: 'Mowing',
        unitSellCents: centsPerSqft * 1000,
      }),
    ],
  }
  return buildMaintenanceEstimate({
    id: 'est-job',
    crewRateCentsPerHour: 18_000,
    sections: [section, ...extra],
  })
}

function mockBenchmark(body: { sampleSize: number; averageCentsPerSqft: number | null } | number) {
  server.use(
    http.get('/api/estimating/estimates/:id/price-sqft-benchmark', () => {
      if (typeof body === 'number') return HttpResponse.json({ detail: 'failed' }, { status: body })
      return HttpResponse.json(body)
    }),
  )
}

describe('MarginAnalysis price per sq ft benchmark', () => {
  it('shows Avg 3.0¢ · +10% for a 3.3¢ job against a 3¢ mean', async () => {
    mockBenchmark({ sampleSize: 2, averageCentsPerSqft: 3 })
    render(
      <Wrap estimate={turfJob(3.3)}>
        <MarginAnalysis />
      </Wrap>,
    )
    expect(await screen.findByTestId('price-sqft-job')).toHaveTextContent('3.3¢')
    await waitFor(() =>
      expect(screen.getByTestId('price-sqft-benchmark')).toHaveTextContent('Avg 3.0¢ · +10%'),
    )
  })

  it('uses a minus sign when the job is below the average', async () => {
    mockBenchmark({ sampleSize: 4, averageCentsPerSqft: 4 })
    render(
      <Wrap estimate={turfJob(2)}>
        <MarginAnalysis />
      </Wrap>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('price-sqft-benchmark')).toHaveTextContent('Avg 4.0¢ · −50%'),
    )
  })

  it('rounds the displayed average to one decimal and the percent to an integer', async () => {
    mockBenchmark({ sampleSize: 3, averageCentsPerSqft: 3.04 })
    render(
      <Wrap estimate={turfJob(3.3)}>
        <MarginAnalysis />
      </Wrap>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('price-sqft-benchmark')).toHaveTextContent('Avg 3.0¢ · +9%'),
    )
  })

  it('shows No benchmark yet when sampleSize is 0 and does not invent a figure', async () => {
    mockBenchmark({ sampleSize: 0, averageCentsPerSqft: null })
    render(
      <Wrap estimate={turfJob(3.3)}>
        <MarginAnalysis />
      </Wrap>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('price-sqft-benchmark')).toHaveTextContent('No benchmark yet'),
    )
    const benchmark = screen.getByTestId('price-sqft-benchmark')
    expect(benchmark.textContent).not.toMatch(/¢|%/)
    expect(screen.getByTestId('price-sqft-job')).toHaveTextContent('3.3¢')
  })

  it('says the benchmark is unavailable when the request fails', async () => {
    mockBenchmark(500)
    render(
      <Wrap estimate={turfJob(3.3)}>
        <MarginAnalysis />
      </Wrap>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('price-sqft-benchmark')).toHaveTextContent('Benchmark unavailable'),
    )
    const benchmark = screen.getByTestId('price-sqft-benchmark')
    expect(benchmark.textContent).not.toContain('No benchmark yet')
  })

  it('counts bed square feet in the job rate and leaves the contract price unchanged', async () => {
    mockBenchmark({ sampleSize: 2, averageCentsPerSqft: 3 })
    const beds: EstimateSection = {
      id: 'sec-beds',
      estimateId: 'est-job',
      name: 'Beds',
      squareFeet: 5_000,
      sortOrder: 1,
      serviceCategoryId: null,
      services: [line('sec-beds', { id: 'svc-bed', label: 'Pruning', squareFeet: 0, unitSellCents: 0 })],
    }
    // Turf line at 3¢/sq ft of the turf section only. Bed section adds 5,000 sq ft
    // and $0 of price, so the job rate is 2.0¢ — not the turf-only 3.0¢.
    const job = turfJob(3, [beds])
    render(
      <Wrap estimate={job}>
        <MarginAnalysis />
      </Wrap>,
    )
    expect(await screen.findByTestId('price-sqft-job')).toHaveTextContent('2.0¢')
    expect(screen.getByTestId('price-sqft-job').textContent).not.toContain('3.0¢')
    expect(screen.getByTestId('margin-kpi-contract')).toHaveTextContent(formatCents(contractTotal(job)))
    await waitFor(() =>
      expect(screen.getByTestId('price-sqft-benchmark')).toHaveTextContent('Avg 3.0¢ · −33%'),
    )
  })
})
