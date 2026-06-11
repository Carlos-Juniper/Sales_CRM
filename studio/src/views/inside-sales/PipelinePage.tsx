import React, { useState, useMemo, useRef, useEffect } from 'react'
import './PipelinePage.css'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'
import { GripVertical, Clock, Search, X, Plus } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { PageHeader } from '@/components/layout/PageHeader'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import { ScoreMeter } from '@/components/shared/ScoreMeter'
import { KanbanCardSkeleton } from '@/components/shared/LoadingSkeleton'
import { LeadDetailPanel } from './components/LeadDetailPanel'
import { useLeads, useUpdateLead } from '@/hooks/useLeads'
import { AddLeadModal } from './components/AddLeadModal'
import { useUIStore } from '@/store/uiStore'
import { formatCurrency, formatRelativeTime, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { Lead, LeadStatus } from '@/types'

const COLUMNS: { id: LeadStatus; title: string; color: string; index: number }[] = [
  { id: 'new', title: 'New Leads', color: 'border-sky-400', index: 1 },
  { id: 'contacted', title: 'Contacted', color: 'border-blue-400', index: 2 },
  { id: 'proposal_sent', title: 'Proposal Sent', color: 'border-purple-400', index: 3 },
]

const COLUMN_COLORS: Record<string, string> = {
  new: 'bg-sky-500',
  contacted: 'bg-blue-500',
  proposal_sent: 'bg-purple-500',
}

// --- Kanban Card ---
interface KanbanCardProps {
  lead: Lead
  onSelect: (id: string) => void
  isDragging?: boolean
}

const KanbanCard = React.memo(function KanbanCard({ lead, onSelect, isDragging = false }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: sortableIsDragging } = useSortable({ id: lead.id })
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!cardRef.current) return
    cardRef.current.style.transform = CSS.Transform.toString(transform) ?? ''
    cardRef.current.style.transition = transition ?? ''
  }, [transform, transition])

  return (
    <div
      ref={(node) => { setNodeRef(node); cardRef.current = node }}
      className={cn(
        'kanban-card',
        'group bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg p-3 cursor-pointer hover:shadow-md hover:border-[#2E7D52]/30 transition-all',
        (sortableIsDragging || isDragging) && 'opacity-50 shadow-lg'
      )}
      onClick={() => onSelect(lead.id)}
    >
      <div className="flex items-start gap-2">
        <div
          {...attributes}
          {...listeners}
          className="mt-0.5 text-[hsl(var(--muted-fg))] opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
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
    </div>
  )
})

// --- Droppable Column ---
interface KanbanColumnProps {
  id: LeadStatus
  title: string
  color: string
  leads: Lead[]
  conversionRate: number | null
  onCardClick: (id: string) => void
  onAddLead: (status: LeadStatus) => void
}

