import { Zap } from 'lucide-react'
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
            ⚡ Score
          </p>
          <p className="text-lg font-bold text-gray-900 leading-none">{lead.score}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{scoreFitLabel}</p>
        </div>

        {lead.bid_deadline ? (
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide mb-1">
              🔥 Bid Due
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
            ◎ Distance
          </p>
          <p className="text-lg font-bold text-gray-900 leading-none">
            {lead.distance_miles} mi
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">from branch</p>
        </div>
      </div>

      {/* AI Hook callout */}
      {lead.score_factors && lead.score_factors.length > 0 && (
        <div className="mx-6 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3.5">
          <div className="flex items-start gap-2.5">
            <Zap className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-0.5">AI Hook</p>
              <p className="text-sm text-amber-800 leading-relaxed">
                {lead.score_factors[0]?.description ||
                  `Score ${lead.score}/100 — ${lead.score_factors.map(f => `${f.name} ${f.score}/${f.max}`).join(', ')}.`}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
