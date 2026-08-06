import type { LeadStatus } from '@/types'

export interface PipelineStage {
  key: string
  label: string
  borderColor: string
  dotColor: string
  /** Hex fill color — for chart/map contexts that can't use Tailwind classes. */
  hexColor: string
  statuses: LeadStatus[]
  /**
   * Only Qualifying allows manually creating a lead directly into it. The
   * other three stages are reached exclusively via the estimate write-back
   * (create/PATCH in api/estimating.py) — never by direct creation or drag.
   */
  allowManualCreate: boolean
}

// Single source of truth for the Pipeline kanban's four stages. Qualifying
// alone buckets three LeadStatus values (new/contacted/qualified stay
// independently settable via the Lead detail panel's stage tracker); the
// other three map 1:1 to their own auto-driven status.
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    key: 'qualifying',
    label: 'Qualifying',
    borderColor: 'border-sky-400',
    dotColor: 'bg-sky-500',
    hexColor: '#60a5fa',
    statuses: ['new', 'contacted', 'qualified'],
    allowManualCreate: true,
  },
  {
    key: 'estimating',
    label: 'Estimating',
    borderColor: 'border-orange-400',
    dotColor: 'bg-orange-500',
    hexColor: '#fb923c',
    statuses: ['estimating'],
    allowManualCreate: false,
  },
  {
    key: 'op_review',
    label: 'OP Review',
    borderColor: 'border-amber-400',
    dotColor: 'bg-amber-500',
    hexColor: '#fbbf24',
    statuses: ['op_review'],
    allowManualCreate: false,
  },
  {
    key: 'approved',
    label: 'Approved',
    borderColor: 'border-emerald-400',
    dotColor: 'bg-emerald-500',
    hexColor: '#34d399',
    statuses: ['approved'],
    allowManualCreate: false,
  },
]

// Terminal/hidden statuses — never rendered as a kanban column.
export const HIDDEN_LEAD_STATUSES: LeadStatus[] = ['disqualified', 'proposal_sent', 'won', 'lost']

export function stageForStatus(status: LeadStatus): PipelineStage | undefined {
  return PIPELINE_STAGES.find((stage) => stage.statuses.includes(status))
}