function KanbanColumn({ id, title, color, leads, conversionRate, onCardClick, onAddLead }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const totalValue = leads.reduce((s, l) => s + l.estimated_contract_value, 0)
  const dotColor = COLUMN_COLORS[id] ?? 'bg-slate-500'

  return (
    <div className="flex flex-col min-w-[240px] flex-1">
      <div className={cn('border-t-2 rounded-t-none mb-3 pt-0', color)} />
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-center gap-2">
          <span className={cn('w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0', dotColor)}>
            {leads.length}
          </span>
          <h3 className="text-xs font-semibold text-[hsl(var(--fg))]">{title}</h3>
        </div>
      </div>
      <div className="flex items-center justify-between px-0.5 mb-2">
        <span className="text-sm font-bold text-[hsl(var(--fg))]">{formatCurrency(totalValue)}</span>
        {conversionRate !== null && (
          <span className="text-sm font-bold text-[hsl(var(--fg))]">{conversionRate}% conv</span>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 min-h-[400px] rounded-lg p-2 space-y-2 transition-colors',
          isOver ? 'bg-[#2E7D52]/5 border border-dashed border-[#2E7D52]' : 'bg-[hsl(var(--muted))]/50'
        )}
      >
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <KanbanCard
              key={lead.id}
              lead={lead}
              onSelect={onCardClick}
            />
          ))}
        </SortableContext>
      </div>

      <button
        type="button"
        onClick={() => onAddLead(id)}
        className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-[hsl(var(--border))] text-[11px] text-[hsl(var(--muted-fg))] hover:border-[#2E7D52]/50 hover:text-[#2E7D52] hover:bg-[#2E7D52]/5 transition-colors"
      >
        <Plus className="h-3 w-3" />
        Add lead
      </button>
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
  const updateLead = useUpdateLead()
  const selectedLeadId = useUIStore((s) => s.selectedLeadId)
  const selectLead = useUIStore((s) => s.selectLead)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [addLeadStatus, setAddLeadStatus] = useState<LeadStatus | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

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
    const byStatus: Record<string, Lead[]> = {}
    for (const col of COLUMNS) {
      byStatus[col.id] = filteredLeads.filter((l: Lead) => l.status === col.id)
    }
    return byStatus
  }, [filteredLeads])

  const activeLead = activeId ? allLeads.find((l: Lead) => l.id === activeId) : null

  const activeLeadCount = useMemo(
    () => COLUMNS.reduce((s, col) => s + (columnLeads[col.id]?.length ?? 0), 0),
    [columnLeads]
  )

  const totalPipelineValue = useMemo(
    () => COLUMNS.reduce((s, col) => s + (columnLeads[col.id] ?? []).reduce((ss: number, l: Lead) => ss + l.estimated_contract_value, 0), 0),
    [columnLeads]
  )

  function findColumnForLead(leadId: string): LeadStatus | null {
    for (const col of COLUMNS) {
      if (columnLeads[col.id]?.some((l: Lead) => l.id === leadId)) return col.id
    }
    return null
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const sourceColumn = findColumnForLead(active.id as string)
    let targetColumn = over.id as LeadStatus
    if (!COLUMNS.some(c => c.id === targetColumn)) {
      targetColumn = findColumnForLead(over.id as string) ?? sourceColumn!
    }

    if (sourceColumn && targetColumn && sourceColumn !== targetColumn) {
      try {
        await updateLead.mutateAsync({ id: active.id as string, body: { status: targetColumn } })
      } catch {
        // useUpdateLead onError already surfaces a toast
      }
    }
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
          description="Drag leads between stages to update their status."
          actions={
            <Button size="sm" onClick={() => setAddLeadStatus('new')}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add lead
            </Button>
          }
        />

        {isLoading ? (
          <div className="flex gap-4">
            {COLUMNS.map(col => (
              <div key={col.id} className="flex-1 min-w-[240px] space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <KanbanCardSkeleton key={i} />)}
              </div>
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 min-w-max pb-4">
              {COLUMNS.map(col => (
                <KanbanColumn
                  key={col.id}
                  id={col.id}
                  title={col.title}
                  color={col.color}
                  leads={columnLeads[col.id] ?? []}
                  conversionRate={conversionRate}
                  onCardClick={selectLead}
                  onAddLead={setAddLeadStatus}
                />
              ))}
            </div>

            <DragOverlay>
              {activeLead && (
                <div className="bg-[hsl(var(--card))] border border-[#2E7D52] rounded-lg p-3 shadow-xl w-56">
                  <p className="text-xs font-medium text-[hsl(var(--fg))] truncate">{activeLead.property_name}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <LeadTypeBadge type={activeLead.lead_type} className="text-[10px] py-0 px-1.5" />
                    <span className="text-[10px] font-medium">{formatCurrency(activeLead.estimated_contract_value)}</span>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {addLeadStatus && (
        <AddLeadModal
          open
          defaultStatus={addLeadStatus}
          onClose={() => setAddLeadStatus(null)}
        />
      )}

      <LeadDetailPanel
        leadId={selectedLeadId}
        onClose={() => selectLead(null)}
        onPrev={(() => {
          if (!selectedLeadId) return undefined
          const col = findColumnForLead(selectedLeadId)
          if (!col) return undefined
          const colLeads = columnLeads[col] ?? []
          const idx = colLeads.findIndex((l) => l.id === selectedLeadId)
          return idx > 0 ? () => selectLead(colLeads[idx - 1].id) : undefined
        })()}
        onNext={(() => {
          if (!selectedLeadId) return undefined
          const col = findColumnForLead(selectedLeadId)
          if (!col) return undefined
          const colLeads = columnLeads[col] ?? []
          const idx = colLeads.findIndex((l) => l.id === selectedLeadId)
          return idx !== -1 && idx < colLeads.length - 1 ? () => selectLead(colLeads[idx + 1].id) : undefined
        })()}
      />
    </div>
  )
}
