// ---------------------------------------------------------------------------
// Install engine helpers (Line-Item Editor, install).
//
// Pure logic + config for the QUANTITY-driven kit editor (BRD II-6.8):
//   • TP = QTY × unit sell price; each line carries an embedded SUB COST and
//     a target GM%. GM% is the pricing lever — never an hourly rate.
//   • HOURS are tracked for production planning only and NEVER move price.
//   • Cost basis feeds up from service_kits; live-goods SKUs may carry
//     multiple vendor prices averaged into the kit cost (II-6.5).
//   • Labor/material component split + same-production-rate labor grouping
//     (II-9.7 — landscape gets the parts/labor split irrigation already has).
//
// The install pipeline stays INDEPENDENT of the maintenance engine (§2c) —
// nothing here imports from ./maintenance, and all pricing
// math flows through ./calc (single source of truth).
// ---------------------------------------------------------------------------

import type {
  ServiceKit,
  ComponentKind,
  Estimate,
  EstimateSection,
  InstallEstimate,
  SectionService,
  SectionServiceComponent,
  CatalogService,
  ServiceCategory,
} from '@/types/estimating'
import { componentCost, groupMargin, installLineTotal, sectionTotal } from './calc'
import { catalogServiceToLine } from './installCatalog'

// ----- Cost basis & margins (II-6.8 / II-6.5) --------------------------------

/** Aspire's five cost buckets, in display order (migration 074). */
export const COMPONENT_KINDS: readonly ComponentKind[] = [
  'labor',
  'material',
  'equipment',
  'subcontractor',
  'other',
]

/** Badge text per cost bucket — never collapse a non-labor kind into "MATERIAL". */
export const COMPONENT_KIND_LABELS: Record<ComponentKind, string> = {
  labor: 'LABOR',
  material: 'MATERIAL',
  equipment: 'EQUIPMENT',
  subcontractor: 'SUB',
  other: 'OTHER',
}

/**
 * Per-unit cost of one component, integer cents (qty × unit cost); null when
 * the unit cost is unknown (Handoff 55 §4/§5: a material with no current
 * price). Never coerce that null to $0 for display.
 */
export function componentUnitCostOrNull(c: SectionServiceComponent): number | null {
  return c.unitCostCents === null ? null : componentCost(c.qty, c.unitCostCents)
}

/**
 * Per-unit cost basis for a kit line, integer cents.
 * With components (the estimator-facing override surface), the LIVE sum of
 * qty × unit cost per component wins; without them, the kit's embedded
 * SUB COST from the catalog applies. Null embedded cost — and a null
 * (unknown) component cost — read as 0 here; `serviceCostOrNull` is the
 * null-aware read the editor renders.
 */
