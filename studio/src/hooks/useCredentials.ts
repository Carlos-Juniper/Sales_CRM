// ---------------------------------------------------------------------------
// Credentials hooks — Slice 15b.
//
// Two separate data surfaces share one section:
//   - Licenses/certifications: /api/settings/licenses (CRUD, branch-scoped or
//     company-wide)  +  /api/proposals/config/licenses (read-only, carries
//     server-computed isExpired — the ONLY source of truth for expiry state).
//   - Insurance certificates: /api/settings/insurance (admin-only, company-wide).
//
// Query keys:
//   ['settings', 'licenses', aspireBranchId|null, includeExpired]
//   ['proposals', 'config', 'licenses', aspireBranchId|null]   ← existing key
//   ['settings', 'insurance']
// ---------------------------------------------------------------------------

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import type {
  LicenseCreateBody,
  LicensePatchBody,
  InsuranceCreateBody,
  InsurancePatchBody,
} from '@/api/settings'

// ── Licenses/certifications ───────────────────────────────────────────────────

/**
 * Settings-path license list (lacks isExpired — use useProposalLicenses for that).
 * When aspireBranchId is provided, the server returns both branch-scoped rows AND
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
      // Invalidate both the settings list and the proposals read (expiry banner).
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
 * Soft-deletes (active=0) the license row. The row remains in the DB as a
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
 * Uploads a scan PDF/image for a license row. On success invalidates the list
 * so the objectKey renders a view link via the media-url signer.
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

// ── Insurance certificates ────────────────────────────────────────────────────

/** List all insurance certificates, newest first (admin-only server-side). */
export function useSettingsInsurance() {
  return useQuery({
    queryKey: ['settings', 'insurance'],
    queryFn: () => settingsApi.listInsurance(),
    staleTime: 5 * 60_000,
  })
}

export function useCreateInsurance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InsuranceCreateBody) => settingsApi.createInsurance(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'insurance'] })
      // Also invalidate the proposals config so the proposal builder picks up changes.
      qc.invalidateQueries({ queryKey: ['proposals-config'] })
    },
  })
}

export function useUpdateInsurance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ certId, body }: { certId: string; body: InsurancePatchBody }) =>
      settingsApi.updateInsurance(certId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'insurance'] })
      qc.invalidateQueries({ queryKey: ['proposals-config'] })
    },
  })
}

export function useDeleteInsurance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (certId: string) => settingsApi.deleteInsurance(certId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'insurance'] })
      qc.invalidateQueries({ queryKey: ['proposals-config'] })
    },
  })
}

/**
 * Upload + create an insurance certificate in one request.
 * The combined endpoint (POST /api/settings/insurance/upload) avoids a
 * two-step upload-then-create flow in the UI.
 */
export function useUploadInsuranceCert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { file: File; expiryDate: string; label?: string | null }) =>
      settingsApi.uploadInsuranceCert(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'insurance'] })
      qc.invalidateQueries({ queryKey: ['proposals-config'] })
    },
  })
}
