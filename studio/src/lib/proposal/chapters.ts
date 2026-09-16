// ---------------------------------------------------------------------------
// Proposal chapter model — shared between ProposalPreview.tsx (which renders
// each chapter's pages) and the reorder UI (which only needs chapter keys and
// titles, not the JSX behind them).
//
// A "chapter" is the reorder unit: one or more consecutive pages that always
// move together (e.g. "Our Services" bundles the overview page and every
// service detail page). Cover, Intro Letter, and Closing are never chapters —
// they are locked in place and are not part of this model at all.
//
// Kept dependency-free of React/JSX on purpose: naturalBodyChapterKeys and
// resolveChapterOrder must be callable from both ProposalPreview.tsx (which
// needs the JSX per key) and the toolbar's reorder panel (which only needs the
// key + title list to render as draggable rows) without either one depending
// on the other's rendering code.
// ---------------------------------------------------------------------------

import type { OptionalSection } from '@/views/inside-sales/components/estimating/ProposalBuilder'

/** Human-readable label for a chapter key, shown in the TOC and the reorder panel. */
const CHAPTER_TITLES: Record<string, string> = {
  'rooted-in-florida': 'Rooted in Florida',
  'local-landscape-experts': 'Local Landscape Experts',
  'org-chart': 'Org Chart',
  'our-services': 'Our Services',
  'juniper-cares': 'Juniper Cares',
  'startup-communication': 'Start Up Communication',
  'customer-care': 'Customer Care',
  'startup-plan': 'Start Up Plan (30-60-90 Day)',
  'juniper-sync': 'Juniper Sync',
  'juniper-mapping': 'Juniper Mapping',
  'meet-the-team-executive': 'Meet Our Team — Executive',
  'meet-the-team': 'Meet Our Team',
  'references': 'Client References',
  'insurance': 'Insurance',
  'licenses': 'Licenses & Certifications',
  'portfolio': 'Portfolio',
  'contract': 'Landscape Maintenance Agreement',
}

export function chapterTitle(key: string): string {
  return CHAPTER_TITLES[key] ?? key
}

export interface NaturalChapterInputs {
  sections: Set<OptionalSection>
  hasOrgChart: boolean
  hasExecutiveTeam: boolean
  hasPortfolio: boolean
  hasContract: boolean
}

/**
 * The body chapter keys that exist for this proposal, in natural (default)
 * order — i.e. the order the document renders in before any custom
 * chapterOrder is applied. Every key here is guaranteed to have at least one
 * page; a chapter that could render zero pages (an empty optional pick) is
 * left out entirely rather than appearing as an empty draggable row.
 *
 * "meet-the-team" (the branch roster) is unconditional even with zero picks —
 * it renders one page with an empty grid rather than disappearing, matching
 * `paginate`'s existing `[[]]`-on-empty fallback in ProposalPreview.tsx. The
 * executive variant, by contrast, only exists when the roster is non-empty.
 */
export function naturalBodyChapterKeys(inputs: NaturalChapterInputs): string[] {
  const keys: string[] = ['rooted-in-florida', 'local-landscape-experts']
  if (inputs.hasOrgChart) keys.push('org-chart')
  keys.push('our-services', 'juniper-cares', 'startup-communication', 'customer-care')
  if (inputs.sections.has('startup_plan_30_60_90')) keys.push('startup-plan')
  if (inputs.sections.has('juniper_sync')) keys.push('juniper-sync')
  if (inputs.sections.has('juniper_mapping')) keys.push('juniper-mapping')
  if (inputs.hasExecutiveTeam) keys.push('meet-the-team-executive')
  keys.push('meet-the-team', 'references', 'insurance', 'licenses')
  if (inputs.hasPortfolio) keys.push('portfolio')
  if (inputs.hasContract) keys.push('contract')
  return keys
}

/**
 * Reconciles a persisted custom order against the chapters that actually exist
 * right now. A persisted key for a chapter that no longer exists (e.g. a
 * since-unchecked optional section) is dropped; a chapter that exists now but
 * wasn't in the persisted order (e.g. a newly-checked section, or this is the
 * first-ever save) is appended at the end — the simplest reconciliation rule,
 * not an attempt to guess the "natural" slot for a newly-added chapter.
 */
export function resolveChapterOrder(natural: string[], persisted: string[] | null): string[] {
  if (!persisted) return natural
  const naturalSet = new Set(natural)
  const kept = persisted.filter((k) => naturalSet.has(k))
  const seen = new Set(kept)
  const appended = natural.filter((k) => !seen.has(k))
  return [...kept, ...appended]
}
