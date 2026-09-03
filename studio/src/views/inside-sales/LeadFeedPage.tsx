import { LeadListView } from './components/LeadListView'
import { GOV_LEAD_SOURCES } from '@/lib/constants'

// The public feed is the government opportunities the gov-bids scrapers ingest.
// Manually-created leads live on MyLeadsPage, so there is no "Add lead" here —
// a manual lead would vanish from this feed the moment it was created.
export default function LeadFeedPage() {
  return (
    <LeadListView
      title="Public Leads"
      scope={{ sources: GOV_LEAD_SOURCES }}
      emptyTitle="No public leads match your filters"
      emptyDescription="Government opportunities arrive from the weekly HigherGov refresh."
    />
  )
}
