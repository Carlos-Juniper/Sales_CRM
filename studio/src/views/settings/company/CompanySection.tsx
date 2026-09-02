import { useRole } from '@/hooks/useRole'
import type { CompanySectionSlug } from './companySlugs'
import { ApprovalTiersForm } from './ApprovalTiersForm'
import { MarginBandsForm } from './MarginBandsForm'
import { SlaForm } from './SlaForm'
import { DiscrepancyThresholdForm } from './DiscrepancyThresholdForm'
import { IntakeDefaultsForm } from './IntakeDefaultsForm'
import { PortfolioSection } from './PortfolioSection'
import { CredentialsSection } from '../credentials/CredentialsSection'

/** Company slugs this slice owns a real body for (users managed separately). */
const COMPANY_FORMS: Record<CompanySectionSlug, () => React.ReactElement> = {
  'approval-tiers': ApprovalTiersForm,
  'margin-bands': MarginBandsForm,
  sla: SlaForm,
  'discrepancy-threshold': DiscrepancyThresholdForm,
  'intake-defaults': IntakeDefaultsForm,
  // Slice 13b: portfolio property management (admin-only, company-scoped).
  portfolio: PortfolioSection,
}

/**
 * Company-config section body. The shell already gates the Company GROUP to
 * admin, but this is a second, defense-in-depth guard: company config edits
 * move real authorization boundaries (approval ceilings, margin bands), so a
 * non-admin who somehow reaches a slug sees an admin-only note, never a form.
 *
 * The `credentials` slug is handled inline (Slice 15b) because it renders
 * the shared CredentialsSection with aspireBranchId=null (company-wide scope).
 * Returns null for slugs another slice owns (users).
 */
export function CompanySection({ slug, label }: { slug: string; label: string }) {
  const { isAdmin } = useRole()

  // Slice 15b: credentials section is company-wide (aspireBranchId=null).
  if (slug === 'credentials') {
    if (!isAdmin) {
      return (
        <div
          data-testid="settings-section-credentials"
          className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
        >
          <h2 className="text-sm font-semibold text-[var(--fg)]">{label}</h2>
          <p className="mt-1 text-xs text-[var(--fg)] opacity-60">
            Admin only — company settings are admin-owned.
          </p>
        </div>
      )
    }
    return <CredentialsSection aspireBranchId={null} />
  }

  const Form = (COMPANY_FORMS as Record<string, () => React.ReactElement>)[slug]
  if (!Form) return null

  if (!isAdmin) {
    return (
      <div
        data-testid={`settings-section-${slug}`}
        className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
      >
        <h2 className="text-sm font-semibold text-[var(--fg)]">{label}</h2>
        <p className="mt-1 text-xs text-[var(--fg)] opacity-60">
          Admin only — company settings are admin-owned.
        </p>
      </div>
    )
  }

  return <Form />
}
