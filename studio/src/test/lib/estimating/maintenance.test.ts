// ---------------------------------------------------------------------------
// Handoff 03 — maintenance engine pure helpers.
// Business rules under test: sq-ft basis enforcement (BRD I-6.5), company-
// default complexity + override detection (I-9.7), section CRUD semantics,
// Bidding↔Won lifecycle transition with ownership flip + audit (BRD §8.1),
// and estimator-vs-approver field ownership (enforced in logic, not UI).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import {
  COMPANY_DEFAULT_COMPLEXITY_PCT,
  MAINTENANCE_SERVICE_CATALOG,
  assertSqftBasis,
  isComplexityOverridden,
  coerceQty,
  catalogToService,
  buildDefaultSection,
  duplicateSection,
  removeSection,
  transitionLifecycle,
  lifecycleAuditLog,
  clearLifecycleAuditLog,
  canEditField,
  assertCanEdit,
  formatCents,
  lineCentsPerSqft,
} from '@/lib/estimating/maintenance'
import { buildMaintenanceEstimate } from '@/mocks/estimatingData'

describe('maintenance service catalog (sq-ft basis, BRD I-6.5)', () => {
  it('every catalog service is configured on a square-footage basis', () => {
    for (const row of MAINTENANCE_SERVICE_CATALOG) {
      expect(row.basis).toBe('sqft')
      expect(() => assertSqftBasis(row)).not.toThrow()
    }
  })

  it('fertilization is present and sq-ft based (the $3M–$42M acre bug)', () => {
    const fert = MAINTENANCE_SERVICE_CATALOG.find((r) => r.key === 'fert')
    expect(fert).toBeDefined()
    expect(fert!.basis).toBe('sqft')
  })

  it('assertSqftBasis rejects an acre-based config row', () => {
    expect(() =>
      assertSqftBasis({ key: 'fert', label: 'Fertilizer', basis: 'acre' } as never),
    ).toThrow(/square-footage/i)
  })

  it('mowing exposes kit granularity options (mower sizes, I-9.7)', () => {
    const mow = MAINTENANCE_SERVICE_CATALOG.find((r) => r.key === 'mow')
    expect(mow?.granularity?.options).toEqual(['36"', '52–60"', '72"'])
  })
})

describe('complexity company default (I-9.7)', () => {
  it('matches the fixture norm of 10%', () => {
    expect(COMPANY_DEFAULT_COMPLEXITY_PCT).toBe(0.1)
  })

  it('detects overrides away from the company default', () => {
    expect(isComplexityOverridden(COMPANY_DEFAULT_COMPLEXITY_PCT)).toBe(false)
    expect(isComplexityOverridden(0.05)).toBe(true)
    expect(isComplexityOverridden(0.25)).toBe(true)
  })
})

describe('input coercion', () => {
  it('coerces blank to 0 and rejects negatives', () => {
    expect(coerceQty('')).toBe(0)
    expect(coerceQty('42')).toBe(42)
    expect(coerceQty('-5')).toBe(0)
    expect(coerceQty('abc')).toBe(0)
  })
})

describe('section operations', () => {
  it('catalogToService builds a service from a catalog row', () => {
    const mow = MAINTENANCE_SERVICE_CATALOG.find((r) => r.key === 'mow')!
    const svc = catalogToService(mow, 'sec-1', 3)
    expect(svc.sectionId).toBe('sec-1')
    expect(svc.label).toBe('Mowing')
    expect(svc.qty).toBe(mow.defaultQty)
    expect(svc.unitSellCents).toBe(mow.rateCentsPer1000Sf)
    expect(svc.complexityPct).toBe(COMPANY_DEFAULT_COMPLEXITY_PCT)
    expect(svc.sortOrder).toBe(3)
  })

  it('buildDefaultSection seeds the catalog defaults', () => {
    const sec = buildDefaultSection('est-1', 2)
    expect(sec.estimateId).toBe('est-1')
    expect(sec.name).toBe('New region')
    expect(sec.sortOrder).toBe(2)
    expect(sec.services.length).toBeGreaterThan(0)
    expect(sec.services.map((s) => s.sectionId)).toEqual(
      sec.services.map(() => sec.id),
    )
  })

  it('duplicateSection deep-clones, appends " (copy)", inserts after source', () => {
    const est = buildMaintenanceEstimate()
    const [s1, s2] = est.sections
    const next = duplicateSection(est.sections, s1.id)
    expect(next).toHaveLength(3)
    const copy = next[1]
    expect(copy.name).toBe(`${s1.name} (copy)`)
    expect(copy.id).not.toBe(s1.id)
    expect(next[2].id).toBe(s2.id)
    // deep clone: services are new objects with new ids, re-pointed at the copy
    expect(copy.services).toHaveLength(s1.services.length)
    copy.services.forEach((svc, i) => {
      expect(svc.id).not.toBe(s1.services[i].id)
      expect(svc.sectionId).toBe(copy.id)
      expect(svc.label).toBe(s1.services[i].label)
    })
    // mutating the copy must not touch the source
    copy.services[0].qty = 999
    expect(s1.services[0].qty).not.toBe(999)
  })

  it('removeSection drops only the target', () => {
    const est = buildMaintenanceEstimate()
    const [s1, s2] = est.sections
    const next = removeSection(est.sections, s1.id)
    expect(next.map((s) => s.id)).toEqual([s2.id])
  })
})

