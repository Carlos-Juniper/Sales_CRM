import { useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBidByLeadId, useCreateBid, useUpdateBid } from '@/hooks/useBids'
import { useUpdateLead } from '@/hooks/useLeads'
import { useApprovedEstimate } from '@/hooks/useApprovedEstimate'
import { formatCurrency, formatDate, daysUntil, cn } from '@/lib/utils'
import { ProposalBuilder } from '@/views/inside-sales/components/estimating/ProposalBuilder'
import type { Lead } from '@/types'

interface BidTabProps {
  lead: Lead
  /**
   * Controlled builder visibility. LeadDetailPanel's action bar owns this so
   * its Generate Proposal button can switch to this tab and expand the builder
   * in one click; left uncontrolled the tab manages its own state.
   */
  builderOpen?: boolean
  onBuilderOpenChange?: (open: boolean) => void
}

export function BidTab({ lead, builderOpen, onBuilderOpenChange }: BidTabProps) {
  const [bidAmountDraft, setBidAmountDraft] = useState<string | null>(null)
  const [localBuilderOpen, setLocalBuilderOpen] = useState(false)

  const showProposalBuilder = builderOpen ?? localBuilderOpen
  const setShowProposalBuilder = onBuilderOpenChange ?? setLocalBuilderOpen

  const { data: existingBid } = useBidByLeadId(lead.id)
  const createBid = useCreateBid()
  const updateBid = useUpdateBid()
  const updateLead = useUpdateLead()

  // Shared with LeadDetailPanel's action-bar button — same query key, one fetch.
  const { estimate: approvedEstimate, isLoading: loadingApprovedEstimate } =
    useApprovedEstimate(lead)

  const effectiveBidAmount = bidAmountDraft ?? (existingBid ? existingBid.estimated_value.toString() : '')

  function handleGenerateBid() {
    createBid.mutate({
      title: lead.property_name,
      agency: lead.contact_name ?? lead.property_name,
      service_types: [lead.lead_type],
      deadline: lead.bid_deadline ?? new Date(Date.now() + 30 * 24 * 3600000).toISOString(),
      estimated_value: lead.estimated_contract_value,
      lead_id: lead.id,
      ...(lead.branch_id ? { branch_id: lead.branch_id } : {}),
    })
  }

  function handleSaveBid() {
    if (!existingBid || bidAmountDraft === null) return
    const val = parseFloat(bidAmountDraft)
    if (isNaN(val)) return
    updateBid.mutate(
      { id: existingBid.id, body: { estimated_value: val } },
      { onSuccess: () => setBidAmountDraft(null) },
    )
  }

  async function handleSendBid() {
    if (!existingBid) return
    try {
      const val = bidAmountDraft !== null ? parseFloat(bidAmountDraft) : existingBid.estimated_value
      await updateBid.mutateAsync({ id: existingBid.id, body: { estimated_value: val, status: 'submitted' } })
      setBidAmountDraft(null)
      if (lead.status !== 'proposal_sent') {
        await updateLead.mutateAsync({ id: lead.id, body: { status: 'proposal_sent' } })
      }
    } catch {
      // mutation onError handlers surface toasts
    }
  }

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Bid section */}
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Bid</p>

        {!existingBid ? (
          <div className="flex flex-col items-center py-8 border border-dashed border-gray-200 rounded-lg text-center gap-3">
            <p className="text-sm text-gray-500">No bid created yet for this lead.</p>
            <Button
              size="sm"
              className="bg-[#2E7D52] hover:bg-[#256644] text-white"
              disabled={createBid.isPending}
              onClick={handleGenerateBid}
            >
              {createBid.isPending ? 'Generating…' : 'Generate Bid'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 capitalize">
                Status: <span className="font-semibold text-gray-800">{existingBid.status.replace(/_/g, ' ')}</span>
              </span>
              {lead.bid_deadline && (
                <span className="text-xs text-orange-500 font-medium">
                  Due {formatDate(lead.bid_deadline)}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Bid Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={effectiveBidAmount}
                  onChange={(e) => setBidAmountDraft(e.target.value)}
                  aria-label="Bid amount"
                  placeholder="0"
                  className="w-full pl-7 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2E7D52]/30 focus:border-[#2E7D52]"
                />
              </div>
              {bidAmountDraft !== null && (
                <p className="text-[10px] text-gray-400">
                  ML estimate: {formatCurrency(existingBid.estimated_value)} · Editing manually
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              {bidAmountDraft !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={updateBid.isPending}
                  onClick={handleSaveBid}
                >
                  {updateBid.isPending ? 'Saving…' : 'Save Bid'}
                </Button>
              )}
              <Button
                size="sm"
                className="flex-1 bg-[#2E7D52] hover:bg-[#256644] text-white"
                disabled={updateBid.isPending || existingBid.status === 'submitted' || existingBid.status === 'won'}
                onClick={handleSendBid}
              >
                <Send className="h-3.5 w-3.5" />
                {existingBid.status === 'submitted' || existingBid.status === 'won'
                  ? 'Bid Sent'
                  : updateBid.isPending ? 'Sending…' : 'Send Bid'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Proposal section — WS2: always rendered when a lead exists (no estimate
          required). approvedEstimate is passed when present so ProposalBuilder
          can display estimate-derived pricing; it is null otherwise. */}
      {!loadingApprovedEstimate && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Proposal</p>

          {showProposalBuilder ? (
            <ProposalBuilder
              lead={lead}
              estimate={approvedEstimate ?? null}
              onClose={() => setShowProposalBuilder(false)}
            />
          ) : (
            <div className="flex flex-col items-center py-8 border border-dashed border-gray-200 rounded-lg text-center gap-3">
              <p className="text-sm text-gray-500">No proposal generated yet for this lead.</p>
              <Button
                size="sm"
                className="bg-[#2E7D52] hover:bg-[#256644] text-white"
                onClick={() => setShowProposalBuilder(true)}
              >
                Generate Proposal
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Bid Tracker */}
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Bid Tracker</p>
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-gray-500">Est. Annual Value</span>
            <span className="text-sm font-semibold text-gray-900">
              {formatCurrency(lead.estimated_contract_value)}
            </span>
          </div>
          {lead.bid_deadline && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-gray-500">Bid Deadline</span>
              <span className={cn('text-sm font-semibold', daysUntil(lead.bid_deadline) <= 14 ? 'text-orange-500' : 'text-gray-900')}>
                {formatDate(lead.bid_deadline)} · {daysUntil(lead.bid_deadline)} days
              </span>
            </div>
          )}
          {existingBid && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-gray-500">Bid Amount</span>
              <span className="text-sm font-semibold text-gray-900">
                {formatCurrency(existingBid.estimated_value)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
