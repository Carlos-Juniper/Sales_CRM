import { describe, expect, it } from 'vitest'
import type { EstimateSection, MaintenanceEstimate, SectionService } from '@/types/estimating'
import { contractTotal } from '@/lib/estimating/calc'
import { buildMaintenanceEstimate } from '@/mocks/estimatingData'
import {
  PriceSqftError,
  formatPriceSqftBenchmark,
  maintainedSqft,
  parsePriceSqftBenchmark,
  readJobPricePerSqft,
  type SqftClassification,
} from '@/lib/estimating/pricePerSqft'

function line(sectionId: string, overrides: Partial<SectionService> & Pick<SectionService, 'id' | 'label'>): SectionService {
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

function section(overrides: Partial<EstimateSection> & Pick<EstimateSection, 'id' | 'name' | 'squareFeet'>): EstimateSection {
  return {
    estimateId: 'est-job',
    sortOrder: 0,
    serviceCategoryId: null,
    services: [],
    ...overrides,
  }
}

function estimate(sections: EstimateSection[]): MaintenanceEstimate {
  return buildMaintenanceEstimate({ id: 'est-job', crewRateCentsPerHour: 18_000, sections })
}

const catalog: SqftClassification = {
  categoryCodeById: new Map([
    ['cat-turf', 'turf'],
    ['cat-bed', 'bed_maint'],
    ['cat-irr', 'irrigation'],
  ]),
  categoryCodeByServiceId: new Map([
    ['svc-mow', 'turf'],
    ['svc-bed', 'bed_maint'],
  ]),
}

describe('maintainedSqft', () => {
  it('uses a bed section’s square feet when the seeded bed line is 0', () => {
    const areas = maintainedSqft(
      estimate([
        section({
          id: 'turf',
          name: 'Turf',
          squareFeet: 10_000,
          serviceCategoryId: 'cat-turf',
          services: [line('turf', { id: 'mow', label: 'Mowing', serviceId: 'svc-mow', unitSellCents: 300, squareFeet: null })],
        }),
        section({
          id: 'beds',
          name: 'Beds',
          squareFeet: 5_000,
          serviceCategoryId: 'cat-bed',
          services: [line('beds', { id: 'bed', label: 'Pruning', serviceId: 'svc-bed', unitSellCents: 100, squareFeet: 0 })],
        }),
      ]),
      catalog,
    )
    expect(areas.turfSqft).toBe(10_000)
    expect(areas.bedSqft).toBe(5_000)
    expect(areas.totalSqft).toBe(15_000)
  })

  it('adds a positive bed-line area without changing the contract total', () => {
    const without = estimate([
      section({
        id: 'sec',
        name: 'Common Area',
        squareFeet: 10_000,
        services: [
          line('sec', { id: 'mow', label: 'Mowing', unitSellCents: 300 }),
          line('sec', { id: 'bed', label: 'Bed Maintenance', unitSellCents: 100, squareFeet: 0 }),
        ],
      }),
    ])
    const withBed = estimate([
      section({
        id: 'sec',
        name: 'Common Area',
        squareFeet: 10_000,
        services: [
          line('sec', { id: 'mow', label: 'Mowing', unitSellCents: 300 }),
          line('sec', { id: 'bed', label: 'Bed Maintenance', unitSellCents: 100, squareFeet: 2_500 }),
        ],
      }),
    ])
    expect(contractTotal(without)).toBe(contractTotal(withBed))
    expect(maintainedSqft(without, null).bedSqft).toBe(0)
    expect(maintainedSqft(withBed, null)).toMatchObject({ turfSqft: 10_000, bedSqft: 2_500, totalSqft: 12_500 })
  })

  it('reads a zero bed section from the typed line instead of staying at 0', () => {
    const areas = maintainedSqft(
      estimate([
        section({
          id: 'beds',
          name: 'Beds',
          squareFeet: 0,
          services: [line('beds', { id: 'bed', label: 'Bed Maintenance', squareFeet: 3_000, unitSellCents: 100 })],
        }),
      ]),
      null,
    )
    expect(areas.bedSqft).toBe(3_000)
    expect(readJobPricePerSqft(estimate([
      section({
        id: 'beds',
        name: 'Beds',
        squareFeet: 0,
        services: [line('beds', { id: 'bed', label: 'Bed Maintenance', squareFeet: 3_000, unitSellCents: 100 })],
      }),
    ]), null)).toEqual({ kind: 'missing', reason: 'no-price' })
  })
})

describe('parsePriceSqftBenchmark', () => {
  it('rejects an average when the sample is empty', () => {
    expect(() => parsePriceSqftBenchmark({ sampleSize: 0, averageCentsPerSqft: 3 })).toThrow(PriceSqftError)
    expect(parsePriceSqftBenchmark({ sampleSize: 0, averageCentsPerSqft: null })).toEqual({
      sampleSize: 0,
      averageCentsPerSqft: null,
    })
  })
})

describe('formatPriceSqftBenchmark', () => {
  it('rounds the average to a tenth and the percent to an integer', () => {
    expect(formatPriceSqftBenchmark(3.3, 3)).toBe('Avg 3.0¢ · +10%')
    expect(formatPriceSqftBenchmark(3.3, 3.04)).toBe('Avg 3.0¢ · +9%')
    expect(formatPriceSqftBenchmark(2, 4)).toBe('Avg 4.0¢ · −50%')
  })
})
