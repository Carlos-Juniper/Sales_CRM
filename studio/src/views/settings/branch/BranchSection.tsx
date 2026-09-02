import type { BranchSectionSlug } from './branchSlugs'
import { BRANCH_FORM_SLUGS } from './branchSlugs'
import { SectionPlaceholder } from '../SectionPlaceholder'
import { CrewRateForm } from './CrewRateForm'
import { MaterialFactorsForm } from './MaterialFactorsForm'
import { ProductionRatesForm } from './ProductionRatesForm'
import { BranchProfileSection } from './BranchProfileSection'
import { TeamRosterSection } from './TeamRosterSection'
import { ClientReferencesSection } from './ClientReferencesSection'

/** Each branch form takes the currently-selected branch id. */
type BranchForm = (props: { aspireBranchId: number }) => React.ReactElement

const BRANCH_FORMS: Record<BranchSectionSlug, BranchForm> = {
  'crew-rate': CrewRateForm,
  'material-factors': MaterialFactorsForm,
  'production-rates': ProductionRatesForm,
  'branch-profile': BranchProfileSection,
  'team-roster': TeamRosterSection,
  'client-references': ClientReferencesSection,
}

/**
 * Branch-config section body, bound to the branch the shell selected.
 *
 * For slugs that ARE in BRANCH_FORM_SLUGS but have no matching form entry (e.g.
 * 'branch-credentials', which is scoped to Slice 15), renders a SectionPlaceholder
 * so the section shell never shows a blank page. For slugs with a real form,
 * renders that form once a branch is selected.
 *
 * When no branch is resolvable yet (empty scope), shows a neutral prompt instead
 * of a form with an undefined id.
 */
export function BranchSection({
  slug,
  aspireBranchId,
  sectionLabel,
}: {
  slug: string
  aspireBranchId: number | undefined
  sectionLabel?: string
}) {
  const Form = (BRANCH_FORMS as Record<string, BranchForm | undefined>)[slug]

  // Unmapped slug (e.g. 'branch-credentials'): render a placeholder instead of null
  // so the user never sees a blank content area.
  if (!Form) {
    return <SectionPlaceholder slug={slug} name={sectionLabel ?? slug} />
  }

  if (aspireBranchId === undefined) {
    return (
      <div
        data-testid={`settings-section-${slug}`}
        className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
      >
        <p className="text-xs text-[var(--fg)] opacity-60">
          Select a branch to configure its settings.
        </p>
      </div>
    )
  }

  return <Form aspireBranchId={aspireBranchId} />
}

// Re-export so callers importing from this file still work.
export { BRANCH_FORM_SLUGS }
