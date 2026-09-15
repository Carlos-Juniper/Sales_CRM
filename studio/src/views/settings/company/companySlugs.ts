/**
 * Company slugs that Slice 10a owns a real body for. Kept in its own module so
 * the SettingsPage can ask "does the company section own this slug?" without
 * importing the component file (which would trip react-refresh/only-export).
 * `users` is owned by a separate slice; `portfolio` and `credentials` live
 * only under Sales (formerly Marketing) — see sections.ts.
 */
export const COMPANY_SECTION_SLUGS = [
  'approval-tiers',
  'margin-bands',
  'sla',
  'discrepancy-threshold',
  'intake-defaults',
] as const

export type CompanySectionSlug = (typeof COMPANY_SECTION_SLUGS)[number]

export function companySectionOwnsSlug(slug: string): slug is CompanySectionSlug {
  return (COMPANY_SECTION_SLUGS as readonly string[]).includes(slug)
}
