import { LeadListView } from './components/LeadListView'

// A CRM's own book of work: leads assigned to them (by inside sales, from the
// public feed) plus leads they created themselves. Scoping is server-side.
export default function MyLeadsPage() {
  return (
    <LeadListView
      title="Leads"
      scope={{ mine: true }}
      showAddLead
      emptyTitle="No leads assigned to you yet"
      emptyDescription="Leads appear here once inside sales assigns one to you, or you add your own."
    />
  )
}
