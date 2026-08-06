import { cn } from '@/lib/utils'
import type { LeadStatus } from '@/types'

interface Stage {
  key: LeadStatus
  label: string
  /**
   * Estimating/OP Review/Approved are auto-driven by the estimate write-back
   * (see pipelineStages.ts) — never independently settable, so those pills
   * render progress only and aren't click targets.
   */
  manual: boolean
}

const STAGE_SEQUENCE: Stage[] = [
  { key: 'new', label: 'New', manual: true },
  { key: 'contacted', label: 'Contacted', manual: true },
  { key: 'qualified', label: 'Qualified', manual: true },
  { key: 'estimating', label: 'Estimating', manual: false },
  { key: 'op_review', label: 'OP Review', manual: false },
  { key: 'approved', label: 'Approved', manual: false },
  { key: 'proposal_sent', label: 'Proposal', manual: true },
  { key: 'won', label: 'Won', manual: true },
]

interface StageTrackerProps {
  status: LeadStatus
  onStageChange: (status: LeadStatus) => void
}

export function StageTracker({ status, onStageChange }: StageTrackerProps) {
  const currentIdx = STAGE_SEQUENCE.findIndex(s => s.key === status)
  return (
    <div className="px-6 pb-4">
      <div className="flex items-stretch rounded-lg overflow-hidden border border-gray-200">
        {STAGE_SEQUENCE.map((stage, idx) => {
          const isActive = stage.key === status
          const isPast = idx < currentIdx
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => { if (stage.manual) onStageChange(stage.key) }}
              disabled={!stage.manual}
              className={cn(
                'flex-1 py-2 text-xs font-semibold text-center transition-colors border-r border-gray-200 last:border-r-0',
                stage.manual ? 'cursor-pointer' : 'cursor-default',
                isActive
                  ? 'bg-[#1f2937] text-white'
                  : isPast
                  ? cn('bg-green-50 text-green-700', stage.manual && 'hover:bg-green-100')
                  : cn('bg-white text-gray-500', stage.manual && 'hover:bg-gray-50')
              )}
            >
              {stage.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
