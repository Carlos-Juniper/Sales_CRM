import { useState } from 'react'
import { LeadListView } from './components/LeadListView'
import { useAuthStore } from '@/store/authStore'
import { isTeamManager } from '@/lib/roles'
import { TeamToggle } from '@/components/shared/TeamToggle'

// A CRM's own book of work: leads assigned to them (by inside sales, from the
// public feed) plus leads they created themselves. Scoping is server-side.
// Managers and admins get an "All team" toggle to see the full branch scope.
export default function MyLeadsPage() {
  const user = useAuthStore((s) => s.user)
  const canSeeTeam = isTeamManager(user?.role)
  const [showAll, setShowAll] = useState(false)

  return (
    <LeadListView
      title="Leads"
      scope={{ mine: !showAll }}
      showAddLead
      emptyTitle={showAll ? 'No leads in your branch yet' : 'No leads assigned to you yet'}
      emptyDescription={
        showAll
          ? 'Leads appear here once reps in your branch create or receive them.'
          : 'Leads appear here once inside sales assigns one to you, or you add your own.'
      }
      headerExtra={
        canSeeTeam ? <TeamToggle showAll={showAll} onToggle={setShowAll} /> : undefined
      }
    />
  )
}
