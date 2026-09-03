import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  settingsApi,
  type ApprovalTierPatch,
  type CompanySettingsPatch,
  type MarginBandPatch,
} from '@/api/settings'
import { useUIStore } from '@/store/uiStore'

// Query keys — kept as module constants so the mutations invalidate exactly
// what the reads populate (CLAUDE.md §2: React Query owns server state).
export const COMPANY_SETTINGS_KEY = 'company-settings'
export const APPROVAL_TIERS_KEY = 'company-approval-tiers'
export const MARGIN_BANDS_KEY = 'company-margin-bands'

/** Read the company_settings singleton. */
export function useCompanySettings() {
  return useQuery({
    queryKey: [COMPANY_SETTINGS_KEY],
    queryFn: () => settingsApi.company(),
    staleTime: 30_000,
  })
}

/**
 * Patch the company singleton. Framework-native optimistic update: onMutate
 * snapshots + merges the changed keys into the cached row; onError rolls that
 * snapshot back; onSuccess/onSettled invalidate so the row re-reads authoritative.
 */
export function useUpdateCompanySettings() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (body: CompanySettingsPatch) => settingsApi.updateCompany(body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: [COMPANY_SETTINGS_KEY] })
      const previous = qc.getQueryData([COMPANY_SETTINGS_KEY])
      qc.setQueryData(
        [COMPANY_SETTINGS_KEY],
        (old: unknown) => (old ? { ...old, ...body } : old),
      )
      return { previous }
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData([COMPANY_SETTINGS_KEY], ctx.previous)
      }
      toast('Could not save company settings', { variant: 'error' })
    },
    onSuccess: () => toast('Company settings saved', { variant: 'success' }),
    onSettled: () => qc.invalidateQueries({ queryKey: [COMPANY_SETTINGS_KEY] }),
  })
}

/** Read the approval-tier ladder (config source of truth). */
export function useApprovalTiers() {
  return useQuery({
    queryKey: [APPROVAL_TIERS_KEY],
    queryFn: () => settingsApi.approvalTiers(),
    staleTime: 30_000,
  })
}

/**
 * Patch one approval tier. The PATCH return shape is the raw DB row (snake_case),
 * so rather than trusting it we invalidate the camelCase read on settle.
 */
export function useUpdateApprovalTier() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ tierId, body }: { tierId: string; body: ApprovalTierPatch }) =>
      settingsApi.updateApprovalTier(tierId, body),
    onSuccess: () => toast('Approval tier updated', { variant: 'success' }),
    onError: () => toast('Could not update approval tier', { variant: 'error' }),
    onSettled: () => qc.invalidateQueries({ queryKey: [APPROVAL_TIERS_KEY] }),
  })
}

/** Read the margin bands (config source of truth). */
export function useMarginBands() {
  return useQuery({
    queryKey: [MARGIN_BANDS_KEY],
    queryFn: () => settingsApi.marginBands(),
    staleTime: 30_000,
  })
}

/** Patch one margin band; invalidate the read on settle. */
export function useUpdateMarginBand() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ bandId, body }: { bandId: string; body: MarginBandPatch }) =>
      settingsApi.updateMarginBand(bandId, body),
    onSuccess: () => toast('Margin band updated', { variant: 'success' }),
    onError: () => toast('Could not update margin band', { variant: 'error' }),
    onSettled: () => qc.invalidateQueries({ queryKey: [MARGIN_BANDS_KEY] }),
  })
}
