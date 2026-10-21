// ---------------------------------------------------------------------------
// Maintenance price per square foot — job value and the company-wide average.
//
// Denominator is turf sq ft + bed sq ft. Bed area is the bed section's
// square feet when that is positive. Seeded bed lines are 0 and are not the
// bed area. A positive bed-line override on a turf or legacy region is added.
//
// Numerator is contractTotal() — section square feet, never the bed line
// override — so showing bed area does not change the job price.
//
// The average is the server's unweighted mean of those per-estimate rates
// across every other maintenance estimate. sampleSize 0 has no average.
// ---------------------------------------------------------------------------

import type { Estimate, EstimateSection, SectionService, ServiceCategory } from '@/types/estimating'
import { contractTotal } from './calc'

export class PriceSqftError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PriceSqftError'
  }
}

export interface SqftClassification {
  categoryCodeById: ReadonlyMap<string, string>
  categoryCodeByServiceId: ReadonlyMap<string, string>
}

export interface MaintainedSqft {
  turfSqft: number
  bedSqft: number
  totalSqft: number
}

export interface PriceSqftBenchmark {
  sampleSize: number
  averageCentsPerSqft: number | null
}

const BED_LABEL = /\bbeds?\b/i

export function classificationFromCatalog(categories: ServiceCategory[]): SqftClassification {
  const categoryCodeById = new Map<string, string>()
  const categoryCodeByServiceId = new Map<string, string>()
  for (const category of categories) {
    if (!category.code) {
      throw new PriceSqftError(`service category ${category.id} has no code`)
    }
    categoryCodeById.set(category.id, category.code)
    for (const service of category.services) {
      categoryCodeByServiceId.set(service.id, category.code)
    }
  }
  return { categoryCodeById, categoryCodeByServiceId }
}

export function needsCategoryCodes(estimate: Estimate): boolean {
  return estimate.sections.some(
    (section) =>
      section.serviceCategoryId != null ||
      section.services.some((service) => service.serviceId != null),
  )
}

function sectionKind(
  section: EstimateSection,
  classification: SqftClassification | null,
): 'turf' | 'bed' | 'other' {
  const categoryId = section.serviceCategoryId
  if (categoryId) {
    if (!classification) {
      throw new PriceSqftError('service catalog is required to classify turf and bed square feet')
    }
    const code = classification.categoryCodeById.get(categoryId)
    if (!code) {
      throw new PriceSqftError(`unknown service category ${categoryId}`)
    }
    if (code === 'turf') return 'turf'
    if (code === 'bed_maint') return 'bed'
    return 'other'
  }
  const name = section.name.trim().toLowerCase()
  if (name === 'turf') return 'turf'
  if (name === 'bed' || name === 'beds') return 'bed'
  return 'other'
}

function lineIsBed(service: SectionService, classification: SqftClassification | null): boolean {
  if (service.serviceId) {
    if (!classification) {
      throw new PriceSqftError('service catalog is required to classify turf and bed square feet')
    }
    const code = classification.categoryCodeByServiceId.get(service.serviceId)
    if (!code) {
      throw new PriceSqftError(`unknown service ${service.serviceId}`)
    }
    return code === 'bed_maint'
  }
  return BED_LABEL.test(service.label)
}

function finiteSqft(value: number | null | undefined, what: string): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) throw new PriceSqftError(`${what} is not a finite number`)
  if (value < 0) throw new PriceSqftError(`${what} is negative`)
  return value
}

function positiveBedLineSqft(
  section: EstimateSection,
  classification: SqftClassification | null,
): number {
  let total = 0
  for (const service of section.services) {
    if (!lineIsBed(service, classification)) continue
    const sqft = finiteSqft(service.squareFeet, `bed square feet on ${service.label}`)
    if (sqft !== null && sqft > 0) total += sqft
  }
  return total
}

