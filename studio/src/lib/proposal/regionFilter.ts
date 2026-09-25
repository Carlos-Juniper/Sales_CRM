import type { BranchCoverageGroup } from '@/types/proposal'

/** Switcher value that omits `region_id` so the API uses the caller's region. */
export const REGION_MINE = 'mine'

/** Switcher value that sends `region_id=all`. */
export const REGION_ALL = 'all'

export const ALL_REGIONS_LABEL = 'All regions'

export type RegionFilterChoice = typeof REGION_MINE | typeof REGION_ALL | (string & {})

export interface RegionOption {
  regionId: string
  regionName: string
}

/**
 * Distinct regions from branch-coverage, in first-seen order (the payload
 * already sorts regions within each state). Blank ids are the unassigned
 * office bucket and are not switcher options.
 */
export function regionsFromCoverage(
  groups: BranchCoverageGroup[] | undefined | null,
): RegionOption[] {
  const seen = new Map<string, string>()
  for (const group of groups ?? []) {
    for (const region of group.regions) {
      const regionId = region.regionId.trim()
      if (!regionId || seen.has(regionId)) continue
      const regionName = region.regionName.trim() || regionId
      seen.set(regionId, regionName)
    }
  }
  return [...seen.entries()].map(([regionId, regionName]) => ({ regionId, regionName }))
}

/** Query value for the roster endpoints. `undefined` omits the param. */
export function regionFilterParam(choice: RegionFilterChoice): string | undefined {
  return choice === REGION_MINE ? undefined : choice
}

/**
 * A single region id the switcher can show, or null when the header should
 * not move the control off "My region".
 *
 * Null covers: header missing (cross-origin and not exposed), "all", a
 * comma-separated set (the caller spans several regions), and an id that
 * branch-coverage did not name.
 */
export function echoedRegionChoice(
  echoed: string | null,
  regions: RegionOption[],
): string | null {
  if (!echoed) return null
  const token = echoed.trim()
  if (!token || token.toLowerCase() === REGION_ALL || token.includes(',')) return null
  return regions.some((region) => region.regionId === token) ? token : null
}

/**
 * Render-time adjustment for the switcher. Returns the next selection when
 * `X-Region-Filter` names one known region and the user has not chosen yet.
 * Returns null when the control should stay put — including while region
 * names are still loading, so a later coverage response can still apply.
 */
export function nextRegionSelection(
  touched: boolean,
  appliedEcho: string | null,
  echoed: string | null,
  regions: RegionOption[],
): { choice: RegionFilterChoice; appliedEcho: string } | null {
  if (touched || !echoed || appliedEcho === echoed) return null
  const choice = echoedRegionChoice(echoed, regions)
  if (!choice) return null
  return { choice, appliedEcho: echoed }
}
