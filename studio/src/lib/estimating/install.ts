// ---------------------------------------------------------------------------
// Install engine helpers (Handoff 04 — Line-Item Editor, install).
//
// Pure logic + config for the QUANTITY-driven kit editor (BRD II-6.8):
//   • TP = QTY × unit sell price; each line carries an embedded SUB COST and
//     a target GM%. GM% is the pricing lever — never an hourly rate.
//   • HOURS are tracked for production planning only and NEVER move price.
//   • Cost basis feeds up from catalog_items; live-goods SKUs may carry
//     multiple vendor prices averaged into the kit cost (II-6.5).
//   • Labor/material component split + same-production-rate labor grouping
//     (II-9.7 — landscape gets the parts/labor split irrigation already has).
//
// The install pipeline stays INDEPENDENT of the maintenance engine (written
// handoff §2c) — nothing here imports from ./maintenance, and all pricing
// math flows through ./calc (single source of truth).
// ---------------------------------------------------------------------------

import type {
  CatalogItem,
  ComponentKind,
  Estimate,
  EstimateSection,
  InstallEstimate,
  SectionService,
  SectionServiceComponent,
} from '@/types/estimating'
import { componentCost, groupMargin, installLineTotal, sectionTotal } from './calc'

// ----- Cost basis & margins (II-6.8 / II-6.5) --------------------------------

/**
 * Per-unit cost basis for a kit line, integer cents.
 * With components (the estimator-facing override surface), the LIVE sum of
 * qty × unit cost per component wins; without them, the kit's embedded
 * SUB COST from the catalog applies. Null embedded cost reads as 0.
 */
export function unitCostBasisCents(svc: SectionService): number {
  if (svc.components.length > 0) {
    return svc.components.reduce((sum, c) => sum + componentCost(c.qty, c.unitCostCents), 0)
  }
  return svc.embeddedCostCents ?? 0
}

/** Line total price (TP), integer cents: QTY × U/P. Hours play no part. */
export function serviceTotalCents(svc: SectionService): number {
  return installLineTotal(svc.qty, svc.unitSellCents ?? 0)
}

/** Line SUB COST, integer cents: QTY × per-unit cost basis. */
export function serviceSubCostCents(svc: SectionService): number {
  return Math.round(svc.qty * unitCostBasisCents(svc))
}

/** Live line GM% as a decimal — (TP − sub cost) / TP; 0 when TP is 0. */
export function serviceGm(svc: SectionService): number {
  return groupMargin(serviceTotalCents(svc), serviceSubCostCents(svc))
}

/** Group (section) roll-ups. TP comes from calc.sectionTotal — never re-derived. */
export function sectionTotalCents(section: EstimateSection): number {
  return sectionTotal(section, 'install')
}

export function sectionSubCostCents(section: EstimateSection): number {
  return section.services.reduce((sum, svc) => sum + serviceSubCostCents(svc), 0)
}

export function sectionGm(section: EstimateSection): number {
  return groupMargin(sectionTotalCents(section), sectionSubCostCents(section))
}

/** Estimate (parent-row) roll-ups. */
export function estimateSubCostCents(estimate: Estimate): number {
  return estimate.sections.reduce((sum, s) => sum + sectionSubCostCents(s), 0)
}

export function estimateGm(estimate: InstallEstimate): number {
  const total = estimate.sections.reduce((sum, s) => sum + sectionTotalCents(s), 0)
  return groupMargin(total, estimateSubCostCents(estimate))
}

// ----- Hours (production planning ONLY — never price) -------------------------

export function sectionHours(section: EstimateSection): number {
  return section.services.reduce((sum, svc) => sum + (svc.hours ?? 0), 0)
}

export function estimateHours(estimate: Estimate): number {
  return estimate.sections.reduce((sum, s) => sum + sectionHours(s), 0)
}

// ----- Ids --------------------------------------------------------------------

let opSeq = 0
function newId(prefix: string): string {
  opSeq += 1
  return `${prefix}-${Date.now()}-${opSeq}`
}

// ----- Components ("+ Add labor / cost line", II-9.7) ---------------------------

/** Defaults for a freshly split labor or material/cost line. */
export function buildComponent(
  sectionServiceId: string,
  kind: ComponentKind,
  sortOrder = 0,
): SectionServiceComponent {
  return {
    id: newId('cmp'),
    sectionServiceId,
    kind,
    label: kind === 'labor' ? 'Install labor' : 'New material line',
    qty: 1,
    unitCostCents: 0,
    hours: kind === 'labor' ? 1 : null,
    sortOrder,
  }
}

/**
 * II-9.7 — bid landscape like irrigation: species sharing a production rate
 * collapse into ONE labor line (qty + hours summed) while material lines stay
 * separate. "Same production rate" keys off the labor line's unit cost.
 */
export function groupSameRateLabor(
  components: SectionServiceComponent[],
): SectionServiceComponent[] {
  const merged: SectionServiceComponent[] = []
  const laborByRate = new Map<number, SectionServiceComponent>()
  for (const c of components) {
    if (c.kind !== 'labor') {
      merged.push(c)
      continue
    }
    const existing = laborByRate.get(c.unitCostCents)
    if (!existing) {
      const copy = { ...c }
      laborByRate.set(c.unitCostCents, copy)
      merged.push(copy)
      continue
    }
    existing.qty += c.qty
    if (c.hours !== null) existing.hours = (existing.hours ?? 0) + c.hours
  }
  return merged.map((c, i) => ({ ...c, sortOrder: i }))
}

// ----- Kit catalog (II-6.5 live-goods volatility / II-9.5 config-not-code) -----

