import { useMemo } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { useRole } from '@/hooks/useRole'
import { useBranchList } from '@/hooks/useBranchList'
import { cn } from '@/lib/utils'
import {
  SETTINGS_GROUPS,
  type SettingsGroup,
  type SettingsSection,
} from './sections'
import { SectionPlaceholder } from './SectionPlaceholder'

/**
 * Settings shell (Slice 9): a left-hand section nav grouped by permission, plus
 * a branch picker for the branch-scoped group. Section CONTENT is a placeholder
 * per section; Slices 10–12 slot the real forms in behind each stable testid.
 *
 * Deep-linkable: `/settings/:section` and `/settings/branch/:aspireBranchId/:section`.
 * The URL is the source of truth for the active section + selected branch, so a
 * refresh / back-navigation never loses either (mirrors the Estimating tab).
 */
export function SettingsPage() {
  const navigate = useNavigate()
  const { section, aspireBranchId } = useParams<{
    section?: string
    aspireBranchId?: string
  }>()
  const { canAccess, isAdmin } = useRole()
  const { data: branches } = useBranchList()

  // Permission-filter the groups: Company is admin-only; Branch is BM/RD (admin
  // passes via super-role); Mine is any authed user.
  const visibleGroups = useMemo(
    () =>
      SETTINGS_GROUPS.filter((g) => {
        if (g.adminOnly) return isAdmin
        return g.roles.length === 0 || canAccess(g.roles)
      }),
    [canAccess, isAdmin],
  )

  // Active section: the URL segment if it maps to a visible section, else the
  // first section of the first visible group.
  const allVisibleSections = visibleGroups.flatMap((g) => g.sections)
  const activeSection =
    allVisibleSections.find((s) => s.slug === section) ?? allVisibleSections[0]

  const activeGroup = visibleGroups.find((g) =>
    g.sections.some((s) => s.slug === activeSection?.slug),
  )

  // Branch picker: default to the first alphabetical scoped branch (the endpoint
  // returns them sorted by name), unless a deep link names one explicitly.
  const branchList = branches ?? []
  const deepLinkBranch = aspireBranchId ? Number(aspireBranchId) : undefined
  const selectedBranchId =
    (deepLinkBranch !== undefined &&
      branchList.some((b) => b.aspireBranchId === deepLinkBranch)
      ? deepLinkBranch
      : branchList[0]?.aspireBranchId) ?? undefined

  const showBranchPicker = Boolean(activeGroup?.branchScoped)

  function goToSection(slug: string, branchScoped: boolean) {
    if (branchScoped && selectedBranchId !== undefined) {
      navigate(`/settings/branch/${selectedBranchId}/${slug}`)
    } else {
      navigate(`/settings/${slug}`)
    }
  }

  function onBranchChange(nextId: number) {
    if (activeSection) navigate(`/settings/branch/${nextId}/${activeSection.slug}`)
  }

  return (
    <div data-testid="settings-shell" className="flex h-full">
      {/* Section nav */}
      <nav className="w-56 flex-shrink-0 border-r border-[var(--border)] overflow-y-auto p-3 space-y-4">
        {visibleGroups.map((group) => (
          <SectionGroupNav
            key={group.id}
            group={group}
            activeSlug={activeSection?.slug}
            onSelect={(slug) => goToSection(slug, group.branchScoped)}
          />
        ))}
      </nav>

      {/* Section content */}
      <div className="flex-1 overflow-y-auto p-6">
        {showBranchPicker && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-[var(--fg)] opacity-70 mb-1">
              Branch
            </label>
            <select
              data-testid="settings-branch-picker"
              value={selectedBranchId ?? ''}
              onChange={(e) => onBranchChange(Number(e.target.value))}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
            >
              {branchList.map((b) => (
                <option key={b.aspireBranchId} value={b.aspireBranchId}>
                  {b.branchName}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeSection && (
          <SectionPlaceholder slug={activeSection.slug} name={activeSection.label} />
        )}
      </div>
    </div>
  )
}

function SectionGroupNav({
  group,
  activeSlug,
  onSelect,
}: {
  group: SettingsGroup
  activeSlug?: string
  onSelect: (slug: string) => void
}) {
  return (
    <div data-testid={`settings-group-${group.id}`}>
      <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg)] opacity-50">
        {group.label}
      </p>
      <ul className="space-y-0.5">
        {group.sections.map((sec) => (
          <SectionNavItem
            key={sec.slug}
            section={sec}
            active={sec.slug === activeSlug}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  )
}

function SectionNavItem({
  section,
  active,
  onSelect,
}: {
  section: SettingsSection
  active: boolean
  onSelect: (slug: string) => void
}) {
  return (
    <li>
      <NavLink
        to={`/settings/${section.slug}`}
        onClick={(e) => {
          // Let the shell decide the real target (branch-scoped links carry the
          // selected branch); prevent the plain NavLink navigation.
          e.preventDefault()
          onSelect(section.slug)
        }}
        className={cn(
          'block rounded-md px-2 py-1.5 text-sm transition-colors',
          active
            ? 'bg-[var(--sidebar-active-bg)] text-white'
            : 'text-[var(--fg)] opacity-75 hover:opacity-100 hover:bg-[var(--sidebar-hover-bg)]',
        )}
      >
        {section.label}
      </NavLink>
    </li>
  )
}

export default SettingsPage