export function unitCostBasisCents(svc: SectionService): number {
  if (svc.components.length > 0) {
    return svc.components.reduce((sum, c) => sum + (componentUnitCostOrNull(c) ?? 0), 0)
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

// ----- Three-level roll-ups: item → service → section (Handoff 55 §6) ---------
//
// Every level reports total COST, total PRICE and GM%. Price always resolves
// (a null unit sell reads as 0, exactly as `serviceTotalCents` and
// calc.sectionTotal already do — kit-priced lines price as before). Cost and
// GM are `null` when they cannot be resolved, and the editor renders "—" for
// null — never 0 (the useResolvedCrewRate.ts convention: refuse a number
// rather than show a plausible-but-wrong one).
//
// The cost basis is the SAME component-sum basis as `unitCostBasisCents`,
// including its fallback to the kit's flat `embeddedCostCents` when a line has
// no components. Margin Analysis (margins.ts installLineCost) reads this same
// basis, so the editor and the panel cannot disagree.

export interface InstallRollup {
  /** Total cost, integer cents; null when unresolvable. */
  costCents: number | null
  /** Total price (TP), integer cents. */
  priceCents: number
  /** Decimal GM; null when cost is unresolvable or price is 0. */
  gm: number | null
}

/** Item-level roll-up: cost is null when the item's unit cost is unknown. */
export interface ItemRollup {
  costCents: number | null
  priceCents: number | null
  gm: number | null
}

/** GM for a roll-up; null (rendered "—") when cost is unknown or price is 0. */
export function rollupGm(priceCents: number, costCents: number | null): number | null {
  if (costCents === null || priceCents === 0) return null
  return groupMargin(priceCents, costCents)
}

/**
 * Line cost with unresolvable made explicit: the component sum when
 * components exist, else qty × embedded cost, else null (no components AND
 * no embedded cost — `serviceSubCostCents` reads that case as 0).
 *
 * Handoff 55 §4: any component with an unknown (null) unit cost makes the
 * line cost unknown. A catalog service line (`serviceId` set) with no items
 * yet has nothing priced, so it costs 0 rather than blanking the section and
 * estimate GM — most catalog services ship with zero default items.
 */
export function serviceCostOrNull(svc: SectionService): number | null {
  if (svc.components.some((c) => c.unitCostCents === null)) return null
  if (svc.components.length === 0 && svc.embeddedCostCents == null) {
    return svc.serviceId ? 0 : null
  }
  return serviceSubCostCents(svc)
}

/** Service (line) roll-up. */
export function serviceRollup(svc: SectionService): InstallRollup {
  const priceCents = serviceTotalCents(svc)
  const costCents = serviceCostOrNull(svc)
  return { costCents, priceCents, gm: rollupGm(priceCents, costCents) }
}

/** Extended item cost, integer cents: line qty × (component qty × unit cost); null when unknown. */
export function componentExtendedCostCents(
  svc: SectionService,
  component: SectionServiceComponent,
): number | null {
  const unit = componentUnitCostOrNull(component)
  return unit === null ? null : Math.round(svc.qty * unit)
}

/**
 * Item (component) roll-ups, index-aligned with `svc.components`.
 *
 * Items carry a cost but no sell price of their own: the line is priced from
 * its unit sell / target GM (one line-level GM — Handoff 55 open item 2). An
 * item's price is therefore its cost-proportional share of the line price,
 * apportioned by largest remainder so the item prices sum exactly to the line
 * TP; its GM equals the line GM. When the line's component cost is 0 the share
 * is undefined, so price and GM are null ("—").
 */
export function componentRollups(svc: SectionService): ItemRollup[] {
  const maybeCosts = svc.components.map((c) => componentExtendedCostCents(svc, c))
  // An unknown item cost leaves the line's cost share undefined for every item.
  if (maybeCosts.some((c) => c === null)) {
    return maybeCosts.map((costCents) => ({ costCents, priceCents: null, gm: null }))
  }
  const costs = maybeCosts as number[]
  const totalCost = costs.reduce((a, b) => a + b, 0)
  const linePrice = serviceTotalCents(svc)
  if (totalCost <= 0) {
    return costs.map((costCents) => ({ costCents, priceCents: null, gm: null }))
  }
  const raw = costs.map((c) => (linePrice * c) / totalCost)
  const floors = raw.map((r) => Math.floor(r))
  let remainder = linePrice - floors.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    floors[i] += 1
    remainder -= 1
  }
  return costs.map((costCents, i) => ({
    costCents,
    priceCents: floors[i],
    gm: rollupGm(floors[i], costCents),
  }))
}

/** Sum roll-ups: cost is null if ANY child cost is unresolvable. */
function sumRollups(children: InstallRollup[], priceCents: number): InstallRollup {
  let costCents: number | null = 0
  for (const r of children) {
    if (r.costCents === null) {
      costCents = null
      break
    }
    costCents += r.costCents
  }
  return { costCents, priceCents, gm: rollupGm(priceCents, costCents) }
}

/** Section (group) roll-up; price from calc.sectionTotal (never re-derived). */
export function sectionRollup(
  section: EstimateSection,
  serviceRollups: InstallRollup[] = section.services.map(serviceRollup),
): InstallRollup {
  return sumRollups(serviceRollups, sectionTotalCents(section))
}

/** Estimate (parent-row) roll-up. */
export function estimateRollup(
  estimate: Estimate,
  sectionRollups: InstallRollup[] = estimate.sections.map((s) => sectionRollup(s)),
): InstallRollup {
  const price = sectionRollups.reduce((sum, r) => sum + r.priceCents, 0)
  return sumRollups(sectionRollups, price)
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

// ----- Sections from the service catalog (Handoff 55 §3, as revised) ----------
//
// Every install estimate is created by the BACKEND with one section per
// standard catalog category, in catalog order, each carrying its
// serviceCategoryId. The editor never creates, repeats or renames those
// sections, and there are no area suffixes. The only section an estimator
// can add is Aspire's Optional Services group, by picking one of its
// services (the backend 422s any other section add, duplicate or rename).

/** The install Optional Services category, if the catalog has one. */
export function optionalServicesCategory(categories: ServiceCategory[]): ServiceCategory | null {
  return categories.find((c) => c.estimateType === 'install' && c.isOptional) ?? null
}

/** The estimate's Optional Services section (linked by category id), if present. */
export function findCategorySection(
  sections: EstimateSection[],
  category: ServiceCategory,
): EstimateSection | null {
  return sections.find((s) => s.serviceCategoryId === category.id) ?? null
}

/**
 * Add an Optional Services service (with its default items, §4): into the
 * estimate's existing Optional Services section, else into ONE new section
 * named after the category (never a second one). Returns the new sections.
 */
export function addOptionalService(
  estimateId: string,
  sections: EstimateSection[],
  category: ServiceCategory,
  service: CatalogService,
): EstimateSection[] {
  const existing = findCategorySection(sections, category)
  if (existing) {
    return sections.map((s) =>
      s === existing
        ? { ...s, services: [...s.services, catalogServiceToLine(service, s.id, s.services.length)] }
        : s,
    )
  }
  const id = newId('sec')
  const section: EstimateSection = {
    id,
    estimateId,
    name: category.name,
    // Square footage drives maintenance pricing only.
    squareFeet: 0,
    sortOrder: sections.length,
    services: [catalogServiceToLine(service, id, 0)],
    serviceCategoryId: category.id,
  }
  return [...sections, section]
}

// ----- Components ("+ Add labor / cost line", II-9.7) ---------------------------

const NEW_COMPONENT_LABEL: Record<ComponentKind, string> = {
  labor: 'Install labor',
  material: 'New material line',
  equipment: 'New equipment line',
  subcontractor: 'New subcontractor line',
  other: 'New cost line',
}

/** Defaults for a freshly split plain line (any cost bucket, no material link). */
export function buildComponent(
  sectionServiceId: string,
  kind: ComponentKind,
  sortOrder = 0,
): SectionServiceComponent {
  return {
    id: newId('cmp'),
    sectionServiceId,
    kind,
    label: NEW_COMPONENT_LABEL[kind],
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
    // An unknown-cost labor line has no rate to group on; it stays separate.
    if (c.kind !== 'labor' || c.unitCostCents === null) {
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
 * An install kit row: a ServiceKit carrying its per-vendor price quotes.
 * Live-goods SKUs (a 3-gal shrub can range $0.25–$0.75) average their vendor
 * prices into the kit's cost basis.
 *
 * II-9.5 — these are CONFIG ROWS: kit unit prices / costs / GM% are edited
 * in-app by authorized Estimating/Operations users via catalog admin (a
 * separate surface — open item with Carlos), never by a developer deploy.
 * The component cells in the editor are the per-estimate override surface.
 */
export interface InstallServiceKit extends ServiceKit {
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
export const INSTALL_SERVICE_KITS: InstallServiceKit[] = [
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
    aspireBranchId: null,
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
    aspireBranchId: null,
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
    aspireBranchId: null,
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
    aspireBranchId: null,
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
    aspireBranchId: null,
    active: true,
    serviceType: 'Landscape Install',
  },
]

/**
 * The editors read kits from GET /service-kits.
 * Adapts install_quantity service kits into the editor's kit shape; the API
 * row carries a single blended unit cost, which stands in as the one vendor
 * quote until per-vendor pricing lands. The INSTALL_SERVICE_KITS literal
 * survives ONLY as the offline fallback (API unreachable / not yet loaded ⇒
 * empty list).
 */
export function installServiceKitsFromItems(items: ServiceKit[]): InstallServiceKit[] {
  const kits = items.filter((k) => k.kitType === 'install_quantity' && k.active)
  if (kits.length === 0) return INSTALL_SERVICE_KITS
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
  kit: InstallServiceKit,
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
    serviceKitId: kit.id,
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

/** A fresh local id for a draft node (the server mints the real one on save). */
export function newDraftId(prefix: string): string {
  return newId(prefix)
}

/** Placeholder for an unresolvable value — never render 0 in its place. */
export const UNRESOLVED = '—'

/** GM% display read with the unresolvable convention: null → "—". */
export function formatGmPctOrDash(gm: number | null): string {
  return gm === null ? UNRESOLVED : formatGmPct(gm)
}
