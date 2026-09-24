import { useState, type ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useRole } from '@/hooks/useRole'
import { useSalesRepOptions } from '@/hooks/useSalesRepOptions'
import { PortfolioSection } from '../company/PortfolioSection'
import { TeamRosterSection } from '../branch/TeamRosterSection'
import { ClientReferencesSection } from '../branch/ClientReferencesSection'
import { SettingsFormShell } from '../company/formStatus'

/**
 * Sales settings group: the shared portfolio, plus each rep's client
 * references and team roster.
 *
 * Portfolio has no rep selector — sales, marketing, and admin edit one set.
 * A sales rep edits only their own roster rows (no dropdown; calls use their
 * id). Marketing and admin pick a rep before any rep-scoped request fires.
 */
export function MarketingSection({ slug }: { slug: string }) {
  const { canPickRosterRep, isSales } = useRole()

  if (!isSales && !canPickRosterRep) {
    return (
      <div
        data-testid={`settings-section-${slug}`}
        className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
      >
        <p className="text-xs text-[var(--fg)] opacity-60">
          Sales, marketing, or admin role required to edit proposal assets.
        </p>
      </div>
    )
  }

  switch (slug) {
    case 'portfolio':
      return <PortfolioSection />
    case 'client-references':
      return (
        <RepScopedRoster slug="client-references" title="Client references">
          {(repId) => (
            <ClientReferencesSection
              aspireBranchId={null}
              canEditCompanyWide
              repId={repId}
            />
          )}
        </RepScopedRoster>
      )
    case 'team-roster':
      return (
        <RepScopedRoster slug="team-roster" title="Team roster">
          {(repId) => (
            <TeamRosterSection
              aspireBranchId={null}
              canEditCompanyWide
              repId={repId}
            />
          )}
        </RepScopedRoster>
      )
    default:
      return null
  }
}

function RepScopedRoster({
  slug,
  title,
  children,
}: {
  slug: string
  title: string
  children: (repId: string) => ReactNode
}) {
  const { canPickRosterRep, isSales } = useRole()
  const ownId = useAuthStore((s) => s.user?.id ?? null)
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null)
  const repId = isSales ? ownId : selectedRepId

  return (
    <div>
      {canPickRosterRep && (
        <RosterRepPicker value={selectedRepId} onChange={setSelectedRepId} />
      )}
      {repId ? (
        children(repId)
      ) : (
        <SettingsFormShell slug={slug} title={title}>
          <p className="text-xs text-[var(--fg)] opacity-60">
            Select a sales rep to view and edit their {title.toLowerCase()}.
          </p>
        </SettingsFormShell>
      )}
    </div>
  )
}

function RosterRepPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (repId: string | null) => void
}) {
  const { data: reps = [], isLoading } = useSalesRepOptions()

  return (
    <div className="mb-4">
      <label
        htmlFor="settings-rep-picker"
        className="block text-xs font-medium text-[var(--fg)] opacity-70 mb-1"
      >
        Sales rep
      </label>
      <select
        id="settings-rep-picker"
        data-testid="settings-rep-picker"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={isLoading}
        className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)]"
      >
        <option value="">Select a sales rep</option>
        {reps.map((rep) => (
          <option key={rep.id} value={rep.id}>
            {rep.name}
          </option>
        ))}
      </select>
    </div>
  )
}
