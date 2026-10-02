import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  settingsApi,
  type BranchSettings,
  type BranchSettingsPatch,
  type KitRatePatchBody,
} from '@/api/settings'
import { estimatingConfigApi } from '@/api/estimating'
import type { ServiceKit, MaterialCalcRow } from '@/types/estimating'
import { ESTIMATES_KEY } from '@/hooks/useEstimate'
import { useUIStore } from '@/store/uiStore'

// Query keys — crew rate and production rates come from the branch settings
// payload. SERVICE_KITS_KEY is GET /api/estimating/service-kits, which is not
// filtered by branch. Material-factor rows are read from material-calcs.
export const BRANCH_SETTINGS_KEY = 'branch-settings'
export const MATERIAL_CALCS_KEY = 'branch-material-calcs'
/** GET /api/estimating/service-kits. Not scoped to a branch. */
export const SERVICE_KITS_KEY = 'service-kits'

/**
 * One branch's settings (crew rate and production rates). Keyed by branch so
 * switching the picker re-reads the right branch. A 403 (out-of-scope BM)
 * surfaces as `isError`.
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
export function useServiceKits() {
  return useQuery<ServiceKit[]>({
    queryKey: [SERVICE_KITS_KEY],
    queryFn: () => estimatingConfigApi.serviceKits({ kitType: 'maintenance_hours' }),
    staleTime: 30_000,
  })
}

/**
 * Patch the selected branch (crew rate, material factors). The optimistic
 * update merges the crew rate; onError rolls it back. onSettled invalidates
 * this cache. Production rates are now written per-kit via useUpdateKitRate
 * (Handoff 54 §4) — this hook no longer handles productionRates.
 */
export function useUpdateBranchSettings(aspireBranchId: number | undefined) {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)
  const key = [BRANCH_SETTINGS_KEY, aspireBranchId]

  return useMutation({
    mutationFn: (body: BranchSettingsPatch) =>
      settingsApi.updateBranchSettings(aspireBranchId as number, body),
    onMutate: async (body) => {
      // Optimistic merge is crew-rate only. Production-rate writes are
      // reconciled when onSettled invalidates this cache.
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
    onSuccess: (_data, body) => {
      toast('Branch settings saved', { variant: 'success' })
      // The same PATCH reprices crew-rate-derived lines on this branch's open
      // drafts. Refetch estimates so an open editor shows those prices.
      if (body.crewRateCentsPerHour !== undefined) {
        qc.invalidateQueries({ queryKey: [ESTIMATES_KEY] })
      }
    },
    onSettled: (_data, _err, body) => {
      qc.invalidateQueries({ queryKey: key })
      if (body.materialFactors !== undefined)
        qc.invalidateQueries({ queryKey: [MATERIAL_CALCS_KEY] })
    },
  })
}

/**
 * Per-kit, per-branch production rate PATCH (Handoff 54 §4).
 *
 * Save-on-blur: the form calls mutate({ productionRate }) for one kit at a
 * time. The hook invalidates branch-settings so the GET re-resolves the
 * effective rate (and updates the source badge) after each save.
 *
 * Note: service_kit_rates is an append-only ledger — there is no way to delete
 * a branch override row. The form only appends new rate rows on save.
 */
export function useUpdateKitRate(
  aspireBranchId: number | undefined,
  kitId: string,
) {
  const queryClient = useQueryClient()
  const toast = useUIStore((s) => s.toast)
  const key = [BRANCH_SETTINGS_KEY, aspireBranchId]
  return useMutation({
    mutationFn: (body: KitRatePatchBody) =>
      settingsApi.patchKitRate(aspireBranchId!, kitId, body),
    onError: () => {
      toast('Could not save production rate', { variant: 'error' })
      queryClient.invalidateQueries({ queryKey: key })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
