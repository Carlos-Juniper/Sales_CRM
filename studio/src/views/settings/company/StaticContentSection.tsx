import { SERVICES_CONTENT } from '@/lib/proposal/staticContent'
import { SettingsFormShell } from './formStatus'

/**
 * Static content — READ-ONLY.
 *
 * The proposal boilerplate copy (H37) lives in `lib/proposal/staticContent.ts`
 * as a typed TS module, not the DB — there is no read/write endpoint. Editing
 * it is a code change (version-controlled, reviewed), so this section lists the
 * code-managed blocks and states plainly that it is not DB-editable. We do NOT
 * invent a backend to make it writable.
 */
export function StaticContentSection() {
  const serviceKeys = Object.keys(SERVICES_CONTENT)
  return (
    <SettingsFormShell slug="static-content" title="Static content">
      <p className="mb-3 rounded-md border border-dashed border-[var(--border)] p-4 text-xs text-[var(--fg)] opacity-70">
        Proposal boilerplate (service blurbs, page copy, startup-plan seed) is
        code-managed in <code>lib/proposal/staticContent.ts</code>. It is not
        edited here — changes ship through a code review, not a settings write.
      </p>
      <p className="text-xs font-medium text-[var(--fg)] opacity-70 mb-1">
        Service content blocks ({serviceKeys.length})
      </p>
      <ul className="list-disc pl-5 text-xs text-[var(--fg)] opacity-70">
        {serviceKeys.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
    </SettingsFormShell>
  )
}
