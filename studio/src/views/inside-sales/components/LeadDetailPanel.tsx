import { useEffect, useRef, useState } from 'react'
import './LeadDetailPanel.css'
import { useNavigate } from 'react-router-dom'
import {
  X, MapPin, ChevronUp, ChevronDown, ArrowRight, Pencil, Trash2, CheckCircle2,
} from 'lucide-react'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { HandoffModal } from './HandoffModal'
import { EditLeadModal } from './EditLeadModal'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { StageTracker } from './StageTracker'
import { LeadMetricsGrid } from './LeadMetricsGrid'
import { DeleteLeadDialog } from './DeleteLeadDialog'
import { useLead, useUpdateLead, useDeleteLead } from '@/hooks/useLeads'
import { useLeadPanelKeyboard } from '@/hooks/useLeadPanelKeyboard'
import type { LeadStatus } from '@/types'
import { OverviewTab } from './OverviewTab'
import { BidTab } from './BidTab'
import { CalendarTab } from './CalendarTab'

interface LeadDetailPanelProps {
  leadId: string | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}

export function LeadDetailPanel({ leadId, onClose, onPrev, onNext }: LeadDetailPanelProps) {
  const navigate = useNavigate()
  const { data: lead, isLoading } = useLead(leadId)
  const updateLead = useUpdateLead()
  const deleteLead = useDeleteLead()
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useLeadPanelKeyboard(leadId, onClose, onPrev, onNext)

  useEffect(() => {
    if (leadId) panelRef.current?.focus()
  }, [leadId])

  async function handleStageClick(status: LeadStatus) {
    if (!lead || lead.status === status) return
    try {
      await updateLead.mutateAsync({ id: lead.id, body: { status } })
    } catch {
      // error toast shown by useUpdateLead's onError
    }
  }

  async function handleDelete() {
    if (!lead) return
    try {
      await deleteLead.mutateAsync(lead.id)
      setDeleteOpen(false)
      onClose()
    } catch {
      // error toast shown by useDeleteLead's onError
    }
  }

  if (!leadId) return null

  return (
    <>
      <div className="fixed inset-0 z-[1200] flex justify-end" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-black/40 fade-in" onClick={onClose} aria-hidden="true" />

        <div
          ref={panelRef}
          tabIndex={-1}
          className="relative flex flex-col h-full bg-white border-l border-gray-200 shadow-2xl slide-in-right overflow-hidden w-full sm:max-w-2xl focus:outline-none"
        >
          {isLoading || !lead ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className={`h-4 ${i % 3 === 0 ? 'w-1/2' : 'w-full'}`} />
              ))}
            </div>
          ) : (
            <>
              {/* Top header bar */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>

                <LeadTypeBadge type={lead.lead_type} />

                {lead.aspire_opportunity_id && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 flex-shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    In Aspire
                  </span>
                )}

                {lead.source_url ? (
                  <a
                    href={lead.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-500 hover:text-gray-700 truncate flex-1 min-w-0"
                  >
                    {lead.source} · {lead.source_url.replace(/^https?:\/\//, '').split('/')[0]}
                  </a>
                ) : (
                  <span className="text-xs text-gray-500 truncate flex-1 min-w-0 capitalize">
                    {lead.source.replace(/_/g, ' ')}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                  aria-label="Edit lead details"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={onPrev}
                    disabled={!onPrev}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronUp className="h-3.5 w-3.5" /> Prev
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    disabled={!onNext}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Next <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto">
                {/* Title + address */}
                <div className="px-6 pt-5 pb-4">
                  <h2 className="text-2xl font-bold text-gray-900 leading-tight mb-1.5">
                    {lead.property_name}
                  </h2>
                  <div className="flex items-center gap-1.5 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{lead.address}, {lead.city}, {lead.state} {lead.zip}</span>
                    {lead.lat && lead.lng && (
                      <a
                        href={`https://maps.google.com/?q=${lead.lat},${lead.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 text-[#2E7D52] hover:underline font-medium"
                      >
                        View map
                      </a>
                    )}
                  </div>
                </div>

                <StageTracker status={lead.status} onStageChange={handleStageClick} />

                <LeadMetricsGrid lead={lead} />

                {/* Tabs */}
                <Tabs defaultValue="overview" className="flex flex-col">
                  <div className="px-6 border-b border-gray-100 flex-shrink-0">
                    <TabsList className="w-auto bg-transparent p-0 gap-0 h-auto rounded-none">
                      {[
                        { value: 'overview', label: 'Overview' },
                        { value: 'calendar', label: 'Calendar' },
                        { value: 'bid', label: 'Bid' },
                      ].map(tab => (
                        <TabsTrigger
                          key={tab.value}
                          value={tab.value}
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-gray-900 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none text-gray-500 hover:text-gray-700 px-4 py-3 text-sm font-medium transition-colors"
                        >
                          {tab.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </div>

                  <TabsContent value="overview" className="mt-0">
                    <OverviewTab lead={lead} />
                  </TabsContent>

                  <TabsContent value="calendar" className="mt-0">
                    <CalendarTab lead={lead} />
                  </TabsContent>

                  <TabsContent value="bid" className="mt-0">
                    <BidTab lead={lead} />
                  </TabsContent>
                </Tabs>

                <div className="h-20" />
              </div>

              {/* Sticky bottom action bar */}
              <div className="flex-shrink-0 border-t border-gray-100 bg-white px-4 py-3 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1.5 text-gray-700"
                  onClick={() => { onClose(); navigate('/inside-sales/estimating') }}
                >
                  Open in Estimating
                </Button>
                <Button
                  size="sm"
                  className="flex items-center gap-1.5 bg-[#2E7D52] hover:bg-[#256644] text-white"
                  onClick={() => setHandoffOpen(true)}
                  disabled={lead.status === 'handed_off'}
                >
                  {lead.status === 'handed_off' ? 'Handed Off' : 'Hand off to Estimating Team'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="ml-auto flex items-center gap-1.5"
                  aria-label="Delete lead"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <HandoffModal lead={lead ?? null} isOpen={handoffOpen} onClose={() => setHandoffOpen(false)} />
      {lead && <EditLeadModal lead={lead} open={editOpen} onClose={() => setEditOpen(false)} />}

      <DeleteLeadDialog
        isOpen={deleteOpen}
        isPending={deleteLead.isPending}
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  )
}
