import { useState } from 'react'
import { ArrowUp, ArrowDown, RefreshCw, Plus } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { LeadCard } from '@/components/shared/LeadCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { LeadCardSkeleton } from '@/components/shared/LoadingSkeleton'
import { LeadDetailPanel } from './components/LeadDetailPanel'
import { LeadFilters } from './components/LeadFilters'
import { AddLeadModal } from './components/AddLeadModal'
import { Button } from '@/components/ui/button'
import { useLeads } from '@/hooks/useLeads'
import { useLeadsStore } from '@/store/leadsStore'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { PAGE_SIZE } from '@/lib/constants'
import type { Lead } from '@/types'
import { ScrollArea } from '@/components/ui/scroll-area'

type SortField = 'score' | 'created_at' | 'estimated_contract_value' | 'bid_deadline'

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'score', label: 'Score' },
  { field: 'estimated_contract_value', label: 'Value' },
  { field: 'created_at', label: 'Date Added' },
  { field: 'bid_deadline', label: 'Deadline' },
]

export default function LeadFeedPage() {
  const { data, isLoading, isError, refetch } = useLeads()
  const { sortBy, sortDir, setSort, page, setPage } = useLeadsStore()
  const selectedLeadId = useUIStore((s) => s.selectedLeadId)
  const selectLead = useUIStore((s) => s.selectLead)
  const [addLeadOpen, setAddLeadOpen] = useState(false)

  const leads = data?.data ?? []
  const total = data?.total ?? 0

  const SortIcon = sortDir === 'desc' ? ArrowDown : ArrowUp

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="Public Leads" subtitle={`${total} total leads`} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <LeadFilters />

        {/* Sort controls */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] flex-shrink-0">
          <span className="text-xs text-[hsl(var(--muted-fg))] mr-1">Sort:</span>
          {SORT_OPTIONS.map(({ field, label }) => (
            <button
              key={field}
              onClick={() => setSort(field)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
                sortBy === field
                  ? 'bg-[#2E7D52] text-white'
                  : 'text-[hsl(var(--muted-fg))] hover:bg-[hsl(var(--muted))]'
              )}
            >
              {label}
              {sortBy === field && <SortIcon className="h-3 w-3" />}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-xs text-[hsl(var(--muted-fg))]">
            <span>{leads.length} shown</span>
            <Button variant="ghost" size="icon-sm" onClick={() => refetch()} title="Refresh">
              <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={() => setAddLeadOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add lead
            </Button>
          </div>
        </div>

        {/* Lead list */}
        <ScrollArea className="flex-1">
          <div className="p-4 grid gap-3 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {isLoading && Array.from({ length: 6 }).map((_, i) => <LeadCardSkeleton key={i} />)}

            {isError && (
              <div className="col-span-full">
                <EmptyState
                  title="Failed to load leads"
                  description="Check your connection and try again."
                  action={{ label: 'Retry', onClick: () => refetch() }}
                />
              </div>
            )}

            {!isLoading && !isError && leads.length === 0 && (
              <div className="col-span-full">
                <EmptyState
                  title="No leads match your filters"
                  description="Try adjusting or clearing the filters above."
                />
              </div>
            )}

            {!isLoading && leads.map((lead: Lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onClick={() => selectLead(lead.id === selectedLeadId ? null : lead.id)}
                isSelected={lead.id === selectedLeadId}
              />
            ))}

            {/* Pagination */}
            {!isLoading && total > PAGE_SIZE && (
              <div className="col-span-full flex items-center justify-between pt-2">
                <span className="text-xs text-[hsl(var(--muted-fg))]">
                  Page {page} of {Math.ceil(total / PAGE_SIZE)}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page === 1}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page * PAGE_SIZE >= total}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <AddLeadModal
        open={addLeadOpen}
        defaultStatus="new"
        onClose={() => setAddLeadOpen(false)}
      />

      <LeadDetailPanel
        leadId={selectedLeadId}
        onClose={() => selectLead(null)}
        onPrev={(() => {
          const idx = leads.findIndex((l) => l.id === selectedLeadId)
          return idx > 0 ? () => selectLead(leads[idx - 1].id) : undefined
        })()}
        onNext={(() => {
          const idx = leads.findIndex((l) => l.id === selectedLeadId)
          return idx !== -1 && idx < leads.length - 1 ? () => selectLead(leads[idx + 1].id) : undefined
        })()}
      />
    </div>
  )
}
