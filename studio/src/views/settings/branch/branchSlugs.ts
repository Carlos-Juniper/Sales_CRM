/**
 * The branch slugs with real form implementations.
 * Slice 11a owns crew-rate/material-factors/production-rates/branch-profile.
 * team-roster and client-references live only under Sales (formerly
 * Marketing) now — see sections.ts. branch-credentials is handled inline in
 * BranchSection (renders the shared CredentialsSection).
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
