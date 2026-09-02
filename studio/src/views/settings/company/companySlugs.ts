/**
 * Company slugs that Slice 10a owns a real body for. Kept in its own module so
 * the SettingsPage can ask "does the company section own this slug?" without
 * importing the component file (which would trip react-refresh/only-export).
 * `users` and `credentials` are deliberately absent — separate slices own them.
 */
export const COMPANY_SECTION_SLUGS = [
  'approval-tiers',
  'margin-bands',
  'sla',
  'discrepancy-threshold',
  'intake-defaults',
  'regions',
  'static-content',
  'portfolio',
] as const

export type CompanySectionSlug = (typeof COMPANY_SECTION_SLUGS)[number]

export function companySectionOwnsSlug(slug: string): slug is CompanySectionSlug {
  return (COMPANY_SECTION_SLUGS as readonly string[]).includes(slug)
}
