import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AssigneeAvatar } from '@/components/shared/AssigneeAvatar'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LeadDetailPanel } from './components/LeadDetailPanel'
import { NewProposalPackageDialog } from './components/NewProposalPackageDialog'
import { useProposalPackages } from '@/hooks/useProposals'
import { useUIStore } from '@/store/uiStore'
import { LEAD_STATUS_LABELS } from '@/lib/constants'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { LeadStatus, User, UserRole } from '@/types'
import type { ProposalPackageAssignee, ProposalPackageSummary } from '@/types/proposal'
import { filterProposalPackages } from './proposalPackageFilters'

const STATUS_KEYS = Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]

function toUser(assignee: ProposalPackageAssignee | null): User | null {
  if (!assignee) return null
  return {
    id: assignee.id,
    name: assignee.name,
    email: assignee.email,
    role: assignee.role as UserRole,
    branch_id: assignee.branchId,
    avatar_initials: assignee.avatarInitials,
  }
}

function packageMeta(pkg: ProposalPackageSummary): string {
  const parts = [pkg.code]
  if (pkg.version != null) parts.push(`v${pkg.version}.0`)
  if (pkg.pageCount != null) parts.push(`${pkg.pageCount} pg`)
  return parts.join(' · ')
}

export default function ProposalsPage() {
  const { data: packages = [], isLoading, isError, refetch } = useProposalPackages()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<LeadStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const selectedLeadId = useUIStore((s) => s.selectedLeadId)
  const selectLead = useUIStore((s) => s.selectLead)

  // Deep link from Accounts ("open this lead") and from a refreshed row click.
  const leadFromUrl = searchParams.get('leadId')
  useEffect(() => {
    if (leadFromUrl) selectLead(leadFromUrl)
  }, [leadFromUrl, selectLead])

  const filtered = useMemo(
    () => filterProposalPackages(packages, query, status),
    [packages, query, status],
  )

  const leadIds = useMemo(() => {
    const ids: string[] = []
    for (const pkg of filtered) {
      if (pkg.leadId && !ids.includes(pkg.leadId)) ids.push(pkg.leadId)
    }
    return ids
  }, [filtered])

  function openLead(leadId: string) {
    if (!leadId) return
    selectLead(leadId)
    setSearchParams({ leadId })
  }

  function closeLead() {
    selectLead(null)
    setSearchParams({})
  }

  const selectedIndex = selectedLeadId ? leadIds.indexOf(selectedLeadId) : -1

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav
        title="Proposals"
        subtitle={`${packages.length} proposal package${packages.length === 1 ? '' : 's'}`}
      />

      <ScrollArea className="flex-1">
        <div className="p-5">
          <PageHeader
            title="Proposal Packages"
            description="Saved proposal packages, each linked to its lead."
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center mb-4">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search proposals..."
              aria-label="Search proposals"
              className="sm:max-w-xs"
            />
            <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus | 'all')}>
              <SelectTrigger className="w-full sm:w-40 h-9 text-sm" aria-label="Status">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {STATUS_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>{LEAD_STATUS_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="sm:ml-auto">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                New Proposal Package
              </Button>
            </div>
          </div>

          <div className="border border-[hsl(var(--border))] rounded-lg overflow-hidden bg-[hsl(var(--card))]">
            {isLoading && (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            )}

            {isError && (
              <EmptyState
                title="Couldn't load proposals"
                description="Check your connection and try again."
                action={{ label: 'Retry', onClick: () => { void refetch() } }}
              />
            )}

            {!isLoading && !isError && packages.length === 0 && (
              <EmptyState
                title="No proposal packages yet"
                description="Generate a package and it will show up here, attached to its lead."
                action={{ label: 'New Proposal Package', onClick: () => setCreateOpen(true) }}
              />
            )}

            {!isLoading && !isError && packages.length > 0 && filtered.length === 0 && (
              <EmptyState
                title="No proposals match"
                description="Try a different search or status."
              />
            )}

            {!isLoading && !isError && filtered.map((pkg) => {
              const selected = pkg.leadId !== '' && pkg.leadId === selectedLeadId
              return (
                <button
                  key={pkg.id}
                  type="button"
                  data-testid="proposal-row"
                  onClick={() => openLead(pkg.leadId)}
                  className={cn(
                    'flex w-full items-start gap-4 border-b border-[hsl(var(--border))] px-4 py-3.5 text-left last:border-0 transition-colors',
                    'hover:bg-[hsl(var(--muted))]',
                    selected && 'bg-[#2E7D52]/5',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[hsl(var(--fg))] truncate">{pkg.title}</p>
                    {pkg.subtitle && (
                      <p className="mt-0.5 text-xs text-[hsl(var(--muted-fg))] line-clamp-1">{pkg.subtitle}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[hsl(var(--muted-fg))]">
                      <span className="inline-flex items-center gap-1.5">
                        <AssigneeAvatar user={toUser(pkg.assignee)} size="sm" />
                        <span>{pkg.assignee?.name ?? 'Unassigned'}</span>
                      </span>
                      <span>{packageMeta(pkg)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-sm font-semibold text-[#2E7D52]">{formatCurrency(pkg.amount)}</span>
                    {pkg.updatedAt && (
                      <span className="text-[11px] text-[hsl(var(--muted-fg))]">{formatDate(pkg.updatedAt)}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </ScrollArea>

      <NewProposalPackageDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <LeadDetailPanel
        leadId={selectedLeadId}
        onClose={closeLead}
        onPrev={selectedIndex > 0 ? () => openLead(leadIds[selectedIndex - 1]) : undefined}
        onNext={selectedIndex !== -1 && selectedIndex < leadIds.length - 1
          ? () => openLead(leadIds[selectedIndex + 1])
          : undefined}
      />
    </div>
  )
}
