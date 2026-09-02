import type { UserRole } from '@/types'

/**
 * The Settings section contract (Handoff §2.9).
 *
 * Sections are grouped by permission scope, not by page. Slices 10–12 slot real
 * forms in behind each `slug` — this file is the single source of truth for the
 * nav, the URL segment (`/settings/:section`), and the placeholder testid
 * (`settings-section-<slug>`) those later slices target.
 */
export type SettingsGroupId = 'company' | 'branch' | 'mine'

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
   * Roles that may see this group (in ADDITION to admin, who passes every gate
   * via useRole's super-role). An empty array + `adminOnly: false` means "any
   * authed user"; an empty array + `adminOnly: true` means "admin only".
   */
  roles: UserRole[]
  /** Restrict the group to admin regardless of `roles` (Company config). */
  adminOnly: boolean
  /** Whether the group's sections are branch-scoped (drive the branch picker). */
  branchScoped: boolean
  sections: SettingsSection[]
}

/**
 * Company: admin-only, company-wide config.
 * Branch:  branch-scoped; a BM/RD sees its branches, admin sees all.
 * Mine:    any authed user's personal preferences.
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
      { slug: 'regions', label: 'Regions' },
      { slug: 'approval-tiers', label: 'Approval tiers' },
      { slug: 'margin-bands', label: 'Margin bands' },
      { slug: 'sla', label: 'SLA' },
      { slug: 'discrepancy-threshold', label: 'Discrepancy threshold' },
      { slug: 'intake-defaults', label: 'Intake defaults' },
      { slug: 'static-content', label: 'Static content' },
      { slug: 'portfolio', label: 'Portfolio' },
      { slug: 'credentials', label: 'Credentials' },
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
      { slug: 'team-roster', label: 'Team roster' },
      { slug: 'client-references', label: 'Client references' },
      { slug: 'branch-credentials', label: 'Credentials (branch)' },
    ],
  },
  {
    id: 'mine',
    label: 'Mine',
    roles: [],
    adminOnly: false,
    branchScoped: false,
    sections: [
      { slug: 'theme', label: 'Theme' },
      { slug: 'sidebar', label: 'Sidebar' },
      { slug: 'queue-filters', label: 'Queue filters' },
      { slug: 'connections', label: 'Connections' },
    ],
  },
]

/** The very first section (Company → Users), used as the bare `/settings` default. */
export const DEFAULT_SECTION_SLUG = SETTINGS_GROUPS[0].sections[0].slug
