// ---------------------------------------------------------------------------
// Page 18 — Meet Our Team (variable: picked branch members)
// ---------------------------------------------------------------------------

import type { TeamMember } from '@/types/proposal'
import { PrintPage, TeamMemberCard } from './shared'

export function MeetOurTeam({
  members,
  pageIndex,
  totalPages,
}: {
  members: TeamMember[]
  pageIndex: number
  totalPages: number
}) {
  return (
    <PrintPage
      data-testid={
        pageIndex === 0 ? 'page-meet-our-team' : `page-meet-our-team-${pageIndex + 1}`
      }
    >
      <p className="eyebrow">Your Juniper Team</p>
      <h1 className="page-title">
        Meet Our Team
        {totalPages > 1 ? ` (${pageIndex + 1} of ${totalPages})` : ''}
      </h1>
      <div className="team-grid">
        {members.map((m) => (
          <TeamMemberCard key={m.id} member={m} />
        ))}
      </div>
    </PrintPage>
  )
}
