import { useCallback, useState } from 'react'
import { useClientReferences, useTeamMembers } from '@/hooks/useProposals'
import {
  nextRegionSelection,
  REGION_MINE,
  type RegionFilterChoice,
  type RegionOption,
} from '@/lib/proposal/regionFilter'
import type { TeamMemberType } from '@/types/proposal'

/**
 * Region switcher for the proposal team roster.
 *
 * The request starts with no `region_id` ("My region"). If `X-Region-Filter`
 * is readable and names one region from branch-coverage, the control moves
 * to that region. A missing header, "all", or a comma-separated set leaves
 * the control on "My region". A choice the user makes is never overwritten.
 */
export function useRegionScopedTeamMembers(
  params: { aspireBranchId?: number; teamType?: TeamMemberType } | undefined,
  regions: RegionOption[],
) {
  const [choice, setChoice] = useState<RegionFilterChoice>(REGION_MINE)
  const [touched, setTouched] = useState(false)
  const [appliedEcho, setAppliedEcho] = useState<string | null>(null)

  const query = useTeamMembers({
    ...params,
    ...(choice === REGION_MINE ? {} : { regionId: choice }),
  })

  // Adjusting state during render (rather than in an effect) so the follow-up
  // request can start before paint. nextRegionSelection is null until the
  // header names a single known region, and null again once that echo is stored.
  const update = nextRegionSelection(
    touched,
    appliedEcho,
    query.regionFilter ?? null,
    regions,
  )
  if (update) {
    setAppliedEcho(update.appliedEcho)
    setChoice(update.choice)
  }

  const selectRegion = useCallback((next: RegionFilterChoice) => {
    setTouched(true)
    setChoice(next)
  }, [])

  return { ...query, choice, selectRegion }
}

/** Same switcher, bound to the client-reference roster. */
export function useRegionScopedClientReferences(
  params: { aspireBranchId?: number } | undefined,
  regions: RegionOption[],
) {
  const [choice, setChoice] = useState<RegionFilterChoice>(REGION_MINE)
  const [touched, setTouched] = useState(false)
  const [appliedEcho, setAppliedEcho] = useState<string | null>(null)

  const query = useClientReferences({
    ...params,
    ...(choice === REGION_MINE ? {} : { regionId: choice }),
  })

  const update = nextRegionSelection(
    touched,
    appliedEcho,
    query.regionFilter ?? null,
    regions,
  )
  if (update) {
    setAppliedEcho(update.appliedEcho)
    setChoice(update.choice)
  }

  const selectRegion = useCallback((next: RegionFilterChoice) => {
    setTouched(true)
    setChoice(next)
  }, [])

  return { ...query, choice, selectRegion }
}
