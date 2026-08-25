
// ---------------------------------------------------------------------------
// Handoff 16 — Config-Table Read APIs (frontend fetch layer).
//
// The five config sets (approval tiers, margin bands, material calcs, ITB
// scopes, catalog items) are fetched from the API once per session and cached
// in module memory — the DB is the source of truth, so editing a row changes
// the UI without a frontend deploy. The config.ts literals remain ONLY as a
// typed fallback used while the fetch is in flight or when it fails, so the
// UI degrades gracefully offline.
//
// The material_calcs nuance: the API returns compute_type + factors (data);
// the formula math stays in the frontend registry (config.ts FORMULA_ENGINE /
// buildMaterialCalc), applied to the API-supplied factors.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
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
  /** Kits. Empty until Handoff 22 populates catalog_items. */
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

// Session-scoped module cache: config is loaded once and shared by every
// consumer; no new state library (per the handoff).
let cache: EstimatingConfig | null = null
let inflight: Promise<EstimatingConfig> | null = null

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

/** Load (or reuse) the session config. Exported for non-hook callers. */
export function loadEstimatingConfig(): Promise<EstimatingConfig> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetchConfig().then((cfg) => {
      // Cache only a (fully or partially) successful load; a total failure
      // stays uncached so the next mount retries instead of pinning the
      // fallback for the whole session.
      if (cfg.loaded) cache = cfg
      inflight = null
      return cfg
    })
  }
  return inflight
}

/** Test seam: clear the session cache between tests. */
export function resetEstimatingConfigCache(): void {
  cache = null
  inflight = null
}

/**
 * The app-wide estimating config. Returns the fallback literals immediately,
 * then re-renders with the API values once the (session-cached) fetch lands.
 */
export function useEstimatingConfig(): EstimatingConfig {
  const [config, setConfig] = useState<EstimatingConfig>(() => cache ?? FALLBACK_ESTIMATING_CONFIG)
  useEffect(() => {
    if (cache) {
      setConfig(cache)
      return
    }
    let alive = true
    loadEstimatingConfig().then((cfg) => {
      if (alive) setConfig(cfg)
    })
    return () => {
      alive = false
    }
  }, [])
  return config
}
