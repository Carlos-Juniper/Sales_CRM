import { SettingsFormShell } from './formStatus'

/**
 * Regions — READ-ONLY.
 *
 * There is no `regions` table yet: migration 019 explicitly defers it to
 * Handoff 40 ("`regions` and branches.lat/lng/region_id are NOT created here").
 * With no backing read or write endpoint, inventing a form would fabricate an
 * unbacked backend. We render a clear "managed in DB / not yet configurable"
 * note instead — swap in a real list + form once Handoff 40 lands the table.
 */
export function RegionsSection() {
  return (
    <SettingsFormShell slug="regions" title="Regions">
      <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-xs text-[var(--fg)] opacity-70">
        Regions are not yet a configurable surface. The <code>regions</code>{' '}
        table is deferred to a later handoff; until it exists, region membership
        is managed directly in the database. This section will become editable
        once the backing table and endpoints ship.
      </p>
    </SettingsFormShell>
  )
}
