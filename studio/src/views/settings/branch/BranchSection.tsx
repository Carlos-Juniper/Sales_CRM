import type { BranchSectionSlug } from './branchSlugs'
import { BRANCH_FORM_SLUGS } from './branchSlugs'
import { SectionPlaceholder } from '../SectionPlaceholder'
import { CrewRateForm } from './CrewRateForm'
import { MaterialFactorsForm } from './MaterialFactorsForm'
import { ProductionRatesForm } from './ProductionRatesForm'
import { BranchProfileSection } from './BranchProfileSection'
import { TeamRosterSection } from './TeamRosterSection'
import { ClientReferencesSection } from './ClientReferencesSection'
import { CredentialsSection } from '../credentials/CredentialsSection'

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
 * The `branch-credentials` slug (Slice 15b) is handled inline: it renders the
 * shared CredentialsSection with the selected aspireBranchId so the BM manages
 * branch-scoped licenses/certifications (company-wide rows appear read-only).
 *
 * For other unmapped slugs renders a SectionPlaceholder so the section shell
 * never shows a blank page. For slugs with a real form, renders that form once
 * a branch is selected.
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
  // Slice 15b: branch credentials rendered with the selected branch scope.
  if (slug === 'branch-credentials') {
    if (aspireBranchId === undefined) {
      return (
        <div
          data-testid="settings-section-branch-credentials"
          className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
        >
          <p className="text-xs text-[var(--fg)] opacity-60">
            Select a branch to configure its credentials.
          </p>
        </div>
      )
    }
    return <CredentialsSection aspireBranchId={aspireBranchId} />
  }

  const Form = (BRANCH_FORMS as Record<string, BranchForm | undefined>)[slug]

  // Unmapped slug: render a placeholder instead of null so the user never sees
  // a blank content area.
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
