import { useState } from 'react'
import { Send, Phone, Link, ExternalLink } from 'lucide-react'
import { formatRelativeTime, getInitials } from '@/lib/utils'
import { useUpdateLead } from '@/hooks/useLeads'
import { Button } from '@/components/ui/button'
import type { Lead } from '@/types'

interface OverviewTabProps {
  lead: Lead
}

export function OverviewTab({ lead }: OverviewTabProps) {
  const updateLead = useUpdateLead()
  const [notes, setNotes] = useState(lead.notes ?? '')
  const isDirty = notes !== (lead.notes ?? '')

  async function handleSaveNotes() {
    try {
      await updateLead.mutateAsync({ id: lead.id, body: { notes } })
    } catch {
      // error toast handled by useUpdateLead
    }
  }

  return (
    <div className="px-6 py-5 space-y-6">
      {/* Contact */}
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Contact</p>
        {lead.contact_name ? (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50">
            <div className="h-9 w-9 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-gray-700">
              {getInitials(lead.contact_name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{lead.contact_name}</p>
              {lead.contact_email && (
                <p className="text-xs text-gray-500 truncate">{lead.contact_email}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {lead.contact_email && (
                <a
                  href={`mailto:${lead.contact_email}`}
                  className="h-7 w-7 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-white transition-colors"
                  title="Send email"
                >
                  <Send className="h-3.5 w-3.5" />
                </a>
              )}
              <button
                type="button"
                className="h-7 w-7 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-white transition-colors cursor-pointer"
                aria-label="Call contact"
              >
                <Phone className="h-3.5 w-3.5" />
              </button>
              {lead.contact_linkedin && (
                <a
                  href={lead.contact_linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-7 w-7 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-white transition-colors"
                  title="LinkedIn"
                >
                  <Link className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No contact identified yet</p>
        )}
      </div>

      {/* Score breakdown */}
      {lead.score_factors && lead.score_factors.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Why this scores {lead.score}
            </p>
            <button type="button" className="text-xs text-[#2E7D52] hover:underline cursor-pointer">
              How is this calculated?
            </button>
          </div>
          <div className="space-y-3">
            {lead.score_factors.map((factor) => (
              <div key={factor.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-700">{factor.name}</span>
                  <span className="text-xs font-semibold text-gray-900 tabular-nums">
                    {factor.score}/{factor.max}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#2E7D52] transition-all duration-500 factor-bar-fill"
                    style={{ '--bar-width': `${(factor.score / factor.max) * 100}%` } as React.CSSProperties}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Property */}
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Property</p>
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          <div>
            <p className="text-xs text-gray-400">Acreage</p>
            <p className="font-semibold text-gray-900 mt-0.5">{lead.estimated_acreage} ac</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Type</p>
            <p className="font-semibold text-gray-900 mt-0.5 capitalize">{lead.lead_type}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Source</p>
            <p className="font-semibold text-gray-900 mt-0.5 capitalize">{lead.source.replace(/_/g, ' ')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Discovered</p>
            <p className="font-semibold text-gray-900 mt-0.5">{formatRelativeTime(lead.created_at)}</p>
          </div>
          {lead.current_provider && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400">Current provider</p>
              <p className="font-semibold text-amber-700 mt-0.5">{lead.current_provider}</p>
            </div>
          )}
        </div>
        {lead.source_url && (
          <a
            href={lead.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-xs text-[#2E7D52] hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View original source
          </a>
        )}
      </div>

      {/* Notes */}
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Notes</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Add internal notes about this lead…"
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2E7D52]/40 focus:border-[#2E7D52] resize-none"
        />
        {isDirty && (
          <div className="flex justify-end mt-2">
            <Button
              size="sm"
              onClick={handleSaveNotes}
              disabled={updateLead.isPending}
            >
              {updateLead.isPending ? 'Saving…' : 'Save notes'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
