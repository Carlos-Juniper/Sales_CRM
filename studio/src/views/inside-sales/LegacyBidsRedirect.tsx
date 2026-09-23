import { Navigate, useLocation } from 'react-router-dom'

/** Old Bid Tracker bookmarks land on Proposals and keep ?leadId=. */
export function LegacyBidsRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/inside-sales/proposals', search }} replace />
}
