/**
 * The branch slugs with real form implementations.
 * Slice 11a owns crew-rate/material-factors/production-rates/branch-profile.
 * Slice 13b adds team-roster and client-references.
 * branch-credentials stays as a placeholder until Slice 15.
 */
export const BRANCH_FORM_SLUGS = [
  'crew-rate',
  'material-factors',
  'production-rates',
  'branch-profile',
  'team-roster',
  'client-references',
] as const

export type BranchSectionSlug = (typeof BRANCH_FORM_SLUGS)[number]

export function branchSectionOwnsSlug(slug: string): slug is BranchSectionSlug {
  return (BRANCH_FORM_SLUGS as readonly string[]).includes(slug)
}
