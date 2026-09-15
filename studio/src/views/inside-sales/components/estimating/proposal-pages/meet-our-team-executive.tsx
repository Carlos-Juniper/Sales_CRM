// ---------------------------------------------------------------------------
// Optional page: Meet Our Team — Executive
// ---------------------------------------------------------------------------

import type { TeamMember } from '@/types/proposal'
import { PrintPage, TeamMemberCard } from './shared'

export function MeetOurTeamExecutive({
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
        pageIndex === 0
          ? 'page-meet-our-team-executive'
          : `page-meet-our-team-executive-${pageIndex + 1}`
      }
    >
      <p className="eyebrow">Leadership</p>
      <h1 className="page-title">
        Meet Our Team — Executive
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
