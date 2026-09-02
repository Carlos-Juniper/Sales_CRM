import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  settingsApi,
  type BranchSettings,
  type BranchSettingsPatch,
} from '@/api/settings'
import { estimatingConfigApi } from '@/api/estimating'
import type { CatalogItem, MaterialCalcRow } from '@/types/estimating'
import { useUIStore } from '@/store/uiStore'

// Query keys — the crew-rate read is per-branch (the branch endpoint), while the
// material-factor / production-rate reads come from the company-wide estimating
// config endpoints (the branch GET does not carry them — a Slice 5 shape gap).
export const BRANCH_SETTINGS_KEY = 'branch-settings'
export const MATERIAL_CALCS_KEY = 'branch-material-calcs'
export const CATALOG_ITEMS_KEY = 'branch-catalog-items'

/**
 * One branch's settings (crew rate). Keyed by branch so switching the picker
 * re-reads the right branch. A 403 (out-of-scope BM) surfaces as `isError`.
 */
export function useBranchSettings(aspireBranchId: number | undefined) {
  return useQuery<BranchSettings>({
    queryKey: [BRANCH_SETTINGS_KEY, aspireBranchId],
    queryFn: () => settingsApi.branchSettings(aspireBranchId as number),
    enabled: aspireBranchId !== undefined,
    staleTime: 30_000,
  })
}

/**
 * The material_calcs rows (formula factors). Company-wide today: the branch GET
 * does not distinguish inherited vs branch-override rows, so the form edits the
 * factors it reads and PATCHes them to the selected branch (creating an override
 * server-side). The read key is independent of the branch until the GET grows a
 * branch-scoped payload.
 */
export function useMaterialCalcs() {
  return useQuery<MaterialCalcRow[]>({
    queryKey: [MATERIAL_CALCS_KEY],
    queryFn: () => estimatingConfigApi.materialCalcs(),
    staleTime: 30_000,
  })
}

/** Maintenance kits (production rates). Only production-rate is editable here. */
export function useCatalogItems() {
  return useQuery<CatalogItem[]>({
    queryKey: [CATALOG_ITEMS_KEY],
    queryFn: () => estimatingConfigApi.catalogItems({ kitType: 'maintenance_hours' }),
    staleTime: 30_000,
  })
}

/**
 * Patch the selected branch. Framework-native optimistic update for the crew
 * rate (onMutate snapshots + merges, onError rolls back); production-rate and
 * material-factor writes invalidate their config reads on settle so they
 * re-read authoritative (the PATCH return only echoes the crew rate).
 */
export function useUpdateBranchSettings(aspireBranchId: number | undefined) {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)
  const key = [BRANCH_SETTINGS_KEY, aspireBranchId]

  return useMutation({
    mutationFn: (body: BranchSettingsPatch) =>
      settingsApi.updateBranchSettings(aspireBranchId as number, body),
    onMutate: async (body) => {
      // Only the crew rate lives in this cache; production/material writes are
      // reconciled via invalidation on settle.
      if (body.crewRateCentsPerHour === undefined) return { previous: undefined }
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<BranchSettings>(key)
      qc.setQueryData<BranchSettings>(key, (old) =>
        old ? { ...old, crewRateCentsPerHour: body.crewRateCentsPerHour ?? null } : old,
      )
      return { previous }
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(key, ctx.previous)
      toast('Could not save branch settings', { variant: 'error' })
    },
    onSuccess: () => toast('Branch settings saved', { variant: 'success' }),
    onSettled: (_data, _err, body) => {
      qc.invalidateQueries({ queryKey: key })
      if (body.productionRates !== undefined)
        qc.invalidateQueries({ queryKey: [CATALOG_ITEMS_KEY] })
      if (body.materialFactors !== undefined)
        qc.invalidateQueries({ queryKey: [MATERIAL_CALCS_KEY] })
    },
  })
}
