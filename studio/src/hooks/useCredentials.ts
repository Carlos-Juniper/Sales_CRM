// ---------------------------------------------------------------------------
// Documents hooks — Slice 15b (reworked: Handoff 42).
//
// All document kinds (license, certification, insurance) are unified under one
// endpoint: GET/POST/PATCH/DELETE /api/settings/licenses.
//
// Query keys:
//   ['settings', 'licenses', aspireBranchId|null, includeExpired]
//   ['proposals', 'config', 'licenses', aspireBranchId|null]   ← existing key
// ---------------------------------------------------------------------------

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import type { LicenseCreateBody, LicensePatchBody } from '@/api/settings'

/**
 * Settings-path document list (lacks isExpired — use useProposalLicenses for that).
 * Returns all kinds (license, certification, insurance) for the caller's scope.
 * When aspireBranchId is provided, the server returns branch-scoped rows AND
 * company-wide rows. When absent, admin gets everything.
 */
export function useSettingsLicenses(params?: {
  aspireBranchId?: number
  includeExpired?: boolean
}) {
  return useQuery({
    queryKey: ['settings', 'licenses', params?.aspireBranchId ?? null, params?.includeExpired ?? false],
    queryFn: () => settingsApi.listLicenses(params),
    staleTime: 5 * 60_000,
  })
}

export function useCreateLicense(aspireBranchId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LicenseCreateBody) => settingsApi.createLicense(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'licenses'] })
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'licenses', aspireBranchId ?? null] })
    },
  })
}

export function useUpdateLicense(aspireBranchId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ licenseId, body }: { licenseId: string; body: LicensePatchBody }) =>
      settingsApi.updateLicense(licenseId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'licenses'] })
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'licenses', aspireBranchId ?? null] })
    },
  })
}

/**
 * Soft-deletes (active=0) the document row. The row remains in the DB as a
 * historical record; it reappears when the "include expired" toggle is on.
 */
export function useDeactivateLicense(aspireBranchId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (licenseId: string) => settingsApi.deactivateLicense(licenseId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'licenses'] })
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'licenses', aspireBranchId ?? null] })
    },
  })
}

/**
 * Uploads a file for a document row. Accepts any file type (pdf or image).
 * On success invalidates the list so the objectKey renders a view link.
 */
export function useUploadLicenseScan(aspireBranchId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ licenseId, file }: { licenseId: string; file: File }) =>
      settingsApi.uploadLicenseScan(licenseId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'licenses'] })
      qc.invalidateQueries({ queryKey: ['proposals', 'config', 'licenses', aspireBranchId ?? null] })
    },
  })
}