/**
 * An install kit row: a CatalogItem carrying its per-vendor price quotes.
 * Live-goods SKUs (a 3-gal shrub can range $0.25–$0.75) average their vendor
 * prices into the kit's cost basis.
 *
 * II-9.5 — these are CONFIG ROWS: kit unit prices / costs / GM% are edited
 * in-app by authorized Estimating/Operations users via catalog admin (a
 * separate surface — open item with Carlos), never by a developer deploy.
 * The component cells in the editor are the per-estimate override surface.
 */
export interface InstallCatalogKit extends CatalogItem {
  vendorPricesCents: number[]
}

/** Averaged/current cost basis over vendor quotes, integer cents (II-6.5). */
export function averagedVendorCostCents(vendorPricesCents: number[]): number {
  if (vendorPricesCents.length === 0) return 0
  return Math.round(
    vendorPricesCents.reduce((a, b) => a + b, 0) / vendorPricesCents.length,
  )
}

/** Seed "… — Installed" quantity kits. Adding a kit is a data change. */
export const INSTALL_KIT_CATALOG: InstallCatalogKit[] = [
  {
    id: 'kit-mahogany-30g',
    description: "Mahogany, 10'-12' x 3'-4', 2\" cal — Installed",
    uom: '30g',
    unitCostCents: 68750,
    vendorPricesCents: [67200, 70300],
    unitSellCents: 125000,
    targetGm: 0.45,
    kitType: 'install_quantity',
    productionRate: null,
    branch: 'Phoenix-Desert',
    active: true,
    serviceType: 'Landscape Install',
  },
  {
    id: 'kit-shrub-3g',
    description: 'Indian Hawthorn 3 gal — Installed',
    uom: '3g',
    unitCostCents: 519,
    // live-goods volatility: the same SKU quotes $4.10–$6.30 across vendors
    vendorPricesCents: [410, 520, 630],
    unitSellCents: 725,
    targetGm: 0.28,
    kitType: 'install_quantity',
    productionRate: null,
    branch: 'Phoenix-Desert',
    active: true,
    serviceType: 'Landscape Install',
  },
  {
    id: 'kit-spray-head',
    description: 'PROS06 6" Spray — Installed',
    uom: 'EA',
    unitCostCents: 449,
    vendorPricesCents: [449],
    unitSellCents: 817,
    targetGm: 0.45,
    kitType: 'install_quantity',
    productionRate: null,
    branch: 'Phoenix-Desert',
    active: true,
    serviceType: 'Irrigation Install',
  },
  {
    id: 'kit-lateral-pipe',
    description: '1" CL200 PVC — Installed',
    uom: 'FT',
    unitCostCents: 50,
    vendorPricesCents: [46, 54],
    unitSellCents: 91,
    targetGm: 0.45,
    kitType: 'install_quantity',
    productionRate: null,
    branch: 'Phoenix-Desert',
    active: true,
    serviceType: 'Irrigation Install',
  },
  {
    id: 'kit-mulch-2cf',
    description: 'IN: Cocobrown 2CF Bag — Installed',
    uom: '2CF Bag',
    unitCostCents: 255,
    vendorPricesCents: [240, 270],
    unitSellCents: 325,
    targetGm: 0.22,
    kitType: 'install_quantity',
    productionRate: null,
    branch: 'Phoenix-Desert',
    active: true,
    serviceType: 'Landscape Install',
  },
]

/**
 * Handoff 22 — the editors read kits from GET /catalog-items (Handoff 16).
 * Adapts install_quantity CatalogItems into the editor's kit shape; the API
 * row carries a single blended unit cost, which stands in as the one vendor
 * quote until per-vendor pricing lands. The INSTALL_KIT_CATALOG literal
 * survives ONLY as the offline fallback (API unreachable / not yet loaded ⇒
 * empty list).
 */
export function installKitCatalogFromItems(items: CatalogItem[]): InstallCatalogKit[] {
  const kits = items.filter((k) => k.kitType === 'install_quantity' && k.active)
  if (kits.length === 0) return INSTALL_KIT_CATALOG
  return kits.map((k) => ({
    ...k,
    vendorPricesCents: k.unitCostCents > 0 ? [k.unitCostCents] : [],
  }))
}

/**
 * Seed a SectionService from an install kit. The cost basis feeds from the
 * catalog row's averaged vendor prices — the runtime guard keeps the two
 * pricing engines independent (a maintenance_hours kit can never enter here).
 */
export function kitToService(
  kit: InstallCatalogKit,
  sectionId: string,
  sortOrder: number,
): SectionService {
  if (kit.kitType !== 'install_quantity') {
    throw new Error(
      `Install lines only accept install_quantity kits — "${kit.description}" is ` +
        `${kit.kitType}. The two pricing engines never merge (BRD II-6.8).`,
    )
  }
  return {
    id: newId('svc'),
    sectionId,
    catalogItemId: kit.id,
    label: kit.description,
    qty: 1,
    uom: kit.uom,
    complexityPct: 0,
    unitSellCents: kit.unitSellCents,
    embeddedCostCents: averagedVendorCostCents(kit.vendorPricesCents),
    targetGm: kit.targetGm,
    hours: null,
    sortOrder,
    components: [],
  }
}

// ----- Input coercion / display reads -------------------------------------------

/** Blank/invalid input coerces to 0; negatives clamp to 0. */
export function coerceNum(raw: string): number {
  const n = Number(raw)
  if (raw.trim() === '' || Number.isNaN(n) || n < 0) return 0
  return n
}

/** GM% display read: 0.4498… → "44.98%". */
export function formatGmPct(gm: number): string {
  return `${(gm * 100).toFixed(2)}%`
}

/** Exact dollars from integer cents: 5_342_000 → "$53,420.00". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
