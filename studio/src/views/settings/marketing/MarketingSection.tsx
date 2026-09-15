import { useRole } from '@/hooks/useRole'
import { PortfolioSection } from '../company/PortfolioSection'
import { TeamRosterSection } from '../branch/TeamRosterSection'
import { ClientReferencesSection } from '../branch/ClientReferencesSection'

/**
 * Marketing settings group body (Handoff 50 §3).
 *
 * The Marketing role owns the COMPANY-WIDE proposal assets — portfolio pages,
 * client references and team bios/headshots. Carlos's §5.1 scope decision
 * (2026-09-08) makes these company-wide, role-gated resources rather than
 * branch-scoped ones, which is why they live in their own group here (not
 * under Company, which is admin-only, nor under Branch, which is per-branch).
 * Portfolio management "moves into settings" and lives here.
 *
 * Licenses (formerly "Documents"/credentials) is NOT part of this group — it
 * stays a Branch-only, per-branch tab (2026-09-14), since it isn't a
 * company-wide asset like the rest of this group.
 *
 * The section components are the SAME ones the Company/Branch groups use; the
 * team-roster / client-references sections render in their company-wide mode
 * (aspireBranchId=null) with edit rights granted to marketing/admin. The
 * SettingsPage shell already gates this whole group to the marketing role
 * (admin passes via the super-role); this is a second, defense-in-depth guard.
 */
export function MarketingSection({ slug }: { slug: string }) {
  const { canManageMarketingAssets } = useRole()

  if (!canManageMarketingAssets) {
    return (
      <div
        data-testid={`settings-section-${slug}`}
        className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
      >
        <p className="text-xs text-[var(--fg)] opacity-60">
          Marketing or admin role required — these are company-wide proposal assets.
        </p>
      </div>
    )
  }

  switch (slug) {
    case 'portfolio':
      return <PortfolioSection />
    case 'client-references':
      return <ClientReferencesSection aspireBranchId={null} canEditCompanyWide />
    case 'team-roster':
      return <TeamRosterSection aspireBranchId={null} canEditCompanyWide />
    default:
      return null
  }
}
