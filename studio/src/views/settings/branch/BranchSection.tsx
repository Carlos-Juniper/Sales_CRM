import type { BranchSectionSlug } from './branchSlugs'
import { CrewRateForm } from './CrewRateForm'
import { MaterialFactorsForm } from './MaterialFactorsForm'
import { ProductionRatesForm } from './ProductionRatesForm'
import { BranchProfileSection } from './BranchProfileSection'

/** Each branch form takes the currently-selected branch id. */
type BranchForm = (props: { aspireBranchId: number }) => React.ReactElement

const BRANCH_FORMS: Record<BranchSectionSlug, BranchForm> = {
  'crew-rate': CrewRateForm,
  'material-factors': MaterialFactorsForm,
  'production-rates': ProductionRatesForm,
  'branch-profile': BranchProfileSection,
}

/**
 * Branch-config section body, bound to the branch the shell selected. Renders
 * null for slugs a later slice owns (team-roster, client-references,
 * branch-credentials), so the shell falls back to their placeholders. When no
 * branch is resolvable yet (empty scope), shows a neutral prompt instead of a
 * form with an undefined id.
 */
export function BranchSection({
  slug,
  aspireBranchId,
}: {
  slug: string
  aspireBranchId: number | undefined
}) {
  const Form = (BRANCH_FORMS as Record<string, BranchForm | undefined>)[slug]
  if (!Form) return null

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
