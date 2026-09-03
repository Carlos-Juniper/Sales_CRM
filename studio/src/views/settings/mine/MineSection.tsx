import { ThemeSection } from './ThemeSection'
import { ConnectionsSection } from './ConnectionsSection'

type MineSectionSlug = 'theme' | 'connections'

const MINE_SECTIONS: Record<MineSectionSlug, () => React.ReactElement> = {
  theme: ThemeSection,
  connections: ConnectionsSection,
}

/**
 * Mine-section body dispatcher. Any authed user sees Mine; no role gate needed
 * here because the shell already restricts Mine to authed users only (roles: [],
 * adminOnly: false).
 *
 * Returns null for slugs not owned by this slice so the shell can fall back to
 * its placeholder (there are none currently, but the pattern matches Branch/Company).
 */
export function MineSection({ slug }: { slug: string }) {
  const Section = (MINE_SECTIONS as Record<string, (() => React.ReactElement) | undefined>)[slug]
  if (!Section) return null
  return <Section />
}
