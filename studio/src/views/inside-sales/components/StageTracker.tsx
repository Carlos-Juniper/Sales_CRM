import { cn } from '@/lib/utils'
import type { LeadStatus } from '@/types'

const STAGE_SEQUENCE: { key: LeadStatus; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal_sent', label: 'Proposal' },
  { key: 'won', label: 'Won' },
]

interface StageTrackerProps {
  status: LeadStatus
  onStageChange: (status: LeadStatus) => void
}

export function StageTracker({ status, onStageChange }: StageTrackerProps) {
  return (
    <div className="px-6 pb-4">
      <div className="flex items-stretch rounded-lg overflow-hidden border border-gray-200">
        {STAGE_SEQUENCE.map((stage, idx) => {
          const currentIdx = STAGE_SEQUENCE.findIndex(s => s.key === status)
          const isActive = stage.key === status
          const isPast = idx < currentIdx
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => onStageChange(stage.key)}
              className={cn(
                'flex-1 py-2 text-xs font-semibold text-center transition-colors cursor-pointer border-r border-gray-200 last:border-r-0',
                isActive
                  ? 'bg-[#1f2937] text-white'
                  : isPast
                  ? 'bg-green-50 text-green-700 hover:bg-green-100'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
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
