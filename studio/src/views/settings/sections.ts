import type { UserRole } from '@/types'

/**
 * The Settings section contract (Handoff §2.9).
 *
 * Sections are grouped by permission scope, not by page. Slices 10–12 slot real
 * forms in behind each `slug` — this file is the single source of truth for the
 * nav, the URL segment (`/settings/:section`), and the placeholder testid
 * (`settings-section-<slug>`) those later slices target.
 */
export type SettingsGroupId = 'company' | 'marketing' | 'branch' | 'mine'

export interface SettingsSection {
  /** URL segment + testid suffix. Stable — later slices key off it. */
  slug: string
  /** Human label shown in the nav. */
  label: string
}

export interface SettingsGroup {
  id: SettingsGroupId
  label: string
  /**
   * Roles that may see this group (in ADDITION to admin-equivalent roles —
   * admin, regional_sales_rep, vp_sales — who pass every gate via useRole's
   * super-role). An empty array + `adminOnly: false` means "any authed user";
   * an empty array + `adminOnly: true` means "admin-equivalent only".
   */
  roles: UserRole[]
  /** Restrict the group to admin-equivalent roles regardless of `roles`. */
  adminOnly: boolean
  /** Whether the group's sections are branch-scoped (drive the branch picker). */
  branchScoped: boolean
  sections: SettingsSection[]
}

/**
 * Company:   admin-only, company-wide config.
 * Marketing: company-wide proposal assets — sales, marketing, and manager-tier
 *            roles (admin passes via super-role). NOT branch-scoped: Handoff 50
 *            §3's scope decision (Carlos, 2026-09-08) makes portfolio, client
 *            references and the team roster company-wide, role-gated resources.
 *            Sole owner of Portfolio, Client references and Team roster — these
 *            no longer duplicate into Company or Branch (2026-09-14). Licenses
 *            stays a Branch-only, per-branch tab (2026-09-14).
 * Branch:    branch-scoped; a BM/RD sees its branches, admin sees all. Owns
 *            branch-specific config (crew rate, material factors, production
 *            rates, branch profile) plus Licenses, scoped per branch.
 * Mine:      any authed user's personal preferences.
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'company',
    label: 'Company',
    roles: [],
    adminOnly: true,
    branchScoped: false,
    sections: [
      { slug: 'users', label: 'Users' },
      { slug: 'approval-tiers', label: 'Approval tiers' },
      { slug: 'margin-bands', label: 'Margin bands' },
      { slug: 'sla', label: 'SLA' },
      { slug: 'discrepancy-threshold', label: 'Discrepancy threshold' },
      { slug: 'intake-defaults', label: 'Intake defaults' },
    ],
  },
  {
    id: 'marketing',
    label: 'Sales',
    roles: ['sales', 'inside_sales', 'maintenance_sales', 'install_sales', 'marketing', 'manager', 'regional_director', 'vice_president', 'ceo'],
    adminOnly: false,
    branchScoped: false,
    sections: [
      { slug: 'portfolio', label: 'Portfolio' },
      { slug: 'client-references', label: 'Client references' },
      { slug: 'team-roster', label: 'Team roster' },
    ],
  },
  {
    id: 'branch',
    label: 'Branch',
    roles: ['manager', 'regional_director'],
    adminOnly: false,
    branchScoped: true,
    sections: [
      { slug: 'crew-rate', label: 'Crew rate' },
      { slug: 'material-factors', label: 'Material factors' },
      { slug: 'production-rates', label: 'Production rates' },
      { slug: 'branch-profile', label: 'Branch profile' },
      { slug: 'branch-credentials', label: 'Licenses' },
    ],
  },
  {
    id: 'mine',
    label: 'User',
    roles: [],
    adminOnly: false,
    branchScoped: false,
    sections: [
      { slug: 'profile', label: 'Profile' },
      { slug: 'theme', label: 'Theme' },
      { slug: 'connections', label: 'Connections' },
    ],
  },
]

/** The very first section (Company → Users), used as the bare `/settings` default. */
export const DEFAULT_SECTION_SLUG = SETTINGS_GROUPS[0].sections[0].slug
