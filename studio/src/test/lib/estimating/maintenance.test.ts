// ---------------------------------------------------------------------------
// Maintenance engine pure helpers.
// Business rules under test: sq-ft basis enforcement (BRD I-6.5), company-
// default complexity + override detection (I-9.7), section CRUD semantics,
// the pure aspireOwner-from-lifecycle derivation (BRD §8.1),
// and estimator-vs-approver field ownership (enforced in logic, not UI).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
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
  aspireOwnerFor,
  canEditField,
  assertCanEdit,
  estimatingRolesForUser,
  canUserEditField,
  MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR,
  formatCents,
  lineCentsPerSqft,
  maintenanceCatalogFromItems,
  sellRateCentsPer1000Sf,
  unresolvedProductionRateLabels,
} from '@/lib/estimating/maintenance'
import type { CatalogItem } from '@/types/estimating'
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

describe('aspireOwner derivation (BRD §8.1)', () => {
  // The lifecycle flip itself persists server-side (estimatingApi.setLifecycle);
  // the pure derivation rule stays client-side as the reference.
  it('won hands ownership to the CRM', () => {
    expect(aspireOwnerFor('won')).toBe('crm')
  })

  it('bidding keeps ownership with estimating', () => {
    expect(aspireOwnerFor('bidding')).toBe('estimating')
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

describe('canonical auth role → estimating role mapping', () => {
  it('estimators = maintenance/install estimating (+ admin)', () => {
    expect(estimatingRolesForUser('maintenance_estimating')).toContain('estimator')
    expect(estimatingRolesForUser('install_estimating')).toContain('estimator')
    expect(estimatingRolesForUser('admin')).toContain('estimator')
    expect(estimatingRolesForUser('regional_sales_rep')).toContain('estimator')
    expect(estimatingRolesForUser('vp_sales')).toContain('estimator')
    expect(estimatingRolesForUser('regional_director')).not.toContain('estimator')
    expect(estimatingRolesForUser('vice_president')).not.toContain('estimator')
    expect(estimatingRolesForUser('manager')).not.toContain('estimator')
    expect(estimatingRolesForUser('sales')).not.toContain('estimator')
  })

  it('approvers = manager/RD/VP/CEO (+ admin)', () => {
    for (const r of ['manager', 'regional_director', 'vice_president', 'ceo', 'admin', 'regional_sales_rep', 'vp_sales'] as const) {
      expect(estimatingRolesForUser(r)).toContain('approver')
    }
    expect(estimatingRolesForUser('maintenance_estimating')).not.toContain('approver')
    expect(estimatingRolesForUser('procurement')).toEqual([])
  })

  it('legacy sales roles have no estimating scope', () => {
    expect(estimatingRolesForUser('inside_sales')).toEqual([])
    expect(estimatingRolesForUser('outside_sales')).toEqual([])
  })

  it('canUserEditField composes the mapping with field ownership', () => {
    expect(canUserEditField('maintenance_estimating', 'qty')).toBe(true)
    expect(canUserEditField('maintenance_estimating', 'margin')).toBe(false)
    expect(canUserEditField('manager', 'margin')).toBe(true)
    expect(canUserEditField('manager', 'qty')).toBe(false)
    expect(canUserEditField('admin', 'qty')).toBe(true)
    expect(canUserEditField('admin', 'margin')).toBe(true)
    expect(canUserEditField('sales', 'qty')).toBe(false)
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

// ---------------------------------------------------------------------------
// The editor reads kits from GET /catalog-items; the literal is
// only the offline fallback. Plus the client half of the save guard.
// ---------------------------------------------------------------------------

const kit = (over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'description'>): CatalogItem => ({
  uom: 'Sq. Ft.',
  unitCostCents: 0,
  unitSellCents: 0,
  targetGm: 0.22,
  kitType: 'maintenance_hours',
  productionRate: null,
  branch: 'All Branches',
  active: true,
  serviceType: '',
  ...over,
})

describe('maintenanceCatalogFromItems (API catalog adapter)', () => {
  const rated = kit({ id: 'kit-1', description: 'Standard Production Mowing', productionRate: 67650 })

  it('falls back to the literal when the API returned no usable kits', () => {
    expect(maintenanceCatalogFromItems([])).toBe(MAINTENANCE_SERVICE_CATALOG)
  })

  it('adapts rated sq-ft maintenance kits to editor catalog rows (kit id = key)', () => {
    const rows = maintenanceCatalogFromItems([rated])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('kit-1')
    expect(rows[0].label).toBe('Standard Production Mowing')
    expect(rows[0].basis).toBe('sqft')
  })

  it('excludes unrated, inactive, non-sqft, and install kits (only guard-passing kits are addable)', () => {
    const items: CatalogItem[] = [
      rated,
      kit({ id: 'kit-unrated', description: 'Prune Easy' }),
      kit({ id: 'kit-inactive', description: 'Old Kit', productionRate: 100, active: false }),
      kit({ id: 'kit-count', description: 'Tree Rings', productionRate: 10, uom: 'CT' }),
      kit({ id: 'kit-install', description: 'Mulch', productionRate: 5, kitType: 'install_quantity' }),
    ]
    expect(maintenanceCatalogFromItems(items).map((r) => r.key)).toEqual(['kit-1'])
  })

  it('derives the sell rate from the production rate + crew rate + target GM when unit sell is 0', () => {
    const rows = maintenanceCatalogFromItems([rated])
    expect(rows[0].rateCentsPer1000Sf).toBe(
      sellRateCentsPer1000Sf(67650, 0.22, MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR),
    )
    // and an explicit unit sell wins
    const priced = kit({ id: 'kit-2', description: 'Priced', productionRate: 5000, unitSellCents: 450 })
    expect(maintenanceCatalogFromItems([priced])[0].rateCentsPer1000Sf).toBe(450)
  })

  it('sellRateCentsPer1000Sf = (1000 ÷ rate) × crew rate ÷ (1 − GM)', () => {
    // 1000/60000 h × 18,000¢ = 300¢ cost → /0.78 = 385¢
    expect(sellRateCentsPer1000Sf(60_000, 0.22, 18_000)).toBe(385)
  })
})

describe('unresolvedProductionRateLabels (client save guard)', () => {
  const rated = kit({ id: 'kit-1', description: 'Mow', productionRate: 67650 })
  const unrated = kit({ id: 'kit-2', description: 'Prune Easy' })

  function sectionsWith(over: Partial<Parameters<typeof unresolvedProductionRateLabels>[0][number]['services'][number]>) {
    const est = buildMaintenanceEstimate()
    est.sections[0].services[0] = { ...est.sections[0].services[0], ...over }
    return est.sections
  }

  it('a line with explicit hours always resolves', () => {
    expect(unresolvedProductionRateLabels(sectionsWith({ hours: 1.6 }), [])).toEqual([])
  })

  it('flags a line with no hours and no kit — even with the catalog not loaded', () => {
    expect(
      unresolvedProductionRateLabels(sectionsWith({ hours: null, catalogItemId: null }), []),
    ).toEqual(['Mowing'])
  })

  it('resolves through a production-rated kit', () => {
    expect(
      unresolvedProductionRateLabels(sectionsWith({ hours: null, catalogItemId: 'kit-1' }), [rated]),
    ).toEqual([])
  })

  it('flags an unrated or unknown kit once the catalog is loaded', () => {
    expect(
      unresolvedProductionRateLabels(sectionsWith({ hours: null, catalogItemId: 'kit-2' }), [rated, unrated]),
    ).toEqual(['Mowing'])
    expect(
      unresolvedProductionRateLabels(sectionsWith({ hours: null, catalogItemId: 'kit-nope' }), [rated]),
    ).toEqual(['Mowing'])
  })

  it('gives a kit-carrying line the benefit of the doubt while the catalog is unknown (server still enforces)', () => {
    expect(
      unresolvedProductionRateLabels(sectionsWith({ hours: null, catalogItemId: 'kit-2' }), []),
    ).toEqual([])
  })
})
