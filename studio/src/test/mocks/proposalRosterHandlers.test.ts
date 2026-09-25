import { describe, expect, it } from 'vitest'
import { MOCK_CLIENT_REFERENCES, MOCK_TEAM_MEMBERS } from '@/mocks/proposalRoster'

async function getRoster(path: string) {
  const res = await fetch(path)
  const body = await res.json()
  return { status: res.status, header: res.headers.get('X-Region-Filter'), body }
}

describe('proposal roster MSW handlers', () => {
  it('omitted region_id filters to the mock caller region and echoes it', async () => {
    const { status, header, body } = await getRoster('/api/proposals/config/team-members')
    expect(status).toBe(200)
    expect(header).toBe('west-coast')
    expect(body.map((row: { id: string }) => row.id).sort()).toEqual(['tm-all', 'tm-exec', 'tm-west'])
    expect(body.find((row: { id: string }) => row.id === 'tm-all').regionId).toBeNull()
    expect(body.find((row: { id: string }) => row.id === 'tm-west').regionId).toBe('west-coast')
  })

  it('region_id=all returns every row and echoes all', async () => {
    const { status, header, body } = await getRoster('/api/proposals/config/team-members?region_id=ALL')
    expect(status).toBe(200)
    expect(header).toBe('all')
    expect(body).toHaveLength(MOCK_TEAM_MEMBERS.length)
  })

  it('a region id returns that region plus null-region rows', async () => {
    const { header, body } = await getRoster('/api/proposals/config/team-members?region_id=east-coast')
    expect(header).toBe('east-coast')
    expect(body.map((row: { id: string }) => row.id).sort()).toEqual(['tm-all', 'tm-east', 'tm-exec'])
  })

  it('an unknown region id is a 400', async () => {
    const { status, header, body } = await getRoster('/api/proposals/config/team-members?region_id=nope')
    expect(status).toBe(400)
    expect(header).toBeNull()
    expect(body.detail).toMatch(/Unknown region_id/)
  })

  it('a blank region id is a 400', async () => {
    const { status, body } = await getRoster('/api/proposals/config/client-references?region_id=%20')
    expect(status).toBe(400)
    expect(body.detail).toMatch(/crm\.regions\.id or 'all'/)
  })

  it('aspire_branch_id and team_type still combine with the region filter', async () => {
    const branch = await getRoster(
      '/api/proposals/config/team-members?region_id=west-coast&aspire_branch_id=1403',
    )
    expect(branch.body.map((row: { id: string }) => row.id).sort()).toEqual(['tm-all', 'tm-exec', 'tm-west'])

    const executives = await getRoster(
      '/api/proposals/config/team-members?region_id=all&team_type=executive',
    )
    expect(executives.header).toBe('all')
    expect(executives.body.map((row: { id: string }) => row.id)).toEqual(['tm-exec'])
  })

  it('client references follow the same region rules', async () => {
    const mine = await getRoster('/api/proposals/config/client-references')
    expect(mine.header).toBe('west-coast')
    expect(mine.body.map((row: { id: string }) => row.id).sort()).toEqual(['cr-all', 'cr-west'])

    const everyone = await getRoster('/api/proposals/config/client-references?region_id=all')
    expect(everyone.body).toHaveLength(MOCK_CLIENT_REFERENCES.length)
  })
})
