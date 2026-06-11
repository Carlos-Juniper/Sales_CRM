import { Mail } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { EmptyState } from '@/components/shared/EmptyState'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useUIStore } from '@/store/uiStore'
import { useOutreachQueue } from '@/hooks/useLeads'
import { QueueItem } from './components/outreach/QueueItem'
import { OutreachDetail } from './components/outreach/OutreachDetail'
import type { Lead } from '@/types'

export default function OutreachQueuePage() {
  const { queue, isLoading } = useOutreachQueue()
  const selectedLeadId = useUIStore((s) => s.selectedLeadId)
  const selectLead = useUIStore((s) => s.selectLead)

  const overdueCount = queue.length
  const firstLead = queue[0]
  const activeId = selectedLeadId ?? firstLead?.id ?? null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav
        title="Outreach Queue"
        subtitle={`${overdueCount} pending follow-ups`}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Queue list ── */}
        <div className="w-[300px] flex-shrink-0 border-r border-[hsl(var(--border))] flex flex-col overflow-hidden bg-[hsl(var(--card))]">
          <div className="px-3 py-3 border-b border-[hsl(var(--border))] flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide">
                Follow-up queue
              </span>
              {overdueCount > 0 && (
                <span className="text-[10px] font-bold bg-red-500 text-white rounded-full px-2 py-0.5">
                  {overdueCount}
                </span>
              )}
            </div>
            <p className="text-[10px] text-[hsl(var(--muted-fg))] mt-0.5">
              {overdueCount} overdue · {queue.length} total
            </p>
          </div>

          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="space-y-0">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-24 border-b border-[hsl(var(--border))] skeleton-shimmer" />
                ))}
              </div>
            ) : queue.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Queue is empty"
                  description="All follow-ups are complete."
                  icon={Mail}
                />
              </div>
            ) : (
              queue.map((lead: Lead) => (
                <QueueItem
                  key={lead.id}
                  lead={lead}
                  isSelected={lead.id === activeId}
                  onClick={() => selectLead(lead.id === activeId ? null : lead.id)}
                />
              ))
            )}
          </ScrollArea>
        </div>

        {/* ── Right: Outreach detail ── */}
        <div className="flex-1 overflow-hidden bg-[hsl(var(--background))]">
          {activeId ? (
            <OutreachDetail key={activeId} leadId={activeId} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-[hsl(var(--muted-fg))]">Select a lead to see outreach history</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
