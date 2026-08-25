
// ---------------------------------------------------------------------------
// Config-Table Read APIs (frontend fetch layer).
//
// The five config sets (approval tiers, margin bands, material calcs, ITB
// scopes, catalog items) are fetched from the API and cached via TanStack
// Query — the DB is the source of truth, so editing a row changes the UI
// without a frontend deploy, and `invalidateQueries([ESTIMATING_CONFIG_KEY])`
// after an admin edit picks it up immediately (no page reload needed). The
// config.ts literals remain ONLY as `placeholderData`, shown while the fetch
// is in flight or if it fails, so the UI degrades gracefully offline.
//
// The material_calcs nuance: the API returns compute_type + factors (data);
// the formula math stays in the frontend registry (config.ts FORMULA_ENGINE /
// buildMaterialCalc), applied to the API-supplied factors.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query'
import { estimatingConfigApi } from '@/api/estimating'
import {
  APPROVAL_TIER_SEED,
  DEFAULT_MARGIN_BANDS,
  ITB_SCOPE_SEED,
  MATERIAL_FORMULA_ROWS,
} from '@/lib/estimating/config'
import type {
  ApprovalTier,
  CatalogItem,
  ItbScope,
  MarginBandRow,
  MarginBands,
  MaterialCalcRow,
} from '@/types/estimating'

export interface EstimatingConfig {
  approvalTiers: ApprovalTier[]
  /** The canonical {goodMin, okMin} set (the row named 'default'). */
  marginBands: MarginBands
  materialCalcs: MaterialCalcRow[]
  itbScopes: ItbScope[]
  /** Kits. Empty until catalog_items is populated. */
  catalogItems: CatalogItem[]
  /** True once the API responded; false ⇒ the typed fallback literals. */
  loaded: boolean
}

/** Offline/in-flight fallback — the config.ts literals, typed end-to-end. */
export const FALLBACK_ESTIMATING_CONFIG: EstimatingConfig = {
  approvalTiers: APPROVAL_TIER_SEED,
  marginBands: DEFAULT_MARGIN_BANDS,
  materialCalcs: MATERIAL_FORMULA_ROWS,
  itbScopes: ITB_SCOPE_SEED,
  catalogItems: [],
  loaded: false,
}

/** Pick the canonical band set out of the margin_bands rows. */
function canonicalBands(rows: MarginBandRow[]): MarginBands {
  const row = rows.find((r) => r.name === 'default') ?? rows[0]
  return row ? { goodMin: row.goodMin, okMin: row.okMin } : DEFAULT_MARGIN_BANDS
}

export const ESTIMATING_CONFIG_KEY = 'estimating-config'

async function fetchConfig(): Promise<EstimatingConfig> {
  // Each set falls back independently so one failing endpoint cannot blank
  // the others.
  const [tiers, bands, calcs, scopes, kits] = await Promise.all([
    estimatingConfigApi.approvalTiers().catch(() => null),
    estimatingConfigApi.marginBands().catch(() => null),
    estimatingConfigApi.materialCalcs().catch(() => null),
    estimatingConfigApi.itbScopes().catch(() => null),
    estimatingConfigApi.catalogItems().catch(() => null),
  ])
  const anyLoaded =
    tiers !== null || bands !== null || calcs !== null || scopes !== null || kits !== null
  return {
    approvalTiers: tiers ?? APPROVAL_TIER_SEED,
    marginBands: bands ? canonicalBands(bands) : DEFAULT_MARGIN_BANDS,
    materialCalcs: calcs ?? MATERIAL_FORMULA_ROWS,
    itbScopes: scopes ?? ITB_SCOPE_SEED,
    catalogItems: kits ?? [],
    loaded: anyLoaded,
  }
}

/**
 * The app-wide estimating config. Returns the fallback literals immediately
 * (as `placeholderData`), then re-renders with the API values once the fetch
 * lands. Query-cached (not module-cached), so a Settings-UI edit followed by
 * `queryClient.invalidateQueries({ queryKey: [ESTIMATING_CONFIG_KEY] })`
 * updates every consumer — no full page reload required.
 */
export function useEstimatingConfig(): EstimatingConfig {
  // fetchConfig() never rejects — each set catches independently — so a
  // total outage resolves as a `loaded: false` success, not a query error.
  const { data } = useQuery({
    queryKey: [ESTIMATING_CONFIG_KEY],
    queryFn: fetchConfig,
    staleTime: 5 * 60_000,
    placeholderData: FALLBACK_ESTIMATING_CONFIG,
  })
  return data ?? FALLBACK_ESTIMATING_CONFIG
}
