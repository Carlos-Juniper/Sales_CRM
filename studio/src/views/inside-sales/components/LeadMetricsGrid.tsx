import { formatCurrency, formatDate, daysUntil, cn } from '@/lib/utils'
import { STRONG_FIT_SCORE, GOOD_FIT_SCORE } from '@/lib/constants'
import type { Lead } from '@/types'

interface LeadMetricsGridProps {
  lead: Lead
}

export function LeadMetricsGrid({ lead }: LeadMetricsGridProps) {
  const score = lead.score ?? 0
  const scoreFitLabel = score >= STRONG_FIT_SCORE ? 'strong fit' : score >= GOOD_FIT_SCORE ? 'good fit' : 'moderate fit'

  return (
    <>
      {/* Metric tiles */}
      <div className="px-6 pb-4 grid grid-cols-4 gap-3">
        <div className="border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] font-semibold text-[#2E7D52] uppercase tracking-wide mb-1">
            $ Annual Value
          </p>
          <p className="text-lg font-bold text-gray-900 leading-none">
            {formatCurrency(lead.estimated_contract_value)}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">est. contract</p>
        </div>

        <div className="border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] font-semibold text-[#2E7D52] uppercase tracking-wide mb-1">
            Score
          </p>
          <p className="text-lg font-bold text-gray-900 leading-none">{lead.score}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{scoreFitLabel}</p>
        </div>

        {lead.bid_deadline ? (
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide mb-1">
              Bid Due
            </p>
            <p className={cn(
              'text-lg font-bold leading-none',
              daysUntil(lead.bid_deadline) <= 14 ? 'text-orange-500' : 'text-gray-900'
            )}>
              {daysUntil(lead.bid_deadline)} days
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(lead.bid_deadline)}</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Bid Due
            </p>
            <p className="text-sm font-medium text-gray-400">—</p>
          </div>
        )}

        <div className="border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Distance
          </p>
          <p className="text-lg font-bold text-gray-900 leading-none">
            {lead.distance_miles} mi
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">from branch</p>
        </div>
      </div>

    </>
  )
}
