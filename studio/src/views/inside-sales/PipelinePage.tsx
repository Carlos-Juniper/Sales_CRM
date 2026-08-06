import React, { useState, useMemo } from 'react'
import { Clock, Search, X, Plus } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { PageHeader } from '@/components/layout/PageHeader'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import { ScoreMeter } from '@/components/shared/ScoreMeter'
import { KanbanCardSkeleton } from '@/components/shared/LoadingSkeleton'
import { LeadDetailPanel } from './components/LeadDetailPanel'
import { useLeads } from '@/hooks/useLeads'
import { AddLeadModal } from './components/AddLeadModal'
import { useUIStore } from '@/store/uiStore'
import { formatCurrency, formatRelativeTime, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/pipelineStages'
import type { Lead, LeadStatus } from '@/types'

// --- Kanban Card ---
interface KanbanCardProps {
  lead: Lead
  onSelect: (id: string) => void
}

const KanbanCard = React.memo(function KanbanCard({ lead, onSelect }: KanbanCardProps) {
  return (
    <div
      className="group bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg p-3 cursor-pointer hover:shadow-md hover:border-[#2E7D52]/30 transition-all"
      onClick={() => onSelect(lead.id)}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[hsl(var(--fg))] truncate leading-snug">{lead.property_name}</p>
        <p className="text-[10px] text-[hsl(var(--muted-fg))] mt-0.5">{lead.city}, {lead.state}</p>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <LeadTypeBadge type={lead.lead_type} className="text-[10px] py-0 px-1.5" />
          <span className="text-[10px] font-medium text-[hsl(var(--fg))]">{formatCurrency(lead.estimated_contract_value)}</span>
        </div>
        <div className="mt-2">
          <ScoreMeter score={lead.score} size="sm" showLabel={false} />
        </div>
        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-[hsl(var(--muted-fg))]">
          <Clock className="h-2.5 w-2.5" />
          <span>{formatRelativeTime(lead.updated_at)}</span>
        </div>
      </div>
    </div>
  )
})

// --- Kanban Column ---
// Stages are read-only visual buckets: Qualifying/Estimating/OP Review/Approved
// move automatically (manual sales flow for Qualifying's sub-statuses lives in
// the Lead detail panel's stage tracker; the other three are estimate write-back
// only — see pipelineStages.ts), so there is no drag-and-drop between columns.
interface KanbanColumnProps {
  stage: PipelineStage
  leads: Lead[]
  conversionRate: number | null
  onCardClick: (id: string) => void
  onAddLead: () => void
}

function KanbanColumn({ stage, leads, conversionRate, onCardClick, onAddLead }: KanbanColumnProps) {
  const totalValue = leads.reduce((s, l) => s + l.estimated_contract_value, 0)

  return (
    <div className="flex flex-col min-w-[200px] lg:flex-1 lg:min-w-0">
      <div className={cn('border-t-2 rounded-t-none mb-3 pt-0', stage.borderColor)} />
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-center gap-2">
          <span className={cn('w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0', stage.dotColor)}>
            {leads.length}
          </span>
          <h3 className="text-xs font-semibold text-[hsl(var(--fg))]">{stage.label}</h3>
        </div>
      </div>
      <div className="flex items-center justify-between px-0.5 mb-2">
        <span className="text-sm font-bold text-[hsl(var(--fg))]">{formatCurrency(totalValue)}</span>
        {conversionRate !== null && (
          <span className="text-sm font-bold text-[hsl(var(--fg))]">{conversionRate}% conv</span>
        )}
      </div>

      <div className="flex-1 min-h-[400px] rounded-lg p-2 space-y-2 bg-[hsl(var(--muted))]/50">
        {leads.map((lead) => (
          <KanbanCard key={lead.id} lead={lead} onSelect={onCardClick} />
        ))}
      </div>

      {stage.allowManualCreate && (
        <button
          type="button"
          onClick={onAddLead}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-[hsl(var(--border))] text-[11px] text-[hsl(var(--muted-fg))] hover:border-[#2E7D52]/50 hover:text-[#2E7D52] hover:bg-[#2E7D52]/5 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add lead
        </button>
      )}
    </div>
  )
}

// --- Search Bar ---
interface SearchBarProps {
  value: string
  onChange: (v: string) => void
}

function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[hsl(var(--muted-fg))]" />
      <input
        type="text"
        placeholder="Search leads..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-48 pl-7 pr-7 py-1 text-xs bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-md focus:outline-none focus:ring-1 focus:ring-[#2E7D52]/50 text-[hsl(var(--fg))] placeholder:text-[hsl(var(--muted-fg))]"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// --- Page ---
export default function PipelinePage() {
  const { data, isLoading } = useLeads()
  const selectedLeadId = useUIStore((s) => s.selectedLeadId)
  const selectLead = useUIStore((s) => s.selectLead)
  const [searchQuery, setSearchQuery] = useState('')
  const [addLeadOpen, setAddLeadOpen] = useState(false)

  const allLeads = useMemo(() => data?.data ?? [], [data])

  const conversionRate = useMemo(() => {
    const wonCount = allLeads.filter((l: Lead) => l.status === 'won').length
    const lostCount = allLeads.filter((l: Lead) => l.status === 'lost').length
    const total = wonCount + lostCount
    if (total === 0) return null
    return Math.round((wonCount / total) * 100)
  }, [allLeads])

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return allLeads
    const q = searchQuery.toLowerCase()
    return allLeads.filter((l: Lead) =>
      l.property_name.toLowerCase().includes(q) ||
      l.city.toLowerCase().includes(q) ||
      l.lead_type.toLowerCase().includes(q)
    )
  }, [allLeads, searchQuery])

  const columnLeads = useMemo(() => {
    const byStage: Record<string, Lead[]> = {}
    for (const stage of PIPELINE_STAGES) {
      byStage[stage.key] = filteredLeads.filter((l: Lead) => (stage.statuses as LeadStatus[]).includes(l.status))
    }
    return byStage
  }, [filteredLeads])

  const activeLeadCount = useMemo(
    () => PIPELINE_STAGES.reduce((s, stage) => s + (columnLeads[stage.key]?.length ?? 0), 0),
    [columnLeads]
  )

  const totalPipelineValue = useMemo(
    () => PIPELINE_STAGES.reduce((s, stage) => s + (columnLeads[stage.key] ?? []).reduce((ss: number, l: Lead) => ss + l.estimated_contract_value, 0), 0),
    [columnLeads]
  )

  function findStageForLead(leadId: string): string | null {
    for (const stage of PIPELINE_STAGES) {
      if (columnLeads[stage.key]?.some((l: Lead) => l.id === leadId)) return stage.key
    }
    return null
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav
        title="Pipeline"
        subtitle={`${activeLeadCount} leads · ${formatCurrency(totalPipelineValue)} open`}
        actions={<SearchBar value={searchQuery} onChange={setSearchQuery} />}
      />

      <div className="flex-1 overflow-auto p-5">
        <PageHeader
          title="Inbound Pipeline"
          description="Leads move between stages automatically as estimates progress."
          actions={
            <Button size="sm" onClick={() => setAddLeadOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add lead
            </Button>
          }
        />

        {isLoading ? (
          <div className="flex gap-4">
            {PIPELINE_STAGES.map(stage => (
              <div key={stage.key} className="min-w-[200px] lg:flex-1 lg:min-w-0 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <KanbanCardSkeleton key={i} />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4 pb-4 min-w-max lg:w-full lg:min-w-0">
            {PIPELINE_STAGES.map(stage => (
              <KanbanColumn
                key={stage.key}
                stage={stage}
                leads={columnLeads[stage.key] ?? []}
                conversionRate={conversionRate}
                onCardClick={selectLead}
                onAddLead={() => setAddLeadOpen(true)}
              />
            ))}
          </div>
        )}
      </div>

      {addLeadOpen && (
        <AddLeadModal
          open
          defaultStatus="new"
          onClose={() => setAddLeadOpen(false)}
        />
      )}

      <LeadDetailPanel
        leadId={selectedLeadId}
        onClose={() => selectLead(null)}
        onPrev={(() => {
          if (!selectedLeadId) return undefined
          const stage = findStageForLead(selectedLeadId)
          if (!stage) return undefined
          const stageLeads = columnLeads[stage] ?? []
          const idx = stageLeads.findIndex((l) => l.id === selectedLeadId)
          return idx > 0 ? () => selectLead(stageLeads[idx - 1].id) : undefined
        })()}
        onNext={(() => {
          if (!selectedLeadId) return undefined
          const stage = findStageForLead(selectedLeadId)
          if (!stage) return undefined
          const stageLeads = columnLeads[stage] ?? []
          const idx = stageLeads.findIndex((l) => l.id === selectedLeadId)
          return idx !== -1 && idx < stageLeads.length - 1 ? () => selectLead(stageLeads[idx + 1].id) : undefined
        })()}
      />
    </div>
  )
}
