// ---------------------------------------------------------------------------
// MSW fixture for GET /api/estimating/materials (Handoff 55 §5, backend PR #41).
//
// MOCK-ONLY: a handful of rows in the backend's MaterialSearchItem shape.
// `searchMaterialsFixture` mirrors the endpoint's contract: case-insensitive
// match on inventoryId / description / alternateName, optional
// itemClassCodes filter, limit clamped to 100, keyset paging via an opaque
// cursor (here: the next offset as a string).
// ---------------------------------------------------------------------------

import type { MaterialSearchItem, MaterialSearchResponse } from '@/types/estimating'
import { clampMaterialLimit } from '@/lib/estimating/materialSearch'

function mat(
  inventoryId: string,
  description: string,
  itemClassCode: number,
  itemClassName: string,
  uom: string,
  unitCostCents: number | null,
  costUom: string | null = unitCostCents === null ? null : uom,
): MaterialSearchItem {
  return {
    inventoryId,
    description,
    alternateName: null,
    itemClass: null,
    itemClassCode,
    itemClassName,
    itemClassLabel: `${itemClassCode}-${itemClassName}`,
    uom,
    baseUom: uom,
    salesUom: uom,
    purchaseUom: costUom ?? uom,
    preferredVendorName: null,
    unitCostCents,
    costUom,
  }
}

export const MATERIALS_FIXTURE: MaterialSearchItem[] = [
  mat('IRR-PVC-100-CL200', '1" CL200 PVC Pipe', 606, 'IRR-PVC Pipe', 'FT', 42),
  mat('IRR-PVC-075-CL200', '3/4" CL200 PVC Pipe', 606, 'IRR-PVC Pipe', 'FT', 31),
  mat('IRR-SPR-4IN', '4" Pop-up Spray Head', 601, 'IRR-Heads', 'EA', 389),
  mat('IRR-VLV-1IN', '1" Irrigation Valve', 602, 'IRR-Valves', 'EA', null),
  mat('LND-PVC-EDGE', 'PVC Landscape Edging', 705, 'LND-Edging', 'FT', 125),
  mat('SOD-STA-PAL', 'St. Augustine Sod', 703, 'SOD', 'PAL', 18500),
]

export function searchMaterialsFixture(url: URL): MaterialSearchResponse {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const codesParam = url.searchParams.get('itemClassCodes')
  const codes = codesParam ? codesParam.split(',').map(Number) : null
  const limit = clampMaterialLimit(Number(url.searchParams.get('limit') ?? 25))
  const offset = Number(url.searchParams.get('cursor') ?? 0) || 0
  const matches = MATERIALS_FIXTURE.filter(
    (m) =>
      (!q ||
        m.inventoryId.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        (m.alternateName ?? '').toLowerCase().includes(q)) &&
      (!codes || (m.itemClassCode !== null && codes.includes(m.itemClassCode))),
  )
  const items = matches.slice(offset, offset + limit)
  const next = offset + limit
  return { items, nextCursor: next < matches.length ? String(next) : null }
}
