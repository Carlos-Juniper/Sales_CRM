import { SettingsFormShell } from '../company/formStatus'

/**
 * Branch profile (lat/lng). READ-ONLY by necessity: `branches.lat/lng` exist
 * (migration 021 backfilled them from Aspire) but there is NO write endpoint —
 * neither GET /api/settings/branch/{id} nor its PATCH, nor the branches list,
 * exposes or accepts lat/lng. Rather than fabricate a backend, this section
 * renders a clear read-only note. When a write path lands (a later slice), swap
 * this for an editable form bound to it.
 *
 * `aspireBranchId` is accepted so the section matches the other branch forms'
 * signature and is ready to bind once a per-branch read/write path exists.
 */
export function BranchProfileSection({
  aspireBranchId: _aspireBranchId,
}: {
  aspireBranchId: number
}) {
  return (
    <SettingsFormShell
      slug="branch-profile"
      title="Branch profile"
      description="Geographic coordinates for this branch."
    >
      <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--fg)] opacity-70">
        Branch coordinates are sourced from Aspire and are read-only here — there
        is no write endpoint to edit them yet. They will become editable in a
        later release once a save path exists.
      </p>
    </SettingsFormShell>
  )
}
