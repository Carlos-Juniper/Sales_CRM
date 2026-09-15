// ---------------------------------------------------------------------------
// chapters.test.ts — the pure chapter-order model backing the TOC + reorder
// feature. Covers naturalBodyChapterKeys' gating and resolveChapterOrder's
// reconciliation (persisted order respected; stale key dropped; new key
// appended) — see studio/src/lib/proposal/chapters.ts for the full contract.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { naturalBodyChapterKeys, resolveChapterOrder, chapterTitle } from '@/lib/proposal/chapters'
import type { OptionalSection } from '@/views/inside-sales/components/estimating/ProposalBuilder'

const BASE_INPUTS = {
  sections: new Set<OptionalSection>(),
  hasOrgChart: false,
  hasExecutiveTeam: false,
  hasPortfolio: false,
  hasContract: false,
}

describe('naturalBodyChapterKeys', () => {
  it('always includes the unconditional chapters, including meet-the-team even with zero picks', () => {
    const keys = naturalBodyChapterKeys(BASE_INPUTS)
    expect(keys).toEqual([
      'rooted-in-florida',
      'local-landscape-experts',
      'our-services',
      'juniper-cares',
      'startup-communication',
      'customer-care',
      'meet-the-team',
      'references',
      'insurance',
      'licenses',
    ])
  })

  it('gates org-chart, executive team, portfolio, and contract on their own flags', () => {
    const keys = naturalBodyChapterKeys({
      ...BASE_INPUTS,
      hasOrgChart: true,
      hasExecutiveTeam: true,
      hasPortfolio: true,
      hasContract: true,
    })
    expect(keys).toContain('org-chart')
    expect(keys).toContain('meet-the-team-executive')
    expect(keys).toContain('portfolio')
    expect(keys).toContain('contract')
    // Executive team is listed before the branch roster (reference order).
    expect(keys.indexOf('meet-the-team-executive')).toBeLessThan(keys.indexOf('meet-the-team'))
    // Contract is listed after portfolio (maintenance agreement comes last).
    expect(keys.indexOf('contract')).toBeGreaterThan(keys.indexOf('portfolio'))
  })

  it('gates the optional-section chapters on formState.sections', () => {
    const keys = naturalBodyChapterKeys({
      ...BASE_INPUTS,
      sections: new Set<OptionalSection>(['startup_plan_30_60_90', 'juniper_mapping']),
    })
    expect(keys).toContain('startup-plan')
    expect(keys).toContain('juniper-mapping')
    expect(keys).not.toContain('juniper-sync')
  })
})

describe('resolveChapterOrder', () => {
  const natural = ['a', 'b', 'c', 'd']

  it('returns the natural order untouched when nothing is persisted', () => {
    expect(resolveChapterOrder(natural, null)).toEqual(natural)
  })

  it('applies a persisted order when every key still exists', () => {
    expect(resolveChapterOrder(natural, ['d', 'a', 'c', 'b'])).toEqual(['d', 'a', 'c', 'b'])
  })

  it('drops a persisted key whose chapter no longer exists', () => {
    // 'z' was in a previously-saved order but nothing produces it any more
    // (e.g. a since-unchecked optional section).
    expect(resolveChapterOrder(natural, ['d', 'z', 'a', 'b', 'c'])).toEqual(['d', 'a', 'b', 'c'])
  })

  it('appends a chapter that exists now but was not in the persisted order', () => {
    // 'd' is new (e.g. a newly-checked optional section) — appended at the end,
    // not inserted into its natural relative position.
    expect(resolveChapterOrder(natural, ['c', 'b', 'a'])).toEqual(['c', 'b', 'a', 'd'])
  })
})

describe('chapterTitle', () => {
  it('resolves every key naturalBodyChapterKeys can produce to a non-empty title', () => {
    const keys = naturalBodyChapterKeys({
      ...BASE_INPUTS,
      hasOrgChart: true,
      hasExecutiveTeam: true,
      hasPortfolio: true,
      hasContract: true,
      sections: new Set<OptionalSection>(['startup_plan_30_60_90', 'juniper_sync', 'juniper_mapping']),
    })
    for (const key of keys) {
      expect(chapterTitle(key)).not.toBe(key)
    }
  })

  it('falls back to the raw key for an unknown chapter', () => {
    expect(chapterTitle('some-unregistered-key')).toBe('some-unregistered-key')
  })
})
