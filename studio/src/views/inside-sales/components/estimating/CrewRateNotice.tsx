// Shared crew-rate notices. Margin Analysis owns the wording; the maintenance
// editor uses the same components instead of a second copy.

import { Link } from 'react-router-dom'
import { Settings2, TriangleAlert } from 'lucide-react'
import type { CrewRateSource } from '@/hooks/useResolvedCrewRate'
import { formatCents } from '@/lib/money'

/**
 * Settings → Branch → Crew rate.
 * Router: `settings/branch/:aspireBranchId/:section` (studio/src/router.tsx).
 * Section slug: `crew-rate` (studio/src/views/settings/sections.ts).
 */
function crewRateSettingsPath(aspireBranchId: number): string {
  return `/settings/branch/${aspireBranchId}/crew-rate`
}

/**
 * Loud no-crew-rate state (§2.3). Maintenance margin is hours × loaded crew
 * rate — with no rate there is NO defensible margin number, so the panel
 * REFUSES to show one and points the manager at the branch crew-rate setting.
 * A silent 18_000 fallback would hand an approver a confidently-wrong margin.
 */
export function NoCrewRateState({
  branchCity,
  aspireBranchId,
}: {
  branchCity: string | null
  aspireBranchId: number | null
}) {
  const cityLabel = branchCity ?? 'this branch'
  return (
    <div className="flex flex-col gap-4 pb-6">
      <div
        data-testid="margin-no-crew-rate"
        className="flex flex-col items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-10 text-center dark:border-amber-700/60 dark:bg-amber-950/30"
      >
        <TriangleAlert className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          No crew rate configured for {cityLabel}
        </p>
        <p className="max-w-md text-xs text-amber-700 dark:text-amber-400">
          Maintenance margin is priced from the loaded crew rate (hours × rate). Without it, this
          panel will not show a margin — a wrong number is worse than none before an approval.
        </p>
        {aspireBranchId !== null ? (
          <Link
            data-testid="crew-rate-settings-link"
            to={crewRateSettingsPath(aspireBranchId)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:bg-transparent dark:text-amber-300"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Set the crew rate for {cityLabel}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

/** Where the loaded crew rate that priced this maintenance estimate came from. */
export function CrewRateProvenance({
  crewRateCents,
  source,
  branchCity,
}: {
  crewRateCents: number
  source: CrewRateSource
  branchCity: string | null
}) {
  return (
    <p
      data-testid="crew-rate-provenance"
      data-source={source}
      className="text-[11px] text-[hsl(var(--muted-fg))]"
    >
      Priced at {formatCents(crewRateCents)}/hr loaded crew rate
      {branchCity ? ` — ${branchCity}` : ''}
      {source === 'snapshot' ? ' (frozen at submission)' : ''}
    </p>
  )
}
