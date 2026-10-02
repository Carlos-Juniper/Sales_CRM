// Handoff 54 §3 — per-line and per-category hours/price reads.
import { describe, it, expect } from 'vitest'
import type { EstimateSection, SectionService } from '@/types/estimating'
import {
  categoryRollup,
  formatHours,
  hasOccurrences,
  maintenanceLineRead,
} from '@/lib/estimating/maintenanceHours'
import { MOW_KIT } from '@/test/fixtures/maintenanceCatalog'

const section: EstimateSection = {
  id: 'sec-1', estimateId: 'e', name: 'Main', squareFeet: 120_000, sortOrder: 0, serviceCategoryId: null, services: [],
}

function svc(over: Partial<SectionService>): SectionService {
  return {
    id: 's', sectionId: 'sec-1', serviceKitId: null, label: 'x', qty: 40, uom: '/yr', complexityPct: 0,
    unitSellCents: 450, embeddedCostCents: null, targetGm: null, hours: null, sortOrder: 0, components: [],
    ...over,
  }
}

describe('maintenanceLineRead', () => {
  it('derives hours from the kit production rate, complexity applied', () => {
    const read = maintenanceLineRead(section, svc({ serviceKitId: MOW_KIT.id, complexityPct: 0.1 }), [MOW_KIT])
    expect(read.perOccurrenceHours).toBeCloseTo(2.2) // 120,000 ÷ 60,000 × 1.10
    expect(read.totalHours).toBeCloseTo(88) // × 40
    expect(read.lineCents).toBe(2_376_000) // 120 × 450 × 40 × 1.10
    expect(read.perOccurrenceCents).toBe(59_400)
  })

  it("prefers the line's own hours", () => {
    const read = maintenanceLineRead(section, svc({ hours: 3, qty: 6 }), [])
    expect(read.totalHours).toBe(18)
  })

  it('returns null hours when neither hours nor a rated kit resolve', () => {
    const read = maintenanceLineRead(section, svc({ serviceKitId: 'kit-unknown' }), [MOW_KIT])
    expect(read.perOccurrenceHours).toBeNull()
    expect(read.totalHours).toBeNull()
  })

  it('has no per-occurrence price with zero occurrences', () => {
    expect(maintenanceLineRead(section, svc({ qty: 0, hours: 1 }), []).perOccurrenceCents).toBeNull()
  })
})

describe('categoryRollup', () => {
  it('sums hours and price over the lines', () => {
    const rollup = categoryRollup(section, [svc({ hours: 1, qty: 2 }), svc({ hours: 2, qty: 3 })], [])
    expect(rollup.totalHours).toBe(8)
    expect(rollup.totalCents).toBe(120 * 450 * 5)
  })

  it('reports null hours when any line is unresolvable', () => {
    const rollup = categoryRollup(section, [svc({ hours: 1 }), svc({})], [])
    expect(rollup.totalHours).toBeNull()
  })

  it('is zero for an empty category', () => {
    expect(categoryRollup(section, [], [])).toEqual({ totalHours: 0, totalCents: 0 })
  })
})

describe('hasOccurrences / formatHours', () => {
  it('detects any line with occurrences', () => {
    expect(hasOccurrences([])).toBe(false)
    expect(hasOccurrences([svc({ qty: 0 })])).toBe(false)
    expect(hasOccurrences([svc({ qty: 0 }), svc({ qty: 1 })])).toBe(true)
  })

  it('formats hours to 2 decimals and null as an em dash', () => {
    expect(formatHours(20494.8)).toBe('20,494.8')
    expect(formatHours(47.8612)).toBe('47.86')
    expect(formatHours(0)).toBe('0')
    expect(formatHours(null)).toBe('—')
  })
})
