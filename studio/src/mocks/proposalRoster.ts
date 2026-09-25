import { HttpResponse } from 'msw'
import type { BranchCoverageGroup, ClientReference, TeamMember } from '@/types/proposal'

/** crm.regions ids the roster filter accepts. An unknown id is a 400. */
export const KNOWN_REGION_IDS = new Set(['east-coast', 'west-coast', 'central', 'south'])

/**
 * Stand-in for the signed-in rep's branches. Omitting `region_id` filters to
 * this set and echoes it on `X-Region-Filter`. An empty list would mean the
 * caller has no region and the default is unrestricted.
 */
export const MOCK_CALLER_REGION_IDS = ['west-coast']

export const MOCK_BRANCH_COVERAGE: BranchCoverageGroup[] = [
  {
    state: 'FL',
    stateName: 'Florida',
    regions: [
      { regionId: 'east-coast', regionName: 'East Coast', branches: ['Jupiter'] },
      { regionId: 'west-coast', regionName: 'West Coast', branches: ['Fort Myers'] },
      { regionId: 'central', regionName: 'Central', branches: ['Orlando'] },
      // Unassigned offices are not a switcher option.
      { regionId: '', regionName: '', branches: ['Houston'] },
    ],
  },
]

function member(
  over: Pick<TeamMember, 'id' | 'name' | 'regionId' | 'aspireBranchId'> &
    Partial<TeamMember>,
): TeamMember {
  return {
    title: 'account_manager',
    teamType: 'branch',
    userId: null,
    location: null,
    bio: '',
    headshotObjectKey: null,
    active: true,
    sortOrder: 1,
    ...over,
  }
}

function reference(
  over: Pick<ClientReference, 'id' | 'propertyName' | 'regionId' | 'aspireBranchId'> &
    Partial<ClientReference>,
): ClientReference {
  return {
    servicesProvided: 'Landscape Maintenance',
    contactName: 'Pat Manager',
    contactTitle: 'Manager',
    phone: '239-555-0100',
    email: 'pat@example.com',
    address: '1 Main St',
    clientSinceYear: 2018,
    active: true,
    ...over,
  }
}

export const MOCK_TEAM_MEMBERS: TeamMember[] = [
  member({ id: 'tm-west', name: 'West Coast AM', regionId: 'west-coast', aspireBranchId: 1403, sortOrder: 1 }),
  member({ id: 'tm-east', name: 'East Coast AM', regionId: 'east-coast', aspireBranchId: 2001, sortOrder: 2 }),
  member({ id: 'tm-central', name: 'Central AM', regionId: 'central', aspireBranchId: 2002, sortOrder: 3 }),
  member({ id: 'tm-south', name: 'South AM', regionId: 'south', aspireBranchId: 3001, sortOrder: 4 }),
  member({
    id: 'tm-all',
    name: 'Company Wide Lead',
    regionId: null,
    aspireBranchId: null,
    sortOrder: 5,
  }),
  member({
    id: 'tm-exec',
    name: 'Company Executive',
    title: 'executive',
    teamType: 'executive',
    regionId: null,
    aspireBranchId: null,
    sortOrder: 1,
  }),
]

export const MOCK_CLIENT_REFERENCES: ClientReference[] = [
  reference({ id: 'cr-west', propertyName: 'West Coast HOA', regionId: 'west-coast', aspireBranchId: 1403 }),
  reference({ id: 'cr-east', propertyName: 'East Coast HOA', regionId: 'east-coast', aspireBranchId: 2001 }),
  reference({ id: 'cr-all', propertyName: 'Company Wide HOA', regionId: null, aspireBranchId: null }),
]

type RegionResolution =
  | { regionIds: string[] | null; header: string }
  | { error: string }

export function resolveRegionParam(raw: string | null): RegionResolution {
  if (raw === null) {
    const ids = [...MOCK_CALLER_REGION_IDS].sort()
    if (ids.length === 0) return { regionIds: null, header: 'all' }
    return { regionIds: ids, header: ids.join(',') }
  }
  const token = raw.trim()
  if (token.toLowerCase() === 'all') return { regionIds: null, header: 'all' }
  if (!token || token.length > 36) {
    return { error: "region_id must be a crm.regions.id or 'all'." }
  }
  if (!KNOWN_REGION_IDS.has(token)) {
    return { error: "Unknown region_id. Pass a crm.regions.id or 'all'." }
  }
  return { regionIds: [token], header: token }
}

function matchesRegion(
  row: { regionId: string | null; aspireBranchId: number | null },
  regionIds: string[] | null,
): boolean {
  if (!regionIds || regionIds.length === 0) return true
  if (row.aspireBranchId == null) return true
  if (row.regionId == null || row.regionId === '') return true
  return regionIds.includes(row.regionId)
}

/** MSW response for team-members and client-references. Honors region_id. */
export function rosterHttpResponse<T extends {
  regionId: string | null
  aspireBranchId: number | null
  teamType?: string
}>(
  request: Request,
  rows: T[],
  options?: { filterTeamType?: boolean },
) {
  const url = new URL(request.url)
  const resolved = resolveRegionParam(url.searchParams.get('region_id'))
  if ('error' in resolved) {
    return HttpResponse.json({ detail: resolved.error }, { status: 400 })
  }

  let filtered = rows.filter((row) => matchesRegion(row, resolved.regionIds))
  const branchRaw = url.searchParams.get('aspire_branch_id')
  if (branchRaw) {
    const branchId = Number(branchRaw)
    filtered = filtered.filter(
      (row) => row.aspireBranchId === branchId || row.aspireBranchId == null,
    )
  }
  if (options?.filterTeamType) {
    const teamType = url.searchParams.get('team_type')
    if (teamType) filtered = filtered.filter((row) => row.teamType === teamType)
  }

  return HttpResponse.json(filtered, {
    headers: { 'X-Region-Filter': resolved.header },
  })
}
