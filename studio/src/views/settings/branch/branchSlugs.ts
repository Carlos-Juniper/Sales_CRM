/**
 * The branch slugs Slice 11a owns a real form for. The remaining branch slugs
 * (team-roster, client-references, branch-credentials) stay as placeholders
 * until their later slices.
 */
export const BRANCH_FORM_SLUGS = [
  'crew-rate',
  'material-factors',
  'production-rates',
  'branch-profile',
] as const

export type BranchSectionSlug = (typeof BRANCH_FORM_SLUGS)[number]

export function branchSectionOwnsSlug(slug: string): slug is BranchSectionSlug {
  return (BRANCH_FORM_SLUGS as readonly string[]).includes(slug)
}