/** Turf + bed. Bed is never forced to 0 when a bed section or bed line has area. */
export function maintainedSqft(
  estimate: Estimate,
  classification: SqftClassification | null,
): MaintainedSqft {
  if (estimate.estimateType !== 'maintenance') {
    throw new PriceSqftError('price per sq ft is maintenance-only')
  }
  const described = estimate.sections.map((section) => ({
    section,
    kind: sectionKind(section, classification),
    sqft: finiteSqft(section.squareFeet, `square feet on ${section.name}`),
  }))
  const anyClassified = described.some((row) => row.kind === 'turf' || row.kind === 'bed')
  let turf = 0
  let bed = 0
  for (const row of described) {
    if ((row.kind === 'turf' || row.kind === 'bed' || !anyClassified) && row.sqft === null) {
      throw new PriceSqftError(`square feet on ${row.section.name} is missing`)
    }
    const sectionSqft = row.sqft ?? 0
    const bedLines = positiveBedLineSqft(row.section, classification)
    if (row.kind === 'bed') {
      if (sectionSqft > 0) bed += sectionSqft
      else bed += bedLines
    } else if (row.kind === 'turf' || !anyClassified) {
      turf += sectionSqft
      bed += bedLines
    } else {
      bed += bedLines
    }
  }
  return { turfSqft: turf, bedSqft: bed, totalSqft: turf + bed }
}

export type JobPricePerSqft =
  | { kind: 'value'; cents: number }
  | { kind: 'missing'; reason: 'no-sqft' | 'no-price' }

/** Job cents per sq ft. Missing area and a missing price stay distinct — neither becomes 0¢. */
export function readJobPricePerSqft(
  estimate: Estimate,
  classification: SqftClassification | null,
): JobPricePerSqft {
  const areas = maintainedSqft(estimate, classification)
  if (areas.totalSqft <= 0) return { kind: 'missing', reason: 'no-sqft' }
  const contract = contractTotal(estimate)
  if (contract <= 0) return { kind: 'missing', reason: 'no-price' }
  return { kind: 'value', cents: contract / areas.totalSqft }
}

export function parsePriceSqftBenchmark(raw: PriceSqftBenchmark): PriceSqftBenchmark {
  if (!Number.isInteger(raw.sampleSize) || raw.sampleSize < 0) {
    throw new PriceSqftError('benchmark sampleSize is invalid')
  }
  if (raw.sampleSize === 0) {
    if (raw.averageCentsPerSqft !== null) {
      throw new PriceSqftError('sampleSize 0 must not include an average')
    }
    return { sampleSize: 0, averageCentsPerSqft: null }
  }
  if (typeof raw.averageCentsPerSqft !== 'number' || !(raw.averageCentsPerSqft > 0)) {
    throw new PriceSqftError('benchmark average is missing')
  }
  return { sampleSize: raw.sampleSize, averageCentsPerSqft: raw.averageCentsPerSqft }
}

export function formatCentsPerSqft(cents: number): string {
  if (!Number.isFinite(cents)) throw new PriceSqftError('price per sq ft is not a number')
  const tenths = Math.round(cents * 10) / 10
  return `${tenths.toFixed(1)}¢`
}

/** `Avg 3.0¢ · +10%` or `Avg 4.0¢ · −50%`. Percent is rounded from the raw rates. */
export function formatPriceSqftBenchmark(jobCents: number, averageCents: number): string {
  if (!Number.isFinite(jobCents)) throw new PriceSqftError('job price per sq ft is not a number')
  if (!Number.isFinite(averageCents) || averageCents <= 0) {
    throw new PriceSqftError('benchmark average is missing')
  }
  const pct = ((jobCents - averageCents) / averageCents) * 100
  const rounded = Math.round(pct)
  const sign = rounded < 0 ? '−' : '+'
  return `Avg ${formatCentsPerSqft(averageCents)} · ${sign}${Math.abs(rounded)}%`
}