describe('lifecycle transition (BRD §8.1) — enforced in the handler', () => {
  beforeEach(() => clearLifecycleAuditLog())

  it('Bidding→Won flips lifecycle AND aspireOwner to crm and writes an audit record', () => {
    const est = buildMaintenanceEstimate()
    expect(est.lifecycle).toBe('bidding')
    expect(est.aspireOwner).toBe('estimating')

    const result = transitionLifecycle(est, 'won', 'Jennifer Petel')
    expect(result).not.toBeNull()
    expect(result!.estimate.lifecycle).toBe('won')
    expect(result!.estimate.aspireOwner).toBe('crm')

    expect(lifecycleAuditLog).toHaveLength(1)
    expect(lifecycleAuditLog[0]).toMatchObject({
      estimateId: est.id,
      from: 'bidding',
      to: 'won',
      aspireOwnerFrom: 'estimating',
      aspireOwnerTo: 'crm',
      actor: 'Jennifer Petel',
    })
  })

  it('Won→Bidding returns ownership to estimating', () => {
    const est = buildMaintenanceEstimate({ lifecycle: 'won', aspireOwner: 'crm' })
    const result = transitionLifecycle(est, 'bidding', 'Jennifer Petel')
    expect(result!.estimate.aspireOwner).toBe('estimating')
  })

  it('a no-op transition returns null and writes no audit record', () => {
    const est = buildMaintenanceEstimate()
    expect(transitionLifecycle(est, 'bidding', 'x')).toBeNull()
    expect(lifecycleAuditLog).toHaveLength(0)
  })

  it('the ownership flip cannot be bypassed: aspireOwner always derives from lifecycle', () => {
    // Even if the caller hands in an inconsistent estimate, the handler corrects it.
    const est = buildMaintenanceEstimate({ lifecycle: 'bidding', aspireOwner: 'crm' })
    const result = transitionLifecycle(est, 'won', 'x')
    expect(result!.estimate.aspireOwner).toBe('crm')
    const back = transitionLifecycle(result!.estimate, 'bidding', 'x')
    expect(back!.estimate.aspireOwner).toBe('estimating')
  })
})

describe('field ownership (estimator vs approver) — logic-level enforcement', () => {
  it('estimators own line items, sqft, occurrences, sections', () => {
    expect(canEditField('estimator', 'qty')).toBe(true)
    expect(canEditField('estimator', 'squareFeet')).toBe(true)
    expect(canEditField('estimator', 'sectionName')).toBe(true)
    expect(canEditField('estimator', 'lineItems')).toBe(true)
  })

  it('complexity is editable by both; margin is approver-only', () => {
    expect(canEditField('estimator', 'complexity')).toBe(true)
    expect(canEditField('approver', 'complexity')).toBe(true)
    expect(canEditField('approver', 'margin')).toBe(true)
    expect(canEditField('estimator', 'margin')).toBe(false)
  })

  it('approvers may NOT edit estimator-owned scope fields', () => {
    expect(canEditField('approver', 'qty')).toBe(false)
    expect(canEditField('approver', 'squareFeet')).toBe(false)
    expect(() => assertCanEdit('approver', 'qty')).toThrow(/estimator/i)
    expect(() => assertCanEdit('estimator', 'margin')).toThrow(/approver/i)
  })
})

describe('display reads', () => {
  it('formatCents renders exact dollars', () => {
    expect(formatCents(2_494_800)).toBe('$24,948.00')
    expect(formatCents(0)).toBe('$0.00')
  })

  it('lineCentsPerSqft derives from the shared per-1,000-SF read', () => {
    // 259,200¢ over 120,000 SF = 2.16¢/SF
    expect(lineCentsPerSqft(259_200, 120_000)).toBeCloseTo(2.16, 5)
    expect(lineCentsPerSqft(100, 0)).toBe(0)
  })
})
