import { describe, it, expect } from 'vitest'
import {
  ASPIRE_BRANCH_CITIES,
  SERVICE_LINES,
  DEFAULT_SERVICE_LINE,
  ASPIRE_LOST_REASONS,
  defaultServiceLine,
} from '@/lib/estimating/aspireOptions'

describe('aspireOptions', () => {
  it('exposes sorted, unique branch cities', () => {
    expect(ASPIRE_BRANCH_CITIES).toContain('Orlando, FL')
    expect(ASPIRE_BRANCH_CITIES).toContain('Raleigh, NC')
    const sorted = [...ASPIRE_BRANCH_CITIES].sort()
    expect(ASPIRE_BRANCH_CITIES).toEqual(sorted)
    expect(new Set(ASPIRE_BRANCH_CITIES).size).toBe(ASPIRE_BRANCH_CITIES.length)
  })

  it('keeps the exact backend map key (double-space Hardscape) as the service-line value', () => {
    const hardscape = SERVICE_LINES.find((s) => s.value === 'Install:  Hardscape')
    expect(hardscape).toBeDefined()
    // display label is tidied to a single space
    expect(hardscape!.label).toBe('Install: Hardscape')
  })

  it('has all eight service lines', () => {
    expect(SERVICE_LINES).toHaveLength(8)
  })

  it('defaults service line per estimate type', () => {
    expect(defaultServiceLine('maintenance')).toBe('Maintenance: Contract')
    expect(defaultServiceLine('install')).toBe('Install: Landscape')
    expect(DEFAULT_SERVICE_LINE.maintenance).toBe('Maintenance: Contract')
  })

  it('exposes only the three active lost reasons', () => {
    expect(ASPIRE_LOST_REASONS.map((r) => r.id).sort()).toEqual([13, 14, 15])
    expect(ASPIRE_LOST_REASONS.find((r) => r.id === 14)!.label).toBe('Quality / Reputation')
  })
})
