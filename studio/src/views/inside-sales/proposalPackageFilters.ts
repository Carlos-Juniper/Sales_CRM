import type { LeadStatus } from '@/types'
import type { ProposalPackageSummary } from '@/types/proposal'

/** Client-side search + status filter for the proposals list. */
export function filterProposalPackages(
  packages: ProposalPackageSummary[],
  query: string,
  status: LeadStatus | 'all',
): ProposalPackageSummary[] {
  const q = query.trim().toLowerCase()
  return packages.filter((pkg) => {
    if (status !== 'all' && pkg.status !== status) return false
    if (!q) return true
    const haystack = [pkg.title, pkg.subtitle, pkg.code, pkg.assignee?.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}
